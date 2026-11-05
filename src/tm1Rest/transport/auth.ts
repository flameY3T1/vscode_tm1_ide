// src/tm1Rest/transport/auth.ts
// Authentication header construction + TM1 session-cookie parsing.

import * as http from 'http';
import type { Tm1Config } from './types';

// `__EXT_VERSION__` is replaced at bundle time by esbuild `define` from
// package.json#version, so a single source of truth covers the extension
// runtime build. Tests run unbundled — the typeof guard + fallback to
// process.env.npm_package_version keeps EXT_CLIENT_ID populated there too.
declare const __EXT_VERSION__: string | undefined;
const _version: string =
  (typeof __EXT_VERSION__ !== 'undefined' && __EXT_VERSION__) ||
  (typeof process !== 'undefined' && process.env?.npm_package_version) ||
  'dev';

/** User-Agent / TM1-SessionContext value so requests are identifiable in /Threads and tm1server.log. */
export const EXT_CLIENT_ID = `vscode-tm1-ide/${_version}`;

/**
 * Builds the Authorization header value for the given config.
 * - CAM: base64(user:password:namespace), prefixed with `CAMNamespace ` —
 *   namespace MUST be in the credential string, not only TM1-SessionContext
 *   (otherwise TM1 returns 401).
 * - Basic: base64(user:password), prefixed with `Basic `.
 */
export function buildAuth(cfg: Tm1Config): string {
  if (cfg.authType === 'integrated') {
    // Fail loudly instead of silently sending Basic. A server in mode 3
    // rejects Basic (`401`, `WWW-Authenticate: Negotiate`). The only path here
    // leads through `mintIntegratedCookie`, whose result is a cookie.
    throw new Error('Integrated authentication has no Authorization header — the session cookie is minted separately.');
  }
  if (cfg.authType === 'browser') {
    // Same rule: the browser holds the credentials, we only ever have its
    // cookies (`browserLogin.ts`).
    throw new Error('Browser login has no Authorization header — the session comes from the browser\'s cookies.');
  }
  if (cfg.authType === 'CAM') {
    // Narrowed to the CAM member: camNamespace is guaranteed present (the union
    // makes CAM-without-namespace unrepresentable), so no `?? ''` fallback.
    const credentials = Buffer.from(`${cfg.username}:${cfg.password}:${cfg.camNamespace}`).toString('base64');
    return 'CAMNamespace ' + credentials;
  }
  const credentials = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  return 'Basic ' + credentials;
}

/**
 * Builds the outgoing HTTP headers for a TM1 REST request.
 * When `cookie` is provided, Authorization is intentionally omitted: sending
 * Basic alongside a valid cookie can make TM1 open a fresh session and drop
 * the reused one.
 */
export function buildHeaders(
  cfg: Tm1Config,
  body?: string | Buffer,
  extraHeaders?: Record<string, string>,
  cookie?: string,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': EXT_CLIENT_ID,
    ...extraHeaders,
  };
  if (cookie) {
    headers['Cookie'] = cookie;
    // Through PAW (see `integratedSession.ts`) the session carries PAW's
    // anti-CSRF cookie; PAW expects its value echoed in this header on
    // writes. Reads go through without it (2026-09-29); a POST without it is
    // refused by the gateway with 403 (measured on PA SaaS, 2026-10-25).
    const csrf = /(?:^|;\s*)ba-sso-csrf=([^;]*)/.exec(cookie)?.[1];
    if (csrf) { headers['ba-sso-authenticity'] = csrf; }
  } else {
    headers['Authorization'] = buildAuth(cfg);
  }
  // TM1 stores this header verbatim as Session.Context and shows it in
  // /Threads (and tm1server.log), so it must stay the plain client id for
  // EVERY auth type. CAM used to send a `{CAMNamespace, Client}` JSON blob
  // here, which turned the monitor's Context column into unreadable JSON —
  // and it was never needed: the namespace travels in the Authorization
  // credential (`user:password:namespace`, see buildAuth).
  headers['TM1-SessionContext']  = EXT_CLIENT_ID;
  headers['TM1-Session-Context'] = EXT_CLIENT_ID;
  // Impersonating someone else's view (v11, administrator only). SENT
  // DELIBERATELY on EVERY request, not just at login: if only the login
  // carries the header and TM1, against expectation, evaluates it per
  // request, the user would silently see the administrator's data — wrong
  // data that looks right. Sent on every request, the reverse case instead
  // fails loudly.
  if (cfg.impersonate) {
    headers['TM1-Impersonate'] = cfg.impersonate;
  }
  // TM1 11.8 honours Accept-Encoding and gzips JSON responses (a 34.6 KB
  // payload came back as 10.9 KB ≈ 68 % less on the wire); big cellset /
  // element responses are 10+ MB, so this is the main transport win.
  // http.ts inflates transparently; a server that ignores the header (v12 is
  // unverified) simply answers identity and stays on the untouched raw path.
  // Only set when the caller did not bring its own value — a case-insensitive
  // duplicate would go out as a second header line.
  if (!extraHeaders || !Object.keys(extraHeaders).some((k) => k.toLowerCase() === 'accept-encoding')) {
    headers['Accept-Encoding'] = 'gzip, deflate';
  }
  // Set Keep-Alive EXPLICITLY, instead of letting Node derive the header
  // from the agent. VS Code patches `http(s).request` (`@vscode/proxy-agent`,
  // setting `http.proxySupport`, default `override`) and replaces our agent
  // with a `PacProxyAgent` — which has `keepAlive: false` and
  // `maxSockets: Infinity`, and it is exactly from this that Node derives
  // `shouldKeepAlive` (`_http_client.js`). The result was `Connection: close`
  // on the wire, even though our agent supports keep-alive: the socket died
  // after every response on the write side (`finish` -> `socket.end()`), and
  // because TM1 binds the serving worker thread to the TCP socket, every
  // request was a new thread (measured live 2026-08-18: 40 requests, 0
  // reused).
  // An explicitly set header beats the agent-derived value, because
  // `OutgoingMessage#_storeHeader` recognizes it in `matchHeader` and
  // `shouldKeepAlive` then pulls itself to `true`.
  // Do not set it when the caller brings its own idea — a duplicate would
  // go out as a second header line.
  if (!extraHeaders || !Object.keys(extraHeaders).some((k) => k.toLowerCase() === 'connection')) {
    headers['Connection'] = 'keep-alive';
  }
  if (body) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return headers;
}

/**
 * Scans Node's lowercased `set-cookie` response header (string[]) for the TM1
 * session cookie and returns the full `name=value` pair ready to be put into
 * a `Cookie` request header. Returns undefined if no session cookie is present.
 *
 * Falls back to `paSession`: Planning Analytics as a Service (v12 SaaS) answers
 * Basic `apikey:<key>` with that cookie only, never `TM1SessionId`, and the
 * cookie alone authenticates later calls (measured 2026-10-14, 12.6.4).
 * Without it every call re-authenticated, serialized behind the login lock.
 */
export function parseTm1SessionCookie(setCookie: string[] | undefined): string | undefined {
  if (!setCookie || setCookie.length === 0) { return undefined; }
  let paSession: string | undefined;
  for (const raw of setCookie) {
    const firstPair = raw.split(';', 1)[0].trim();
    const eq = firstPair.indexOf('=');
    if (eq <= 0) { continue; }
    const name = firstPair.substring(0, eq).toLowerCase();
    if (name === 'tm1sessionid') { return firstPair; }
    if (name === 'pasession') { paSession = firstPair; }
  }
  return paSession;
}

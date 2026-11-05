// src/tm1Rest/transport/http.ts
// Low-level HTTP transport: raw request implementations + session-aware
// request orchestration with init-lock and 401 retry-with-Basic.
// Pure module — no vscode dependency.

import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import type { Transform } from 'stream';
import { buildHeaders, parseTm1SessionCookie } from './auth';
import {
  _initInflight, _sessionCacheKey, _getSession, _setSession, _invalidateSession, _touchSession,
  _isAuthFailed, _markAuthFailed, _authFailure, _fireBrowserSessionExpired, _allSessions,
} from './session';
import type { InitOutcome } from './session';
import type { Tm1Config, Tm1Response } from './types';
import { mintV12Cookie, type MintFailure } from './v12Session';
import { mintIntegratedCookie, logIntegratedLogin } from './integratedSession';
import { resolveAgent } from './agent';
import { errorBodyDetail, odataErrorMessage } from '../parseRest';
import { isOk, Tm1HttpError } from '../httpError';
import { withRequestSlot } from './requestGate';
import { currentAbortSignal } from './abortScope';
import type { ODataError } from '../odataTypes';
import { errMsg } from '../../utils/errMsg';
import { isPawAuthRequired } from '../../utils/pawTarget';

/**
 * Maps a response `Content-Encoding` to a zlib decompression stream.
 * Absent / `identity` / anything unrecognised → `undefined`, meaning the raw
 * response bytes are handed to the collector unchanged (byte-identical to the
 * behaviour before compression support — important because v12 has not been
 * verified for gzip). Exported for unit tests.
 */
export function makeDecoder(contentEncoding: string | string[] | undefined): Transform | undefined {
  const raw = Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding;
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.createGunzip();
    case 'deflate':
    case 'x-deflate':
      // Unzip sniffs the header, so it also copes with a server that gzips but
      // labels the response `deflate` (seen in the wild on proxies).
      return zlib.createUnzip();
    case 'br':
      return zlib.createBrotliDecompress();
    default:
      return undefined;
  }
}

/**
 * Throws a descriptive error if the response status is not 2xx.
 * Optional `context` is prepended to the message (e.g. 'PATCH failed').
 */
export function assertOk(res: { statusCode: number; body: string }, context?: string): void {
  if (!isOk(res)) {
    const prefix = context ? `${context}: ` : '';
    let detail = res.body.substring(0, 300);
    let code: string | undefined;
    try {
      const parsed = JSON.parse(res.body) as ODataError;
      detail = odataErrorMessage(parsed) ?? detail;
      code = parsed.error?.code;
    } catch { /* keep raw body */ }
    throw new Tm1HttpError(`${prefix}HTTP ${res.statusCode}: ${detail}`, res.statusCode, code);
  }
}


interface RawResponse<R> {
  statusCode: number;
  body: R;
  setCookie: string[] | undefined;
}

interface BodyCollector<R> {
  push(chunk: Buffer): void;
  finish(): R;
}

/**
 * Idle time after which TCP keepalive probes run — only for requests without
 * an idle timeout (`timeoutMs === 0`), see `_rawTransport`. Deliberately far
 * above Node's own `keepAliveMsecs` (1 s for pool sockets): this is not a NAT
 * keep-warmer, it is a dead-man's switch.
 */
const SOCKET_KEEPALIVE_MS = 30_000;

/**
 * Shared transport core. Body type (string vs Buffer) and response collection
 * strategy are injected via `makeCollector`. `_rawRequest` and
 * `_rawRequestBinary` differ only in those two axes — everything else
 * (options construction, timeout, error handling, write+end) is identical.
 */
function _rawTransport<R>(
  method: string,
  url: string,
  cfg: Tm1Config,
  body: string | Buffer | undefined,
  timeoutMs: number,
  extraHeaders: Record<string, string> | undefined,
  cookie: string | undefined,
  agent: http.Agent | https.Agent,
  makeCollector: () => BodyCollector<R>,
): Promise<RawResponse<R>> {
  const parsed = new URL(url);
  // Read the signal BEFORE queueing: a waiting request starts inside the
  // async context of whichever request frees the slot, so reading it later
  // would pick up a stranger's panel signal.
  // A closed panel cancels its reads; writes run to completion (see abortScope.ts).
  const signal = method === 'GET' ? currentAbortSignal() : undefined;
  // Cap per server, not per agent: VS Code's proxy patch replaces our
  // agent, so `maxSockets` has no effect (see requestGate.ts).
  return withRequestSlot(parsed.host, () => new Promise<RawResponse<R>>((resolve, reject) => {
    const isHttps = parsed.protocol === 'https:';
    const headers = buildHeaders(cfg, body, extraHeaders, cookie);
    // A caller with a remembered ETag sends it itself and gets 412 when another
    // writer came first (process file mode); everyone else overwrites.
    if (method === 'PATCH' && !headers['If-Match']) { headers['If-Match'] = '*'; }

    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers,
      agent,
      ...(isHttps ? { rejectUnauthorized: cfg.rejectUnauthorized } : {}),
      // `req.setTimeout` below starts only AFTER the TCP connect when an agent
      // is passed; the option arms the socket before it. Without it a port a
      // firewall drops silently hung for the OS limit (138 s, measured
      // 2026-10-30) despite the probe's 20 s.
      ...(timeoutMs > 0 ? { timeout: timeoutMs } : {}),
    };
    if (signal) { options.signal = signal; }

    const collector = makeCollector();
    const transport = isHttps ? https : http;
    const req = transport.request(options, (res) => {
      const done = () => resolve({
        statusCode: res.statusCode ?? 0,
        body: collector.finish(),
        setCookie: res.headers['set-cookie'],
      });

      const encoding = res.headers['content-encoding'];
      const decoder = makeDecoder(encoding);
      if (!decoder) {
        // Identity / unknown encoding: untouched original path.
        res.on('data', (chunk: Buffer) => collector.push(chunk));
        res.on('end', done);
        // A peer that closes mid-body emits neither 'end' nor a request error.
        res.on('error', reject);
        return;
      }

      // Compressed: response stream → zlib → collector. Streaming (rather than
      // buffering the compressed body and inflating it in one shot) keeps only
      // ONE copy of a 10+ MB payload alive, matching the memory contract of
      // parseBody/parseBodySafe.
      let settled = false;
      let sawBytes = false;
      const fail = (err: unknown, what: string) => {
        if (settled) { return; }
        settled = true;
        res.destroy();
        decoder.destroy();
        reject(new Error(`TM1 response could not be decompressed (Content-Encoding: ${String(encoding)}, ${what}): ${errMsg(err)}`));
      };

      res.on('data', (chunk: Buffer) => { if (chunk.length > 0) { sawBytes = true; } });
      res.on('end', () => {
        // 204/304/Content-Length:0 that still carry a Content-Encoding header:
        // zero bytes into zlib is a Z_BUF_ERROR ("unexpected end of file"), so
        // short-circuit to the (empty) collector result instead.
        if (sawBytes || settled) { return; }
        settled = true;
        decoder.destroy();
        done();
      });
      res.on('error', (err: unknown) => fail(err, 'response stream'));
      decoder.on('data', (chunk: Buffer) => collector.push(chunk));
      decoder.on('end', () => { if (!settled) { settled = true; done(); } });
      decoder.on('error', (err) => fail(err, 'zlib'));
      res.pipe(decoder);
    });

    if (timeoutMs === 0) {
      // No idle timer (process/chore execution may run for an arbitrary
      // length of time) means: if the remote side disappears mid-run (Wi-Fi
      // drops, the machine sleeps), neither FIN nor RST arrives — the socket
      // hangs until the OS default (~2 h), the promise never settles, and the
      // caller's `finally` (finishRun) never runs. Hence TCP keepalive probes
      // here: `keepAlive: true` on the agent does NOT cover this, Node only
      // arms socket keepalive for sockets that go back into the idle pool. A
      // healthy remote answers the probes at the TCP level even if the
      // application sends nothing for minutes — so there are no false
      // aborts; a dead one turns into ECONNRESET/ETIMEDOUT within minutes.
      req.on('socket', (socket) => { socket.setKeepAlive(true, SOCKET_KEEPALIVE_MS); });
    }
    if (timeoutMs > 0) {
      // Idle/inactivity timeout on the socket — fires on data-flow silence, NOT an overall deadline.
      // Message stays ENGLISH (base language): `tm1Rest/**` must not import `vscode`
      // (depcruise `tm1rest-no-vscode`), so localization happens at the display site.
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`TM1 request timeout: no response/data for ${Math.round(timeoutMs / 1000)}s (idle) — is the server reachable?`));
      });
    }
    req.on('error', reject);
    if (body !== undefined) { req.write(body); }
    req.end();
  }));
}

// Buffer chunks → collect, then decode ONCE as utf8 at the end. Decoding
// per-chunk (`data += chunk`) coerces each Buffer with `.toString('utf8')`
// individually; because `res.on('data')` yields chunks at arbitrary byte
// boundaries (no setEncoding on IncomingMessage), a multibyte UTF-8 sequence
// split across two chunks decodes each half to U+FFFD — corrupting umlauts /
// ß / € in TM1 names, rules, attributes and cell values on responses that span
// more than one chunk (~16 KB+). Buffering + a single terminal decode (like
// bufferCollector) is boundary-safe. Exported for the chunk-split regression test.
export const stringCollector = (): BodyCollector<string> => {
  const chunks: Buffer[] = [];
  return {
    push: (chunk) => { chunks.push(chunk); },
    finish: () => Buffer.concat(chunks).toString('utf8'),
  };
};

const bufferCollector = (): BodyCollector<Buffer> => {
  const chunks: Buffer[] = [];
  return {
    push: (chunk) => { chunks.push(chunk); },
    finish: () => Buffer.concat(chunks),
  };
};

// Browser login through PAW: an expired or missing session comes back as a 200
// with AUTH_REQUIRED (measured 2026-10-31, `isPawAuthRequired`). Read it as the
// 401 it means — otherwise the session check (`browserConnect.ts#carries`)
// counted it as logged in and callers parsed the error body as data.
export function _rawRequest(
  method: string,
  url: string,
  cfg: Tm1Config,
  body: string | undefined,
  timeoutMs: number,
  extraHeaders: Record<string, string> | undefined,
  cookie: string | undefined,
  agent: http.Agent | https.Agent,
): Promise<RawResponse<string>> {
  return _rawTransport(method, url, cfg, body, timeoutMs, extraHeaders, cookie, agent, stringCollector)
    .then(res => (cfg.authType === 'browser' && res.statusCode === 200 && res.body.length < 4096
      && isPawAuthRequired(res.body) ? { ...res, statusCode: 401 } : res));
}

/** Binary-safe variant of _rawRequest. Body in/out as Buffer. */
export function _rawRequestBinary(
  method: string,
  url: string,
  cfg: Tm1Config,
  body: Buffer | undefined,
  timeoutMs: number,
  extraHeaders: Record<string, string> | undefined,
  cookie: string | undefined,
  agent: http.Agent | https.Agent,
): Promise<RawResponse<Buffer>> {
  return _rawTransport(method, url, cfg, body, timeoutMs, extraHeaders, cookie, agent, bufferCollector);
}

/**
 * Status of a FAILED session setup, as the caller should see it.
 *
 * `0` stays `0` (no network contact), everything else except 2xx stays as
 * is. A 2xx becomes `401`: the server did respond, but delivered no session
 * — and a success status without a session is a trap for every caller
 * (`assertOk`, `probeConnection`, connection test).
 */
const BROWSER_NOT_LOGGED_IN = 'Not logged in. Connect to the server to log in through the browser.';
const BROWSER_SESSION_EXPIRED = 'The browser session has expired. Connect to the server to log in again.';

function mintFailure(f: MintFailure): NonNullable<Tm1Response<unknown>['v12MintFailure']> {
  return { status: f.status, ...(f.detail ? { detail: f.detail } : {}), ...(f.code ? { code: f.code } : {}) };
}

function failureStatus(status: number): number {
  return status >= 200 && status < 300 ? 401 : status || 0;
}

/**
 * Session-aware request orchestrator: handles init-lock for concurrent
 * first-calls, cookie reuse, and one-shot 401-retry with Basic. Recursive
 * on 401. Body type (string vs Buffer) and the rawFn strategy (text vs
 * binary transport) are injected so this skeleton serves both `request`
 * and `requestBinary` — P0-5 short-circuit logic now lives in ONE place.
 *
 * Recursive contract: on 401 with a stale cookie, the session is
 * invalidated and the call re-enters with the same args. With the lock
 * already released, the second pass becomes the new lock-holder and
 * re-runs Basic auth.
 */
async function requestWithSession<B, R>(
  method: string,
  url: string,
  cfg: Tm1Config,
  body: B | undefined,
  timeoutMs: number,
  extraHeaders: Record<string, string> | undefined,
  rawFn: (
    method: string,
    url: string,
    cfg: Tm1Config,
    body: B | undefined,
    timeoutMs: number,
    extraHeaders: Record<string, string> | undefined,
    cookie: string | undefined,
    agent: http.Agent | https.Agent,
  ) => Promise<RawResponse<R>>,
  emptyBody: R,
  /**
   * Optional dedicated keep-alive agent, used ONLY on the cookie-reuse path
   * (a session is already cached). Lets a caller pin its requests to its own
   * socket instead of sharing the session's pool — e.g. the threads poller,
   * so TM1 keeps handing it the same worker thread and the displayed thread ID
   * stays stable (like Arc's dedicated monitoring connection). The session
   * cache keeps its own agent; the override is never stored there.
   */
  agentOverride?: http.Agent | https.Agent,
): Promise<Tm1Response<R>> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const key = _sessionCacheKey(cfg);

  // Negative-auth short-circuit: a prior Basic-Auth attempt for this cfg was
  // rejected with 401. Do NOT touch the network — re-sending the same wrong
  // credentials on every feature call is exactly what locks the TM1 account.
  // Reset happens on explicit (re)connect / closeSession.
  if (_isAuthFailed(cfg)) {
    // With a stored reason, report the reason, not `401`: a bare `401`
    // reads as "wrong password", even though in the Windows login case no
    // credentials were ever sent — there, the helper process failed. Only
    // the text path has a field for this.
    const failure = _authFailure(cfg);
    if (failure) {
      const detail = (typeof emptyBody === 'string' ? failure.message : emptyBody) as R;
      return { statusCode: failureStatus(failure.status), body: detail };
    }
    return { statusCode: 401, body: emptyBody };
  }

  // Browser login: the session comes ONLY from an explicit connect
  // (browserLogin.ts). A background call (tree, completion, poller) must never
  // open a browser, and has no credentials to send — so no network at all.
  if (cfg.authType === 'browser' && !_getSession(cfg)) {
    const detail = (typeof emptyBody === 'string' ? BROWSER_NOT_LOGGED_IN : emptyBody) as R;
    return { statusCode: 401, body: detail };
  }

  let lockResolve: ((r: InitOutcome) => void) | undefined;
  const inflight = _initInflight.get(key);
  if (!inflight && !_getSession(cfg)) {
    const lockPromise = new Promise<InitOutcome>((r) => { lockResolve = r; });
    _initInflight.set(key, lockPromise);
  }

  if (lockResolve) {
    let outcomeStatus = 0;
    let released = false;
    // Waiters only need the session, not this caller's data call: once the
    // cookie is cached, let them through. Holding the lock until the data call
    // returned queued every request behind it — behind a process run without
    // timeout, for as long as the run took (review 2026-11-02).
    const releaseLock = (status: number): void => {
      if (released) { return; }
      released = true;
      _initInflight.delete(key);
      lockResolve!({ status });
    };
    try {
      // PA as a Service has no mint endpoint: it takes Basic on the data call
      // itself, like v11, and answers with the `paSession` cookie.
      if (cfg.version === 'v12' && cfg.v12?.authMode !== 'saas') {
        // v12: mint the session cookie via the auth endpoint, cache it, then
        // perform the actual data call with the cookie (never Basic on data).
        const minted = await mintV12Cookie(cfg);
        if (!minted.ok) {
          outcomeStatus = minted.status;
          if (minted.status === 401 || minted.status === 403) { _markAuthFailed(cfg); }
          // Same rule as the integrated branch below (review 2026-10-03, A1):
          // a `2xx` mint without a cookie must not reach the caller as a data
          // response, and the mint's reason travels along on the text path.
          // Status 0 here is a network error, not a broken helper process —
          // transient, so it deliberately does NOT arm the negative-auth guard.
          const detail = (typeof emptyBody === 'string' ? minted.message : emptyBody) as R;
          return { statusCode: failureStatus(minted.status), body: detail, v12MintFailure: mintFailure(minted) };
        }
        _setSession(cfg, { cookie: minted.cookie, agent: minted.agent, cfg, lastUsed: Date.now() });
        releaseLock(200);
        let res = await rawFn(method, url, cfg, body, timeoutMs, extraHeaders, minted.cookie, minted.agent);
        if (res.statusCode === 401) {
          // C1: a 401 immediately after a SUCCESSFUL mint means the session cookie
          // is stale/invalid — NOT a credential failure (the mint just proved the
          // creds) and NOT object authz (v12 signals those as 403/404; a session
          // 401 is {"error":{"code":"278","message":"Authentication required"}},
          // verified live against a v12 server). Re-mint ONCE and retry before
          // arming the permanent negative-auth guard, so a transient/expired cookie
          // can't brick the whole connection.
          _invalidateSession(cfg);
          const remint = await mintV12Cookie(cfg);
          if (!remint.ok) {
            outcomeStatus = remint.status;
            if (remint.status === 401 || remint.status === 403) { _markAuthFailed(cfg); }
            const detail = (typeof res.body === 'string' ? remint.message : res.body) as R;
            // Status 0 stays 0: a network error on the re-mint is no rejected
            // login, and reporting the data call's 401 read as "wrong
            // credentials" (review 2026-11-02).
            return { statusCode: failureStatus(remint.status), body: detail, v12MintFailure: mintFailure(remint) };
          }
          _setSession(cfg, { cookie: remint.cookie, agent: remint.agent, cfg, lastUsed: Date.now() });
          res = await rawFn(method, url, cfg, body, timeoutMs, extraHeaders, remint.cookie, remint.agent);
          if (res.statusCode === 401) {
            // Fresh cookie STILL rejected = genuine (e.g. an impersonation user
            // without data rights). Arm the guard so later calls fast-fail instead
            // of re-minting + re-hammering the auth endpoint (lockout risk).
            _markAuthFailed(cfg);
            _invalidateSession(cfg);
          }
        }
        outcomeStatus = res.statusCode;
        return { statusCode: res.statusCode, body: res.body };
      }

      if (cfg.authType === 'integrated') {
        // Windows login: the same shape as v12 — mint the cookie, cache it,
        // only then make the actual request. NEVER fall back to Basic: a
        // server in mode 3 rejects Basic, and every further attempt counts
        // as a failed login (AD lockout).
        const minted = await mintIntegratedCookie(cfg);
        if (!minted.ok) {
          outcomeStatus = minted.status;
          if (minted.status === 401 || minted.status === 403) { _markAuthFailed(cfg); }
          // Status 0 means: the login NEVER happened at all — the helper
          // process did not run (endpoint protection blocking
          // `powershell.exe`, a measured EPERM case). Without a guard, every
          // further call — tree, completion, diagnostics, status poll — runs
          // through the whole handshake again: three packages times three
          // start attempts are NINE process starts per call, plus one temp
          // directory per package. This is exactly the "slow drip" the guard
          // in `session.ts` describes — until now it only applied to Basic
          // login. It is released on the next explicit connect
          // (`_clearAuthFailed`).
          else if (minted.status === 0) {
            _markAuthFailed(cfg, { status: 0, message: minted.message });
          }
          // Pass ALONG the reason, not just the status. `assertOk` builds
          // `HTTP 0: <reason>` from it; without this the user sees a bare
          // "HTTP 0" with no clue, even though the cause (no PowerShell, mode
          // 1, rejected) is precisely known. Only for the text path — the
          // binary path has no field for this and stays empty.
          const detail = (typeof emptyBody === 'string' ? minted.message : emptyBody) as R;
          // NEVER return as 2xx: the session setup failed, the actual
          // request never ran. A passed-through `200` (server accepts but
          // sends no cookie) arrived at the caller as a successful data
          // response — the connection test reported success.
          return { statusCode: failureStatus(minted.status), body: detail };
        }
        _setSession(cfg, { cookie: minted.cookie, agent: minted.agent, cfg, lastUsed: Date.now() });
        releaseLock(200);
        // OPEN CONTRADICTION, deliberately left as is (finding A3, 2026-09-20).
        //
        // `integratedSession.ts` justifies its own `maxSockets: 1` agent with
        // the claim that NTLM is tied to the socket and "the session carries
        // its requests forward on the same connection". Here, though, the
        // first data request goes to the agent pinned by the caller, as soon
        // as one exists (threads poller, `client.ts`) — i.e. to a DIFFERENT
        // socket. The v12 branch above chooses the mint agent instead.
        //
        // If the premise holds, TM1 should answer `401` here and the path
        // should go into remint → `401` → `_markAuthFailed`. If it does not
        // hold, the agent carried along is unnecessary. WHICH of the two is
        // true cannot be measured: per `docs/architecture/integrated-login.md`,
        // no data request after a mint has succeeded at all so far.
        //
        // So this is NOT changed. Switching to `minted.agent` would be one
        // guess against another, and it would take away the threads poller's
        // pinned socket (see `docs/architecture/thread-stability.md`). The
        // day to decide this is the day the first data request after a mint
        // goes through — then the status code will say which half of the
        // contradiction falls.
        let res = await rawFn(method, url, cfg, body, timeoutMs, extraHeaders, minted.cookie, agentOverride ?? minted.agent);
        logIntegratedLogin(`First request after login: ${method} ${new URL(url).pathname} -> ${res.statusCode}`
          + (res.statusCode >= 400 && typeof res.body === 'string' ? `: ${res.body.slice(0, 300)}` : ''));
        if (res.statusCode === 401) {
          // A `401` right after a successful mint means: the cookie is
          // already stale, not the login. Re-mint once, after that it counts
          // as genuine (same reasoning as in the v12 branch).
          _invalidateSession(cfg);
          const remint = await mintIntegratedCookie(cfg);
          if (!remint.ok) {
            outcomeStatus = remint.status;
            if (remint.status === 401 || remint.status === 403) { _markAuthFailed(cfg); }
            else if (remint.status === 0) {
              _markAuthFailed(cfg, { status: 0, message: remint.message });
            }
            const detail = (typeof res.body === 'string' ? remint.message : res.body) as R;
            return { statusCode: failureStatus(remint.status || res.statusCode), body: detail, v12MintFailure: mintFailure(remint) };
          }
          _setSession(cfg, { cookie: remint.cookie, agent: remint.agent, cfg, lastUsed: Date.now() });
          res = await rawFn(method, url, cfg, body, timeoutMs, extraHeaders, remint.cookie, agentOverride ?? remint.agent);
          if (res.statusCode === 401) {
            _markAuthFailed(cfg);
            _invalidateSession(cfg);
          }
        }
        outcomeStatus = res.statusCode;
        return { statusCode: res.statusCode, body: res.body };
      }

      const agent = resolveAgent(cfg, isHttps);
      // If the caller pinned a dedicated agent (threads poller), do the mint on
      // THAT socket too — otherwise a server that re-mints per poll (no cached
      // cookie) would open a fresh socket every time and the displayed thread ID
      // would keep churning. The session still caches its own `agent` for other
      // callers; the poll just always rides its dedicated socket.
      const res = await rawFn(method, url, cfg, body, timeoutMs, extraHeaders, undefined, agentOverride ?? agent);
      outcomeStatus = res.statusCode;
      const cookie = parseTm1SessionCookie(res.setCookie);
      if (cookie && res.statusCode >= 200 && res.statusCode < 400) {
        _setSession(cfg, { cookie, agent, cfg, lastUsed: Date.now() });
      } else {
        // 401 on Basic = bad credentials. Arm the negative-auth cache so every
        // later call fast-fails instead of re-hammering the server into a lockout.
        if (res.statusCode === 401) { _markAuthFailed(cfg); }
        agent.destroy();
      }
      return { statusCode: res.statusCode, body: res.body };
    } finally {
      releaseLock(outcomeStatus);
    }
  }

  if (inflight) {
    const outcome = await inflight;
    // Lock-holder hit 401 on Basic-Auth → credentials are bad. If every
    // waiter recurses into a fresh init attempt (the old behaviour), N
    // concurrent callers cause N sequential Basic-Auth failures against
    // the same account — a classic account-lockout trigger. Return a
    // synthetic 401 to all waiters instead; the caller handles auth
    // failure exactly as it would for a single-shot 401. (5xx/network
    // errors still fall through to a legitimate retry below.)
    if (outcome.status === 401) {
      return { statusCode: 401, body: emptyBody };
    }
  }
  const cached = _getSession(cfg);
  if (!cached) {
    return requestWithSession(method, url, cfg, body, timeoutMs, extraHeaders, rawFn, emptyBody, agentOverride);
  }
  // Use the caller's dedicated agent if supplied, but keep the session's cookie.
  const first = await rawFn(method, url, cfg, body, timeoutMs, extraHeaders, cached.cookie, agentOverride ?? cached.agent);
  // A late 401 for cookies a new login has since replaced is no expiry: retry
  // with the fresh set instead of throwing that login away (review 2026-11-02;
  // the same check as for the other auth types below).
  if (first.statusCode === 401 && cfg.authType === 'browser' && _getSession(cfg)?.cookie !== cached.cookie) {
    return requestWithSession(method, url, cfg, body, timeoutMs, extraHeaders, rawFn, emptyBody, agentOverride);
  }
  if (first.statusCode === 401 && cfg.authType === 'browser') {
    // The browser's cookies expired. There is nothing to re-mint from; the
    // user logs in again on the next explicit connect, which also clears the
    // guard (no auto-reconnect). Other databases on the same host share these
    // cookies (browserConnect.ts), so their entries go too.
    // Diagnostics: a 401 right after a fresh login is no expiry — the route
    // and the server's own text tell which side refused.
    logIntegratedLogin(`Browser session rejected (401) on ${method} ${new URL(url).pathname}: ${
      typeof first.body === 'string' ? errorBodyDetail(first.body).slice(0, 500) : '(stream)'}`);
    const origin = new URL(cfg.serverUrl).origin;
    for (const e of _allSessions()) {
      if (e.cfg.authType === 'browser' && new URL(e.cfg.serverUrl).origin === origin) { _invalidateSession(e.cfg); }
    }
    _invalidateSession(cfg);
    _markAuthFailed(cfg, { status: 401, message: BROWSER_SESSION_EXPIRED });
    _fireBrowserSessionExpired(cfg);
    const detail = (typeof emptyBody === 'string' ? BROWSER_SESSION_EXPIRED : emptyBody) as R;
    return { statusCode: 401, body: detail };
  }
  if (first.statusCode === 401) {
    if (cfg.authType === 'integrated') {
      logIntegratedLogin(`Session rejected (401) on ${method} ${new URL(url).pathname} — logging in again`);
    }
    // A late 401 for the OLD cookie must not drop a session a concurrent
    // request has already re-minted — that cost one login per stale answer.
    // Only invalidate while the entry still carries the rejected cookie; else
    // the recursion simply retries with the fresh one.
    if (_getSession(cfg)?.cookie === cached.cookie) { _invalidateSession(cfg); }
    return requestWithSession(method, url, cfg, body, timeoutMs, extraHeaders, rawFn, emptyBody, agentOverride);
  }
  const newCookie = parseTm1SessionCookie(first.setCookie);
  // Merge only into the session this request rode on: a concurrent re-mint or
  // a disconnect may have replaced or removed it meanwhile (review 2026-11-02).
  if (newCookie && newCookie !== cached.cookie && _getSession(cfg)?.cookie === cached.cookie) {
    // A session minted through PAW is a SET of cookies (`paSession`,
    // `TM1SessionId_<instance>`, …). Replace only the renewed pair — dropping
    // the rest would make the next request anonymous.
    _setSession(cfg, { cookie: mergeSessionCookie(cached.cookie, newCookie), agent: cached.agent, cfg, lastUsed: Date.now() });
  } else {
    _touchSession(cfg);
  }
  return { statusCode: first.statusCode, body: first.body };
}

/** Replaces the pair named like `renewed` in `cookie`, or appends it. */
export function mergeSessionCookie(cookie: string, renewed: string): string {
  const name = renewed.slice(0, renewed.indexOf('=') + 1);
  const pairs = cookie.split(/;\s*/).filter(Boolean);
  const i = pairs.findIndex(p => p.startsWith(name));
  if (i < 0) { pairs.push(renewed); } else { pairs[i] = renewed; }
  return pairs.join('; ');
}

/**
 * Session-aware text request: handles init-lock for concurrent first-calls,
 * cookie reuse, and one-shot 401-retry with Basic.
 */
export async function request(
  method: string,
  url: string,
  cfg: Tm1Config,
  body?: string,
  timeoutMs = 30000,
  extraHeaders?: Record<string, string>,
  agent?: http.Agent | https.Agent,
): Promise<Tm1Response<string>> {
  return trackInFlight(cfg, requestWithSession(method, url, cfg, body, timeoutMs, extraHeaders, _rawRequest, '', agent));
}

/**
 * Session-aware binary request: same init-lock + 401-retry semantics as
 * `request`, but operates on Buffer bodies in/out.
 */
export async function requestBinary(
  method: string,
  url: string,
  cfg: Tm1Config,
  body: Buffer | undefined,
  timeoutMs: number,
  extraHeaders?: Record<string, string>,
): Promise<{ statusCode: number; body: Buffer }> {
  return trackInFlight(cfg, requestWithSession(method, url, cfg, body, timeoutMs, extraHeaders, _rawRequestBinary, Buffer.alloc(0)));
}

// Requests still running per session key. closeSession waits for them: a
// panel's dispose cleanup (temp view delete, cellset delete) that is still in
// flight when the session closes would otherwise log in again and leave an
// orphaned session on TM1.
const _inFlight = new Map<string, Set<Promise<unknown>>>();

function trackInFlight<T>(cfg: Tm1Config, p: Promise<T>): Promise<T> {
  const key = _sessionCacheKey(cfg);
  let set = _inFlight.get(key);
  if (!set) { set = new Set(); _inFlight.set(key, set); }
  set.add(p);
  const done = () => {
    set.delete(p);
    if (set.size === 0 && _inFlight.get(key) === set) { _inFlight.delete(key); }
  };
  p.then(done, done);
  return p;
}

/** Settles once every request for `cfg`'s session that is running right now has finished. */
export function inFlightSettled(cfg: Tm1Config): Promise<void> {
  const set = _inFlight.get(_sessionCacheKey(cfg));
  return set ? Promise.allSettled([...set]).then(() => undefined) : Promise.resolve();
}

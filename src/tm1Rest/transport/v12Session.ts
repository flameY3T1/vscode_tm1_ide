// src/tm1Rest/transport/v12Session.ts
// Mints a TM1SessionId cookie for TM1 v12 by POSTing to the per-instance
// `/{instance}/auth/v1/session` endpoint (basic-s2s / basic-native).
//
// Self-contained (own raw POST) so http.ts can depend on it without a cycle:
// this module must NOT import from ./http.
import * as http from 'http';
import * as https from 'https';
import type { Tm1Config } from './types';
import { EXT_CLIENT_ID, parseTm1SessionCookie } from './auth';
import { buildV12SessionUrl } from './urlBuilder';
import { resolveAgent } from './agent';
import { errMsg } from '../../utils/errMsg';
import { odataErrorMessage } from '../parseRest';
import type { ODataError } from '../odataTypes';

/** A failed mint. `detail` is the gateway's own reason, `code` the network
 *  error code when the mint never got an HTTP answer (status 0). */
export type MintFailure = { ok: false; status: number; message: string; detail?: string; code?: string };

export type MintResult =
  | { ok: true; cookie: string }
  | MintFailure;

export type MintOutcome =
  | { ok: true; cookie: string; agent: http.Agent | https.Agent }
  | MintFailure;

export interface V12SessionRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Build Basic-mode session-mint request (pure). */
export function buildV12SessionRequest(cfg: Tm1Config): V12SessionRequest {
  if (!cfg.v12) { throw new Error('v12 config missing'); }
  const v12 = cfg.v12;
  // Both basic modes send Basic(username:password): for S2S the username field
  // holds the App-Client ID and the password the App-Client secret; for native
  // it holds the TM1 user credentials. The {User} body is the impersonation
  // target (S2S) or the login user (native, defaults to the username).
  const basic = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  return {
    url: buildV12SessionUrl(cfg),
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': EXT_CLIENT_ID,
    },
    // Impersonation user: native falls back to the login username; S2S must use
    // an explicit tm1User (the username is the App-Client ID, not a TM1 user —
    // it would mint OK but 403 every data call). Empty S2S user → mint 400 (loud).
    body: JSON.stringify({
      User: v12.tm1User || (v12.authMode === 'basic-native' ? cfg.username : ''),
    }),
  };
}

/** Pulls a human-readable error detail out of a TM1 mint error body (pure). */
function _extractMintError(body: string | undefined): string {
  if (!body) { return ''; }
  try {
    // The gateway answers a refused client in OAuth shape, not OData:
    // `{"error":"invalid_client","error_details":"Insufficient permissions on
    // this resource."}` (wrong instance, measured 2026-10-30).
    const j = JSON.parse(body) as ODataError & { message?: string; error_details?: string };
    const oauth = typeof j?.error === 'string' ? j.error_details ?? j.error : undefined;
    return String(odataErrorMessage(j) ?? j?.message ?? oauth ?? '').slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Interpret session-mint HTTP response (pure). */
export function parseV12SessionResult(status: number, setCookie: string[] | undefined, body?: string): MintResult {
  if (status >= 200 && status < 300) {
    const cookie = parseTm1SessionCookie(setCookie);
    if (cookie) { return { ok: true, cookie }; }
    return { ok: false, status, message: 'v12 session response had no TM1SessionId cookie' };
  }
  // C5: mint is the most setup-fragile call; surface the server's own error
  // message instead of a bare HTTP status.
  const detail = _extractMintError(body);
  return {
    ok: false, status,
    message: `v12 session mint failed with HTTP ${status}${detail ? `: ${detail}` : ''}`,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Mints a TM1SessionId cookie for v12 (basic-s2s or basic-native).
 * Returns the keep-alive agent used for the mint call so a subsequent v12
 * session mint can reuse socket data calls.
 */
export async function mintV12Cookie(cfg: Tm1Config): Promise<MintOutcome> {
  const isHttps = cfg.serverUrl.startsWith('https:');
  const agent = resolveAgent(cfg, isHttps);

  try {
    const req = buildV12SessionRequest(cfg);
    const res = await _rawPost(req, cfg, agent, isHttps);
    const parsed = parseV12SessionResult(res.status, res.setCookie, res.body);
    if (parsed.ok) { return { ok: true, cookie: parsed.cookie, agent }; }
    agent.destroy();
    return parsed;
  } catch (err) {
    agent.destroy();
    const code = (err as { code?: unknown })?.code;
    return { ok: false, status: 0, message: errMsg(err), ...(typeof code === 'string' ? { code } : {}) };
  }
}

function _rawPost(
  req: V12SessionRequest,
  cfg: Tm1Config,
  agent: http.Agent | https.Agent,
  isHttps: boolean,
): Promise<{ status: number; setCookie: string[] | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(req.url);
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    if (req.body) { headers['Content-Length'] = Buffer.byteLength(req.body); }

    const transport = isHttps ? https : http;
    const httpReq = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers,
        agent,
        ...(isHttps ? { rejectUnauthorized: cfg.rejectUnauthorized } : {}),
        // Covers the TCP connect too; `setTimeout` below starts only after it
        // (see the same option in http.ts#_rawTransport).
        timeout: 30000,
      },
      (res) => {
        // C5: keep the body so a non-2xx mint can surface the server message.
        // Buffer chunks and decode once — `raw += chunk` would split a multibyte
        // UTF-8 char at a chunk boundary into U+FFFD (see stringCollector in http.ts).
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            setCookie: res.headers['set-cookie'],
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    httpReq.setTimeout(30000, () => { httpReq.destroy(); reject(new Error('v12 session mint timeout')); });
    httpReq.on('error', reject);
    if (req.body) { httpReq.write(req.body); }
    httpReq.end();
  });
}

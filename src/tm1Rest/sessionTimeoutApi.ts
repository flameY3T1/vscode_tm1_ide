/**
 * The server's session timeout (tm1s.cfg `HTTPSessionTimeoutMinutes`).
 *
 * Over REST it is called `Access/HTTP/SessionTimeout` and is an ISO-8601
 * duration; `Administration/HTTPSessionTimeoutMinutes` does NOT exist
 * (`404 Code 278`). Measured 2026-09-23 against 11.8: `P0DT02H00M00S`.
 */
import type { Tm1Config } from './transport/types';
import { parseBodySafe } from './parseRest';
import { setServerSessionTimeout } from './transport/session';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';

/** ISO-8601 duration in milliseconds (`P1DT02H30M15S`, `PT20M`); `undefined` for everything else. */
export function parseIsoDurationMs(s: unknown): number | undefined {
  if (typeof s !== 'string') { return undefined; }
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m || s.trim() === 'P' || s.trim() === 'PT') { return undefined; }
  const [d, h, min, sec] = [m[1], m[2], m[3], m[4]].map(v => Number(v ?? 0));
  return ((d * 24 + h) * 60 + min) * 60_000 + sec * 1000;
}

/**
 * Reads the timeout and attaches it to the session. Fails silently: without
 * a value, the cautious default from `transport/session.ts` applies, and
 * connecting itself must not depend on this.
 */
export async function learnSessionTimeout(
  cfg: Tm1Config,
  // From the caller, so that tests that replace `tm1Client` do not hit the network here.
  request: (method: string, path: string, body: undefined, timeoutMs: number, cfg: Tm1Config) => Promise<{ statusCode: number; body: string }>,
): Promise<void> {
  try {
    const res = await request('GET', 'ActiveConfiguration/Access/HTTP/SessionTimeout', undefined, 10000, cfg);
    if (!isOk(res)) { return; }
    const ms = parseIsoDurationMs(parseBodySafe<{ value?: string }>(res, {}).value);
    if (ms) { setServerSessionTimeout(cfg, ms); }
  } catch (e) { logRestBestEffort('sessionTimeout', 'read SessionTimeout', e); /* the default stays */ }
}

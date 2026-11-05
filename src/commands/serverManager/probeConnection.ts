import * as vscode from 'vscode';
import type { Tm1Config, Tm1Response } from '../../tm1Rest/transport/types';
import { apiRequest } from '../../tm1Client';
import { _clearAuthFailed } from '../../tm1Rest/transport/session';
import { ensureBrowserSession } from './browserConnect';
import { errMsg } from '../../utils/errMsg';
import { errorBodyDetail } from '../../tm1Rest/parseRest';
import {
  classifyNetworkError, swapScheme, isPlainHttpPortError, isTlsOnlyPortError, isTlsCertError,
} from '../../utils/networkErrorPure';
import { isOk } from '../../tm1Rest/httpError';
import { fetchAuthChallenges } from '../../tm1Rest/transport/integratedSession';
import { loginMismatch, offeredLogins, type OfferedLogin } from '../../tm1Rest/transport/authChallengePure';

export type ProbeKind = 'auth' | 'tls' | 'scheme' | 'refused' | 'dns' | 'timeout' | 'url' | 'other';
export type ProbeResult =
  | { ok: true; productVersion?: string }
  | { ok: false; kind: ProbeKind; message: string; /** Network error code, when there was no HTTP answer. */ code?: string };

/**
 * Deadline for the connect probe. Without one a port that a firewall silently
 * drops held "Test connection" for 138 s (Linux SYN retries, measured
 * 2026-10-30) — `tm1.timeoutMs` defaults to no timeout, which is right for
 * long-running calls but not for a single `GET Configuration`. The idle timer
 * also covers the TCP connect — and a Basic/CAM login, whose credentials travel
 * with that first request: a slow CAM namespace or a VPN link can need longer,
 * hence the setting `tm1.connectTimeoutMs` (this value is its default).
 * Integrated login keeps its own per-leg deadline (`integratedSession.ts`).
 */
export const PROBE_TIMEOUT_MS = 20_000;

function probeTimeoutMs(): number {
  const v = vscode.workspace.getConfiguration('tm1').get<number>('connectTimeoutMs');
  return typeof v === 'number' && v >= 1000 ? v : PROBE_TIMEOUT_MS;
}

/**
 * A refused v12 / PA as a Service login, named by its actual cause.
 * `undefined` for v11. "Wrong password" is the rarest cause on v12: a wrong
 * instance comes back from the mint as 403 `invalid_client`, an unknown TM1
 * user gets a session and only the data call fails (both measured 2026-10-30).
 */
export function v12AuthFailureMessage(cfg: Tm1Config, res: Tm1Response<string>): string | undefined {
  if (cfg.version !== 'v12' || !cfg.v12) { return undefined; }
  const v12 = cfg.v12;
  if (v12.authMode === 'saas') {
    return vscode.l10n.t('The API key was rejected (HTTP {0}). Check the key under Manage API keys in PA.', res.statusCode);
  }
  const mint = res.v12MintFailure;
  if (mint) {
    if (mint.status === 403) {
      return vscode.l10n.t(
        'The gateway refused a session for instance "{0}" (HTTP 403) — check the instance name and that this login may use it.{1}',
        v12.instance, mint.detail ? ` (${mint.detail})` : '');
    }
    return v12.authMode === 'basic-s2s'
      ? vscode.l10n.t('The gateway rejected the App-Client ID or secret (HTTP {0}).', mint.status)
      : vscode.l10n.t('The gateway rejected the username or password (HTTP {0}).', mint.status);
  }
  const user = v12.authMode === 'basic-s2s' ? v12.tm1User : cfg.username;
  return vscode.l10n.t(
    'Signed in to the gateway, but TM1 user "{0}" has no access to database "{1}" (HTTP {2}) — check the TM1 user and the database name.',
    user, v12.database, res.statusCode);
}

/**
 * Maps a low-level network/TLS error from the connect probe to a clear,
 * actionable message. Falls back to the raw error message for codes we don't
 * special-case. The lockout-relevant 401/403 path is handled by status, not by
 * throw — those never reach here.
 */
export function _connectErrorMessage(err: any, cfg: Tm1Config): string {
  const code: string = err?.code ?? '';
  const msg: string = err?.message ?? String(err);
  let host = cfg.serverUrl;
  try { host = new URL(cfg.serverUrl).host; } catch { /* keep raw */ }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return vscode.l10n.t('Server unreachable — hostname "{0}" could not be resolved. Check the server URL.', host);
  }
  if (code === 'ECONNREFUSED') {
    return vscode.l10n.t('Server unreachable — connection to "{0}" refused. Is the TM1 REST API running and is the port correct?', host);
  }
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return vscode.l10n.t('Server unreachable — timeout connecting to "{0}". Check network/firewall.', host);
  }
  // BEFORE the certificate branch: the BoringSSL message contains "SSL
  // routines", which the loose certificate check would otherwise match — the
  // user would get the advice to turn off certificate verification, even
  // though no TLS is involved at all.
  if (isTlsOnlyPortError(err)) {
    return vscode.l10n.t(
      'No plain HTTP on "{0}" — that port expects HTTPS. Change the server URL to https:// and try again.',
      host);
  }
  if (isPlainHttpPortError(err)) {
    return vscode.l10n.t(
      'No HTTPS on "{0}" — that port answers in plain HTTP. Change the server URL to http:// and try again.',
      host);
  }
  if (isTlsCertError(err)) {
    // The control is named "Verify SSL certificate" in the form and must be
    // turned OFF. The earlier version advised turning ON an "accept
    // certificate" toggle — a switch of that name doesn't exist, and the
    // direction was the reverse (review 2026-08-28).
    return vscode.l10n.t(
      'TLS certificate error for "{0}" — the server presents a certificate that cannot be verified. Turn off "Verify SSL certificate" for this profile to accept it anyway. ({1})',
      host, msg);
  }
  return msg;
}

/** Pure classification of a connect-probe network error into a ProbeKind.
 *  Delegates to `networkErrorPure` — the same table also drives the humanized
 *  message in `_connectErrorMessage` and the admin-server probe. */
export function classifyProbeError(err: unknown): ProbeKind {
  return classifyNetworkError(err);
}

/**
 * A rejected Basic/CAM login is usually the wrong login TYPE, not a typo.
 * Ask the server anonymously which types it takes (no credentials, so no
 * lockout count) and name them when the chosen one is missing. Best effort:
 * any failure leaves the original message.
 */
async function authFailureMessage(cfg: Tm1Config, status: number): Promise<string> {
  const message = vscode.l10n.t('Login failed (HTTP {0}) — username or password is incorrect.', status);
  if (cfg.version === 'v12' || (cfg.authType !== undefined && cfg.authType !== 'Basic' && cfg.authType !== 'CAM')) { return message; }
  let all: OfferedLogin[];
  try {
    all = offeredLogins(await fetchAuthChallenges(cfg));
  } catch {
    return message;
  }
  // A v12 gateway answers 401 without any `WWW-Authenticate`; a v11 server
  // always names its login. Worded as a hint only: the CAM answer (mode 4/5)
  // is not measured.
  if (all.length === 0) {
    return vscode.l10n.t('{0} The server named no login type, which is typical for a TM1 v12 gateway — if this is one, choose "TM1 v12" and enter instance and database.', message);
  }
  const offered = loginMismatch(cfg.authType ?? 'Basic', all);
  if (!offered) { return message; }
  const names: Record<OfferedLogin, string> = {
    Basic: vscode.l10n.t('Basic (user / password)'),
    CAM: vscode.l10n.t('CAM / IBM Security'),
    integrated: vscode.l10n.t('Integrated (Windows login)'),
  };
  return vscode.l10n.t('Login rejected (HTTP {0}): the server does not accept this login type — it offers: {1}.', status, offered.map(o => names[o]).join(', '));
}

/**
 * Single connect probe (GET Configuration?$select=ProductVersion) without
 * persisting or marking the session connected. Shared by the Test path;
 * Pass 2 wraps this with a one-shot scheme/TLS fallback.
 */
export async function probeConnection(cfg: Tm1Config): Promise<ProbeResult> {
  _clearAuthFailed(cfg);
  try {
    await ensureBrowserSession(cfg);
  } catch (err) {
    return { ok: false, kind: 'auth', message: errMsg(err) };
  }
  let res: Tm1Response<string>;
  try {
    res = await apiRequest('GET', 'Configuration?$select=ProductVersion', undefined, probeTimeoutMs(), cfg);
  } catch (err) {
    return networkFailure(err, cfg);
  }
  if (res.v12MintFailure?.status === 0) {
    // The v12 mint never got an HTTP answer: `https://` on the plain-HTTP
    // gateway came back as "HTTP 0: write EPROTO … wrong version number" and
    // the scheme fallback never ran (2026-10-30).
    return networkFailure(Object.assign(new Error(res.body), { code: res.v12MintFailure.code }), cfg);
  }
  if (res.statusCode === 401 || res.statusCode === 403) {
    // With integrated login there is no typed password that could be wrong.
    // The transport puts the reason in the body (`mintIntegratedCookie`) —
    // that's exactly what belongs here.
    if (cfg.authType === 'integrated') {
      return { ok: false, kind: 'auth', message: res.body || vscode.l10n.t('Integrated login was rejected (HTTP {0}).', res.statusCode) };
    }
    if (cfg.authType === 'browser') {
      return { ok: false, kind: 'auth', message: res.body || vscode.l10n.t('The server rejected the browser login (HTTP {0}).', res.statusCode) };
    }
    const v12Message = v12AuthFailureMessage(cfg, res);
    if (v12Message) { return { ok: false, kind: 'auth', message: v12Message }; }
    return { ok: false, kind: 'auth', message: await authFailureMessage(cfg, res.statusCode) };
  }
  if (res.statusCode === 503) {
    // Same wording as the startup reconnect: the server exists, it is still loading.
    return { ok: false, kind: 'other', message: 'HTTP 503: not ready (starting up)' };
  }
  if (!isOk(res)) {
    const detail = errorBodyDetail(res.body);
    return { ok: false, kind: 'other', message: `HTTP ${res.statusCode}: ${detail}` };
  }
  let productVersion: string | undefined;
  try { productVersion = JSON.parse(res.body)?.ProductVersion; } catch { /* optional */ }
  return { ok: true, productVersion };
}

function networkFailure(err: unknown, cfg: Tm1Config): ProbeResult {
  const code = (err as { code?: unknown })?.code;
  return {
    ok: false, kind: classifyProbeError(err), message: _connectErrorMessage(err, cfg),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

export { swapScheme };

export type FallbackNote = 'http' | 'https' | 'tls';
export type FallbackResult = ProbeResult & {
  appliedFallback?: { serverUrl?: string; rejectUnauthorized?: boolean; note: FallbackNote };
};

/** Asks before a retry that would send the credentials over a weaker transport. */
export type ConfirmDowngrade = (kind: 'tls' | 'http', target: string) => Promise<boolean>;

export async function confirmDowngradeModal(kind: 'tls' | 'http', target: string): Promise<boolean> {
  const proceed = vscode.l10n.t('Retry anyway');
  const msg = kind === 'tls'
    ? vscode.l10n.t('The server certificate of {0} is not trusted. Retry with certificate verification switched off? Your login is then sent to whoever answers on this address — only do this if you know the certificate is self-signed.', target)
    : vscode.l10n.t('{0} does not speak HTTPS. Retry over plain HTTP? Your username and password are then sent unencrypted.', target);
  return (await vscode.window.showWarningMessage(msg, { modal: true }, proceed)) === proceed;
}

/**
 * One connect probe, plus a single deterministic fallback for the two common
 * first-setup mistakes: a self-signed TLS cert (retry with rejectUnauthorized
 * off) or the wrong scheme (retry with https<->http swapped). Never retries on
 * auth (401/403) — lockout risk. A retry that weakens the transport (cert check
 * off, https→http) sends the credentials again, so it only runs after
 * `confirm` — a MITM must not get the login before the user decided anything.
 * Only mutates Tm1ConfigBase fields, so no buildTm1Config rebuild is needed.
 * `probe` and `confirm` are injectable for tests.
 */
export async function probeWithFallback(
  cfg: Tm1Config,
  probe: (c: Tm1Config) => Promise<ProbeResult> = probeConnection,
  confirm: ConfirmDowngrade = confirmDowngradeModal,
): Promise<FallbackResult> {
  const first = await probe(cfg);
  if (first.ok) { return first; }

  if (first.kind === 'tls') {
    if (!await confirm('tls', cfg.serverUrl)) { return first; }
    const retry = await probe({ ...cfg, rejectUnauthorized: false });
    if (retry.ok) { return { ...retry, appliedFallback: { rejectUnauthorized: false, note: 'tls' } }; }
  } else if (first.kind === 'refused' || first.kind === 'scheme') {
    // `scheme` is the unambiguously diagnosable case: `https://` against a
    // port that speaks plain HTTP. Until 2026-08-29 the swap kicked in ONLY
    // on `ECONNREFUSED`, missing exactly the manifestation it was built for
    // — the user saw the raw BoringSSL line instead.
    const swapped = swapScheme(cfg.serverUrl);
    if (swapped) {
      const downgrade = swapped.startsWith('http://');
      if (downgrade && !await confirm('http', cfg.serverUrl)) { return first; }
      const retry = await probe({ ...cfg, serverUrl: swapped });
      if (retry.ok) {
        return { ...retry, appliedFallback: { serverUrl: swapped, note: downgrade ? 'http' : 'https' } };
      }
      // http→https usually lands on a self-signed certificate next; one more
      // confirmed step instead of leaving the user with a URL that still says http.
      if (!downgrade && retry.kind === 'tls' && await confirm('tls', swapped)) {
        const both = await probe({ ...cfg, serverUrl: swapped, rejectUnauthorized: false });
        if (both.ok) {
          return { ...both, appliedFallback: { serverUrl: swapped, rejectUnauthorized: false, note: 'tls' } };
        }
      }
    }
  }
  return first; // auth / dns / timeout / other, or a declined/failed fallback → original error
}

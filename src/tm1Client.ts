// src/tm1Client.ts
// Thin re-export facade. The real code lives in:
//   src/tm1Rest/client.ts         — apiRequest/apiRequestBinary/getConfig
//   src/tm1Rest/transport/*       — session/auth/http
//   src/tm1Rest/*Api.ts           — domain calls (process/cube/dim/subset/…)
//
// Hebel 15: kept for backwards compat with 80+ importers across commands/,
// providers/, dimensionEditor/, git/, tiTestFramework/. New code should
// import from the canonical paths above directly.

import type { Tm1Config } from './tm1Rest/transport/types';
import {
  _getSession, _invalidateSession, _allSessions,
} from './tm1Rest/transport/session';
import { _rawRequest, inFlightSettled } from './tm1Rest/transport/http';
import { buildBaseUrl } from './tm1Rest/transport/urlBuilder';
import { resolveWithin } from './utils/resolveWithin';

// ── Type re-exports ──────────────────────────────────────────────────────
export type {
  TiSections, DataSource, Tm1Config,
} from './tm1Rest/transport/types';

// ── Session test-only API re-exports ──────────────────────────────────────
export {
  _setSessionForTest, _getSessionForTest, _clearAllSessionsForTest,
} from './tm1Rest/transport/session';

// ── HTTP utility re-export ────────────────────────────────────────────────
export { assertOk } from './tm1Rest/transport/http';

// ── Config + API request re-exports (moved to tm1Rest/client.ts) ─────────
export {
  setConfigOverride,
  getConfig,
  apiRequest,
} from './tm1Rest/client';

// ── Session lifecycle ─────────────────────────────────────────────────────

/**
 * Hard-closes the cached TM1 session for `cfg` (POST /ActiveSession/tm1.Close),
 * destroys its keep-alive agent and drops the cache entry. Best-effort: network
 * errors are swallowed because callers (disconnect / deactivate) don't want to
 * fail just because a stale session could not be closed.
 */
export async function closeSession(cfg: Tm1Config, drainMs = 3000): Promise<void> {
  // Let running requests (e.g. a closing panel's cleanup) finish on this
  // session first; bounded, because an Execute runs without a timeout.
  await resolveWithin(inFlightSettled(cfg), drainMs);
  const entry = _getSession(cfg);
  if (!entry) { return; }
  const url = `${buildBaseUrl(cfg)}/ActiveSession/tm1.Close`;
  try {
    await _rawRequest('POST', url, cfg, '{}', 5000, undefined, entry.cookie, entry.agent);
  } catch { /* best-effort */ }
  // Explicit teardown: destroy the agent here (no in-flight siblings
  // expected) — otherwise the keep-alive agent would live on until the
  // server-side socket timeout.
  _invalidateSession(cfg, true);
}

/**
 * Closes all cached sessions. Intended for extension deactivate().
 * Bounded by `timeoutMs` so a slow/unreachable server can never stall a
 * VS Code reload/disable — the underlying best-effort closes keep running,
 * but we stop awaiting them after the bound.
 */
export async function closeAllSessions(timeoutMs = 3000): Promise<void> {
  const entries = _allSessions();
  await resolveWithin(Promise.all(entries.map(entry => closeSession(entry.cfg))), timeoutMs);
}

// ── Domain re-exports (legacy compat) ─────────────────────────────────────
// New code should import directly from `./tm1Rest/<domain>Api`.

import { cancelThread as _cancelThreadApi } from './tm1Rest/threadApi';

export {
  deployProcess,
} from './tm1Rest/processApi';
export type { ProcessParameter, ProcessVariable } from './tm1Rest/processApi';

export { executeProcess } from './tm1Rest/executionApi';

export { fetchProcessMessageLog } from './tm1Rest/logsApi';
export { updateCells } from './cubeViewer/cubeWriteApi';

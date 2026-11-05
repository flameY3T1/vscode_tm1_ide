/**
 * Vscode-aware transport entry point for TM1 REST calls.
 *
 * Owns the `_configOverride` slot (the active server's `Tm1Config`) and exposes `apiRequest` /
 * `apiRequestBinary` as the canonical low-level HTTP helpers.
 *
 * Hebel 15 — extracted from `src/tm1Client.ts` (which now re-exports for
 * backward compat). Domain APIs in `tm1Rest/*Api.ts` import from here
 * to avoid the legacy `tm1Client` ↔ `*Api` cycle.
 */

import * as vscode from 'vscode';
import type { Tm1Config, Tm1Response } from './transport/types';
import { request, requestBinary } from './transport/http';
import { buildBaseUrl } from './transport/urlBuilder';

let _configOverride: Tm1Config | null = null;

/** Override the workspace-derived config (used by tests + multi-server commands). */
export function setConfigOverride(cfg: Tm1Config | null): void {
  _configOverride = cfg;
}

/**
 * Placeholder when no server is connected. Callers on that path only read
 * flags from it (v12 mode, diagnostics); a request against it fails like any
 * unreachable server.
 *
 * Until 2026-10 this read `tm1.serverUrl`/`authType`/`camNamespace` from the
 * settings. Those keys left the settings UI in 301ffc8d, and the reader turned
 * a hand-set CAM without namespace silently into Basic (review E5).
 */
const NO_SERVER: Tm1Config = Object.freeze({
  serverUrl: 'http://localhost:8010', username: '', password: '',
  rejectUnauthorized: true, authType: 'Basic' as const,
});

/** The active server's config, or `NO_SERVER` while none is connected. */
export function getConfig(): Tm1Config {
  return _configOverride ?? NO_SERVER;
}

// Default 0 = no timeout: TM1 computes a request server-side (view/MDX/large dim)
// and sends nothing until done, so an idle timeout can't tell "still computing"
// from "hung" — it would abort a legitimately slow busy-server response. Server
// work runs unbounded by design; a dead connection is handled by user cancel/reload.
// Users can still set tm1.timeoutMs > 0 to opt into a cap.
function getTimeoutMs(): number {
  return vscode.workspace.getConfiguration('tm1').get<number>('timeoutMs') ?? 0;
}

/**
 * High-level API request. `config` is REQUIRED — the caller must always name the
 * target server explicitly so a call can never silently hit the active-workspace
 * server (a wrong-server bug in multi-server setups). `body`/`timeoutMs` stay
 * nullable but positional, so pass `undefined` when not needed.
 */
export function apiRequest(
  method: string,
  apiPath: string,
  body: string | undefined,
  timeoutMs: number | undefined,
  config: Tm1Config,
  extraHeaders?: Record<string, string>,
  /** Optional dedicated keep-alive agent (cookie-reuse path only). See
   *  `requestWithSession`'s `agentOverride` — used by the threads poller to pin
   *  its own socket so the displayed TM1 thread ID stays stable. */
  agent?: import('http').Agent | import('https').Agent,
): Promise<Tm1Response<string>> {
  const cfg = config;
  const timeout = timeoutMs ?? getTimeoutMs();
  const base = buildBaseUrl(cfg);
  const url = apiPath.startsWith('http') ? apiPath : `${base}/${apiPath}`;
  return request(method, url, cfg, body, timeout, extraHeaders, agent);
}

/**
 * Binary-safe REST call. Use for file content download/upload (e.g. /Files).
 * Body is Buffer; response body returned as Buffer.
 */
export function apiRequestBinary(
  method: string,
  apiPath: string,
  body: Buffer | undefined,
  config: Tm1Config,
  extraHeaders?: Record<string, string>,
): Promise<{ statusCode: number; body: Buffer }> {
  const cfg = config;
  const timeout = getTimeoutMs();
  const base = buildBaseUrl(cfg);
  const url = apiPath.startsWith('http') ? apiPath : `${base}/${apiPath}`;
  return requestBinary(method, url, cfg, body, timeout, extraHeaders);
}

// Re-export assertOk for callers (matches legacy tm1Client surface)
export { assertOk } from './transport/http';

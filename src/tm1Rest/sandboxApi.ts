/**
 * TM1 Sandbox REST helpers.
 *
 * Sandboxes are per-user private write-spaces over the base cube data:
 *   - Reads/writes carrying `TM1-Sandbox: <name>` go to that sandbox.
 *   - `tm1.Commit` merges sandbox changes into base.
 *   - DELETE discards the sandbox without committing.
 *
 * REST endpoints (per IBM Planning Analytics 2.0.x docs):
 *   GET    /Sandboxes
 *   POST   /Sandboxes                       — body { "Name": "<n>" }
 *   DELETE /Sandboxes('<n>')
 *   POST   /Sandboxes('<n>')/tm1.Commit
 *
 * Phase A of Sandbox-Awareness MVP — REST layer only. UI + active-tracking
 * live in tm1Rest/sandboxTracker.ts (Phase B) and CubeViewer/MDX header
 * threading (Phase C).
 */
import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { parseODataValueBody, parseJsonSafe } from './parseRest';
import { encodeODataKey } from '../utils/odataKey';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';
import { SIDE_READ_CAP_MS } from './timeouts';

/** Single sandbox descriptor as returned by `GET /Sandboxes`. */
export interface SandboxInfo {
  Name: string;
}

// ─── Server-config detection: only show sandbox UI when enabled in TM1 cfg ──

const _sandboxEnabledCache = new Map<string, boolean>();

/** For tests + server-disconnect to wipe the cached enabled-flag. */
export function _clearSandboxEnabledCache(serverUrl?: string): void {
  if (serverUrl === undefined) { _sandboxEnabledCache.clear(); }
  else { _sandboxEnabledCache.delete(serverUrl); }
}

function findKeyDeep(obj: unknown, target: string): unknown {
  if (!obj || typeof obj !== 'object') { return undefined; }
  const o = obj as Record<string, unknown>;
  if (target in o) { return o[target]; }
  for (const v of Object.values(o)) {
    const hit = findKeyDeep(v, target);
    if (hit !== undefined) { return hit; }
  }
  return undefined;
}

/**
 * Checks whether sandboxes are usable on this server.
 *
 * Per IBM PA 2.0 docs, the master kill-switch is `DisableSandboxing`:
 *   - absent / `F` → sandboxes ENABLED (default behaviour)
 *   - `T`          → sandboxes DISABLED for all users (Direct-Writeback mode)
 *
 * Note: `EnableSandboxDimension` is a separate, unrelated feature (exposes
 * the sandbox as a TM1 dimension) and does NOT gate basic sandbox usage.
 *
 * Result cached per-serverUrl until disconnect. On any read error returns true
 * (optimistic — never hide the feature due to a transient config-read fail).
 */
export async function isSandboxEnabled(cfg: Tm1Config): Promise<boolean> {
  const key = cfg.serverUrl;
  const cached = _sandboxEnabledCache.get(key);
  if (cached !== undefined) { return cached; }
  try {
    // ActiveConfiguration (deeply nested object) is the canonical source.
    let body: unknown | null = null;
    const res = await apiRequest('GET', 'ActiveConfiguration', undefined, SIDE_READ_CAP_MS, cfg);
    if (isOk(res)) {
      body = parseJsonSafe<unknown>(res.body, null);
    } else {
      // Fallback to flat /Configuration (TM1 11.8 legacy).
      const res2 = await apiRequest('GET', 'Configuration', undefined, SIDE_READ_CAP_MS, cfg);
      if (isOk(res2)) {
        body = parseJsonSafe<unknown>(res2.body, null);
      }
    }
    if (body !== null) {
      const disableFlag = findKeyDeep(body, 'DisableSandboxing');
      // Disabled only if explicitly T (true). Absent / F → enabled.
      const enabled = disableFlag !== true && disableFlag !== 'T';
      _sandboxEnabledCache.set(key, enabled);
      return enabled;
    }
  } catch (e) { logRestBestEffort('sandbox', 'read DisableSandboxing', e); /* fall through to optimistic default */ }
  // Optimistic: assume enabled so user can still see/use the UI.
  _sandboxEnabledCache.set(key, true);
  return true;
}

/** Builds `Sandboxes('<key>')` — quote-doubled AND URL-encoded (`#`, `%`, `?`). */
export function sandboxKey(name: string): string {
  return `Sandboxes('${encodeODataKey(name)}')`;
}

/** Builds `Sandboxes('<escaped>')/tm1.Commit`. */
export function sandboxCommitPath(name: string): string {
  return `${sandboxKey(name)}/tm1.Commit`;
}

/** Lists all sandboxes visible to the authenticated user. */
export async function listSandboxes(cfg: Tm1Config): Promise<SandboxInfo[]> {
  const res = await apiRequest('GET', 'Sandboxes?$select=Name', undefined, undefined, cfg);
  assertOk(res, 'listSandboxes');
  return parseODataValueBody<SandboxInfo>(res);
}

/** Creates a new sandbox. Fails if a sandbox of the same name exists. */
export async function createSandbox(name: string, cfg: Tm1Config): Promise<void> {
  const body = JSON.stringify({ Name: name });
  const res = await apiRequest('POST', 'Sandboxes', body, undefined, cfg);
  assertOk(res, `createSandbox(${name})`);
}

/** Discards a sandbox (deletes without committing). */
export async function deleteSandbox(name: string, cfg: Tm1Config): Promise<void> {
  const res = await apiRequest('DELETE', sandboxKey(name), undefined, undefined, cfg);
  assertOk(res, `deleteSandbox(${name})`);
}

/**
 * Commits/publishes a sandbox to base (merges its writes into the live cubes).
 *
 * TM1 versions differ on the action name (verified against TM1py):
 *   - TM1 11.x:    `tm1.Publish`   — the original/canonical action.
 *   - PA 2.0.x+:   `tm1.Commit`    — newer alias (some builds support both).
 *   - some builds: bare `Commit`   — last resort.
 *
 * Tries in cascade, returns successfully when one succeeds.
 */
export async function commitSandbox(name: string, cfg: Tm1Config): Promise<{ via: string }> {
  const attempts: Array<{ via: string; path: string }> = [
    { via: 'tm1.Commit',  path: sandboxCommitPath(name) },
    { via: 'tm1.Publish', path: `${sandboxKey(name)}/tm1.Publish` },
    { via: 'Commit',      path: `${sandboxKey(name)}/Commit` },
  ];
  const tried: string[] = [];
  for (const a of attempts) {
    const r = await apiRequest('POST', a.path, undefined, undefined, cfg);
    if (r.statusCode !== 404) {
      assertOk(r, `commitSandbox(${name}) via ${a.via}`);
      return { via: a.via };
    }
    tried.push(a.via);
  }
  throw new Error(`commitSandbox(${name}): no commit endpoint found. Tried: ${tried.join(', ')}.`);
}

/**
 * Shared fetchNames cache — no vscode dependency.
 * Imported by tiDiagnosticsProvider and processEditor to avoid pulling in
 * the vscode-dependent completion provider classes in test environments.
 */
import { apiRequest, assertOk, getConfig } from '../tm1Client';
import { cacheScope } from '../tm1Rest/transport/session';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { listDimensionsWithHierarchies } from '../tm1Rest/dimensionApi';
import { parseBody } from '../tm1Rest/parseRest';
import { errMsg } from '../utils/errMsg';
import { INTERACTIVE_CAP_MS } from '../tm1Rest/timeouts';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';

const cache = new Map<string, { names: string[]; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function _cacheKey(endpoint: string, config?: Tm1Config): string {
  const cfg = config ?? getConfig();
  // Who asks decides what is listed (impersonation, another user or v12
  // database on the same URL), so the scope sits in front; `invalidateCache`
  // checks the URL at the front and the endpoint at the back.
  return `${cfg.serverUrl ? cacheScope(cfg) : '__default__'}::${endpoint}`;
}

/** Name list for completion and lint callers; every failure yields `[]`. */
export async function fetchNames(endpoint: string, config?: Tm1Config): Promise<string[]> {
  try {
    return await fetchNamesOrThrow(endpoint, config);
  } catch (err) {
    console.warn(`[fetchNames] failed for '${endpoint}': ${errMsg(err)}`);
    return [];
  }
}

/**
 * Same list and cache, but a failure throws. For commands where `[]` would be
 * read as "the server has none" (Go to Object, Bedrock detection).
 */
export async function fetchNamesOrThrow(endpoint: string, config?: Tm1Config): Promise<string[]> {
  const key = _cacheKey(endpoint, config);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) { return cached.names; }

  const cfg = config ?? getConfig();
  let names: string[];
  if (endpoint === 'Hierarchies') {
    const dims = await listDimensionsWithHierarchies(cfg, 5000);
    names = dims.flatMap(d =>
      (d.Hierarchies ?? []).map((h: any) => h.Name as string).filter(Boolean),
    );
  } else {
    const res = await apiRequest('GET', `${endpoint}?$select=Name`, undefined, INTERACTIVE_CAP_MS, cfg);
    assertOk(res);
    const parsed = parseBody<{ value?: Array<{ Name?: string }> }>(res);
    names = (parsed.value ?? []).map(e => e.Name as string);
  }
  cache.set(key, { names, ts: Date.now() });
  return names;
}

export function invalidateCache(endpoint?: string, serverUrl?: string): void {
  if (!endpoint && !serverUrl) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    const serverMatch = !serverUrl || key.startsWith(`${serverUrl}|`);
    const endpointMatch = !endpoint || key.endsWith(`::${endpoint}`);
    if (serverMatch && endpointMatch) { cache.delete(key); }
  }
}

// Server-keyed cache. The registry runs on disconnect AND on impersonation
// start/end — object names depend on read rights, so a list fetched as one
// user must not be served to the other.
registerServerDisposer('fetchNames', (url) => invalidateCache(undefined, url));

export function warmCache(config?: Tm1Config): void {
  // Best-effort prefetch — a miss (e.g. a 401 before a server profile is
  // selected) is harmless: the on-demand fetchNames call retries and surfaces
  // real errors. Deliberately swallowed to avoid noise on the warm path.
  for (const ep of ['Cubes', 'Dimensions', 'Hierarchies', 'Processes', 'Chores']) {
    fetchNames(ep, config).catch(() => {});
  }
}

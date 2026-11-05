import type { Tm1Config } from '../tm1Rest/transport/types';
import { encodeODataKey } from '../utils/odataKey';
import { parseBody } from '../tm1Rest/parseRest';
import { assertSameOriginLink, CrossOriginLinkError } from '../tm1Rest/odataPaging';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { cacheScope } from '../tm1Rest/transport/session';

export type ApiFetcher = (method: string, path: string, body?: string) => Promise<{ statusCode: number; body: string }>;

const TTL_5MIN = 5 * 60 * 1000;

interface TtlEntry<T> { value: T; ts: number }

/**
 * Bumped by every clear. A fetch that started before a clear (e.g. under the
 * previous login) must not write its late answer into the fresh cache.
 * ponytail: one counter for all servers — a clear on one server also skips
 * caching of fetches in flight on another; per-server counters if that matters.
 */
let _gen = 0;

function keyFor(cfg: Tm1Config, suffix: string): string {
  return `${cacheScope(cfg)}::${suffix}`;
}

/** Escape a name for an OData key segment — doubles `'`, then URL-encodes. */
function odataKey(name: string): string {
  return `'${encodeODataKey(name)}'`;
}

const cubeCache  = new Map<string, TtlEntry<string[]>>();
const dimCache   = new Map<string, TtlEntry<string[]>>();
/**
 * Element cache — session-lifetime (no TTL), LRU-capped at `ELEM_CACHE_MAX`
 * distinct dims, cleared on panel dispose.
 *
 * No TTL by design: element lists can be 100k+ entries; a TTL would force
 * re-fetching the actively-edited dim mid-session (perf hit). Instead we bound
 * the NUMBER of cached dims, not staleness — the hot dim stays resident (touched
 * on every hit → moved to the end of Map iteration order), and the
 * least-recently-used dim is evicted on overflow.
 */
const elemCache  = new Map<string, ElemEntry>();
/**
 * Max distinct dims held in `elemCache`. 32 comfortably covers a typical
 * cube's dimension count plus a few switched hierarchies, so the working set
 * never evicts, while capping worst-case memory at 32 element Sets.
 */
export const ELEM_CACHE_MAX = 32;

function isFresh<T>(e: TtlEntry<T> | undefined, ttl: number): e is TtlEntry<T> {
  return !!e && Date.now() - e.ts < ttl;
}

/**
 * TM1 pages large collections (e.g. `Elements`) via `@odata.nextLink`. A single
 * GET returns only the first page, so for big dimensions the element set was
 * truncated — any element past page 1 was falsely flagged "unknown" by the MDX
 * validator. Follow every nextLink so the returned list is complete.
 *
 * The nextLink is passed to `apiRequest` verbatim: it forwards absolute
 * (`http…`) links unchanged and base-prepends relative ones — the same handling
 * every other pagination loop in the codebase relies on. Do NOT try to
 * relativize an absolute link by slicing off `/api/v1/`: on v12 the base URL is
 * `…/api/v1/Databases('db')`, so the slice would leave a `Databases('db')/…`
 * prefix that gets prepended a second time → duplicated segment → 404 on page 2.
 */
interface NameList { names: string[]; complete: boolean }

/**
 * `complete: false` = the list may be cut short (server error, transport
 * failure). Such a list is never cached: a cached partial element list flagged
 * valid MDX as "unknown" for the rest of the session. A 404 on the first page
 * is a real answer (the object does not exist) and counts as complete.
 */
async function fetchNamesFrom(api: ApiFetcher, path: string, cfg: Tm1Config): Promise<NameList> {
  const names: string[] = [];
  let next: string | undefined = path;
  let guard = 0;
  try {
    while (next && guard++ < 1000) {
      const res = await api('GET', next);
      if (res.statusCode !== 200) {
        return { names, complete: guard === 1 && res.statusCode === 404 };
      }
      const obj = parseBody<{ value?: Array<{ Name?: string }>; '@odata.nextLink'?: string }>(res);
      for (const v of obj.value ?? []) {
        const n = v.Name ?? '';
        if (n !== '') { names.push(n); }
      }
      const link = obj['@odata.nextLink'] ?? undefined;
      // The server picks this URL and the transport attaches our credentials to
      // it, so refuse one that leaves the configured origin before requesting it.
      if (link !== undefined) { assertSameOriginLink(link, cfg); }
      next = link;
    }
    return { names, complete: true };
  } catch (e) {
    // A refused link must NOT look like a complete collection here: the whole
    // point of this loop is that a truncated element list makes the MDX
    // validator flag every element past page 1 as unknown. Partial results stay
    // the answer for ordinary transport/parse failures; the origin refusal is
    // re-thrown so it surfaces instead of turning into bogus lint.
    if (e instanceof CrossOriginLinkError) { throw e; }
    return { names, complete: false };
  }
}

export async function getCubes(cfg: Tm1Config, api: ApiFetcher): Promise<string[]> {
  const key = keyFor(cfg, 'cubes');
  const cached = cubeCache.get(key);
  if (isFresh(cached, TTL_5MIN)) { return cached.value; }
  const gen = _gen;
  const { names, complete } = await fetchNamesFrom(api, 'Cubes?$select=Name', cfg);
  if (complete && gen === _gen) { cubeCache.set(key, { value: names, ts: Date.now() }); }
  return names;
}

export async function getCubeDims(cube: string, cfg: Tm1Config, api: ApiFetcher): Promise<string[]> {
  const key = keyFor(cfg, `cubeDims::${cube}`);
  const cached = dimCache.get(key);
  if (isFresh(cached, TTL_5MIN)) { return cached.value; }
  const gen = _gen;
  const { names, complete } = await fetchNamesFrom(api, `Cubes(${odataKey(cube)})/Dimensions?$select=Name`, cfg);
  if (complete && gen === _gen) { dimCache.set(key, { value: names, ts: Date.now() }); }
  return names;
}

interface ElemEntry { names: string[]; lower: Set<string>; complete: boolean }

async function loadElements(dim: string, cfg: Tm1Config, api: ApiFetcher, hier?: string): Promise<ElemEntry> {
  const hierarchy = hier ?? dim;
  const key = keyFor(cfg, `elems::${dim}::${hierarchy}`);
  const cached = elemCache.get(key);
  if (cached) {
    // Hit → mark most-recently-used (delete + re-set moves to end of Map order).
    elemCache.delete(key);
    elemCache.set(key, cached);
    return cached;
  }
  const gen = _gen;
  const { names, complete } = await fetchNamesFrom(
    api,
    `Dimensions(${odataKey(dim)})/Hierarchies(${odataKey(hierarchy)})/Elements?$select=Name`,
    cfg,
  );
  const entry = { names, lower: new Set(names.map(n => n.toLowerCase())), complete };
  if (!complete || gen !== _gen) { return entry; }
  elemCache.set(key, entry);
  // Evict least-recently-used dim(s) once over the cap (first key = oldest).
  while (elemCache.size > ELEM_CACHE_MAX) {
    const oldest = elemCache.keys().next().value;
    if (oldest === undefined) { break; }
    elemCache.delete(oldest);
  }
  return entry;
}

/**
 * Element names of one hierarchy, lower-cased; `null` when the list could not
 * be read completely — the validator must then stay silent instead of marking
 * every element past the gap as unknown. `hier` defaults to the
 * dimension's default hierarchy (same name as the dimension) — an alternate
 * hierarchy carries its own elements, so validating against the default one
 * flags correct members as unknown.
 */
export async function getDimElements(
  dim: string,
  cfg: Tm1Config,
  api: ApiFetcher,
  hier?: string,
): Promise<Set<string> | null> {
  const entry = await loadElements(dim, cfg, api, hier);
  return entry.complete ? entry.lower : null;
}

/** Same list as {@link getDimElements}, in the server's spelling — for completion. */
export async function getElementNames(
  dim: string,
  cfg: Tm1Config,
  api: ApiFetcher,
  hier?: string,
): Promise<string[]> {
  return (await loadElements(dim, cfg, api, hier)).names;
}

/**
 * Drop element-cache entries. With no arg: clears all (test-only behaviour).
 * With a server URL prefix: clears only entries matching that server, so
 * closing one panel does not wipe caches in use by another panel.
 */
export function clearSessionElements(serverUrlPrefix?: string): void {
  _gen++;
  if (serverUrlPrefix === undefined) {
    elemCache.clear();
    return;
  }
  const prefix = `${serverUrlPrefix}|`;
  for (const key of elemCache.keys()) {
    if (key.startsWith(prefix)) { elemCache.delete(key); }
  }
}

/**
 * Drops one server's cube, dimension and element lists (disconnect, and the
 * start or end of an impersonation frees the entries of the other identity).
 */
export function clearSchemaCacheForServer(serverUrl: string): void {
  _gen++;
  const prefix = `${serverUrl}|`;
  for (const cache of [cubeCache, dimCache, elemCache]) {
    for (const k of [...cache.keys()]) {
      if (k.startsWith(prefix)) { cache.delete(k); }
    }
  }
}

registerServerDisposer('mdxSchema', (url) => clearSchemaCacheForServer(url));

/** Test-only — drops everything. */
export function _clearAllForTest(): void {
  cubeCache.clear();
  dimCache.clear();
  elemCache.clear();
}

/** Test-only — current number of dims held in the element cache. */
export function _elemCacheSizeForTest(): number {
  return elemCache.size;
}

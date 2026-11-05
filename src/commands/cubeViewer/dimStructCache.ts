import { apiRequest } from '../../tm1Client';
import { cacheScope } from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import { withSandbox } from '../../tm1Rest/sandboxTracker';
import { hierODataPath } from '../../utils/hierKeyPure';
import { _fetchDimLevels, _fetchDimParents, type DimParentMaps } from './fetch';
import { isOk } from '../../tm1Rest/httpError';
import { runWithoutAbortSignal } from '../../tm1Rest/transport/abortScope';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

/**
 * Axis metadata of a dimension (levels + parent maps), cached and validated
 * against the server.
 *
 * Why this exists at all: every refresh of the Cube Viewer — and expanding or
 * collapsing a row IS a refresh — rebuilt the axis metadata from scratch. Per
 * axis dimension that is two full tables: `Elements?$select=Name,Level` and
 * the complete edge list `Edges`. Measured live against 11.8 (2026-08-08,
 * `Cube A`): a dimension with 160,659 elements is 16.9 MB + 23.7 MB, one with
 * 211,833 (211,852) is 20.0 MB + 26.2 MB. The structure practically never
 * changes between two clicks — it was still paid for every time regardless,
 * including `JSON.parse` over 24 MB in the extension host.
 *
 * Why an ETag instead of a TTL: a guessed expiry time is simultaneously too
 * short (fetches needlessly) and too long (shows stale data). TM1 supplies a
 * real validator, confirmed live (2026-08-08, 11.8.02900.8):
 *
 *  • The Hierarchy entity carries `@odata.etag` even under `$select=Name` —
 *    around 180 bytes, 1 ms. The value is in the BODY, not just the header;
 *    that is the reason for this approach instead of `If-None-Match` on the
 *    expensive query: `ApiResponse` (transport/types.ts) only passes through
 *    statusCode and body, response headers would be a transport rework for
 *    every caller.
 *  • This ETag is character-for-character identical to the ETag of the
 *    Elements query.
 *  • It also changes on a pure EDGE change, even though the `Name,Level`
 *    projection then stays identical. So it is a hierarchy version stamp, not
 *    a content hash of the individual query — and that means it also covers
 *    the edge part, which does not deliver its own ETag at all.
 *
 * Limit: the stamp applies per hierarchy. If someone changes the dimension on
 * the server, an open Cube Viewer sees that on the next click — not sooner,
 * because nothing here polls.
 */
export interface DimStructure {
  levels: Map<string, number>;
  parents: DimParentMaps;
}

interface CacheEntry {
  etag: string;
  struct: DimStructure;
  /** Element count of the dimension — the measure the cap hangs on. */
  weight: number;
}

/**
 * Upper bound for the sum of held elements across all entries.
 *
 * The cache holds what used to become garbage again on every refresh. That
 * does not change the peak requirement — the maps were built on every refresh
 * anyway — but it does change the steady-state requirement. The cap is on the
 * element count rather than the number of entries, because a dimension with
 * 200,000 elements and one with 68 do not cost the same. The two largest
 * dimensions of the reference server (160,659 + 211,852) fit together under
 * the budget.
 */
export const DIM_STRUCT_ELEMENT_BUDGET = 1_000_000;

/**
 * The key is `serverUrl|user|dim`: element security hides elements per user,
 * and two profiles on one URL must not share a structure. Sandbox headers
 * deliberately do NOT go into the key: a sandbox holds cell values, not the
 * dimension structure.
 *
 * A `Map`'s insertion order is the LRU order: every hit moves its entry back
 * to the end, and eviction happens from the front.
 */
const _cache = new Map<string, CacheEntry>();
/** Queries in flight, so two concurrent calls do not fetch twice. */
const _inFlight = new Map<string, Promise<DimStructure>>();

/**
 * Bumped by every invalidation. A read that started before (e.g. under the
 * previous login) must neither serve new callers nor write its late answer
 * into the fresh cache.
 * ponytail: one counter for all servers; per-server counters if the skipped
 * cache writes on unrelated servers ever matter.
 */
let _gen = 0;

function cacheKey(config: Tm1Config | undefined, dimName: string): string {
  return `${config?.serverUrl ? cacheScope(config) : '|'}|${dimName}`;
}

/** Move a freshly used entry to the end of the LRU order. */
function touch(key: string, entry: CacheEntry): void {
  _cache.delete(key);
  _cache.set(key, entry);
}

/**
 * Evicts from the oldest accesses onward until the budget fits again. The
 * entry just inserted (`keep`) always stays, even if it alone is over budget:
 * a dimension of this size is the most expensive reload case there is, and
 * discarding exactly that one would defeat the purpose. So it then simply
 * sits alone in the cache.
 */
function evictToBudget(keep: string): void {
  let total = 0;
  for (const e of _cache.values()) { total += e.weight; }
  if (total <= DIM_STRUCT_ELEMENT_BUDGET) { return; }
  for (const [k, e] of [..._cache]) {
    if (total <= DIM_STRUCT_ELEMENT_BUDGET) { break; }
    if (k === keep) { continue; }
    _cache.delete(k);
    total -= e.weight;
  }
}

/**
 * The hierarchy's current version stamp, or `undefined` when the server does
 * not provide one. `undefined` means "validity unknown" and always leads to
 * the full query — never to serving a possibly stale entry.
 */
async function _fetchHierEtag(dimName: string, config: Tm1Config): Promise<string | undefined> {
  try {
    const res = await apiRequest(
      'GET', `${hierODataPath(dimName)}?$select=Name`,
      undefined, 15000, config, withSandbox(config),
    );
    if (!isOk(res)) { return undefined; }
    const etag = parseBodySafe<{ '@odata.etag'?: string }>(res, {})['@odata.etag'];
    return typeof etag === 'string' && etag !== '' ? etag : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Levels + parent maps of a dimension, from the cache when the server
 * confirms the unchanged version stamp. Keeps throwing when the actual query
 * fails — the caller (`_buildAxisMeta`) catches it per dimension.
 */
export async function getDimStructure(dimName: string, config: Tm1Config): Promise<DimStructure> {
  const key = cacheKey(config, dimName);
  const running = _inFlight.get(key);
  if (running) { return running; }

  const gen = _gen;
  // Shared by every viewer asking for this dimension meanwhile, so it runs
  // outside the starting panel's abort scope (review 2026-10-07, R2).
  const task = runWithoutAbortSignal(async (): Promise<DimStructure> => {
    const etag = await _fetchHierEtag(dimName, config);
    const hit = _cache.get(key);
    if (etag !== undefined && hit && hit.etag === etag) {
      touch(key, hit);
      return hit.struct;
    }

    const [levels, parents] = await Promise.all([
      _fetchDimLevels(dimName, config),
      _fetchDimParents(dimName, config),
    ]);
    const struct: DimStructure = { levels, parents };
    if (gen !== _gen) { return struct; }
    // Without a stamp the entry stays out: a cache whose validity nobody can
    // confirm is just a bet at the next click.
    if (etag !== undefined) {
      touch(key, { etag, struct, weight: levels.size });
      evictToBudget(key);
    } else {
      _cache.delete(key);
    }
    return struct;
  }).finally(() => { if (_inFlight.get(key) === task) { _inFlight.delete(key); } });

  _inFlight.set(key, task);
  return task;
}

/**
 * Discards entries. With no arguments, everything; with `serverUrl`, only its
 * entries; with both, that dimension for every user. For places that write to a dimension
 * themselves and do not want to wait for the next stamp comparison.
 */
export function invalidateDimStructure(serverUrl?: string, dimName?: string): void {
  _gen++;
  if (serverUrl === undefined) { _cache.clear(); _childIndex.clear(); _inFlight.clear(); return; }
  const prefix = `${serverUrl}|`;
  // `|` cannot occur in a TM1 object name, so the suffix is unambiguous.
  const suffix = dimName === undefined ? '' : `|${dimName}`;
  for (const m of [_cache, _childIndex, _inFlight] as Map<string, unknown>[]) {
    for (const k of [...m.keys()]) {
      if (k.startsWith(prefix) && k.endsWith(suffix)) { m.delete(k); }
    }
  }
}

registerServerDisposer('dimStructure', (url) => invalidateDimStructure(url));

/**
 * Reverse index of a dimension: parent -> children, plus the set of all
 * parents.
 *
 * Why here and not on the client: for this, the client used to scan the
 * complete parent map (`grid.ts`, 160k-211k entries) on EVERY row header it
 * rendered. The host has the map anyway, can flip it once, and attaches the
 * result to the same cache entry — the ETag that validates the structure
 * thereby also validates the index.
 */
export interface DimChildIndex {
  children: Map<string, string[]>;
  parentSet: Set<string>;
}

const _childIndex = new Map<string, { etagStruct: DimStructure; index: DimChildIndex }>();

export async function getDimChildIndex(dimName: string, config: Tm1Config): Promise<DimChildIndex> {
  const gen = _gen;
  const struct = await getDimStructure(dimName, config);
  const key = cacheKey(config, dimName);
  const hit = _childIndex.get(key);
  // Identity comparison, not content comparison: `getDimStructure` returns
  // exactly the same object when the stamp is unchanged. A new object means
  // "the structure has changed", and then the index is obsolete.
  if (hit && hit.etagStruct === struct) { return hit.index; }

  const children = new Map<string, string[]>();
  const parentSet = new Set<string>();
  for (const c of Object.keys(struct.parents.all)) {
    for (const p of struct.parents.all[c]) {
      parentSet.add(p);
      const list = children.get(p);
      if (list) { list.push(c); } else { children.set(p, [c]); }
    }
  }
  const index: DimChildIndex = { children, parentSet };
  if (gen === _gen) { _childIndex.set(key, { etagStruct: struct, index }); }
  return index;
}

/** Test-intern. */
export function _clearDimStructCacheForTest(): void {
  _cache.clear();
  _inFlight.clear();
  _childIndex.clear();
}

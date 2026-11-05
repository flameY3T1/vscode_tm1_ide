/**
 * Reads picklists from TM1. There is NO REST support for this: `$metadata`
 * does not know the term, `CellsetCell` has no field for it, there is no
 * action. So we read it ourselves — from the control cube's RULE TEXT, from
 * the element attributes per dimension, and for everything else ONE cell on
 * request.
 *
 * The measured law (2026-08-13, TM1 11.8, on a planning cube, probes
 * picklistViewProbe*.js):
 *
 * | Query form against `}PickList_<Cube>`      | Cost                  |
 * |--------------------------------------------|-----------------------|
 * | `GET Cubes('}PickList_<c>')/Rules`         | 1 ms                  |
 * | ONE cell, even never queried before        | 1-2 ms                |
 * | 417 cells in ONE cellset                   | 12,521 ms             |
 * | Window of a real saved view                | > 10 min, aborted     |
 * | Scan per dimension over its elements       | 19 s total            |
 *
 * The control cube is NOT expensive per cell, but with the CELLSET SIZE.
 * That is why there is no area-wide cell query here any more, and there must
 * never be one again — the numbers are here for exactly that reason.
 *
 * Live fact (TM1 11.8): if `}PickList_<Cube>` is missing, the MDX query
 * responds with HTTP 400 "501 syntax error", NOT 404 — that is why
 * `hasPicklistCube` checks existence separately via `GET` before the rule
 * text or a single cell is read. A broken picklist query must never cost the
 * view anything: EVERY error path here ends in an empty result, never in a
 * throw.
 */
import { hierODataPath } from '../../utils/hierKeyPure';
import { apiRequest } from '../../tm1Rest/client';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { buildCellPicklistMdx } from '../../cubeViewer/cellPicklistMdxPure';
import { parsePicklistRules } from '../../cubeViewer/picklistRulePure';
import { parsePicklistDefinition } from '../../cubeViewer/picklistPure';
import { encodeODataKey } from '../../utils/odataKey';
import { fetchAllPages } from '../../tm1Rest/odataPaging';
import { logCubeViewer } from './cubeViewerLog';
import { errMsg } from '../../utils/errMsg';
import { isOk } from '../../tm1Rest/httpError';

const _cubeExists = new Map<string, boolean>();
const key = (cfg: Tm1Config, s: string): string => `${cfg.serverUrl}::${s}`;
const serverPrefix = (serverUrl: string): string => `${serverUrl}::`;

/**
 * Is this error status a FINAL answer — that is, one worth remembering
 * (fix round 1)?
 *
 * `404` means "that doesn't exist", `401`/`403` "you're not allowed to do
 * that", `400` "that's not how you ask that": none of the three changes by
 * itself within a session, and asking again just costs. `5xx`, by contrast,
 * means "not right now" — that is much closer to a thrown exception
 * (network/DNS/timeout) than to a 404, and we do not remember it for exactly
 * the same reason: a single server hiccup must not switch off picklists for
 * the rest of the session. Without this distinction, a 503 on the first
 * refresh pinned the element picklists invisibly to OFF.
 */
const isDefinitive = (statusCode: number): boolean => statusCode < 500;

/** Every cache in this module — otherwise they persist across tests. */
export function _clearPicklistCachesForTest(): void {
  _cubeExists.clear(); _resolved.clear(); _elemPicklists.clear();
  _rulePicklists.clear(); _cellPicklists.clear();
}

/** All entries of a cache that belong to this server. */
function dropForServer(cache: Map<string, unknown>, serverUrl: string): void {
  const prefix = serverPrefix(serverUrl);
  for (const k of [...cache.keys()]) {
    if (k.startsWith(prefix)) { cache.delete(k); }
  }
}

/**
 * Discards resolved definitions of this server (spec §E3). Called from the
 * refresh path (`picklistWiring.ts#_picklistMaps`): otherwise a picklist
 * changed in TM1 would stay stale for the whole session, because `_resolved`
 * never lets go of anything by itself.
 *
 * ONLY the resolutions and the single-cell definitions — the control cube's
 * existence, the attribute maps and the rule map are precisely what is
 * supposed to carry OVER refreshes; otherwise they would come up again on
 * every refresh, and their cache would be pointless (all three are needed
 * exactly once per refresh).
 *
 * The single-cell definitions, by contrast, hang off cell values that can
 * change on refresh — they therefore follow `_resolved`, as required by the
 * brief ("cache the result per coordinate, with the same invalidation as
 * `resolvePicklist`").
 */
export function invalidatePicklistResolutions(serverUrl: string): void {
  dropForServer(_resolved, serverUrl);
  dropForServer(_cellPicklists, serverUrl);
}

/**
 * Forget everything for this server — the hook for disconnecting. Without
 * it, a 404 of the control cube (or an attribute map) would survive
 * disconnect and reconnect, even though a different state may by then exist
 * on the server.
 */
export function disposePicklistCachesForServer(serverUrl: string): void {
  dropForServer(_cubeExists, serverUrl);
  dropForServer(_resolved, serverUrl);
  dropForServer(_elemPicklists, serverUrl);
  dropForServer(_rulePicklists, serverUrl);
  dropForServer(_cellPicklists, serverUrl);
}

/**
 * Does `}PickList_<cube>` exist? If it is missing, all the picklist support
 * costs nothing further — that is why this is the first question, and it is
 * remembered per `serverUrl|cube`, because otherwise it would come up again
 * on every refresh.
 *
 * Callers (Task 7) call this unguarded inside a `Promise.all` in the open
 * path — a throw here would therefore cost the view, exactly what the
 * binding requirement forbids. Hence the same coverage as for every other
 * read path here: a thrown exception (network/DNS/timeout) is treated as
 * "no control cube" — the safe answer, meaning only no cell picklists, never
 * a broken grid. It is NOT cached: a single hiccup must not switch off
 * picklists for the rest of the session.
 *
 * The same has applied to `5xx` since fix round 1 (see `isDefinitive`) —
 * that too means "not right now", not "doesn't exist". A `404` (and any
 * other 4xx) stays remembered, that is a final answer. The 5xx case reports
 * on the log channel, because it switches off a visible feature.
 */
export async function hasPicklistCube(cfg: Tm1Config, cube: string): Promise<boolean> {
  const k = key(cfg, cube);
  const known = _cubeExists.get(k);
  if (known !== undefined) { return known; }
  try {
    const res = await apiRequest(
      'GET', `Cubes('${encodeODataKey(`}PickList_${cube}`)}')?$select=Name`, undefined, undefined, cfg,
    );
    const ok = isOk(res);
    if (!ok && !isDefinitive(res.statusCode)) {
      logCubeViewer(`Picklists: cannot tell whether control cube "}PickList_${cube}" exists — `
        + `HTTP ${res.statusCode}. Cell-level picklists are off for this read; not remembered, `
        + 'the next refresh asks again.');
      return false;
    }
    _cubeExists.set(k, ok);
    return ok;
  } catch (err) {
    logCubeViewer(`Picklists: control cube check for "${cube}" failed — ${errMsg(err)}`);
    return false;
  }
}

/**
 * Rule map per `serverUrl|cube`: `element name -> raw definition`, read from
 * the control cube's rule text (`parsePicklistRules`).
 *
 * This is the only AREA-WIDE source for the cell level, and it costs a
 * measured 1 ms — compared to 12.5 s for 417 cells and > 10 min for the
 * window of a real view. Exactly one GET per cube and session.
 */
const _rulePicklists = new Map<string, Record<string, string>>();

/**
 * Which elements does a rule-based picklist carry?
 *
 * What is remembered is what comes from a REAL server response (2xx or a
 * final 4xx status). `5xx` and thrown exceptions are NOT — the same
 * discipline as with `hasPicklistCube`/`fetchElementPicklists`: a single
 * hiccup must not switch off picklists for the rest of the session.
 *
 * Without a control cube there is nothing to read; that is the first
 * question and costs nothing further after the first time.
 */
export async function fetchRulePicklists(
  cfg: Tm1Config, cube: string,
): Promise<Record<string, string>> {
  const ck = key(cfg, cube);
  const cached = _rulePicklists.get(ck);
  if (cached !== undefined) { return cached; }
  try {
    if (!(await hasPicklistCube(cfg, cube))) { return {}; }
    const res = await apiRequest(
      'GET', `Cubes('${encodeODataKey(`}PickList_${cube}`)}')/Rules`, undefined, undefined, cfg,
    );
    // 204 = control cube with no rules. A real result, not an error.
    if (res.statusCode === 204) { _rulePicklists.set(ck, {}); return {}; }
    if (!isOk(res)) {
      logCubeViewer(`Picklists: rule text of control cube "}PickList_${cube}" not readable — `
        + `HTTP ${res.statusCode}. Rule-based cells get no marker; a double-click still `
        + 'resolves them one cell at a time.'
        + (isDefinitive(res.statusCode) ? ' Remembered until disconnect.' : ' Not remembered.'));
      if (isDefinitive(res.statusCode)) { _rulePicklists.set(ck, {}); }
      return {};
    }
    // `GET .../Rules` responds with `{ value: "<text>" }`, NOT `{ Rules: ... }`
    // (docs/architecture/tm1-rest-quirks.md, "Reading rules").
    const text = parseBodySafe<{ value?: string }>(res, {}).value;
    const map = parsePicklistRules(typeof text === 'string' ? text : '');
    _rulePicklists.set(ck, map);
    return map;
  } catch (err) {
    logCubeViewer(`Picklists: rule text of "}PickList_${cube}" not read — ${errMsg(err)}`);
    // Network/DNS/timeout — no cache entry, the view stays usable.
    return {};
  }
}

/**
 * Single-cell definitions per `serverUrl|cube|coordinate`. `null` is a REAL
 * result ("this cell has no picklist") and must stay distinguishable from
 * "not yet asked" — hence `Map.has` semantics over `undefined`.
 */
const _cellPicklists = new Map<string, string | null>();

/**
 * The definition of EXACTLY ONE cell — the lazy path for everything that
 * neither the attribute map nor the rule map knows (stored, non-rule-based
 * definitions).
 *
 * Measured at 1-2 ms, even for coordinates never queried before. This
 * function must NEVER address more than one cell — `buildCellPicklistMdx`
 * enforces that, and the reason is documented there: 417 cells in one
 * cellset cost 12.5 s, the window of a real view over 10 minutes.
 *
 * Every error path results in `null` = "no list, TM1 allows anything here".
 * Only a result from a real 2xx response is remembered.
 */
export async function fetchCellPicklist(
  cfg: Tm1Config, cube: string, dims: readonly string[], coordinates: readonly string[],
): Promise<string | null> {
  const mdx = buildCellPicklistMdx(cube, dims, coordinates);
  if (!mdx) { return null; }
  const ck = `${cfg.serverUrl}::${cube}::${dims.join('\u0000')}::${coordinates.join('\u0000')}`;
  const cached = _cellPicklists.get(ck);
  if (cached !== undefined) { return cached; }
  try {
    if (!(await hasPicklistCube(cfg, cube))) { return null; }
    const res = await apiRequest(
      'POST', 'ExecuteMDX?$expand=Cells($select=Ordinal,Value)',
      JSON.stringify({ MDX: mdx }), undefined, cfg,
    );
    if (!isOk(res)) { return null; }
    const parsed = parseBodySafe<{ Cells?: Array<{ Value?: string | null }> }>(res, {});
    const raw = parsed.Cells?.[0]?.Value;
    const v = typeof raw === 'string' ? raw.trim() : '';
    const out = v === '' ? null : v;
    _cellPicklists.set(ck, out);
    return out;
  } catch (err) {
    logCubeViewer(`Picklists: cell picklist query failed — ${errMsg(err)}`);
    return null;
  }
}

/**
 * Attribute map per `serverUrl|dimension` (spec §E5). The empty entry is a
 * REAL result ("this dimension has no picklist attribute") and not the same
 * as "not yet asked" — hence `Map.has` semantics over `undefined`, not over
 * the map's size.
 */
const _elemPicklists = new Map<string, Record<string, string>>();

/**
 * Attribute level: dim -> element -> raw definition.
 *
 * Two requests per dimension, and the first is cheap: check first whether
 * the attribute exists at all. On a model with no picklists, it stays at one
 * `ElementAttributes` call per dimension.
 *
 * The result is remembered (`_elemPicklists`), because this would otherwise
 * come up on EVERY refresh — 1-2 requests per cube dimension, up to 20 per
 * refresh on a 10-dimensional cube. The same discipline as with
 * `hasPicklistCube`: only what comes from a real HTTP response is
 * remembered (2xx OR an error status — both are a server response); a
 * result obtained from a thrown exception (network/DNS/timeout) NEVER, or a
 * single network hiccup would switch off the attribute picklists for the
 * rest of the session. The cache is discarded when the connection is
 * disconnected (`disposePicklistCachesForServer`).
 *
 * NO `$filter=Attributes/Picklist ne ''` — on 11.8 the filter over a
 * complex type is silently ignored and the full list comes back regardless;
 * filtering therefore happens in code, after `Attributes` (a complex type,
 * arriving as a `{attrName: value}` object, not an array) has been read.
 *
 * Every error — status code or thrown exception — results in no entry for
 * the affected dimension, never a throw: a broken picklist query must never
 * cost the view anything (the same coverage as `hasPicklistCube`/
 * `fetchRulePicklists`).
 */
export async function fetchElementPicklists(
  cfg: Tm1Config, dims: string[],
): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {};
  await Promise.all(dims.map(async (dim) => {
    const ck = key(cfg, dim);
    const remember = (map: Record<string, string>): void => {
      _elemPicklists.set(ck, map);
      if (Object.keys(map).length > 0) { out[dim] = map; }
    };
    /**
     * Error status on one of the two read paths. Final (4xx) means "this
     * dimension has nothing here" and is remembered; `5xx` means "not right
     * now" and is deliberately NOT remembered, or a single server hiccup
     * would switch off the attribute picklists until disconnect. Both are
     * reported on the channel: it is the only place in the feature where a
     * visible function would otherwise fail silently.
     */
    const skipped = (what: string, statusCode: number): void => {
      const definitive = isDefinitive(statusCode);
      logCubeViewer(`Picklists: element attributes of dimension "${dim}" skipped — ${what} `
        + `answered HTTP ${statusCode}. `
        + (definitive
          ? 'Remembered until disconnect (a definitive answer).'
          : 'Not remembered — the next refresh asks again.'));
      if (definitive) { remember({}); }
    };
    const cached = _elemPicklists.get(ck);
    if (cached !== undefined) {
      if (Object.keys(cached).length > 0) { out[dim] = cached; }
      return;
    }
    try {
      // `dim` is a viewer key (`dim` or `dim:hier`, hierKeyPure).
      const hp = hierODataPath(dim);
      const attrs = await apiRequest(
        'GET', `${hp}/ElementAttributes?$select=Name`,
        undefined, undefined, cfg,
      );
      if (!isOk(attrs)) {
        skipped('the attribute list', attrs.statusCode); return;
      }
      const names = parseBodySafe<{ value?: Array<{ Name?: string }> }>(attrs, {}).value ?? [];
      const attrName = names.map((a) => a.Name ?? '').find((n) => n.toLowerCase() === 'picklist');
      if (!attrName) { remember({}); return; }

      const elemPath = `${hp}/Elements?$select=Name,Attributes`;
      const els = await apiRequest('GET', elemPath, undefined, undefined, cfg);
      if (!isOk(els)) {
        skipped('the element list', els.statusCode); return;
      }
      /**
       * Paging onward as in `resolveNames` (see below): element lists are
       * paged server-side (`@odata.nextLink`) and can have >100k names.
       * Taking only `.value` of the first page would lose EVERY further
       * attribute picklist beyond one page size — silently, with no error.
       * The first page is passed along via `firstRes` (no second request),
       * its status has already been checked above. **With `label`**, so
       * that a failed follow-up page throws instead of returning a TOO SHORT
       * excerpt: the throw lands in the `catch` below — no entry and NO
       * cache entry, the next request sees the complete list. A half map
       * would be worse: it would make arrows disappear exactly where TM1
       * enforces a list.
       */
      const rows = await fetchAllPages<{ Name?: string; Attributes?: Record<string, unknown> }>(
        elemPath, cfg, { firstRes: els, label: elemPath },
      );
      const map: Record<string, string> = {};
      for (const r of rows) {
        // Depending on how it was populated, TM1 returns string attributes with trailing spaces.
        const v = String(r.Attributes?.[attrName] ?? '').trim();
        if (r.Name && v !== '') { map[r.Name] = v; }
      }
      remember(map);
    } catch (err) {
      logCubeViewer(`Picklists: element attributes of "${dim}" not read — ${errMsg(err)}`);
      // network/DNS/timeout — dimension stays without an entry and WITHOUT a
      // cache entry (see above), the view stays usable.
    }
  }));
  return out;
}

const _resolved = new Map<string, string[] | null>();

/**
 * Read an element list (`/Elements?$select=Name` under Dimension/Hierarchy OR
 * Subset/PrivateSubset). Two steps, deliberately separate:
 *
 * 1. Fetch the first page ourselves and check the status code. A 404 (dead
 *    reference) must produce `null` — NOT the empty list, which would mean
 *    "found, but 0 elements" (e.g. a genuinely empty subset). `fetchAllPages`
 *    without `label` would treat this the same way on page 1 (abort on error
 *    status), but then returns `[]` — indistinguishable from a real empty
 *    hit. Hence the separate check up front.
 * 2. Only after the 2xx check, fetch the rest via `fetchAllPages` — element
 *    lists can have >100k names and are paged server-side (`@odata.nextLink`).
 *    The already-fetched first page is passed along via `firstRes` so it is
 *    not requested twice. **With `label`**: if a follow-up page fails (page
 *    2+, a server hiccup in the middle of a large list), `fetchAllPages`
 *    throws instead of silently aborting and returning the — too SHORT —
 *    slice collected so far. An incomplete list is worse as a picklist than
 *    none at all: it leaves values that TM1 would accept missing from the
 *    dropdown, with nothing anywhere pointing to it. The throw runs through
 *    to `resolvePicklist`, which turns it into `null` (= the cell becomes
 *    freely editable) and does NOT cache it.
 *
 * Keeps throwing when `apiRequest`/`fetchAllPages` throws (network/DNS/
 * timeout OR a failed follow-up page) — `resolvePicklist` decides whether
 * (and that) this must NOT be cached.
 */
async function resolveNames(cfg: Tm1Config, path: string): Promise<string[] | null> {
  const first = await apiRequest('GET', path, undefined, undefined, cfg);
  if (!isOk(first)) { return null; }
  const rows = await fetchAllPages<{ Name?: string }>(path, cfg, { firstRes: first, label: path });
  return rows.map((e) => String(e.Name ?? '')).filter(Boolean);
}

/**
 * A dimension's hierarchy names, excluding the (standard) hierarchy that
 * shares the dimension's name — for the fallback path in `resolveSubset`. No
 * pagination effort: hierarchies per dimension are a handful, never hundreds
 * of thousands like elements. An error status is treated as "no further
 * hierarchies" (the caller already checked the standard hierarchy before
 * this); a thrown exception passes through uncaught — `resolvePicklist`
 * decides on cache/retry, as everywhere else here.
 */
async function listOtherHierarchies(cfg: Tm1Config, dimension: string): Promise<string[]> {
  const d = encodeODataKey(dimension);
  const res = await apiRequest('GET', `Dimensions('${d}')/Hierarchies?$select=Name`, undefined, undefined, cfg);
  if (!isOk(res)) { return []; }
  const rows = parseBodySafe<{ value?: Array<{ Name?: string }> }>(res, {}).value ?? [];
  const names = rows.map((r) => r.Name ?? '').filter(Boolean);
  return names.filter((n) => n.toLowerCase() !== dimension.toLowerCase());
}

/**
 * Resolve `subset:Dim[:Hier]:Subset`.
 *
 * If the definition names a hierarchy (four-segment form), the search
 * happens ONLY there (public, then private). Without a hierarchy segment
 * (measured: `subset:` finds the subset in EVERY hierarchy of the
 * dimension, not only the one sharing its name), this order applies:
 *
 *   1. Public, in the (standard) hierarchy that shares the dimension's name
 *      — the normal case, costs exactly ONE request.
 *   2. Only once (1) came back empty: query the dimension's remaining
 *      hierarchies (costs one additional request to LIST them — exactly
 *      once, not per attempt) and search publicly within them.
 *   3. Only once NO hierarchy had a public subset of this name: private,
 *      first the standard hierarchy, then the rest (the list from step 2 is
 *      already available, no further listing call).
 *
 * On a name collision, the public subset therefore always wins — measured —
 * and the expensive fallback (listing hierarchies) is only paid for when
 * the cheap standard case has not already hit.
 */
async function resolveSubset(
  cfg: Tm1Config, dimension: string, subset: string, explicitHierarchy: string | undefined,
): Promise<string[] | null> {
  const d = encodeODataKey(dimension);
  const s = encodeODataKey(subset);
  const inHier = (hierName: string, priv: boolean): Promise<string[] | null> => {
    const h = encodeODataKey(hierName);
    const coll = priv ? 'PrivateSubsets' : 'Subsets';
    return resolveNames(cfg, `Dimensions('${d}')/Hierarchies('${h}')/${coll}('${s}')/Elements?$select=Name`);
  };

  if (explicitHierarchy) {
    return (await inHier(explicitHierarchy, false)) ?? await inHier(explicitHierarchy, true);
  }

  let out = await inHier(dimension, false);
  if (out) { return out; }

  const others = await listOtherHierarchies(cfg, dimension);
  for (const hier of others) {
    out = await inHier(hier, false);
    if (out) { return out; }
  }

  out = await inHier(dimension, true);
  if (out) { return out; }
  for (const hier of others) {
    out = await inHier(hier, true);
    if (out) { return out; }
  }
  return null;
}

/**
 * Definition -> allowed values.
 *
 * `null` means "TM1 allows anything here": an unreadable definition or a dead
 * reference (dimension/hierarchy/subset does not exist). That is NOT the
 * same as an empty list — that would mean "dropdown with no entries", and,
 * measured, the server accepts any cell value for a dead reference, with no
 * error or log entry (spec §0.4).
 *
 * The result is remembered per `serverUrl|rawDef` (`_resolved`) — BUT only
 * when it comes from a real server response (2xx OR a reliable error status
 * like 404). A thrown exception (network/DNS/timeout, or a failed follow-up
 * page in `resolveNames`) does NOT flow into the cache: otherwise a single
 * network hiccup would switch off the picklist for the rest of the session,
 * even though the next call might already get an answer again (the same
 * distinction as `hasPicklistCube`).
 */
export async function resolvePicklist(cfg: Tm1Config, rawDef: string): Promise<string[] | null> {
  const ck = key(cfg, rawDef);
  const cached = _resolved.get(ck);
  if (cached !== undefined) { return cached; }

  const def = parsePicklistDefinition(rawDef);
  let out: string[] | null = null;

  try {
    if (def?.kind === 'static') {
      out = def.values;
    } else if (def?.kind === 'dimension') {
      const d = encodeODataKey(def.dimension);
      const h = encodeODataKey(def.hierarchy ?? def.dimension);
      out = await resolveNames(cfg, `Dimensions('${d}')/Hierarchies('${h}')/Elements?$select=Name`);
    } else if (def?.kind === 'subset') {
      out = await resolveSubset(cfg, def.dimension, def.subset, def.hierarchy);
    }
  } catch (err) {
    logCubeViewer(`Picklists: definition "${rawDef}" not resolved — ${errMsg(err)}`);
    // Network/DNS/timeout OR a failed follow-up page (see `resolveNames`):
    // deliberately NO `_resolved.set` — see the doc comment.
    return null;
  }

  _resolved.set(ck, out);
  return out;
}

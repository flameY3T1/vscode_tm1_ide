import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { parseODataValueBody, parseJsonSafe, parseBody, odataErrorMessage } from './parseRest';
import type { ODataError } from './odataTypes';
import { fetchAllPages } from './odataPaging';
import { buildReorderBody, classifyReorderError } from './reorderDimsPure';
import { encodeODataKey, escapeODataKey } from '../utils/odataKey';
import { isOk } from './httpError';

export interface Tm1CubeSummary {
  Name: string;
  Dimensions?: Array<{ Name: string }>;
}

export interface ListCubeOptions {
  select?: string;
  top?: number;
  expand?: string;
  /** Raw `$filter` expression — the caller is responsible for escaping it. */
  filter?: string;
}

function buildQuery(opts: ListCubeOptions = {}): string {
  const parts: string[] = [];
  if (opts.select) { parts.push(`$select=${opts.select}`); }
  if (opts.top != null) { parts.push(`$top=${opts.top}`); }
  if (opts.expand) { parts.push(`$expand=${opts.expand}`); }
  if (opts.filter) { parts.push(`$filter=${encodeURIComponent(opts.filter)}`); }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** TM1 OData key escape: `'` → `''` then percent-encode. */
const enc = (s: string) => encodeODataKey(s);

/** GET /Cubes. */
export async function listCubes(
  cfg: Tm1Config,
  opts: ListCubeOptions = { select: 'Name' },
  timeoutMs?: number,
): Promise<Tm1CubeSummary[]> {
  const res = await apiRequest('GET', `Cubes${buildQuery(opts)}`, undefined, timeoutMs, cfg);
  assertOk(res);
  return parseODataValueBody<Tm1CubeSummary>(res);
}

/** GET /Cubes('<name>')?$select=... — fetch a single cube descriptor. */
export async function getCube(
  cfg: Tm1Config,
  cubeName: string,
  select = 'Name',
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  const url = `Cubes('${enc(cubeName)}')?$select=${select}`;
  const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
  assertOk(res);
  return parseJsonSafe<Record<string, unknown>>(res.body, {});
}

/** GET /Cubes('<name>')/Dimensions?$select=Name — ordered list of dim names. */
export async function getCubeDimensionNames(
  cfg: Tm1Config,
  cubeName: string,
  timeoutMs?: number,
): Promise<string[]> {
  const url = `Cubes('${enc(cubeName)}')/Dimensions?$select=Name`;
  const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
  assertOk(res);
  return parseODataValueBody<{ Name: string }>(res).map((d) => d.Name);
}

/**
 * Dimensions of a cube with the names of their hierarchies, in cube order —
 * one request for the whole cube instead of one per dimension.
 */
export async function getCubeDimensionHierarchies(
  cfg: Tm1Config,
  cubeName: string,
  timeoutMs?: number,
): Promise<Array<{ name: string; hierarchies: string[] }>> {
  const url = `Cubes('${enc(cubeName)}')/Dimensions?$select=Name&$expand=Hierarchies($select=Name)`;
  const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
  assertOk(res);
  return parseODataValueBody<{ Name: string; Hierarchies?: Array<{ Name: string }> }>(res)
    .map((d) => ({ name: d.Name, hierarchies: (d.Hierarchies ?? []).map((h) => h.Name) }));
}

/**
 * GET /Cubes('<name>')/Views or /PrivateViews.
 *
 * Follows `@odata.nextLink`: on a server with a configured Pager a cube with
 * more views than the page size returned only the first page before — silently,
 * with no marker that anything was cut off. `label` is set so every page is
 * `assertOk`-ed (hard mode); without it `fetchAllPages` stops at the first
 * non-2xx and returns the partial result, which is exactly the failure mode
 * this call has to surface rather than hide.
 */
export async function getCubeViewNames(
  cfg: Tm1Config,
  cubeName: string,
  isPrivate = false,
  timeoutMs?: number,
): Promise<string[]> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const url = `Cubes('${enc(cubeName)}')/${collection}?$select=Name`;
  const rows = await fetchAllPages<{ Name: string }>(url, cfg, { label: collection, timeoutMs });
  return rows.map((v) => v.Name);
}

export interface CubeViewInfo { name: string; isPrivate: boolean; isMdx: boolean; }

/** OData v4 derived-entity type of an MDX (vs native) cube view. The single
 *  reliable native/MDX discriminator — see getCubeViews / _fetchViewAxisConfig. */
export const MDXVIEW_ODATA_TYPE = '#ibm.tm1.api.v1.MDXView';

/**
 * GET /Cubes('<name>')/Views or /PrivateViews with type detection.
 * OData v4 emits `@odata.type` on derived entities (MDXView); if it is
 * missing (an older/stricter server), native is assumed — no regression.
 *
 * Paging/`label` as with `getCubeViewNames` above.
 */
export async function getCubeViews(
  cfg: Tm1Config,
  cubeName: string,
  isPrivate = false,
  timeoutMs?: number,
): Promise<CubeViewInfo[]> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const url = `Cubes('${enc(cubeName)}')/${collection}?$select=Name`;
  const rows = await fetchAllPages<{ Name: string; '@odata.type'?: string }>(
    url, cfg, { label: collection, timeoutMs },
  );
  return rows.map((v) => ({
    name: v.Name,
    isPrivate,
    isMdx: v['@odata.type'] === MDXVIEW_ODATA_TYPE,
  }));
}

/** GET /Cubes('<name>')/Rules — returns rules text (empty string on 204). */
export async function getCubeRules(
  cfg: Tm1Config,
  cubeName: string,
  timeoutMs?: number,
): Promise<string> {
  const res = await apiRequest('GET', `Cubes('${enc(cubeName)}')/Rules`, undefined, timeoutMs, cfg);
  if (res.statusCode === 204) { return ''; }
  assertOk(res);
  // STRICT parse: a malformed 200-body (truncated/HTML from an overloaded
  // server) must NOT silently degrade to '' — that is indistinguishable from
  // "cube has no rules" and, if the user saves the blank editor, PATCH would
  // wipe the cube's real rules. Throw instead → fetchRules rethrows → editor
  // surfaces the error. Valid empty-rules responses come back as 204 (above).
  const parsed = parseBody<{ value?: string }>(res);
  return typeof parsed.value === 'string' ? parsed.value : '';
}

/**
 * Does the cube have rules? `$filter=Rules ne null` answers with the name or
 * `[]`, instead of shipping the whole rules text just to test it for blank.
 *
 * Measured 2026-10-29 on 11.8 and on v12 (throwaway cube): the cube with rules
 * comes back, one without — or with rules saved as '' — returns `[]`.
 * `Name eq` compares case-sensitively on both, so pass the server's name.
 */
export async function cubeHasRules(cfg: Tm1Config, cubeName: string): Promise<boolean> {
  const hits = await listCubes(cfg, {
    select: 'Name', filter: `Name eq '${escapeODataKey(cubeName)}' and Rules ne null`,
  });
  return hits.length > 0;
}

/** PATCH /Cubes('<name>') with `{Rules: <text>}`. */
export async function updateCubeRules(
  cfg: Tm1Config,
  cubeName: string,
  rules: string,
  errorMsg = 'Rules could not be saved',
): Promise<void> {
  const body = JSON.stringify({ Rules: rules });
  // No request timeout (0 disables it): compiling/saving rules on large cubes
  // can take well beyond the default 30s, and a timeout here aborts a valid save.
  const res = await apiRequest('PATCH', `Cubes('${enc(cubeName)}')`, body, 0, cfg);
  assertOk(res, errorMsg);
}

/** POST /Cubes — create a cube. Body must be the full payload. */
export async function createCube(
  cfg: Tm1Config,
  body: string | Record<string, any>,
  errorMsg = 'Cube could not be created',
): Promise<void> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest('POST', 'Cubes', payload, undefined, cfg);
  assertOk(res, errorMsg);
}

/** Concrete view type TM1 reports; `'other'` = unrecognised/absent `@odata.type`. */
export type ViewKind = 'native' | 'mdx' | 'other';

/**
 * Which view type an existing view has — `null` when it does not exist. Costs
 * the same single GET as `viewExists`.
 *
 * Callers need this because `updateView` (PATCH) CANNOT change a view's type:
 * live 11.8 answers a type-mismatched PATCH with HTTP 200 and silently keeps the
 * old type — a NativeView PATCHed with `{MDX}` even ends up carrying both. Only
 * a same-type overwrite may take the atomic PATCH path; anything else must fall
 * back to DELETE+POST. `'other'` routes to that safe fallback as well.
 */
export async function probeViewKind(
  cfg: Tm1Config,
  cubeName: string,
  viewName: string,
  isPrivate = false,
  timeoutMs?: number,
): Promise<ViewKind | null> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const url = `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')?$select=Name`;
  const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
  if (!isOk(res)) { return null; }
  const parsed = parseJsonSafe<{ '@odata.type'?: string }>(res.body, {}) ?? {};
  const t = parsed['@odata.type'] ?? '';
  if (/NativeView$/.test(t)) { return 'native'; }
  if (/MDXView$/.test(t)) { return 'mdx'; }
  return 'other';
}

/**
 * PATCH /Cubes('<cube>')/Views('<view>') or PrivateViews — atomic overwrite of
 * an existing view of the SAME type (see `probeViewKind`).
 *
 * Semantics verified live against TM1 11.8.02900.8:
 * - top-level properties NOT named in the body stay untouched,
 * - `Rows`/`Columns`/`Titles` given in the body REPLACE the stored axes — they do
 *   not append the way `Subsets/Elements` and `Chores/Tasks` do,
 * - an axis entry is replaced as a whole: a `Subset.Alias` that is not re-sent is
 *   dropped, so callers must always emit the complete axis,
 * - `Name` in the body is ignored (no rename trap, unlike `Processes`),
 * - registered `Subset@odata.bind` axes survive unchanged,
 * - PrivateViews behave identically.
 *
 * `If-Match: *` is added centrally by `transport/http.ts` for every PATCH.
 */
export async function updateView(
  cfg: Tm1Config,
  cubeName: string,
  viewName: string,
  body: Record<string, any> | string,
  isPrivate = false,
  timeoutMs?: number,
  errorMsg = 'View could not be updated',
): Promise<void> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const url = `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')`;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest('PATCH', url, payload, timeoutMs, cfg);
  assertOk(res, errorMsg);
}

/**
 * POST /Cubes('<cube>')/Views or PrivateViews.
 *
 * `errorMsg` mirrors `updateView`: this module is vscode-free, so the localized
 * text (including the view name) has to come in from the caller — otherwise the
 * most common case, creating a view, is the one that loses it.
 */
export async function createView(
  cfg: Tm1Config,
  cubeName: string,
  body: Record<string, any> | string,
  isPrivate = false,
  timeoutMs?: number,
  errorMsg = 'View could not be created',
): Promise<void> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const url = `Cubes('${enc(cubeName)}')/${collection}`;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest('POST', url, payload, timeoutMs, cfg);
  assertOk(res, errorMsg);
}

/** DELETE /Cubes('<cube>')/Views('<view>') or PrivateViews. */
export async function deleteView(
  cfg: Tm1Config,
  cubeName: string,
  viewName: string,
  isPrivate = false,
  timeoutMs?: number,
  errorMsg = 'View could not be deleted',
): Promise<void> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const url = `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')`;
  const res = await apiRequest('DELETE', url, undefined, timeoutMs, cfg);
  assertOk(res, errorMsg);
}

/**
 * DELETE /Cubes('<cube>').
 *
 * The argument shape deliberately matches `deleteDimension`/`deleteHierarchy`
 * in `dimensionApi.ts`: the four Explorer CRUD helpers sit side by side in
 * the same command, and a differing order would silently turn an error
 * message into a timeout. No `timeoutMs` here — unlike `deleteView`, which
 * genuinely needs one, no caller has ever set it here; with only a single
 * optional parameter there is nothing to mix up in the first place.
 */
export async function deleteCube(
  cfg: Tm1Config,
  cubeName: string,
  errorMsg?: string,
): Promise<void> {
  const res = await apiRequest('DELETE', `Cubes('${enc(cubeName)}')`, undefined, undefined, cfg);
  assertOk(res, errorMsg);
}

/** Current storage dimension order for a cube — uses the storage-order function endpoint. */
export async function getStorageDimensionOrder(
  cfg: Tm1Config,
  cubeName: string,
  timeoutMs?: number,
): Promise<string[]> {
  const url = `Cubes('${enc(cubeName)}')/tm1.DimensionsStorageOrder()?$select=Name`;
  const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
  assertOk(res);
  return parseODataValueBody<{ Name: string }>(res).map((d) => d.Name);
}

/** Leaf (non-consolidated) element count of a dimension's default hierarchy, or null on error.
 *  Uses inline `$count=true` (JSON `@odata.count`) instead of `/$count`: the latter replies
 *  text/plain and TM1 rejects it under our hard `Accept: application/json` header. */
export async function getDimensionLeafCount(
  cfg: Tm1Config,
  dimName: string,
  timeoutMs?: number,
): Promise<number | null> {
  const d = enc(dimName);
  const url = `Dimensions('${d}')/Hierarchies('${d}')/Elements?$top=0&$count=true&$filter=Type ne 'Consolidated'`;
  try {
    const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
    if (!isOk(res)) {
      return null;
    }
    const n = (JSON.parse(res.body) as { '@odata.count'?: number })['@odata.count'];
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export class ReorderDimensionsError extends Error {
  constructor(
    public status: number,
    public kind: 'versionGate' | 'typeConstraint' | 'generic',
    message: string,
  ) {
    super(message);
    this.name = 'ReorderDimensionsError';
  }
}

function extractODataError(body: string): string {
  try {
    const j = JSON.parse(body) as ODataError;
    const m = odataErrorMessage(j);
    if (m !== undefined) {
      return m;
    }
  } catch {
    /* not JSON */
  }
  return body;
}

/** Apply new storage dimension order. Returns percent memory change. Requires data-admin + TM1 >= 11.4. */
export async function reorderCubeDimensions(
  cfg: Tm1Config,
  cubeName: string,
  order: string[],
): Promise<number> {
  const url = `Cubes('${enc(cubeName)}')/tm1.ReorderDimensions`;
  const res = await apiRequest('POST', url, buildReorderBody(order), 0, cfg);
  if (!isOk(res)) {
    const msg = extractODataError(res.body) || `HTTP ${res.statusCode}`;
    throw new ReorderDimensionsError(res.statusCode, classifyReorderError(res.statusCode, msg), msg);
  }
  const parsed = JSON.parse(res.body) as { value: number };
  return parsed.value;
}

/** Raw cube descriptor with dimensions in storage order (Object Overview page). */
export interface RawCube {
  Name: string;
  Dimensions?: { Name: string }[];
}

/** GET /Cubes?$expand=Dimensions($select=Name) — all cubes with their dimensions, one call. */
export async function listCubesOverview(cfg: Tm1Config): Promise<RawCube[]> {
  const url = 'Cubes?$expand=Dimensions($select=Name)';
  const res = await apiRequest('GET', url, undefined, undefined, cfg);
  assertOk(res);
  const parsed = parseBody<{ value: RawCube[] }>(res);
  return parsed.value ?? [];
}

/** GET /Cubes('<name>')/Rules — rules text for the Object Overview page (empty string on 204 / no rules). */
export async function fetchCubeRules(cfg: Tm1Config, name: string): Promise<string> {
  const url = `Cubes('${enc(name)}')/Rules`;
  const res = await apiRequest('GET', url, undefined, undefined, cfg);
  if (res.statusCode === 204) { return ''; }
  assertOk(res);
  const parsed = parseBody<{ value?: string }>(res);
  return typeof parsed.value === 'string' ? parsed.value : '';
}

/** GET /Cubes?$select=Name,Rules — rules text per cube for the whole server in one call ('' = no rules). */
export async function fetchAllCubeRules(cfg: Tm1Config): Promise<Map<string, string>> {
  const cubes = await listCubes(cfg, { select: 'Name,Rules' }) as Array<Tm1CubeSummary & { Rules?: string | null }>;
  return new Map(cubes.map(c => [c.Name, typeof c.Rules === 'string' ? c.Rules : '']));
}

/** GET /Cubes?$select=Name&$expand=Views($select=Name) — view count per cube for the whole server in one call. */
export async function fetchAllCubeViewCounts(cfg: Tm1Config): Promise<Map<string, number>> {
  const cubes = await listCubes(cfg, { select: 'Name', expand: 'Views($select=Name)' }) as Array<Tm1CubeSummary & { Views?: unknown[] }>;
  return new Map(cubes.map(c => [c.Name, c.Views?.length ?? 0]));
}

/** GET /Cubes('<name>')?$select=Name — true on 2xx, false on 404. */
export async function cubeExists(cfg: Tm1Config, cubeName: string): Promise<boolean> {
  const res = await apiRequest('GET', `Cubes('${enc(cubeName)}')?$select=Name`, undefined, undefined, cfg);
  return isOk(res);
}

import * as vscode from 'vscode';
import { apiRequest, assertOk } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getCubeViews, getCubeDimensionNames, MDXVIEW_ODATA_TYPE } from '../../tm1Rest/cubeApi';
import { listElementNames, listEdges } from '../../tm1Rest/dimensionApi';
import { parseBodySafe, errorBodyDetail } from '../../tm1Rest/parseRest';
import { withSandbox } from '../../tm1Rest/sandboxTracker';
import { enc } from './state';
import { detectNonEmptyAxes } from '../../mdx/nonEmptyAxisPure';
import { detectDimensionProperties } from '../../mdx/dimensionPropertiesPure';
import { hierKey, hierODataPath, memberMdxRef, splitHierKey } from '../../utils/hierKeyPure';
import { logBestEffort } from '../../providers/bestEffortLog';
import { isOk, Tm1HttpError } from '../../tm1Rest/httpError';
import { METADATA_CAP_MS } from '../../tm1Rest/timeouts';

/** A view axis/title `Hierarchy` expanded with its `Dimension`. */
type HierRef = { Name?: string; Dimension?: { Name?: string } };

/** Viewer key of a view's hierarchy: a default hierarchy not named like its
 *  dimension must become `dim:hier`, the bare hierarchy name is no dimension. */
function viewerKey(h: HierRef | undefined): string | undefined {
  if (!h?.Name) { return undefined; }
  return hierKey(h.Dimension?.Name ?? h.Name, h.Name);
}

/**
 * Resolve a subtree of one or more elements server-side via a single recursive
 * MDX drilldown — used by the cube-viewer drill actions so they show the complete
 * hierarchy under a node even when the current (paged) matrix only holds the
 * collapsed parent. `dimName` is a viewer key (`dim` or `dim:hier`, hierKeyPure).
 *
 * mode 'all'        → the elements + every descendant (consolidations AND leaves)
 * mode 'leaves'     → only the level-0 (N) descendants  [= "All N descendants"]
 * mode 'elemLeaves' → the elements themselves + their level-0 descendants
 */
export async function _fetchSubtreeMemberNames(
  dimName: string, elements: string[], config: Tm1Config,
  mode: 'all' | 'leaves' | 'elemLeaves' = 'all',
): Promise<string[]> {
  if (elements.length === 0) { return []; }
  const set = elements.map((e) => memberMdxRef(dimName, e)).join(',');
  const drill = `TM1DRILLDOWNMEMBER({${set}},ALL,RECURSIVE)`;
  // leaves / elemLeaves keep only level-0 (leaf) members of the subtree.
  const expr = mode === 'all' ? drill : `TM1FILTERBYLEVEL(${drill},0)`;
  const res = await apiRequest(
    'POST',
    'ExecuteMDXSetExpression?$expand=Tuples($expand=Members($select=Name))',
    JSON.stringify({ MDX: `{${expr}}` }),
    undefined,
    config,
  );
  assertOk(res, vscode.l10n.t('Load subtree'));
  const json = parseBodySafe<{ Tuples?: Array<{ Members?: Array<{ Name?: string }> }> }>(res, {});
  const seen = new Set<string>();
  const names: string[] = [];
  // 'all' and 'elemLeaves' include the seed elements themselves; 'leaves' does not.
  if (mode === 'all' || mode === 'elemLeaves') {
    for (const e of elements) { if (!seen.has(e)) { seen.add(e); names.push(e); } }
  }
  for (const t of json.Tuples ?? []) {
    const nm = t.Members && t.Members[0] && t.Members[0].Name;
    if (nm && !seen.has(nm)) { seen.add(nm); names.push(nm); }
  }
  return names;
}

export async function _fetchAllViews(
  cubeName: string, config: Tm1Config,
): Promise<{ name: string; isPrivate: boolean; isMdx: boolean }[]> {
  // `getCubeViews` instead of `getCubeViewNames` (click test 2026-08-12): the
  // dropdown is supposed to mark MDX views as such, and the distinction is
  // FREE — `@odata.type` is already in the default response for derived
  // entities. Measured live against `Cube A`: the same query, the same
  // 11,350 bytes for 82 views, of which 38 native and 44 MDX. A
  // `$filter=isof(...)` would have been the obvious way to go, but the server
  // rejects it (400, code 278).
  //
  // Public views are the primary list. If THAT call fails (server down, auth,
  // missing cube), surface the error — silently returning [] (the old
  // blanket `.catch(() => [])`) makes a dead connection look identical to a
  // cube that genuinely has no views (F3). Private-views failures stay
  // tolerated: some servers/users have none or forbid the collection.
  const [pubRes, privRes] = await Promise.allSettled([
    getCubeViews(config, cubeName, false, 15000),
    getCubeViews(config, cubeName, true, 15000),
  ]);
  if (pubRes.status === 'rejected') {
    throw pubRes.reason instanceof Error ? pubRes.reason : new Error(String(pubRes.reason));
  }
  const privViews = privRes.status === 'fulfilled' ? privRes.value : [];
  const pub = pubRes.value
    .filter(v => !v.name.startsWith('}TmpView_VSCode_'))
    .map(v => ({ name: v.name, isPrivate: false, isMdx: v.isMdx }));
  const priv = privViews.map(v => ({ name: v.name, isPrivate: true, isMdx: v.isMdx }));
  return [...pub, ...priv];
}

export async function _fetchCubeDimensions(cubeName: string, config: Tm1Config): Promise<string[]> {
  return getCubeDimensionNames(config, cubeName, 15000);
}

export interface CubeHierarchies {
  /** Hierarchy names, only for dimensions with more than one (the chip shows a picker then). */
  hierarchies: Record<string, string[]>;
  /** Default hierarchy, only where it is NOT named like its dimension. TM1 lets
   *  the same-named hierarchy be deleted and then promotes another one
   *  (measured 11.8, 2026-09-28: dimension `a` → default `b`). */
  defaults: Record<string, string>;
}

/** Best effort: a failure means "no picker, same-named defaults", never a failed open. */
export async function _fetchCubeHierarchies(cubeName: string, config: Tm1Config): Promise<CubeHierarchies> {
  const out: CubeHierarchies = { hierarchies: {}, defaults: {} };
  try {
    const res = await apiRequest(
      'GET', `Cubes('${enc(cubeName)}')/Dimensions?$select=Name&$expand=Hierarchies($select=Name),DefaultHierarchy($select=Name)`,
      undefined, 15000, config, withSandbox(config),
    );
    if (!isOk(res)) {
      // Logged: the fallback `[dim].[dim]` later fails as an opaque MDX error
      // on a dimension whose default hierarchy has another name (review
      // 2026-10-03, A11).
      logBestEffort('cubeViewer', `hierarchies of "${cubeName}"`, `HTTP ${res.statusCode}: ${errorBodyDetail(res.body)}`);
      return out;
    }
    type Row = { Name: string; Hierarchies?: Array<{ Name: string }>; DefaultHierarchy?: { Name?: string } };
    for (const d of parseBodySafe<{ value?: Row[] }>(res, {}).value ?? []) {
      const names = (d.Hierarchies ?? []).map((h) => h.Name);
      if (names.length > 1) { out.hierarchies[d.Name] = names; }
      const def = d.DefaultHierarchy?.Name;
      if (def && def !== d.Name) { out.defaults[d.Name] = def; }
    }
  } catch (err) { logBestEffort('cubeViewer', `hierarchies of "${cubeName}"`, err); }
  return out;
}

export async function _fetchDimElements(dimName: string, config: Tm1Config): Promise<string[]> {
  const { dim, hier } = splitHierKey(dimName);
  return listElementNames(config, dim, hier, { top: 500, timeoutMs: 15000 });
}

export async function _fetchDimElementsTree(
  dimName: string, config: Tm1Config,
): Promise<{ name: string; depth: number }[]> {
  const { dim, hier } = splitHierKey(dimName);
  const [allNames, edgeRows] = await Promise.all([
    listElementNames(config, dim, hier, { timeoutMs: 15000 }),
    listEdges(config, dim, hier, 15000),
  ]);
  if (allNames.length === 0) { return []; }
  const edges: { p: string; c: string }[] = edgeRows.map(x => ({ p: x.ParentName, c: x.ComponentName }));

  const childrenOf: Record<string, string[]> = {};
  const parentOf: Record<string, string> = {};
  const isChild: Record<string, boolean> = {};
  for (const e of edges) {
    (childrenOf[e.p] ??= []).push(e.c);
    if (!parentOf[e.c]) { parentOf[e.c] = e.p; }
    isChild[e.c] = true;
  }

  const known = new Set(allNames);
  const out: { name: string; depth: number }[] = [];
  const visited = new Set<string>();
  const dfs = (name: string, depth: number) => {
    if (visited.has(name) || !known.has(name)) { return; }
    visited.add(name);
    out.push({ name, depth });
    const kids = childrenOf[name];
    if (kids) { for (const k of kids) { dfs(k, depth + 1); } }
  };
  for (const n of allNames) { if (!isChild[n]) { dfs(n, 0); } }
  // Orphans (cycles / detached)
  for (const n of allNames) { if (!visited.has(n)) { out.push({ name: n, depth: 0 }); visited.add(n); } }
  return out;
}

/** A restored context-dim restriction read back from a saved native view: the
 *  curated element list plus the active (selected) member. Host-side twin of the
 *  webview's protocol.TitleSubset. */
export interface TitleSubset { names: string[]; selected: string }

/** Cap on how many elements a title subset may have to still be restored as a
 *  dropdown restriction. Beyond this it's treated as a large pre-existing subset
 *  (not a user curation): skip it to avoid a slow full-element fetch and to keep
 *  the dropdown from locking to a huge set. */
const TITLE_SUBSET_MAX = 200;

/**
 * Axis/suppression/alias configuration of a saved view, as far as it can be read
 * from the view definition itself.
 *
 * `dimAliases` (dim → alias attribute) is filled ONLY for an MDX view, whose
 * display alias lives in the `DIMENSION PROPERTIES` clause of the MDX text —
 * an MDX view has no axis subsets to carry `Subset.Alias`. A native view's
 * alias comes from `alias.ts#fetchViewDimAliases`, which the callers fetch in
 * parallel; duplicating that here would double the roundtrip for no gain.
 */
export interface ViewAxisConfig {
  rowDim?: string;
  colDim?: string;
  suppressRows?: boolean;
  suppressCols?: boolean;
  isMdx: boolean;
  mdx?: string;
  titleSubsets?: Record<string, TitleSubset>;
  /** dim → alias attribute; always `{}` for a native view. */
  dimAliases: Record<string, string>;
}

export async function _fetchViewAxisConfig(
  cubeName: string, viewName: string, isPrivate: boolean, config: Tm1Config,
): Promise<ViewAxisConfig | null> {
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  // Classify strictly by @odata.type — the ONLY reliable signal. A combined
  // Rows/Columns $expand 400s on many native views (server quirk), and even a
  // $select=MDX probe is ambiguous, so neither may be used to infer MDX-ness:
  // the old probe-400→MDX heuristic mislabelled EVERY native view as MDX, so a
  // native-view Save wrongly took the MDX path ("MDX empty"). Matches the tree's
  // getCubeViews() classifier.
  const meta = await apiRequest(
    'GET',
    `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')?$select=Name`,
    undefined, 15000, config, withSandbox(config),
  );
  if (!meta || !isOk(meta)) { return null; }
  const isMdxView = parseBodySafe<{ '@odata.type'?: string }>(meta, {})['@odata.type'] === MDXVIEW_ODATA_TYPE;

  const viewPath = `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')`;
  const sb = withSandbox(config);

  let suppressRows = false;
  let suppressCols = false;
  let mdxText = '';
  let rowDim: string | undefined;
  let colDim: string | undefined;
  let titleSubsets: Record<string, TitleSubset> | undefined;
  let dimAliases: Record<string, string> = {};

  if (isMdxView) {
    const res = await apiRequest('GET', `${viewPath}?$select=MDX`, undefined, METADATA_CAP_MS, config, sb);
    // An MDXView with no readable MDX is unusable: bail with null (caller opens
    // by name — the pre-existing behavior) instead of returning a half-config
    // (isMdx:true, mdx:undefined) that blanks the grid AND blocks Save on a
    // transient MDX-fetch failure.
    if (!res || !isOk(res)) { return null; }
    const mv = parseBodySafe<{ MDX?: string }>(res, {});
    mdxText = typeof mv.MDX === 'string' ? mv.MDX : '';
    // Per-axis NON EMPTY → suppress flag (bracket-/string-aware shared parser).
    const det = detectNonEmptyAxes(mdxText);
    suppressRows = det.rows;
    suppressCols = det.cols;
    // The display alias of an MDX view survives a save/reopen only inside the
    // MDX text (`DIMENSION PROPERTIES`) — read it back into the same channel
    // the native path uses. Unparsable/empty MDX yields `{}`, never a throw.
    dimAliases = mdxText.length > 0 ? detectDimensionProperties(mdxText) : {};
  } else {
    interface TitleRow {
      Subset?: { Hierarchy?: HierRef; Elements?: Array<{ Name?: string }> };
      Selected?: { Name?: string };
    }
    // Native view: these three reads are independent → run in parallel.
    //  • Suppress flags standalone.
    //  • Row/Col dims: `Rows`/`Columns` are COMPLEX types, so the option form
    //    `Rows($expand=…)` is rejected with HTTP 400 ("Expecting '/' after
    //    property of complex type in expand path") — it must be the path form
    //    `Rows/Subset(…)`, and the hierarchy sits under `Subset`. This call used
    //    to 400 on every open, leaving both dims undefined and falling through
    //    to the cellset as the axis source. Still best-effort, but it answers now.
    //  • Titles carries curated context-dim restrictions (>1 element) for the
    //    reopened dropdown. Nested $expand on the main GET is rejected by strict
    //    servers → use the Titles collection call. A single-element subset is a
    //    normal unrestricted slice (every saved view has one) — skip it, else
    //    every dropdown would lock to a single member.
    const [sres, ax, tr] = await Promise.all([
      apiRequest('GET', `${viewPath}?$select=SuppressEmptyRows,SuppressEmptyColumns`, undefined, METADATA_CAP_MS, config, sb),
      apiRequest('GET', `${viewPath}?$expand=Rows/Subset($expand=Hierarchy($select=Name;$expand=Dimension($select=Name))),Columns/Subset($expand=Hierarchy($select=Name;$expand=Dimension($select=Name)))`, undefined, 15000, config, sb),
      apiRequest('GET', `${viewPath}/Titles?$expand=Subset($expand=Hierarchy($select=Name;$expand=Dimension($select=Name)),Elements($select=Name;$top=${TITLE_SUBSET_MAX + 1})),Selected($select=Name)`, undefined, 15000, config, sb),
    ]);
    const sv = parseBodySafe<{ SuppressEmptyRows?: boolean; SuppressEmptyColumns?: boolean }>(sres, {});
    suppressRows = !!sv.SuppressEmptyRows;
    suppressCols = !!sv.SuppressEmptyColumns;
    if (ax && isOk(ax)) {
      type AxisEntry = { Subset?: { Hierarchy?: HierRef } };
      const av = parseBodySafe<{ Rows?: AxisEntry[]; Columns?: AxisEntry[] }>(ax, {});
      rowDim = viewerKey(av.Rows?.[0]?.Subset?.Hierarchy);
      colDim = viewerKey(av.Columns?.[0]?.Subset?.Hierarchy);
    }
    if (tr && isOk(tr)) {
      const rows = parseBodySafe<{ value?: TitleRow[] }>(tr, {}).value ?? [];
      for (const t of rows) {
        const dim = viewerKey(t.Subset?.Hierarchy);
        const names = (t.Subset?.Elements ?? []).map((e) => e.Name).filter((n): n is string => !!n);
        // >1 = a genuine restriction; ≤MAX = not a huge pre-existing subset the
        // $top capped (those we deliberately don't restore — see TITLE_SUBSET_MAX).
        if (dim && names.length > 1 && names.length <= TITLE_SUBSET_MAX) {
          titleSubsets ??= {};
          titleSubsets[dim] = { names, selected: t.Selected?.Name ?? names[0] };
        }
      }
    }
  }
  return {
    rowDim,
    colDim,
    suppressRows,
    suppressCols,
    isMdx: isMdxView,
    mdx: isMdxView && mdxText.length > 0 ? mdxText : undefined,
    titleSubsets,
    dimAliases,
  };
}

/**
 * How one axis subset of a saved view is reproduced in a temp/persisted
 * NativeView. `namedSubset` / `expression` travel by REFERENCE (no element
 * expansion) — that is what keeps a 300k-member axis intact; `elements` is the
 * last-resort copy for anonymous, non-MDX subsets whose members only exist
 * inside the view.
 *
 * `namedSubset.isPrivate` says WHICH subset collection the name resolves in.
 * A public view can only reference `Subsets`; a private view may reference
 * either, and the axis payload does not say which — binding the wrong one
 * either 404s or (worse) silently binds a same-named PUBLIC subset and shows
 * different rows. `_fetchViewAxisSubsets` resolves this before emitting a ref
 * and never emits a private ref for a public target.
 */
export type ViewAxisSubsetRef =
  | { kind: 'namedSubset'; name: string; isPrivate: boolean }
  | { kind: 'expression'; expression: string }
  | { kind: 'elements'; names: string[] };

export interface ViewAxisSubsets {
  /** dim (= hierarchy name) → how to reproduce that axis. */
  subsets: Record<string, ViewAxisSubsetRef>;
  /**
   * Dims whose axis subset could be reproduced NEITHER by reference NOR by a
   * bounded element copy (anonymous + expression-less + > VIEW_AXIS_ELEMENTS_MAX
   * members). They carry no entry in `subsets`; the caller keeps its own
   * (truncated) baseline for them and MUST tell the user.
   */
  oversized: string[];
}

/**
 * Cap on how many members an anonymous, expression-less view axis subset may
 * hold and still be re-materialised element-by-element.
 *
 * That path is the expensive one: every member becomes one `Elements@odata.bind`
 * URL in the `createView` POST. Uncapped, a 295k-member axis is a ~10 MB GET
 * plus a ~25 MB POST — realistically a timeout on one side or the other. The cap
 * is the same order as `CELL_PAGE_ROWS` (the client baseline already ships that
 * many names today), so nothing that used to work becomes "too large".
 *
 * There is no server-side view-copy action in the TM1 11.x REST surface
 * (`Views` has no `tm1.Duplicate`/clone, and an anonymous subset cannot be
 * addressed by MDX or `@odata.bind`), so an axis beyond the cap cannot be
 * reproduced at all — it is reported via `oversized` instead of silently
 * degrading.
 */
export const VIEW_AXIS_ELEMENTS_MAX = 10000;

/**
 * Decide which subset collection a saved view's REGISTERED subset lives in.
 * A public view can only reference a public subset → no probe needed. A private
 * view may reference either; probe both collections. When both hold a subset of
 * that name the tie goes to the private one: a private view most commonly uses
 * its owner's own subset, and guessing "public" is the failure mode that shows
 * the wrong rows without any error.
 */
async function _resolveSubsetVisibility(
  dim: string, name: string, viewIsPrivate: boolean, config: Tm1Config,
): Promise<'public' | 'private' | 'unknown'> {
  if (!viewIsPrivate) { return 'public'; }
  // `dim` is a viewer key (`dim` or `dim:hier`). `tm1Rest/subsetApi#subsetExists`
  // does the same probe but over a different transport import — stay on this
  // module's `apiRequest`.
  const probe = async (collection: string): Promise<boolean> => {
    try {
      const res = await apiRequest(
        'GET',
        `${hierODataPath(dim)}/${collection}('${enc(name)}')?$select=Name`,
        undefined, 15000, config, withSandbox(config),
      );
      return !!res && isOk(res);
    } catch { return false; }
  };
  const [priv, pub] = await Promise.all([probe('PrivateSubsets'), probe('Subsets')]);
  if (priv) { return 'private'; }
  if (pub) { return 'public'; }
  return 'unknown';
}

/**
 * Read a saved native view's OWN row/column subsets, keyed by dimension
 * (= hierarchy name, cube-viewer convention).
 *
 * Needed whenever a saved view has to be re-materialised as a NativeView
 * (context/title override refresh, or Save-view on top of it): the webview can
 * only report the elements of the tuples it has LOADED (one cell page =
 * CELL_PAGE_ROWS), so deriving the axes from `msg.dimSubsets` silently truncates
 * a large view. The server still knows the full subset — take it from there.
 *
 * Two passes so the common case stays cheap: pass 1 asks only for
 * Name+Expression (named subsets and MDX subsets are then bound/copied by
 * reference); pass 2 expands `Elements` — capped at `VIEW_AXIS_ELEMENTS_MAX` —
 * for an axis ONLY if it holds a subset that cannot be referenced.
 * `$expand=Rows,Columns` in one call 400s on TM1 → separate calls.
 *
 * `opts.targetIsPrivate` = visibility of the view being BUILT. A private-origin
 * subset can only be bound from a private target; for a public target (the temp
 * view is always public) it degrades to the capped element copy.
 *
 * Returns `null` when the view's axes can't be read (caller falls back + warns).
 */
export async function _fetchViewAxisSubsets(
  cubeName: string, viewName: string, isPrivate: boolean, config: Tm1Config,
  opts: { targetIsPrivate?: boolean } = {},
): Promise<ViewAxisSubsets | null> {
  interface AxisRow {
    Hierarchy?: HierRef;
    Subset?: { Name?: string; Expression?: string; Elements?: Array<{ Name?: string }> };
  }
  const targetIsPrivate = !!opts.targetIsPrivate;
  const collection = isPrivate ? 'PrivateViews' : 'Views';
  const viewPath = `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')`;
  const sb = withSandbox(config);
  const axes = ['Rows', 'Columns'] as const;

  const readAxis = async (axis: string, withElements: boolean): Promise<AxisRow[] | null> => {
    // $top bounds the expensive pass — see VIEW_AXIS_ELEMENTS_MAX. MAX+1 rows so
    // an over-cap axis is detectable instead of being silently trimmed.
    const sub = withElements
      ? `Subset($select=Name,Expression;$expand=Elements($select=Name;$top=${VIEW_AXIS_ELEMENTS_MAX + 1}))`
      : 'Subset($select=Name,Expression)';
    const res = await apiRequest(
      'GET', `${viewPath}/${axis}?$expand=Hierarchy($select=Name;$expand=Dimension($select=Name)),${sub}`,
      undefined, 30000, config, sb,
    );
    if (!res || !isOk(res)) { return null; }
    return parseBodySafe<{ value?: AxisRow[] }>(res, {}).value ?? null;
  };

  const axisRows = await Promise.all(axes.map((a) => readAxis(a, false)));
  if (axisRows.some((r) => r === null)) { return null; }

  // Phase 1: classify every axis entry. Named subsets need a visibility probe
  // (private views only) before we know whether they are bindable at all.
  interface Decision { dim: string; ref?: ViewAxisSubsetRef; needsElements: boolean }
  const decisions: Decision[][] = await Promise.all(
    axes.map(async (_a, i) => Promise.all(
      (axisRows[i] ?? [])
        .filter((e) => !!e.Hierarchy?.Name)
        .map(async (e): Promise<Decision> => {
          const dim = viewerKey(e.Hierarchy) as string;
          const sub = e.Subset;
          if (sub?.Name) {
            const vis = await _resolveSubsetVisibility(dim, sub.Name, isPrivate, config);
            if (vis === 'public') {
              return { dim, ref: { kind: 'namedSubset', name: sub.Name, isPrivate: false }, needsElements: false };
            }
            if (vis === 'private' && targetIsPrivate) {
              return { dim, ref: { kind: 'namedSubset', name: sub.Name, isPrivate: true }, needsElements: false };
            }
            // Private subset, public target (or name resolves nowhere): the
            // reference form is unusable → copy the members instead.
            return { dim, needsElements: true };
          }
          if (sub?.Expression) {
            return { dim, ref: { kind: 'expression', expression: sub.Expression }, needsElements: false };
          }
          return { dim, needsElements: true };
        }),
    )),
  );

  const out: Record<string, ViewAxisSubsetRef> = {};
  const oversized: string[] = [];
  for (let i = 0; i < axes.length; i++) {
    const axisDecisions = decisions[i];
    for (const d of axisDecisions) { if (d.ref) { out[d.dim] = d.ref; } }
    const pending = new Set(axisDecisions.filter((d) => d.needsElements).map((d) => d.dim));
    if (pending.size === 0) { continue; }
    // Re-read this axis WITH the (capped) elements expanded — the expensive path.
    const resolved = await readAxis(axes[i], true);
    if (!resolved) { oversized.push(...pending); continue; }
    for (const e of resolved) {
      const dim = viewerKey(e.Hierarchy);
      if (!dim || !pending.has(dim)) { continue; }
      const els = e.Subset?.Elements ?? [];
      const names = els.map((el) => el.Name).filter((n): n is string => !!n);
      if (names.length > VIEW_AXIS_ELEMENTS_MAX) { oversized.push(dim); continue; }
      if (names.length > 0) { out[dim] = { kind: 'elements', names }; }
    }
    // An axis entry that came back without any elements at all cannot be
    // reproduced either — report it rather than leaving the caller guessing.
    for (const dim of pending) { if (!out[dim] && !oversized.includes(dim)) { oversized.push(dim); } }
  }
  return { subsets: out, oversized };
}

export async function _fetchDimLevels(dimName: string, config: Tm1Config): Promise<Map<string, number>> {
  const res = await apiRequest(
    'GET', `${hierODataPath(dimName)}/Elements?$select=Name,Level`,
    undefined, 15000, config, withSandbox(config),
  );
  // Throw, not an empty map: `getDimStructure` would cache the empty result
  // under the valid ETag and the dimension would stay flat until it changes.
  if (!isOk(res)) { throw new Tm1HttpError(`levels of ${dimName}: HTTP ${res.statusCode}`, res.statusCode); }
  const rows = parseBodySafe<{ value?: Array<{ Name: string; Level?: number }> }>(res, {}).value ?? [];
  const result = new Map<string, number>();
  for (const e of rows) {
    result.set(e.Name, e.Level ?? 0);
  }
  return result;
}

export interface DimParentMaps {
  first: Record<string, string>;
  all: Record<string, string[]>;
}

export async function _fetchDimParents(dimName: string, config: Tm1Config): Promise<DimParentMaps> {
  const res = await apiRequest(
    'GET', `${hierODataPath(dimName)}/Edges?$select=ParentName,ComponentName`,
    undefined, 15000, config, withSandbox(config),
  );
  if (!isOk(res)) { throw new Tm1HttpError(`edges of ${dimName}: HTTP ${res.statusCode}`, res.statusCode); }
  const rows = parseBodySafe<{ value?: Array<{ ParentName: string; ComponentName: string }> }>(res, {}).value ?? [];
  // Null prototype: element names like "constructor" or "__proto__" are keys here.
  const first = Object.create(null) as Record<string, string>;
  const all = Object.create(null) as Record<string, string[]>;
  const seen = Object.create(null) as Record<string, Set<string>>;
  for (const e of rows) {
    const p = e.ParentName;
    const c = e.ComponentName;
    if (!c || !p) { continue; }
    if (!first[c]) { first[c] = p; }
    const set = seen[c] ?? (seen[c] = new Set());
    if (!set.has(p)) {
      set.add(p);
      (all[c] ?? (all[c] = [])).push(p);
    }
  }
  return { first, all };
}

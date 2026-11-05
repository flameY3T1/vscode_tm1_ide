/**
 * Shared mutable state for the Dimension Browser webview.
 *
 * The webview is a single-instance singleton bundled by esbuild; this object
 * replaces the IIFE-closure-scoped `var _x` declarations in `index.ts` so
 * other sub-modules can read and mutate state via `state._x` references.
 *
 * Extracted from `index.ts` in Hebel 9 (Phase A).
 *
 * ── Three lifetimes, two factories (S2-4, 2026-08-02) ─────────────────────
 *
 * Whether a field may survive a dimension or hierarchy switch used to exist
 * only in comments and in three cleanup funnels. One of them was forgotten
 * three times (K10/K13/K14) — the browser showed the state of the
 * OLD dimension on the NEW one. Now the structure decides:
 *
 *   `makePerListState()`  — belongs to the loaded ELEMENT LIST. Replaced
 *                           completely on every swap of the list
 *                           (`msgElements.ts#adoptElementList`).
 *   `makePerDimState()`   — ⊇ perList, plus what outlives the list but
 *                           not the DIMENSION: subset binding, filter bar.
 *                           Replaced completely on `setHierarchies`.
 *   everything else       — session (panel configuration, DOM binding,
 *                           attached callbacks) or a single gesture
 *                           (dragging, context menu). Lives directly in
 *                           `state` below and survives every switch.
 *
 * A new field thus lands in the right reset automatically, because it is
 * part of the replaced object — forgetting is no longer possible, only
 * the question of which of the three levels it belongs to.
 *
 * Why the factories are laid FLAT over `state` (`Object.assign`) instead of
 * a nested `state.perDim`: the nesting would bring no additional
 * guarantee — the swap is an object swap in both forms —, but would cost
 * 2,398 read sites in 52 files, and the levels are nested in each other
 * (perList ⊂ perDim), which as a field path would read
 * `state.perDim.perList._x`.
 */

export {};

export interface TreeElement {
  Name: string;
  Type?: string;
  Level?: number;
  Attributes?: Array<{ Name: string; Value: unknown }>;
  [extra: string]: unknown;
}

export interface TreeEdge {
  ParentName: string;
  ComponentName: string;
  Weight?: number;
  [extra: string]: unknown;
}

export interface AttrDef {
  Name: string;
  Type?: string;
  [extra: string]: unknown;
}

export interface AllData {
  elements: TreeElement[];
  edges: TreeEdge[];
  attrDefs: AttrDef[];
  [extra: string]: unknown;
}

export interface SubsetSnapshot {
  name?: string;
  isPrivate?: boolean;
  [extra: string]: unknown;
}

/**
 * State that belongs to the LOADED ELEMENT LIST — replaced on EVERY swap
 * of the list: dimension/hierarchy switch, refresh, first page AND the
 * server-side search in page mode.
 *
 * The last case was the fourth instance of the K10/K13/K14 class (S2-15):
 * a server search replaced `_allData` but left the drills, collapse state,
 * pins and the manual order of the old list in place. The drill leftover
 * was the most expensive: its token stood for children that did not occur
 * in the hits at all, and flowed through `expressionForSave` into the saved subset.
 *
 * NOT belonging here is what outlives the list but not the dimension
 * (subset binding, filter bar) — a server search runs WITHIN the
 * dimension, and the filter bar is exactly what triggered it.
 */
export function makePerListState() {
  return {
    _allData: { elements: [], edges: [], attrDefs: [] } as AllData,
    _childrenOf: {} as Record<string, string[]>,
    _parentOf: {} as Record<string, string | undefined>,
    _allParentsOf: {} as Record<string, string[]>,

  };
}

/**
 * State that belongs to the loaded DIMENSION/HIERARCHY — everything from
 * `makePerListState()` plus what outlives a list swap but not a
 * dimension/hierarchy switch.
 *
 * Replaced in `msgSession.ts#setHierarchies`.
 *
 * The difference to the list is exactly the server-side search in page mode:
 * it swaps the rows but stays in the same dimension. The
 * subset filter still applies, and the filter bar is what triggered the
 * search — the handler deliberately does not rebuild its selection fields
 * (`_populateFilterDropdowns` runs only for the first page), so its
 * state must not be cleared either, otherwise it would contradict what is
 * shown in the bar.
 *
 * NOT in here: `_initialSelectionNames`. That is an INPUT for the
 * next element load, written by `setMode` — that is, BEFORE this swap
 * — and only consumed by the load. It therefore lives directly in `state`
 * below and is cleared at the point where it is consumed.
 */
export function makePerDimState() {
  return {
    ...makePerListState(),

    // ── Selection / Mode ────────────────────────────────────
    _currentDim: '' as string,
    _currentHier: '' as string,

    // The subsets of this hierarchy as the host reported them — the same
    // list from which `_populateSubsetSelect` builds the dropdown. It is needed
    // as DATA and not as an option label, because the save dialog
    // has to know whether the typed target name hits a subset that is static
    // on the server (`dynamicSaveDefaultOn`). Until then the `isDynamic` flag
    // hung only on the label and the title of the option.
    _knownSubsets: [] as { name: string; isPrivate: boolean; isDynamic?: boolean }[],
    // Which subset `_subsetExpression` was read from. The save path only writes
    // the expression back onto THIS subset — picking another one in the dropdown
    // and saving must never carry the previous subset's MDX over to it.
    //
    // A dimension reload leaves the loaded subset — and therefore also its
    // MDX binding. If the three expression fields survived it, a later
    // save under the same subset name would have written the old MDX back
    // (`expressionForSave` compares only name + visibility, not dim/hier;
    // addendum to the final review 2026-08-01).
    _subsetExpressionOf: null as { name: string; isPrivate: boolean } | null,
    // The loaded subset's server-side MDX, STICKY across selection edits: it
    // answers "is the subset I am looking at dynamic?", which stays true no
    // matter how the user rearranges the list. Drives the marker bar.
    _subsetSourceExpression: null as string | null,
    /**
     * The expression of the loaded subset could NOT be read (request
     * failed) — not to be confused with "the subset has none". As long as
     * this holds, there is no composition base and the bar says so.
     */
    _subsetExpressionUnread: false,

  };
}

export const state = {
  ...makePerDimState(),

  // ── Handover to the next element load ───────────────────
  // A preset (CubeViewer axis, process editor) arrives with `setMode`,
  // that is BEFORE `setHierarchies`, and is only consumed in the first
  // `setElementPage` branch. It must therefore be taken along by neither the
  // perDim nor the perList swap — it is cleared
  // at the point where it is consumed, so that it does not leak into the next load.
  _initialSelectionNames: null as string[] | null,

  // ── Session: opening configuration (setMode) ────────────
  _mode: 'standalone' as string,
  _multiSelect: false as boolean,
  _allowedTypes: null as string[] | null,
  _pendingInitialSubset: null as SubsetSnapshot | null,
  // May `_collectVisibleSelection` answer with an expression? Belongs to the
  // caller, not to the dimension (see `HostToWebview#setMode.acceptsExpression`).
  _acceptsExpression: false as boolean,
  // Hierarchies the caller already shows elsewhere; `null` = picker locked in
  // selection mode (see `HostToWebview#setMode.hierSwitch`).
  _hierSwitchTaken: null as string[] | null,
  // Diagnostics: what the caller said about the axis. `''` = said nothing.
  // Survives the dimension switch because it describes the OPENING.
  _sourceMdxSeen: '' as string,
  _sourceMdxNote: '' as string,
  // Set expression from `setMode` that becomes the page base on a dimension
  // switch (see `HostToWebview#setMode.initialSourceMdx`). Lives here and not in
  // `makePerDimState`, because `setMode` runs BEFORE `setHierarchies` and the
  // dimension-related state is swapped out completely there — in the perDim block
  // the value would be gone before anyone can redeem it.
  _pendingSourceMdx: null as string | null,

  // ── Session: filter bar that deliberately survives the switch ──
  // The `Alias` the currently loaded subset carries ON THE SERVER — the labels
  // its author saved it to be read under. `_displayAlias` is the live pick and
  // the user may overrule it at any time; this is the memo that survives a
  // re-populated filter bar, since `_populateFilterDropdowns` runs on every
  // dimension/hierarchy load and would otherwise blank the alias for good.
  // Empty = no subset loaded, or one saved without an alias.
  _loadedSubsetAlias: '' as string,

  // ── Session: save handshake across a response ──
  _lastSavedSubset: null as SubsetSnapshot | null,

  // ── Gesture: context menu ───────────────────────────────
  _ctxName: null as string | null,
};

/**
 * True if `type` may be selected, given the active `_allowedTypes` filter
 * (null = no restriction). Pure state query — lives here (the leaf state
 * module) so both render.ts and helpers.ts can use it without pulling render
 * into helpers and forming the helpers→render→subset→helpers cycle (S1).
 */
export function isAllowed(type: string | undefined): boolean {
  if (!state._allowedTypes) { return true; }
  if (type == null) { return false; }
  return state._allowedTypes.indexOf(type) >= 0;
}


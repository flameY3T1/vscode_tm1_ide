/**
 * Cube-Viewer webview state singleton + matrix/cell types.
 *
 * Mirrors the runtime shape that the extension sends via postMessage. The
 * pure-logic modules in `src/cubeViewer/` have their own narrower types;
 * this file is the webview-side authority for the global UI state.
 */

import { dimOfKey } from '../../utils/hierKeyPure';
import type { DisplayFormats } from '../../cubeViewer/displayFormatPure';

// The wire shapes are defined once, in the protocol; see the note there.
import type { CellFlag, MatrixData, DimSelection } from './protocol';
import { nameMap } from '../../utils/nameMapPure';
export type { CellFlag, MatrixData, DimSelection };

export interface CubeViewerState {
  cubeName: string;
  /** All cube dimensions in cube-defined order */
  dimensions: string[];
  /** Hierarchy names per dimension, only dimensions with more than one.
   *  Axis/title entries are keys: `dim` or `dim:hier` (utils/hierKeyPure). */
  hierarchies: Record<string, string[]>;
  /** Default hierarchy where it is not named like its dimension. */
  defaultHiers: Record<string, string>;
  existingViewName: string | null;
  existingViewIsPrivate: boolean;
  /** All server views (public + private) as last delivered by `viewsData`.
   *  Retained so the Save-View modal can default the priv/pub radio to how an
   *  existing view of the typed name was previously saved. */
  knownViews: Array<{ name: string; isPrivate: boolean }>;
  rowDims: string[];
  colDims: string[];
  titleDims: string[];
  /** Title-zone element pick per dim, populated from the live <select> values */
  titleAssignments: Record<string, string>;
  /**
   * The user picked a different context (title) element after a saved view was
   * loaded. Sticky until a view is (re)loaded: a refresh that re-executes the
   * saved view server-side would drop the pick and snap the slicer back to the
   * view's own title members. Travels as `titleOverride` on `refreshData`, which
   * makes the host build a temp NativeView from the current title assignments.
   */
  titleOverride: boolean;
  /** Pre-fetched element lists per dim (tree-ordered: [{name, depth}, ...] or string[]) */
  elementsCache: Record<string, Array<string | { name: string; depth: number }>>;
  dimSelections: Record<string, DimSelection>;
  lastMatrix: MatrixData | null;
  loading: boolean;
  /** `collapsed[dim][elem] = true` ⇒ the consolidation is collapsed in the grid */
  collapsed: Record<string, Record<string, true>>;
  /**
   * Per dimension, the sequence of names from which the LOADED matrix was built.
   *
   * Collapsing only removes rows that are already there — the server has
   * nothing to contribute to that. `dimSelections[dim].names` then shrinks immediately, and
   * the renderer hides whatever this base list still has and the selection
   * no longer does (`removedOccurrences`). Derived rather than carried forward: the
   * only state is "what the matrix holds", and that is set when a
   * matrix arrives.
   */
  axisBaseNames: Record<string, string[]>;
  /**
   * Client-side visible-set filter for one dim. Rows/cols are hidden unless
   * the dim's value is in the `visible` set. Tree-interactions mutate the set
   * additively (toggle = ±immediate children, Parent anzeigen = +ancestor chain,
   * Komplett ausklappen = +all descendants). Cleared via "Filter aufheben".
   * Independent from `dimSelections` (server-side fetch filter).
   */
  localFocus: { dim: string; visible: Set<string> } | null;
  /**
   * Drilldown action queued during a server-side filter promotion. When the
   * user drills on a dim that has dimSelections set, we clear the server
   * filter (reload all elements) and replay this action against the new
   * matrix once it arrives.
   */
  pendingDrillAction: null | {
    dim: string;
    elem: string;
    kind: 'toggle' | 'showParents' | 'showAllParents' | 'expandAll' | 'keepOnly';
    /** Optional multi-element list when the action was triggered with a header
     *  multi-selection. When present, applyPendingDrillAction iterates over
     *  these instead of just `elem`. */
    elems?: string[];
  };
  /**
   * A paused expand/collapse click that is waiting for the host's child list.
   *
   * The child index used to live in the client and was built over the
   * whole dimension on EVERY click; since the parent maps now arrive trimmed,
   * the client could no longer derive it completely. The click is therefore
   * paused, `fetchAxisChildren` is sent and the click is continued in `resume`
   * (`axisChildren` receiver in `messaging.ts`).
   *
   * `resume` is a closure instead of a case distinction in the receiver:
   * when the children are already loaded, the expand case has to fall through to the
   * existing focus/collapse logic — and that lives in the
   * render closure of `grid.ts`, not in the message router.
   *
   * A second click before the reply overwrites the entry; the old
   * reply is recognized by `reqId` and discarded. The last click wins,
   * as it did before.
   */
  pendingChildLookup: null | {
    dim: string;
    elem: string;
    /** Block ordinal of the clicked occurrence (`data-occ`), -1 = unknown. */
    occ: number;
    mode: 'filter' | 'expand';
    reqId: number;
    resume: (children: string[], descendants: string[]) => void;
  };
  /**
   * Paused picklist request for the currently open cell editor
   * (`resolvePicklist` → `picklistValues`). Same pattern as
   * `pendingChildLookup`: the reply is checked against `reqId` AND the cell
   * coordinate of the waiting request before it is applied —
   * the editor may meanwhile have been closed (panel gone, other cell, Escape) or redrawn,
   * and a stale reply must not then land in
   * a foreign or no longer existing cell.
   */
  pendingPicklist: null | { ri: number; ci: number; reqId: number };
  /**
   * Paused SINGLE-CELL request (`fetchCellPicklist` → `cellPicklistDef`),
   * the STAGE BEFORE `pendingPicklist`: first it must be established WHETHER this cell
   * carries a definition, and only then are its values fetched. A slot of its own,
   * because the two stages are only apparently the same thing at the same time — they carry
   * different reply messages, and a shared slot would let the
   * reply of one stage clear the other.
   *
   * `coordinates` travels along, so that the reply lands in the cache under the same
   * coordinate under which it was asked.
   */
  pendingCellPicklist: null | { ri: number; ci: number; reqId: number; coordinates: string[] };
  /** Cell-range selection — set of `${ri},${ci}` keys (Excel-style). */
  selection: Set<string>;
  /** Anchor cell from which shift-extend / drag-extend rectangles grow. */
  selectionAnchor: { ri: number; ci: number } | null;
  /**
   * Multi-select on row/col header elements per dimension. Drives bulk
   * Keep-only / Parent-anzeigen / Expand-all from the ctx-menu. Each key
   * is a dim name; value is the Set of selected element names in that dim.
   * Ctrl/Cmd+click toggles; Shift+click range-extends along the rendered
   * axis order.
   */
  headerSelection: Record<string, Set<string>>;
  headerSelectionAnchor: { dim: string; elem: string } | null;
  /**
   * Scroll position to restore on the NEXT grid render, consumed once. Set by a
   * toggle click that reloads the cellset: `showLoading` hides the container,
   * and a hidden container reports `scrollTop` 0 — the grid jumped to the top.
   */
  holdScrollTop: number | null;
  /** Last MDX submitted via the inline runner — popup uses this as initial text on reopen. */
  lastInlineMdx: string | null;
  /**
   * Is the display narrower than `lastInlineMdx` says? Set by the
   * local shortcuts that narrow WITHOUT asking the server ("Keep
   * only", collapsing what is already loaded). The effective MDX is then rebuilt only
   * at the next reader (`mdxBuild#effectiveInlineMdx`) — writing out an
   * axis with 10,000 rows on EVERY click would be too expensive.
   */
  _inlineMdxStale: boolean;
  /** True when the currently open view is an MDX view (shows Save-to-server button). */
  isMdxView: boolean;
  /** When true, a title-dim select change or suppress-toggle click triggers an automatic refresh. */
  autoRefresh: boolean;
  /** The MDX string as received from the server on open — used for content-loss detection. */
  originalMdx: string | null;
  /** Paging: total row count from server (0 if non-paged). */
  totalRows: number;
  /** Paging: column count (needed to page-fetch the correct slice). */
  numCols: number;
  /** Whether the current cellset is in paged mode (not all rows loaded). */
  paged: boolean;
  /** Highest absolute row index that has been loaded into lastMatrix.values. */
  _loadedRowMax: number;
  /** True while a fetchCellPage request is in-flight. */
  _cellPagePending: boolean;
  /** Cellset id of the currently-displayed matrix (P1-3 race protocol). null
   *  when non-paged (no server cellset kept alive). Sent back on every
   *  `fetchCellPage` request; a `cellPage` response whose `cellsetId` doesn't
   *  match this is from a superseded cellset and must be discarded. */
  cellsetId: string | null;
  /** Active display alias per dimension (dim → alias attr name; absent/'' = none).
   *  Chosen via the row/col right-click "Alias" submenu; persisted into a saved
   *  native view as the axis subset's `Alias` property. */
  dimAliases: Record<string, string>;
  /** Cached elemName → aliasValue map per dim for the currently active alias. */
  aliasMaps: Record<string, Record<string, string>>;
  /** Cached available alias attribute names per dim (drives the submenu). */
  aliasDefs: Record<string, string[]>;
  /** Manual column-width overrides (px), keyed by leaf data-column identity
   *  (`_colKey`). Client-only display state; resets on reload, never saved. */
  colWidths: Record<string, number>;
  /** Manual width (px) for the single row-header column (numHdrCols === 1).
   *  null = default/auto. Skipped for multi-dim row headers (sticky offsets). */
  rowHdrWidth: number | null;
  /** Manual width overrides (px) for multi-dim row-header columns, keyed by the
   *  row-dimension name. Client-only display state; resets on reload. */
  rowDimWidths: Record<string, number>;
  /** Row-dimension list used by the last render, so the module-level resize
   *  handler can recompute cumulative sticky-left offsets per column. */
  renderedRowDims: string[];
  /**
   * Visible row/column order of the last render, in
   * RAW index space (the index carried by `td.dataset.ri`/`.ci`). `renderGrid`
   * filters/trims (collapsed consolidations, `localFocus`,
   * occurrence hiding, empty-row suppression, MAX_COLS) WITHOUT
   * renumbering the remaining indices — gaps stay in place.
   * Pasting (`paste.ts`) must therefore map through these lists instead of through
   * raw row/column counts: otherwise values land in cells that are not
   * drawn at all.
   */
  renderedRowIdx: number[];
  renderedColIdx: number[];
  /** Monotonic counter for the request-generation guard (reqGuard.ts). Stamped
   *  onto outbound refreshData/runInlineMdx/switchView; echoed back on cellData. */
  _reqSent: number;
  /** Axis members from a restored layout (`layoutSnapshot.ts`). Stands in for
   *  the loaded matrix until the first one arrives after a webview reload. */
  restoredDimSubsets: Record<string, string[]>;
  /** Set when a drag pivots an MDX view's axes. Tells doRefresh to rebuild the
   *  whole MDX (buildPivotedMdx) instead of only patching the WHERE slicer,
   *  which would leave a moved dim on an axis AND in the slicer (rte 33). */
  _mdxAxisDirty: boolean;
  /** Dims whose full element list is being fetched after a fresh pivot; when
   *  their elementsData arrives, re-refresh once so the axis uses the full
   *  subset instead of the single title element. */
  _pendingSubsetFetch: Set<string>;
  /** Number-format controls (toolbar): decimal separator, fixed decimal places,
   *  and whether to reformat displayed values from the raw value. `comma` is also
   *  used when copying (Ctrl+C) so pasted numbers match the chosen separator. */
  numFmt: { comma: boolean; decimals: number; reformat: boolean };
  /** Display formats per element, set in the format dialog; grid only. */
  displayFormats: DisplayFormats;
}

export const state: CubeViewerState = {
  cubeName: '',
  dimensions: [],
  hierarchies: {},
  defaultHiers: {},
  existingViewName: null,
  existingViewIsPrivate: false,
  knownViews: [],
  rowDims: [],
  colDims: [],
  titleDims: [],
  titleAssignments: {},
  titleOverride: false,
  elementsCache: {},
  dimSelections: {},
  lastMatrix: null,
  numFmt: {
    comma: !!(window as unknown as { __cvCopyDecimalComma?: boolean }).__cvCopyDecimalComma,
    decimals: 2,
    reformat: false,
  },
  displayFormats: nameMap(),
  loading: false,
  collapsed: nameMap(),
  axisBaseNames: {},
  localFocus: null,
  pendingDrillAction: null,
  pendingChildLookup: null,
  pendingPicklist: null,
  pendingCellPicklist: null,
  selection: new Set<string>(),
  selectionAnchor: null,
  headerSelection: {},
  headerSelectionAnchor: null,
  holdScrollTop: null,
  lastInlineMdx: null,
  _inlineMdxStale: false,
  isMdxView: false,
  autoRefresh: false,
  originalMdx: null,
  totalRows: 0,
  numCols: 0,
  paged: false,
  _loadedRowMax: 0,
  _cellPagePending: false,
  cellsetId: null,
  dimAliases: {},
  aliasMaps: {},
  aliasDefs: {},
  colWidths: {},
  rowHdrWidth: null,
  rowDimWidths: {},
  renderedRowDims: [],
  renderedRowIdx: [],
  renderedColIdx: [],
  _reqSent: 0,
  restoredDimSubsets: {},
  _mdxAxisDirty: false,
  _pendingSubsetFetch: new Set<string>(),
};

/** Hierarchy names of `key`'s dimension other than its same-named one — what
 *  `axisFactorForDim` needs to read `[D].[X]` as hierarchy X, not element X. */
export function altHiersOf(key: string): string[] {
  const dim = dimOfKey(key);
  return (state.hierarchies[dim] ?? []).filter((h) => h !== dim);
}

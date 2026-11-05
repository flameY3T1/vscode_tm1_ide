/**
 * Discriminated-union protocol for the Cube Viewer (Monaco)
 * webview ↔ extension-host bridge.
 *
 * Hebel 13 (2026-05-17): single source of truth for every `postMessage`
 * shape. Both sides import from this module — host
 * (`src/commands/cubeViewer/manager.ts`) and webview client
 * (`src/webviewClient/cubeViewerMonaco/*.ts`).
 *
 * MatrixData / CellFlag / DimSelection live HERE, not in the webview-side
 * `state.ts`, so the host tsconfig (which excludes `src/webviewClient`, no
 * DOM lib) can import the protocol cleanly. `state.ts` re-exports them; it
 * used to keep its own copy, which had drifted (`colLevels`, `rawValues`
 * missing here — review 2026-10-03, D1).
 */

export interface CellFlag {
  c?: 1;
  r?: 1;
  u?: 0;
  s?: 1;
}

export interface MatrixData {
  rowElements: string[];
  colElements: string[];
  values: Record<string, string>;
  /** Full-precision raw values, same key shape as values — shown on cell click. */
  rawValues?: Record<string, string>;
  cellFlags?: Record<string, CellFlag>;
  rowTuples?: string[][];
  colTuples?: string[][];
  /** TM1 level per row/col, indexed [idx][dimIdx]. `null` when the host had
   *  no level data (`axisMeta.ts` returns `levels: null`); readers check it. */
  rowLevels?: number[][] | null;
  colLevels?: number[][] | null;
  rowParents?: Record<string, string>[];
  colParents?: Record<string, string>[];
  rowAllParents?: Record<string, string[]>[];
  colAllParents?: Record<string, string[]>[];
  /** Visible elements that have children in the FULL dimension: the collapse triangle.
   *  Since the trimming, the client can no longer derive this on its own. */
  rowHasChildren?: Record<string, true>[];
  colHasChildren?: Record<string, true>[];
  rowDims?: string[];
  colDims?: string[];
  titleAssignments?: Record<string, string>;
  numCols?: number;
  totalRows?: number;
  loadedRows?: number;
  paged?: boolean;
  /** Cellset id (P1-3 race protocol) — the webview stores this as the "current"
   *  cellset generation and uses it to discard `cellPage` responses that were
   *  produced against a superseded cellset. */
  cellsetId?: string;
  /** Attribute level: dim -> element -> RAW definition. Per element instead of per
   *  cell, which saves three orders of magnitude at 8000 rows. */
  picklistByElem?: Record<string, Record<string, string>>;
  /** Rule level: element -> RAW definition, from the rule text of the
   *  control cube (1 ms per cube). DIMENSIONLESS, because the area bracket
   *  of a TM1 rule names elements without their dimension. */
  picklistByRuleElem?: Record<string, string>;
  /** Does `}PickList_<Cube>` exist at all? Only then is the single query on
   *  double-click worthwhile; without a control cube the client skips the
   *  round trip entirely. The host knows it anyway when reading the rule map. */
  picklistCubePresent?: boolean;
}

/** `'all'` = the whole dimension, chosen explicitly ("All" in the Dimension
 *  Browser). Explicit, because the basis is the axis of the opened view:
 *  a missing entry means "take the view as it is", not
 *  "take everything". Every reader that needs `names` checks for
 *  `kind === 'elements'` anyway and thereby correctly skips this case: it
 *  carries no name list, but becomes `TM1SUBSETALL`. */
export type DimSelection =
  | { kind: 'elements'; names: string[] }
  | { kind: 'consolidation'; name: string }
  | { kind: 'all' }
  /**
   * The axis set as an EXPRESSION, from the Dimension Browser when an
   * arrangement (collapse state, sorting, filter) rather than a manual
   * selection was confirmed there. Inserted into the axis unchanged.
   */
  | { kind: 'expression'; expression: string };

export type DimElementListEntry = string | { name: string; depth: number };

/** A restored context-dim restriction from a saved native view: the curated
 *  element list plus the active (selected) member. */
export interface TitleSubset { names: string[]; selected: string }

export interface CellEditError {
  kind?: string;
  message?: string;
}

export interface ViewRef {
  name: string;
  isPrivate: boolean;
}

// ── Host → Webview ──────────────────────────────────────────────
export type HostToWebview =
  /**
   * "Give me your state": the workbench asks when saving.
   *
   * The state of a changed, not yet saved view lives HERE, not in the
   * extension: `buildCurrentMdx()` builds it from axes, title assignment and
   * aliases. `_activeInlineMdx` only knows it if someone has explicitly run an
   * MDX query.
   *
   * `token` travels along and must appear in the reply: the selection window
   * can be opened twice, and a late reply to the first question must not
   * answer the second.
   */
  | { type: 'requestState'; token: string }
  /** Restore: apply the control shell to a freshly opened panel. */
  | {
      type: 'applyState';
      ui?: {
        titleAssignments?: Record<string, string>;
        dimAliases?: Record<string, string>;
        suppressRows?: boolean;
        suppressCols?: boolean;
        decimals?: number;
        decComma?: boolean;
        displayFormats?: Record<string, Record<string, string>>;
      };
    }
  | {
      type: 'initData';
      cubeName: string;
      dimensions: string[];
      /** Hierarchy names per dimension, only dimensions with more than one. */
      hierarchies?: Record<string, string[]>;
      /** Default hierarchy where it is not named like its dimension. */
      defaultHiers?: Record<string, string>;
      rowDim?: string;
      colDim?: string;
      existingViewName?: string | null;
      existingViewIsPrivate?: boolean;
      suppressRows?: boolean;
      suppressCols?: boolean;
      autoLoad?: boolean;
      isMdx?: boolean;
      mdx?: string | null;
      initialMdx?: string | null;
       /**
        * `true` = EXECUTE the expression instead of showing it for editing.
        *
        * The default remains "edit": `newMdxViewCommand` hands in a
        * template, whereas restoring a workbench hands in the state the
        * window last showed.
        */
      initialMdxRun?: boolean;
      /** Restored curated context-dim restrictions (dim → subset + active member)
       *  read back from a saved native view. Only multi-element restrictions. */
      titleSubsets?: Record<string, TitleSubset> | null;
      /** Display aliases stored on the opened native view (dim → alias name).
       *  Same payload as on `viewSwitched` — the alias belongs to the view, so it
       *  has to arrive on the first open too, not only on a later switch. */
      dimAliases?: Record<string, string>;
    }
  | { type: 'error'; message: string; reqId?: number }
  | { type: 'viewsData'; views: ViewRef[] }
  | {
      type: 'viewSwitched';
      viewName?: string | null;
      isPrivate?: boolean;
      suppressRows?: boolean;
      suppressCols?: boolean;
      /** Display aliases stored on the loaded native view (dim → alias name). */
      dimAliases?: Record<string, string>;
      /** Restored curated context-dim restrictions on the switched-to view. */
      titleSubsets?: Record<string, TitleSubset> | null;
      /** Type of the switched-to view — resets isMdxView/originalMdx so MDX-ness
       *  doesn't leak across a view switch (native ↔ MDX in the same panel). */
      isMdx?: boolean;
      mdx?: string | null;
    }
  | { type: 'dimAliasDefs'; dimName: string; aliases: string[] }
  | { type: 'dimAliasValues'; dimName: string; alias: string; values: Record<string, string> }
  | { type: 'setDimAlias'; dimName: string; alias: string }
  | {
      type: 'viewSaveResult';
      ok: boolean;
      message: string;
      viewName?: string;
      isPrivate?: boolean;
    }
  // `keepUndo`: echoed from the refresh the webview sends after a write of its
  // own. A view switch or a user refresh does not send it, and `messaging.ts`
  // then clears the undo stack as before (defect 2, fix wave 2026-08-12).
  // `reqId` is always set: a reply without one belongs to no request.
  | { type: 'cellData'; matrix: MatrixData; reqId: number; keepUndo?: boolean }
  | {
      type: 'cellEditResult';
      ri: number;
      ci: number;
      ok: boolean;
      error?: CellEditError;
    }
  | {
      type: 'elementsData';
      dimName: string;
      elements: DimElementListEntry[];
    }
  | {
      type: 'dimSelectionUpdate';
      dimName: string;
      selection: DimSelection | null;
      autoRefresh: boolean;
      suppressColsOverride?: boolean;
      /** The browser switched hierarchy: `fromKey` is replaced by `dimName`
       *  in its zone before the selection applies. */
      fromKey?: string;
    }
  | { type: 'spreadResult'; ok: boolean; error?: CellEditError }
  | {
      type: 'spreadBulkResult';
      ok: boolean;
      okCount: number;
      totalCount: number;
      firstError?: { ri: number; ci: number; error: CellEditError } | null;
    }
  | {
      type: 'cellEditBulkResult';
      ok: boolean;
      okCount: number;
      totalCount: number;
      firstError?: { ri: number; ci: number; error: CellEditError } | null;
    }
  | {
      type: 'cellPage';
      startRow: number;
      /** Cellset id this page was fetched against (P1-3 race protocol). The
       *  webview discards the page if it doesn't match its stored current id. */
      cellsetId?: string;
      values: Record<string, string>;
      rawValues?: Record<string, string>;
      cellFlags: Record<string, CellFlag>;
      /** Scroll-loaded row headers for [startRow, startRow+page): absolute-indexed merge. */
      rowElements?: string[];
      rowTuples?: string[][];
      rowLevels?: number[][] | null;
      /** Parent-map top-up for exactly the rows of this page, per row dimension.
       *  DELTA, not a replacement: the client MERGES the entries into its existing
       *  maps. Overwriting would throw away the parent chains of the rows already
       *  loaded; they would then indent flat and lose their collapse triangle. */
      rowParentsDelta?: Record<string, string>[];
      /** Multi-parent delta, same merge rule as `rowParentsDelta`. */
      rowAllParentsDelta?: Record<string, string[]>[];
      /** Collapse-triangle delta for the named names of this page, same merge rule. */
      rowHasChildrenDelta?: Record<string, true>[];
    }
  // P1-6: host detected the cellset is gone server-side (session-idle 404).
  // Client re-issues its current refresh to recreate it.
  | { type: 'cellsetExpired' }
  /** Reply to `fetchAxisChildren`. The client has held back a click and is
   *  waiting, so this message ALWAYS arrives, even for an unknown element
   *  (then both fields are empty instead of no reply at all). */
  | {
      type: 'axisChildren';
      dimName: string;
      elem: string;
      children: string[];
      descendants: string[];
      reqId?: number;
    }
  /** Reply to `resolvePicklist`. `values: null` means "TM1 allows anything
   *  here" (unreadable definition or dead reference), NOT the same as the
   *  empty list, which would mean "dropdown without entries". */
  | { type: 'picklistValues'; def: string; values: string[] | null; reqId: number }
  /** Reply to `fetchCellPicklist`: the RAW definition of EXACTLY ONE cell.
   *  `def: null` means "this cell has no picklist", not "empty list":
   *  the editor then falls back to the free-text field. */
  | { type: 'cellPicklistDef'; def: string | null; reqId: number }
  | { type: 'elementFormats'; dimName: string; raw: Record<string, string>; error?: string; reqId: number }
  | { type: 'elementFormatsWritten'; ok: boolean; cancelled?: boolean; error?: string; reqId: number };

// ── Webview → Host ──────────────────────────────────────────────
export type WebviewToHost =
  /** Reply to `requestState`. `state` is deliberately `unknown`: its shape
   *  belongs to the workbench (`captureStatePure.ts`), not to the Cube Viewer. */
  | { type: 'stateReply'; token: string; state: unknown }
  | { type: 'fetchViews' }
  | { type: 'fetchElements'; dimName: string }
  | {
      type: 'refreshData';
      rowDims?: string[];
      colDims?: string[];
      /** Legacy single-dim fields kept for backward compat with older webview state. */
      rowDim?: string;
      colDim?: string;
      titleAssignments: Record<string, string>;
      /**
       * The user picked a context element after the saved view was loaded, so the
       * host must NOT re-execute the view (that would restore the view's own
       * title members) and builds a temp NativeView from `titleAssignments`.
       */
      titleOverride?: boolean;
      existingViewName?: string | null;
      existingViewIsPrivate?: boolean;
      dimSubsets?: Record<string, string[]>;
      suppressRows?: boolean;
      suppressCols?: boolean;
      reqId: number;
      /** Refresh after the webview's own write: the host echoes it on `cellData`
       *  so the undo entry of that write survives. */
      keepUndo?: boolean;
    }
  | { type: 'exportCsv'; csv: string; cubeName: string }
  | { type: 'switchView'; viewName: string; isPrivate: boolean; reqId: number }
  | {
      type: 'saveView';
      viewName: string;
      isPrivate: boolean;
      overwrite: boolean;
      rowDims: string[];
      colDims: string[];
      titleAssignments: Record<string, string>;
      suppressRows: boolean;
      suppressCols: boolean;
      dimSubsets?: Record<string, string[]>;
      /** Active display alias per axis dim (dim → alias name) to persist. */
      dimAliases?: Record<string, string>;
      /** Curated context-dim restrictions (title dim → element names) to persist
       *  as multi-element title subsets. Webview state is the source of truth. */
      titleSubsets?: Record<string, string[]>;
    }
  | { type: 'fetchDimAliasDefs'; dimName: string }
  | { type: 'fetchDimAliasValues'; dimName: string; alias: string }
  | {
      type: 'cellEdit';
      ri: number;
      ci: number;
      value: number | string;
      coordinates: string[];
      dimensions: string[];
      /** Raw picklist definition of this cell (`pickDefinitionForCell`, the
       *  same test as the arrow), `null` if none. The host uses it to interpret
       *  TM1's uninformative 285 error and appends the allowed values to the
       *  rejection message (`classifyWriteError`). */
      picklistDef?: string | null;
    }
  | {
      type: 'spread';
      ri: number;
      ci: number;
      method: string;
      value: number;
      coordinates: string[];
      dimensions: string[];
    }
  | {
      type: 'spreadBulk';
      method: string;
      value: number;
      dimensions: string[];
      targets: Array<{ ri: number; ci: number; coordinates: string[] }>;
    }
  | {
      type: 'cellEditBulk';
      dimensions: string[];
      /** `picklistDef` is PER TARGET (`pickDefinitionForCell`, the same cell).
       *  The host interprets TM1's 285 error per failed target, not
       *  batch-wide. An empty clearing value (Delete key) cannot be checked
       *  against the list beforehand, so the rejection message has to apply
       *  here just as it does for a single edit. */
      targets: Array<{
        ri: number; ci: number; coordinates: string[]; value: number | string;
        picklistDef?: string | null;
      }>;
    }
  | { type: 'openMdxRunner'; mdx: string }
  | { type: 'runInlineMdx'; mdx: string; reqId: number; keepUndo?: boolean }
  | { type: 'saveMdxView'; mdx: string; viewName: string; isPrivate: boolean; overwrite: boolean; plainMdx?: string }
  | {
      type: 'openDimBrowser';
      dimName: string;
      currentElements?: string[];
       /**
        * The set expression of THIS dimension from the effective MDX: the factor
        * it contributes to the cross product of the axis (`axisFactorForDim`).
        *
        * `currentElements` alongside it only carries the drawn row names, i.e.
        * a projection of the RESULT. A collapse state expressed as a
        * DRILL*MEMBER chain does not survive that: until 2026-08-20 the
        * browser therefore opened at zero (only the roots of the dimension),
        * although the axis next to it showed something quite different. If the
        * expression is missing (dimension only in the `WHERE`, ambiguous
        * factor), the previous behaviour stays.
        */
      currentExpression?: string;
      /** Why NO expression came along: travels into the browser's diagnostics. */
      currentExpressionNote?: string;
      /** Alias this dimension currently shows in the grid, so the browser opens
       *  under the same one. Counterpart of the `setDimAlias` the browser sends
       *  back on confirm — without it the two disagree on first paint. */
      alias?: string;
      /** Other hierarchies of this dimension already on the grid — the browser
       *  greys them out in its hierarchy picker (one key per hierarchy). */
      takenHiers?: string[];
    }
  /**
   * `silent` = only record the selection, do not trigger a refresh. For
   * collapsing, which hides the rows locally: the host must know the shrunken
   * set so that the NEXT real refresh builds on it; there is nothing to
   * reload in this case.
   */
  | { type: 'setDimFilterElements'; dimName: string; names: string[]; suppressColsOverride?: boolean; silent?: boolean }
  /** Carry the axis forward as an expression (collapse click on `kind: 'expression'`). */
  | { type: 'setDimFilterExpression'; dimName: string; expression: string }
  | { type: 'expandSubtree'; dimName: string; names: string[]; mode?: 'all' | 'leaves' | 'elemLeaves' }
  | { type: 'clearDimFilter'; dimName: string }
  | { type: 'clearDimSelection'; dimName: string }
  | { type: 'webviewReady' }
  | {
      type: 'fetchCellPage';
      startRow: number;
      rowCount: number;
      /** Client's current cellset id (P1-3 race protocol) — lets the host bail
       *  out early if the request is already stale relative to its own state. */
      cellsetId?: string;
    }
  | {
      type: 'trace';
      kind: 'rule' | 'feeders' | 'check';
      coordinates: string[];
      dimensions: string[];
    }
  /** Collapse-triangle click on an element that the client, since the trimming,
   *  can no longer answer on its own. `within` = current filter list; if it is
   *  set, it restricts `descendants` (same result, see task 6 in the plan:
   *  `toggleFilterNames` only ever removes names from `sel.names`). */
  | { type: 'fetchAxisChildren'; dimName: string; elem: string; within?: string[]; reqId?: number }
  /** The webview is opening a dropdown and needs the values for this
   *  definition. `reqId` is echoed back so that a reply to an editor that has
   *  been cancelled in the meantime can be discarded. */
  | { type: 'resolvePicklist'; def: string; reqId: number }
  /**
   * Neither the attribute map nor the rule map knows this cell: the host
   * should look up EXACTLY THIS ONE cell in the control cube (1-2 ms measured).
   * Never an area: 417 cells in one cellset cost 12.5 s, the window of a
   * real view over 10 minutes. `reqId` as for `resolvePicklist`.
   */
  | { type: 'fetchCellPicklist'; coordinates: string[]; dimensions: string[]; reqId: number }
  /** Format dialog: stored `Format` attribute values (prefix included) of these elements. */
  | { type: 'readElementFormats'; dimName: string; elements: string[]; reqId: number }
  /** Format dialog: write `Format` (prefix included, '' clears) after a confirmation on the host. */
  | { type: 'writeElementFormats'; dimName: string; values: Record<string, string>; reqId: number };

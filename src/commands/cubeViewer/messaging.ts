import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { WebviewToHost } from '../../webviewClient/cubeViewerMonaco/protocol';
import { unwrapDisplayFormats } from '../../cubeViewer/mdxFormatEmbedPure';
import { hasDisplayFormats } from '../../cubeViewer/displayFormatPure';
import type { WriteError } from '../../cubeViewer/cellWrite';
import type { SpreadMethod } from '../../cubeViewer/spreadMethods';
import { openDimensionBrowser } from '../dimension/dimensionBrowser';
import { openCellTracePanel } from './cellTracePanel';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { MdxRunnerManager } from '../mdx/mdxRunner';
import { _dimSelections, _activeInlineMdx, runSerializedRefresh, cubeViewerTitle, post } from './state';
import { resolveStateReply } from '../workbench/stateAsk';
import {
  _fetchAllViews, _fetchDimElementsTree, _fetchViewAxisConfig, _fetchSubtreeMemberNames,
} from './fetch';
import { handleCellEditMessage } from './cellEdit';
import { handleSpreadMessage } from './spread';
import { _saveCsvFile } from './csv';
import {
  _readExistingView, _saveView, saveMdxView,
  refreshCurrentLayout, _viewAxisBaseline, clearViewAxisWarnings,
  type ViewDimSelection,
} from './view';
import { logBestEffort } from '../../providers/bestEffortLog';
import { fetchDimAliasDefs, fetchDimAliasValues, fetchViewDimAliases } from './alias';
import { resolveMdxSaveTarget } from './mdxSaveTargetPure';
import { _executeMdxInline } from './executeMdxInline';
import { _buildAxisMeta } from './axisMeta';
import { dropPanelCellset, _stashPageContext } from './cellsetState';
import { _cellsets, _panels } from './state';
import { resolvePicklist, fetchCellPicklist } from './picklistApi';
import { _picklistDims, _picklistMaps } from './picklistWiring';
import { _fetchCellPage, _fetchTuplePage, CellsetNotFoundError } from './cellset';
import { rowsForCellBudget } from './cellBudgetPure';
import { levelsForSlice } from './axisMeta';
import { getDimChildIndex } from './dimStructCache';
import { dispatch, type DispatchTable } from '../../webviews/dispatchTablePure';
import { sameElementSequence } from './dimSelectionKeyPure';
import { refreshInlineMdx } from './view';
import { hierKey, splitHierKey } from '../../utils/hierKeyPure';
import { readElementFormats, writeElementFormats } from '../../tm1Rest/elementFormatApi';

/**
 * Injected context for every cube-viewer message handler (A4 dispatch table).
 * Bundles the positional args of the router so each handler is a pure lookup
 * entry that destructures exactly what it needs.
 */
interface CubeViewerCtx {
  readonly panelKey: string;
  readonly panel: vscode.WebviewPanel;
  readonly cubeName: string;
  readonly existingViewName: string | undefined;
  readonly existingViewIsPrivate: boolean;
  readonly config: Tm1Config;
}

/**
 * In-flight `fetchElements` requests, keyed `panelKey|dimName` (M12).
 * A 100k-element context dropdown takes seconds to resolve; opening it again
 * meanwhile used to start a second `_fetchDimElementsTree`, so N opens held N
 * full element trees in host memory at once. One request per panel+dim — the
 * reply broadcasts to the panel anyway, so late openers still get their list.
 */
const _elementFetchInFlight = new Set<string>();

/**
 * Host-side mirror of "which saved view is this panel showing, and has the user
 * picked a context element the view itself doesn't carry".
 *
 * `refreshData` is the only message that carries both (the webview keeps
 * `titleOverride` sticky until a view is (re)loaded), but `saveView` needs them
 * too: without them Save rebuilds the view from `msg.dimSubsets`, i.e. from the
 * ~10k members the webview has LOADED, and persists a truncated copy of a
 * 295k-row view (MED-2 — same defect the refresh path fixes).
 *
 * One tiny entry per panel key (server+cube); never grows with data.
 */
interface PanelViewState { viewName?: string; isPrivate: boolean; titleOverride: boolean }
const _panelViewState = new Map<string, PanelViewState>();
// A pivot leaves saved-view execution mode, but retains the window's view identity.
const _panelViewIdentity = new Map<string, { viewName: string; isPrivate: boolean }>();

export function getPanelViewIdentity(panelKey: string): Readonly<{ viewName: string; isPrivate: boolean }> | undefined {
  return _panelViewIdentity.get(panelKey);
}

/**
 * Current execution state: a pivot clears viewName so refresh/save use the
 * working layout. Workbench capture uses getPanelViewIdentity instead.
 */
export function getPanelViewState(panelKey: string): Readonly<PanelViewState> | undefined {
  return _panelViewState.get(panelKey);
}

/**
 * View switched or (re-)saved: bring both the mirror AND the tab title up to
 * date.
 *
 * `panel.title` used to be set only in `createWebviewPanel` (manager.ts) and
 * afterwards stayed on the view from opening, while the mirror had long since
 * known the new one. The webview does the same (`handleViewSaveResult`,
 * `viewSwitched`): adopt the name, clear `titleOverride`.
 */
function _setCurrentView(
  panelKey: string, panel: vscode.WebviewPanel, cubeName: string, config: Tm1Config,
  viewName: string, isPrivate: boolean,
): void {
  _panelViewState.set(panelKey, { viewName, isPrivate, titleOverride: false });
  _panelViewIdentity.set(panelKey, { viewName, isPrivate });
  panel.title = cubeViewerTitle(formatServerLabel(config.serverUrl, getServerNameByUrl), cubeName, viewName);
}

/**
 * Warnings already shown for a panel/view/reason. A degraded axis rebuild is
 * sticky (the view doesn't change), so without this every refresh would pop the
 * same notification again.
 */
/**
 * Panel dispose hook for the messaging-local per-panel state (called from
 * `manager.ts#onDidDispose`, alongside `_dimSelections` & co.).
 * `_elementFetchInFlight` is deliberately left out: its entries are cleaned
 * up by the `finally` block of the running fetch — a delete here would only
 * remove the key of a new panel with the same name. The axis warnings
 * themselves have lived, since Task 8, in `refreshCurrentLayout`/
 * `_viewAxisBaseline` in `view.ts` (needed there too) — `clearViewAxisWarnings`
 * cleans them up from there.
 */
export function clearPanelMessagingState(panelKey: string): void {
  _panelViewState.delete(panelKey);
  _panelViewIdentity.delete(panelKey);
  clearViewAxisWarnings(panelKey);
}

// ── Dispatch table ──────────────────────────────────────────────
// Exhaustive over WebviewToHost: a missing `type` is a compile error.
export const cubeViewerTable: DispatchTable<WebviewToHost, CubeViewerCtx> = {
  // Answer to the workbench's state question. Deliberately routed through
  // THIS table instead of a second message listener: the table is
  // exhaustive, a new type without a handler is a compile error.
  // `false` (nobody is waiting any more — the timeout fired first, or a
  // foreign token) is a normal outcome, not an error.
  stateReply: (msg) => { resolveStateReply(msg.token, msg.state); },
  fetchElements: async (msg, ctx) => {
    const { panelKey, panel, config } = ctx;
    const dimName = msg.dimName as string;
    const key = `${panelKey}|${dimName}`;
    if (_elementFetchInFlight.has(key)) { return; }
    _elementFetchInFlight.add(key);
    let elements;
    try {
      elements = await _fetchDimElementsTree(dimName, config);
    } finally {
      _elementFetchInFlight.delete(key);
    }
    post(panel, { type: 'elementsData', dimName, elements });
  },

  openDimBrowser: async (msg, ctx) => {
    const { panelKey, panel, config } = ctx;
    const dimName = msg.dimName as string;
    const currentSel = _dimSelections.get(panelKey)?.[dimName];
    // Initial: User-applied filter wins; otherwise the view subset (the
    // webview supplies currentElements from state.lastMatrix); otherwise empty.
    const fromView = Array.isArray(msg.currentElements) ? (msg.currentElements as string[]) : [];
    const initialFromView = !currentSel || currentSel.kind !== 'elements';
    const initialSelection = currentSel?.kind === 'elements' ? currentSel.names : fromView;
    // The axis expression of THIS dimension, when it could be unambiguously
    // extracted from the effective MDX (`axisFactorForDim` in the webview). It
    // is the BASIS the browser builds on — `initialSelection` alongside it
    // stays the preset. When it is missing, the browser opens on the whole
    // dimension as before.
    const sourceMdx = typeof msg.currentExpression === 'string' && msg.currentExpression
      ? msg.currentExpression : undefined;
    const { dim: browseDim, hier: browseHier } = splitHierKey(dimName);
    void openDimensionBrowser(browseDim, config, {
      mode: 'selection',
      ...(browseHier !== browseDim ? { initialHier: browseHier } : {}),
      multiSelect: true,
      initialSelection,
      ...(sourceMdx ? { initialSourceMdx: sourceMdx } : {}),
      ...(typeof msg.currentExpressionNote === 'string' && msg.currentExpressionNote
        ? { initialSourceNote: msg.currentExpressionNote } : {}),
      // The viewer places MDX on the axis (`buildAxisSetMdx`), so the answer
      // is allowed to be an expression. A collapse state is an arrangement,
      // not a selection — handed back as a name list, it would be lost.
      acceptsExpression: true,
      // Open the picker in the window of THIS cube viewer. If the viewer was
      // detached via "Move Editor into New Window", its `viewColumn` points
      // to the group in the extra window — without passing this through, the
      // browser would land in the main window. `viewColumn` is undefined as
      // long as the panel is not visible; in that case, leave the field out
      // and let the host default (`ViewColumn.Active`) decide.
      ...(panel.viewColumn !== undefined ? { viewColumn: panel.viewColumn } : {}),
      // Open under the alias the grid already shows for this dim — the mirror
      // image of the `setDimAlias` that `onSelect` posts back below. Without it
      // the browser starts on raw element names while the grid beside it shows
      // aliases.
      initialAlias: typeof msg.alias === 'string' && msg.alias ? msg.alias : undefined,
      hierSwitch: { taken: Array.isArray(msg.takenHiers) ? (msg.takenHiers as string[]) : [] },
      onSelect: (sel, displayAlias, hierName) => {
        // The user may have switched hierarchy in the browser: the selection
        // then belongs to another key, and the chip follows it.
        const targetKey = hierName ? hierKey(browseDim, hierName) : dimName;
        // Mirror the alias the user had active in the browser onto this axis
        // dim, so applying a selection also switches the grid's display alias.
        post(panel, { type: 'setDimAlias', dimName: targetKey, alias: displayAlias || '' });
        const selMap = _dimSelections.get(panelKey) ?? {};
        if (targetKey !== dimName) {
          // No no-op detection: the preset came from the old hierarchy.
          delete selMap[dimName];
          selMap[targetKey] = sel;
          _dimSelections.set(panelKey, selMap);
          post(panel, { type: 'dimSelectionUpdate', dimName: targetKey, fromKey: dimName, selection: sel, autoRefresh: true });
          return;
        }
        if (sel.kind === 'all') {
          // "All" means the WHOLE dimension — and that is not the same as
          // "no filter". The basis here is the opened view, whose axis
          // carries a subset: without an entry, the refresh falls back to
          // `_readExistingView`, re-reads exactly that subset, and nothing
          // changes on screen (flameY3T1's click test, 2026-08-12: "if you then
          // go back into the view, the view still looks exactly as before").
          // Kept as an explicit selection, the refresh takes the same path as
          // any other selection, and `buildAxisSetMdx` inserts
          // `TM1SUBSETALL` — without enumerating the names individually.
          selMap[dimName] = { kind: 'all' };
          _dimSelections.set(panelKey, selMap);
          post(panel, { type: 'dimSelectionUpdate', dimName, selection: { kind: 'all' }, autoRefresh: true });
          return;
        }
        // No-op detection: if the initial value came from the view subset and
        // the confirm is identical -> do not set a user filter (otherwise the
        // refresh path tips over onto _refreshWithTempView and loses view
        // config like alias/suppress). Order counts (the visible row order
        // carries the axis order) — a pure reordering is NO LONGER a no-op.
        // The same idea for the expression answer: if the basis came from the
        // view and the browser returns exactly that back, the user has done
        // nothing. Without this branch, merely opening and confirming would
        // already set a user filter, and the refresh would lose the view
        // configuration.
        if (initialFromView && sel.kind === 'expression' && sourceMdx
          && sel.expression.trim() === sourceMdx.trim()) {
          delete selMap[dimName];
          _dimSelections.set(panelKey, selMap);
          post(panel, { type: 'dimSelectionUpdate', dimName, selection: null, autoRefresh: false });
          return;
        }
        if (initialFromView && sel.kind === 'elements') {
          if (sameElementSequence(initialSelection, sel.names)) {
            delete selMap[dimName];
            _dimSelections.set(panelKey, selMap);
            post(panel, { type: 'dimSelectionUpdate', dimName, selection: null, autoRefresh: false });
            return;
          }
        }
        selMap[dimName] = sel;
        _dimSelections.set(panelKey, selMap);
        post(panel, { type: 'dimSelectionUpdate', dimName, selection: sel, autoRefresh: true });
      },
      onSubsetSaved: () => { void vscode.commands.executeCommand('tm1.refreshExplorer'); },
    });
  },

  clearDimSelection: async (msg, ctx) => {
    const { panelKey } = ctx;
    const selMap = _dimSelections.get(panelKey) ?? {};
    delete selMap[msg.dimName as string];
    _dimSelections.set(panelKey, selMap);
  },

  clearDimFilter: async (msg, ctx) => {
    const { panelKey, panel } = ctx;
    const selMap = _dimSelections.get(panelKey) ?? {};
    delete selMap[msg.dimName as string];
    _dimSelections.set(panelKey, selMap);
    post(panel, { type: 'dimSelectionUpdate', dimName: msg.dimName, selection: null, autoRefresh: true });
  },

  runInlineMdx: async (msg, ctx) => {
    const { panelKey, panel, cubeName, config } = ctx;
    const mdx = (msg.mdx as string | undefined) ?? '';
    if (!mdx.trim()) {
      post(panel, { type: 'error', message: vscode.l10n.t('MDX is empty.') });
      return;
    }
    await runSerializedRefresh(panelKey, async () => {
      if (await refreshInlineMdx(panelKey, panel, cubeName, mdx, config, msg.reqId, !!msg.keepUndo)) {
        _activeInlineMdx.set(panelKey, mdx);
      }
    });
  },

  openMdxRunner: async (msg, ctx) => {
    const { config } = ctx;
    const mdx = (msg.mdx as string | undefined) ?? '';
    if (!mdx || !config) {
      vscode.window.showWarningMessage(vscode.l10n.t('TM1: Cannot open MDX Runner — no server context.'));
      return;
    }
    const label = getServerNameByUrl(config.serverUrl) ?? formatServerLabel(config.serverUrl, getServerNameByUrl) ?? config.serverUrl;
    MdxRunnerManager.openWithMdx(config, label, mdx);
  },

  setDimFilterElements: async (msg, ctx) => {
    const { panelKey, panel } = ctx;
    // Set/replace the explicit element filter for a dimension. Used by the
    // grid's expand-toggle to extend/shrink the server-side subset (so the
    // refreshed view contains both the parent consolidation and its
    // newly-loaded children, instead of falling back to the view's saved
    // subset and losing the parent).
    const selMap = _dimSelections.get(panelKey) ?? {};
    const dimName = msg.dimName as string;
    const names = (msg.names as string[]) ?? [];
    if (names.length === 0) {
      delete selMap[dimName];
    } else {
      selMap[dimName] = { kind: 'elements', names };
    }
    _dimSelections.set(panelKey, selMap);
    // `silent`: the webview has already hidden the rows itself (a collapse
    // only removes what was loaded). Here the selection is merely recorded so
    // that the next real refresh builds on it — sending an update back would
    // mean running a refresh for it that fetches nothing new.
    if (msg.silent === true) { return; }
    const suppressColsOverride = msg.suppressColsOverride as boolean | undefined;
    post(panel, {
      type: 'dimSelectionUpdate',
      dimName,
      selection: selMap[dimName] ?? null,
      autoRefresh: true,
      ...(suppressColsOverride !== undefined && { suppressColsOverride }),
    });
  },

  setDimFilterExpression: async (msg, ctx) => {
    const { panelKey, panel } = ctx;
    // Collapse click on an axis that travels as an EXPRESSION (a filter chip
    // or a dynamic subset of the opened view). The client has extended the
    // expression with a `DRILLDOWNMEMBER`/`DRILLUPMEMBER`; here it is
    // recorded so that a refresh of a NativeView too (which reads the
    // selection from THIS map, not from the webview state) builds on it.
    const selMap = _dimSelections.get(panelKey) ?? {};
    const dimName = msg.dimName as string;
    const expression = (msg.expression as string) ?? '';
    if (!expression) {
      delete selMap[dimName];
    } else {
      selMap[dimName] = { kind: 'expression', expression };
    }
    _dimSelections.set(panelKey, selMap);
    post(panel, {
      type: 'dimSelectionUpdate',
      dimName,
      selection: selMap[dimName] ?? null,
      autoRefresh: true,
    });
  },

  expandSubtree: async (msg, ctx) => {
    const { panelKey, panel, config } = ctx;
    // "Expand all" on a consolidation: resolve the WHOLE subtree (all
    // descendant C + N elements) server-side via recursive MDX drilldown, then
    // apply it as the dim's explicit element filter. The visible paged matrix
    // only holds the collapsed parent, so the client can't enumerate unloaded
    // descendants — the server must.
    const dimName = msg.dimName;
    const targets = msg.names ?? [];
    if (targets.length === 0) { return; }
    let names: string[];
    try {
      names = await _fetchSubtreeMemberNames(dimName, targets, config, msg.mode ?? 'all');
    } catch (err) {
      post(panel, { type: 'error', message: vscode.l10n.t('Subtree resolve failed: {0}', errMsg(err)) });
      return;
    }
    if (names.length === 0) { return; }
    const selMap = _dimSelections.get(panelKey) ?? {};
    selMap[dimName] = { kind: 'elements', names };
    _dimSelections.set(panelKey, selMap);
    post(panel, {
      type: 'dimSelectionUpdate',
      dimName,
      selection: selMap[dimName] ?? null,
      autoRefresh: true,
    });
  },

  refreshData: async (msg, ctx) => {
    const { panelKey, panel, cubeName, existingViewName, existingViewIsPrivate, config } = ctx;
    // Serialized per panel (latest-wins): prevents TempView races and stale
    // responses that would overwrite newer data.
    await runSerializedRefresh(panelKey, async () => {
      // The webview owns the query: in MDX mode it sends `runInlineMdx`, so a
      // `refreshData` means this layout. Replaying the last inline MDX here
      // instead ignored every layout change after an "Execute" or a restore
      // (review 2026-11-02, C1).
      // A pivot (drag dim between zones) sends existingViewName=null to leave
      // saved-view mode. Respect that explicit null — only fall back to the
      // panel's original view when the key is ABSENT, otherwise a pivot would
      // re-read the original layout and bounce the dim back to its old axis.
      const viewName = msg.existingViewName !== undefined
        ? (msg.existingViewName ?? undefined)
        : existingViewName;
      // Accept both new (rowDims[]) and legacy (rowDim string) formats
      const rowDims: string[] = (msg.rowDims as string[] | undefined)
        ?? (msg.rowDim ? [msg.rowDim as string] : []);
      const colDims: string[] = (msg.colDims as string[] | undefined)
        ?? (msg.colDim ? [msg.colDim as string] : []);
      // Whether the user has set an explicit dim filter via the dim browser
      // embed is checked by `refreshCurrentLayout` itself (it re-reads
      // `_dimSelections` via `panelKey`) — no longer precomputed redundantly
      // here (Task 8).
      // Same for a context (title) element the user picked after the view was
      // loaded: re-executing the saved view server-side would silently snap the
      // slicer back to the view's own title members. The webview reports this as
      // `titleOverride` (sticky until a view is (re)loaded) → temp NativeView,
      // which honours msg.titleAssignments.
      const hasTitleOverride = !!msg.titleOverride;
      const isPriv = (msg.existingViewIsPrivate !== undefined) ? !!msg.existingViewIsPrivate : existingViewIsPrivate;
      // Mirror both for the Save path, which gets neither on its own message.
      _panelViewState.set(panelKey, { viewName, isPrivate: isPriv, titleOverride: hasTitleOverride });
      if (viewName) { _panelViewIdentity.set(panelKey, { viewName, isPrivate: isPriv }); }
      // The decision itself (saved view vs. working state) lives in
      // `refreshCurrentLayout` (view.ts).
      await refreshCurrentLayout(
        panelKey, panel, cubeName, viewName, isPriv, rowDims, colDims,
        msg.titleAssignments ?? {}, (msg.dimSubsets ?? {}) as Record<string, string[]>,
        hasTitleOverride, !!msg.suppressRows, !!msg.suppressCols, config, msg.reqId, !!msg.keepUndo,
      );
    });
  },

  exportCsv: async (msg) => {
    await _saveCsvFile(msg.csv as string, msg.cubeName as string);
  },

  fetchViews: async (msg, ctx) => {
    const { panel, cubeName, config } = ctx;
    try {
      const views = await _fetchAllViews(cubeName, config);
      post(panel, { type: 'viewsData', views });
    } catch (err) {
      // Don't let a dead connection masquerade as an empty view list (F3).
      post(panel, { type: 'error', message: vscode.l10n.t('Failed to load views: {0}', errMsg(err)) });
    }
  },

  fetchDimAliasDefs: async (msg, ctx) => {
    const { panel, config } = ctx;
    const dimName = msg.dimName as string;
    const aliases = await fetchDimAliasDefs(dimName, config);
    post(panel, { type: 'dimAliasDefs', dimName, aliases });
  },

  fetchDimAliasValues: async (msg, ctx) => {
    const { panel, config } = ctx;
    const dimName = msg.dimName as string;
    const alias = msg.alias as string;
    const values = await fetchDimAliasValues(dimName, alias, config);
    post(panel, { type: 'dimAliasValues', dimName, alias, values });
  },

  switchView: async (msg, ctx) => {
    const { panelKey, panel, cubeName, config } = ctx;
    const viewName = (msg.viewName as string | undefined)?.trim();
    const isPriv = !!msg.isPrivate;
    if (!viewName) { return; }
    await runSerializedRefresh(panelKey, async () => {
      try {
        // Update axis/suppression from the new view and reload cells
        // Independent reads — serialising them doubled the latency of every
        // view switch for no reason.
        const [ax, nativeAliases] = await Promise.all([
          _fetchViewAxisConfig(cubeName, viewName, isPriv, config),
          fetchViewDimAliases(cubeName, viewName, isPriv, config),
        ]);
        post(panel, {
          type: 'viewSwitched',
          viewName, isPrivate: isPriv,
          suppressRows: !!ax?.suppressRows, suppressCols: !!ax?.suppressCols,
          // Native views carry the alias on the axis subset, MDX views inside the
          // MDX text — merge both carriers into the one channel the webview reads.
          dimAliases: { ...(ax?.dimAliases ?? {}), ...nativeAliases },
          titleSubsets: ax?.titleSubsets ?? null,
          isMdx: !!ax?.isMdx,
          mdx: ax?.mdx ?? null,
        });
        // A view carrying our format members runs as its plain MDX: executing
        // the stored view would compute the members server-side, and TM1
        // reports those cells as not writable. The decision lives here only;
        // the webview just mirrors the plain MDX as its inline MDX.
        const opened = ax?.isMdx && ax.mdx ? unwrapDisplayFormats(ax.mdx) : null;
        const plainMdx = opened && hasDisplayFormats(opened.formats) ? opened.mdx : null;
        if (plainMdx === null) {
          await _readExistingView(panelKey, panel, cubeName, viewName, isPriv, ax?.rowDim ?? '', ax?.colDim ?? '', config, msg.reqId);
        }
        // Clear any lingering explicit element selections from custom-axis mode
        _dimSelections.delete(panelKey);
        // Loading a view clears the sticky context override (webview does the same).
        _setCurrentView(panelKey, panel, cubeName, config, viewName, isPriv);
        // Switching views exits inline-MDX mode — view query wins — unless the
        // view itself runs as inline MDX.
        _activeInlineMdx.delete(panelKey);
        if (plainMdx !== null && await refreshInlineMdx(panelKey, panel, cubeName, plainMdx, config, msg.reqId)) {
          _activeInlineMdx.set(panelKey, plainMdx);
        }
      } catch (err) {
        post(panel, { type: 'error', message: errMsg(err) });
      }
    });
  },

  saveView: async (msg, ctx) => {
    const { panelKey, panel, cubeName, config, existingViewName, existingViewIsPrivate } = ctx;
    const viewName = (msg.viewName as string | undefined)?.trim();
    const isPrivate = !!msg.isPrivate;
    const overwrite = !!msg.overwrite;
    const rowDims: string[] = msg.rowDims ?? [];
    const colDims: string[] = msg.colDims ?? [];
    const titleAssignments: Record<string, string> = msg.titleAssignments ?? {};
    const suppressRows = !!msg.suppressRows;
    const suppressCols = !!msg.suppressCols;
    const dimAliases: Record<string, string> = msg.dimAliases ?? {};

    if (!viewName) {
      post(panel, { type: 'viewSaveResult', ok: false, message: vscode.l10n.t('Name must not be empty.') });
      return;
    }
    if (rowDims.length === 0 || colDims.length === 0) {
      post(panel, { type: 'viewSaveResult', ok: false, message: vscode.l10n.t('At least one dimension in rows and columns is required.') });
      return;
    }
    try {
      const dimSel = _dimSelections.get(panelKey) ?? {};
      // Baseline merge as with refreshData: all row+col dims keep
      // their view subsets, user edits win.
      const baseline: Record<string, { kind: 'elements'; names: string[] }> = {};
      const dimSubsets = (msg.dimSubsets ?? {}) as Record<string, string[]>;
      for (const d of Object.keys(dimSubsets)) {
        const names = dimSubsets[d];
        if (Array.isArray(names) && names.length > 0) {
          baseline[d] = { kind: 'elements', names };
        }
      }
      // MED-2: same plumbing as refreshData. After a context pick the refresh
      // keeps the saved view's full 295k-row axes — Save must not then persist
      // the ~10k members `msg.dimSubsets` reports. Gated on exactly the state
      // that makes the refresh take the temp-view path (saved view, no explicit
      // dim filters, sticky context override), mirrored in `_panelViewState`.
      const pvs = _panelViewState.get(panelKey);
      const srcView = pvs?.viewName ?? (pvs ? undefined : existingViewName);
      const srcIsPrivate = pvs ? pvs.isPrivate : existingViewIsPrivate;
      const viewSel: Record<string, ViewDimSelection> =
        (srcView && pvs?.titleOverride && Object.keys(dimSel).length === 0)
          ? await _viewAxisBaseline(panelKey, cubeName, srcView, srcIsPrivate, isPrivate, rowDims, colDims, config)
          : {};
      const mergedSel: Record<string, any> = { ...baseline, ...viewSel, ...dimSel };
      // Curated context-dim restrictions come straight from webview state (the
      // source of truth — survives a reopen-restore where host _dimSelections is
      // empty). Fold them in so _buildNativeViewBody persists multi-element title
      // subsets. See title-subset round-trip.
      const titleSubsets = (msg.titleSubsets ?? {}) as Record<string, string[]>;
      for (const d of Object.keys(titleSubsets)) {
        const names = titleSubsets[d];
        if (Array.isArray(names) && names.length > 0) {
          mergedSel[d] = { kind: 'elements', names };
        }
      }
      const result = await _saveView(cubeName, viewName, isPrivate, overwrite, rowDims, colDims, titleAssignments, mergedSel, suppressRows, suppressCols, dimAliases, config);
      // The panel now shows the saved view — the same way the webview
      // (`handleViewSaveResult`) picks up the name and visibility.
      _setCurrentView(panelKey, panel, cubeName, config, viewName, isPrivate);
      post(panel, { type: 'viewSaveResult', ok: true, message: result, viewName, isPrivate });
      vscode.commands.executeCommand('tm1.refreshExplorer');
    } catch (err) {
      post(panel, { type: 'viewSaveResult', ok: false, message: errMsg(err) });
    }
  },

  saveMdxView: async (msg, ctx) => {
    const { panelKey, panel, cubeName, config } = ctx;
    const target = resolveMdxSaveTarget(msg);
    if (!target) {
      post(panel, { type: 'viewSaveResult', ok: false, message: vscode.l10n.t('Name must not be empty.') });
      return;
    }
    if (!target.mdx.trim()) {
      post(panel, { type: 'viewSaveResult', ok: false, message: vscode.l10n.t('MDX empty') });
      return;
    }
    try {
      const result = await saveMdxView(cubeName, target.viewName, target.mdx, target.isPrivate, target.overwrite, config);
      // The webview tracks the saved name/visibility itself (handleViewSaveResult);
      // host mirror + tab title must follow, or the Workbench keeps saving under
      // the view the panel was OPENED with.
      _setCurrentView(panelKey, panel, cubeName, config, target.viewName, target.isPrivate);
      // Saved with format members: keep refreshing the plain MDX, or the next
      // refresh runs the stored members and locks those cells.
      if (typeof msg.plainMdx === 'string' && msg.plainMdx) { _activeInlineMdx.set(panelKey, msg.plainMdx); }
      post(panel, { type: 'viewSaveResult', ok: true, message: result, viewName: target.viewName, isPrivate: target.isPrivate });
      vscode.commands.executeCommand('tm1.refreshExplorer');
    } catch (err) {
      post(panel, { type: 'viewSaveResult', ok: false, message: errMsg(err) });
    }
  },

  cellEdit: async (msg, ctx) => {
    const { panel, cubeName, config } = ctx;
    const result = await handleCellEditMessage({
      cubeName,
      dimensions: (msg.dimensions as string[]) ?? [],
      coordinates: msg.coordinates as string[],
      value: msg.value as number | string,
      ri: msg.ri as number,
      ci: msg.ci as number,
      config,
      // Sent along by the webview (`pickDefinitionForCell`, the same check as
      // the arrow) — `cellEditBulk` below passes this through ANALOGOUSLY,
      // but per target (see there).
      picklistDef: (msg.picklistDef as string | null | undefined) ?? null,
    });
    post(panel, { type: 'cellEditResult', ...result });
    // The refresh that repaints totals and rule cells comes from the webview
    // (`cellEditResult` handler), with its current layout and its own reqId.
  },

  spread: async (msg, ctx) => {
    const { panel, cubeName, config } = ctx;
    const result = await handleSpreadMessage({
      cubeName,
      dimensions: (msg.dimensions as string[]) ?? [],
      coordinates: (msg.coordinates as string[]) ?? [],
      method: msg.method as SpreadMethod,
      value: typeof msg.value === 'number' ? msg.value : 0,
      ri: msg.ri as number,
      ci: msg.ci as number,
      config,
    });
    post(panel, { type: 'spreadResult', ...result });
  },

  spreadBulk: async (msg, ctx) => {
    const { panel, cubeName, config } = ctx;
    const targets = (msg.targets as Array<{ ri: number; ci: number; coordinates: string[] }>) ?? [];
    const dimensions = (msg.dimensions as string[]) ?? [];
    const method = msg.method as SpreadMethod;
    const value = typeof msg.value === 'number' ? msg.value : 0;
    let okCount = 0;
    let firstError: { ri: number; ci: number; error: WriteError } | null = null;
    for (const t of targets) {
      const r = await handleSpreadMessage({
        cubeName, dimensions, coordinates: t.coordinates,
        method, value, ri: t.ri, ci: t.ci, config,
      });
      if (r.ok) {
        okCount++;
      } else {
        firstError = { ri: r.ri, ci: r.ci, error: r.error };
        break; // stop on first failure
      }
    }
    post(panel, {
      type: 'spreadBulkResult',
      okCount, totalCount: targets.length,
      ok: !firstError,
      firstError,
    });
  },

  cellEditBulk: async (msg, ctx) => {
    const { panel, cubeName, config } = ctx;
    const targets = (msg.targets as Array<{
      ri: number; ci: number; coordinates: string[]; value: number | string;
      picklistDef?: string | null;
    }>) ?? [];
    const dimensions = (msg.dimensions as string[]) ?? [];
    let okCount = 0;
    let firstError: { ri: number; ci: number; error: WriteError } | null = null;
    // In order, and abort on the first error — like `spreadBulk`. There would
    // be no rollback anyway: TM1 has no transactions, and the offsetting
    // write would fail for the same reason.
    for (const t of targets) {
      const r = await handleCellEditMessage({
        cubeName, dimensions, coordinates: t.coordinates, value: t.value,
        ri: t.ri, ci: t.ci, config,
        // Sent along by the webview PER TARGET (`bulkWrite.ts`) — the list in
        // the rejection message belongs to EXACTLY this `t`, not to the first
        // target in the batch (the delete path has no value pre-check that
        // could catch the 285 before we do).
        picklistDef: t.picklistDef ?? null,
      });
      if (r.ok) { okCount++; } else { firstError = { ri: r.ri, ci: r.ci, error: r.error }; break; }
    }
    post(panel, {
      type: 'cellEditBulkResult',
      okCount, totalCount: targets.length,
      ok: !firstError,
      firstError,
    });
  },

  fetchCellPage: async (msg, ctx) => {
    const { panelKey, panel } = ctx;
    const cs = _cellsets.get(panelKey);
    if (!cs) { return; }
    // Capture the generation id BEFORE the await (P1-3 race protocol): a
    // refresh may replace `_cellsets.get(panelKey)` with a new cellset while
    // this page fetch is in flight. `cs` itself is never mutated in place, so
    // comparing against a freshly re-read map entry (not the captured `cs`)
    // after the await is what actually detects the swap.
    const requestCellsetId = cs.id;
    // Request already stale relative to host state at receive-time — the
    // client's view of "current" was behind the host's; skip the fetch.
    if (typeof msg.cellsetId === 'string' && msg.cellsetId !== requestCellsetId) { return; }
    // The webview asks in ROWS and cannot know the cell cost of the page —
    // rowCount * numCols. Clamp here rather than trusting the client: it is the
    // host that pays for the payload, and the message is not validated at
    // runtime. Tuples follow the same window so headers and cells stay aligned.
    const rowCount = Math.min(msg.rowCount, rowsForCellBudget(cs.numCols));
    try {
      const [page, tuples] = await Promise.all([
        _fetchCellPage(cs.id, msg.startRow, rowCount, cs.numCols, cs.config),
        _fetchTuplePage(cs.id, 1, msg.startRow, rowCount, cs.config),
      ]);
      // Re-check AFTER the await: if a refresh replaced the panel's cellset
      // while this fetch was running, the page belongs to a superseded
      // cellset and must never be spliced into the (now different) current
      // matrix. Drop it silently — no error, this is not a failure.
      if (_cellsets.get(panelKey)?.id !== requestCellsetId) { return; }
      const rowElements = tuples.map((t) => t.filter(Boolean).join(' / '));
      const hasLevels = !!cs.rowDims && !!cs.levelMaps && cs.levelMaps.some((m: Map<string, number>) => m.size > 0);
      const rowLevels = hasLevels
        ? levelsForSlice(tuples, cs.rowDims!, cs.levelMaps!)
        : undefined;
      // Parent-map top-up for the newly loaded rows: since the trim, the
      // client only holds what it can name — but scrolled rows are new
      // names. Without a top-up, they would indent flat and lose their
      // collapse triangle. The trim runs over EXACTLY the tuples of this
      // page; the dimension structure comes fresh from the ETag cache (warm
      // ~5 ms) — a second cache in the cellset entry would be a second
      // source of truth. Deliberately WITHOUT the filter list
      // (`extraKnown`): the first page already sent that along, the client
      // merges both.
      // Reloaded rows cost NO picklist query (Task 15): the surface comes
      // from the attribute and rule maps that were already there when the
      // view was opened and apply to every row — per-page cell picklists
      // would have the same cellset size as the data and thus the same cost
      // that triggered this task in the first place (417 cells = 12.5 s).
      const meta = cs.rowDims ? await _buildAxisMeta(cs.rowDims, tuples, cs.config) : undefined;
      // The trim is ANOTHER await — the check from above no longer covers the
      // window after it. So check again, or a page of a superseded cellset
      // would still slip out.
      if (_cellsets.get(panelKey)?.id !== requestCellsetId) { return; }
      post(panel, {
        type: 'cellPage', startRow: msg.startRow, cellsetId: requestCellsetId,
        values: page.values, rawValues: page.rawValues, cellFlags: page.cellFlags,
        rowElements, rowTuples: tuples, rowLevels,
        rowParentsDelta: meta?.parents,
        rowAllParentsDelta: meta?.allParents,
        rowHasChildrenDelta: meta?.hasChildren,
      });
    } catch (err) {
      // P1-6: cellset expired server-side (session-idle timeout, ~15min) —
      // drop the stale entry and let the client re-issue its current refresh
      // (which recreates the cellset) instead of freezing the grid forever
      // on a generic error. Non-404 failures keep the existing generic path.
      if (err instanceof CellsetNotFoundError) {
        // The await threw, so the T2 post-await supersession guard above never
        // ran for this path. Re-apply the same check here: only treat the 404
        // as a genuine expiry if the expired cellset is STILL the panel's
        // current one. If a refresh already replaced it (this fetch was for a
        // superseded cellset that TM1 GC'd right after the new one was
        // minted), dropping the panel's now-current cellset and posting
        // cellsetExpired would force a redundant, flicker-causing refresh
        // right after one just succeeded — so ignore it silently instead.
        if (_cellsets.get(panelKey)?.id === requestCellsetId) {
          dropPanelCellset(panelKey);
          post(panel, { type: 'cellsetExpired' });
        }
        return;
      }
      post(panel, { type: 'error', message: vscode.l10n.t('Failed to load cell page: {0}', errMsg(err)) });
    }
  },

  webviewReady: () => {
    // Handshake-only message — no host action (silently ignored, as before).
  },

  trace: async (msg, ctx) => {
    const { cubeName, config } = ctx;
    await openCellTracePanel({
      kind: msg.kind,
      cube: cubeName,
      dims: msg.dimensions,
      coords: msg.coordinates,
      config,
    });
  },


  fetchAxisChildren: async (msg, ctx) => {
    const { panel, config } = ctx;
    // No supersession check like with fetchCellPage (P1-3/T2): the answer
    // hangs off the dimension structure (ETag cache in dimStructCache.ts), not
    // off a particular cellset/panel generation. Even if the panel refresh
    // changes the view during the await, "which children does this element
    // have in this dimension" stays valid regardless — there is no state
    // here that could become stale.
    let children: string[] = [];
    let descendants: string[] = [];
    try {
      const idx = await getDimChildIndex(msg.dimName, config);
      children = idx.children.get(msg.elem) ?? [];
      const limit = msg.within ? new Set(msg.within) : undefined;
      const seen = new Set<string>();
      const stack = [...children];
      while (stack.length > 0) {
        const n = stack.pop() as string;
        if (seen.has(n)) { continue; }
        seen.add(n);
        for (const c of idx.children.get(n) ?? []) { stack.push(c); }
      }
      descendants = limit ? [...seen].filter((n) => limit.has(n)) : [...seen];
    } catch (err) {
      logBestEffort('CubeViewer', `fetchAxisChildren ${msg.dimName}/${msg.elem}`, err);
    }
    // ALWAYS answer — the client has held its click and is waiting.
    post(panel, {
      type: 'axisChildren', dimName: msg.dimName, elem: msg.elem,
      children, descendants, reqId: msg.reqId,
    });
  },

  resolvePicklist: async (msg, ctx) => {
    const { panelKey, panel, config } = ctx;
    const values = await resolvePicklist(config, msg.def);
    // Resolving can take a while (a paged element list of a large dimension),
    // and the panel may be closed in the meantime — `panel.webview` throws
    // then. The dispose hook clears `_panels`; that is the liveness check
    // here.
    if (_panels.get(panelKey) !== panel) { return; }
    // `values === null` travels on AS null: "TM1 allows anything here" is not
    // the same as "dropdown with no entries".
    post(panel, { type: 'picklistValues', def: msg.def, values, reqId: msg.reqId });
  },

  /**
   * The definition of EXACTLY ONE cell (Task 15). The client only asks when
   * neither the attribute map nor the rule map knows this cell — measured at
   * 1-2 ms.
   *
   * A range must NEVER arise here: `fetchCellPicklist` builds, via
   * `buildCellPicklistMdx`, one tuple per axis, everything else into the
   * slicer. 417 cells in one cellset cost 12.5 s, the window of a real saved
   * view over 10 minutes.
   */
  fetchCellPicklist: async (msg, ctx) => {
    const { panelKey, panel, cubeName, config } = ctx;
    const def = await fetchCellPicklist(config, cubeName, msg.dimensions, msg.coordinates);
    // As with `resolvePicklist`: the panel may be closed in the meantime,
    // `panel.webview` throws then. The dispose hook clears `_panels` — that
    // is the liveness check here.
    if (_panels.get(panelKey) !== panel) { return; }
    // `null` travels on AS null: "this cell has no picklist" is not the same
    // as "dropdown with no entries".
    post(panel, { type: 'cellPicklistDef', def, reqId: msg.reqId });
  },

  readElementFormats: async (msg, ctx) => {
    const { panelKey, panel, config } = ctx;
    let raw: Record<string, string> = {};
    let error: string | undefined;
    const { dim, hier } = splitHierKey(msg.dimName);
    try { raw = await readElementFormats(config, dim, msg.elements, hier); } catch (err) { error = errMsg(err); }
    if (_panels.get(panelKey) !== panel) { return; }
    post(panel, { type: 'elementFormats', dimName: msg.dimName, raw, error, reqId: msg.reqId });
  },

  writeElementFormats: async (msg, ctx) => {
    const { panelKey, panel, config } = ctx;
    const n = Object.keys(msg.values).length;
    const { dim, hier } = splitHierKey(msg.dimName);
    // A server write every user and every tool sees — ask first, on the host,
    // where a modal cannot be scripted away by the page.
    const go = vscode.l10n.t('Save on server');
    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t('Write the Format attribute of {0} element(s) of "{1}" on the server? It applies to every user, view and tool.', n, msg.dimName),
      { modal: true }, go,
    );
    if (pick !== go) {
      if (_panels.get(panelKey) === panel) { post(panel, { type: 'elementFormatsWritten', ok: false, cancelled: true, reqId: msg.reqId }); }
      return;
    }
    try {
      const { createdAttribute } = await writeElementFormats(config, dim, msg.values, hier);
      if (createdAttribute) {
        vscode.window.showInformationMessage(vscode.l10n.t('Created the attribute "Format" on dimension "{0}".', dim));
      }
      if (_panels.get(panelKey) === panel) { post(panel, { type: 'elementFormatsWritten', ok: true, reqId: msg.reqId }); }
    } catch (err) {
      if (_panels.get(panelKey) === panel) { post(panel, { type: 'elementFormatsWritten', ok: false, error: errMsg(err), reqId: msg.reqId }); }
    }
  },
};

/**
 * Switch-router for all WebviewToHost messages from a cube viewer panel.
 * Posts replies back to the panel via `panel.webview.postMessage`.
 */
export async function _handleMessage(
  panelKey: string, panel: vscode.WebviewPanel, msg: WebviewToHost,
  cubeName: string, existingViewName: string | undefined, existingViewIsPrivate: boolean, config: Tm1Config,
): Promise<void> {
  await dispatch(cubeViewerTable, msg, { panelKey, panel, cubeName, existingViewName, existingViewIsPrivate, config });
}

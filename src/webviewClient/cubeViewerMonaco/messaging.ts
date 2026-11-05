/**
 * Inbound message handler — routes extension → webview messages to the
 * appropriate module. Also wires the top-level button handlers for
 * Refresh / Export / Suppression toggles.
 */

import { state } from './state';
import type { HostToWebview, TitleSubset } from './protocol';
import { getRefs, showLoading, showError, showToast, refreshTdClassByValue, setToggleOn, isToggleOn } from './dom';
import { vscode } from './vscodeApi';
import { undoStack } from './pureBridge';
import { rebuildZones, fillSelect, currentDimSubsetsAll, clearElementFetchPending, swapAxes, rekeyHierarchy } from './axis';
import { syncTitleCombo } from '../_shared/filterCombo';
import { renderGrid, applyNumberFormat, syncResetButton } from './grid';
import { sanitizeDisplayFormats, hasDisplayFormats } from '../../cubeViewer/displayFormatPure';
import { unwrapDisplayFormats } from '../../cubeViewer/mdxFormatEmbedPure';
import { onElementFormats, onElementFormatsWritten } from './formatDialog';
import {
  cancelEdit, applyPicklistValues, applyCellPicklistDef, cancelPendingPicklistEditor,
} from './editor';
import { lastBulkKind } from './bulkWrite';
import { resolvePastePicklistResponse } from './paste';
import { populateViewSelect, resetViewsLoaded, showOpenedView, ensureViewsFetched } from './viewPicker';
import { handleViewSaveResult, refreshViewSaveVisibility } from './viewSave';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();
import { buildCsv } from './csv';
import { clearSelection } from './selection';
import { applyPendingDrillAction, refreshAliasSubmenu } from './contextMenu';
import { mergeRowPage, nextLoadedRowMax, CELL_PAGE_ROWS_CLIENT } from './pageMerge';
import { clearCellPicklistCache } from './cellPicklistCache';
import { mergeParentDelta } from './parentMergePure';
import { openMdxModal } from './mdxView';
import { buildCurrentMdx, effectiveInlineMdx, setInlineMdx } from './mdxBuild';
import { axisBaseNamesFromMatrix } from './gridPure';
import { rewriteMdxSlicer } from './mdxSlicerPure';
import { buildPivotedMdx } from './mdxPivotPure';
import { consumePendingRefresh, titleKeysFor } from './pivotPure';
import { snapshotLayout, storedLayout, applyLayout } from './layoutSnapshot';
import { setRefreshFn } from './refreshBridge';
import { setCancelPendingPicklistFn } from './pendingEditGuard';
import { hasAxisElementFilter } from './mdxAxisFilterPure';
import { setNonEmptyAxis } from '../../mdx/nonEmptyAxisPure';
import { nextReqId, isCurrentResponse } from './reqGuard';
import { initialMdxAction } from './initialMdxPure';
import { detectNonEmptyAxes } from '../../mdx/nonEmptyAxisPure';
import { nameMap } from '../../utils/nameMapPure';

/** The `initData` message as the protocol defines it — the hand copy that sat
 *  here typed `existingViewName` without `null` (review 2026-10-03, D1). */
type InitData = Extract<HostToWebview, { type: 'initData' }>;

/** Seed state.dimSelections (+ active member) from a saved view's restored
 *  context-dim restrictions so the reopened dropdowns list exactly the curated
 *  subset. Keyed by dim name; must run AFTER any dimSelections reset. */
function applyRestoredTitleSubsets(
  subs: Record<string, TitleSubset> | null | undefined,
): void {
  if (!subs) { return; }
  for (const [dim, ts] of Object.entries(subs)) {
    if (!ts || !Array.isArray(ts.names) || ts.names.length === 0) { continue; }
    state.dimSelections[dim] = { kind: 'elements', names: ts.names };
    if (ts.selected) { state.titleAssignments[dim] = ts.selected; }
  }
}

/** The fields a freshly opened or switched-to view brings along. */
interface OpenedView {
  viewName: string | null;
  isPrivate: boolean;
  suppressRows: boolean;
  suppressCols: boolean;
  isMdx: boolean;
  mdx: string | null;
  titleSubsets: Record<string, TitleSubset> | null | undefined;
}

/**
 * Reset the view-describing state to `v`. Opening (`initData`) and switching
 * (`viewSwitched`) set the same fields; done by hand twice, the two had
 * already drifted (review 2026-10-03, B9).
 *
 * Our own format members come back out: the grid runs the plain MDX and
 * shows the formats itself, so every cell stays writable (see
 * `mdxFormatEmbedPure`). Returns whether the view needs its plain MDX rather
 * than its server-side execution.
 */
function applyOpenedView(v: OpenedView): boolean {
  const refs = getRefs();
  state.existingViewName = v.viewName;
  state.existingViewIsPrivate = v.isPrivate;
  setToggleOn(refs.chkSuppRows, v.suppressRows);
  setToggleOn(refs.chkSuppCols, v.suppressCols);
  state.dimSelections = {};
  state.titleAssignments = {};
  // The view brings its own context — any earlier user pick is gone, so
  // refreshes may go back to executing the saved view directly.
  state.titleOverride = false;
  // MDX-ness follows the view's actual type — else isMdxView (and
  // originalMdx) leak from a previously loaded MDX view and a native view's
  // Save wrongly takes the MDX branch ("MDX empty").
  state.isMdxView = v.isMdx;
  const opened = v.isMdx && v.mdx ? unwrapDisplayFormats(v.mdx) : null;
  state.displayFormats = opened ? sanitizeDisplayFormats(opened.formats) : nameMap();
  state.originalMdx = opened ? opened.mdx : v.mdx;
  syncResetButton();
  setInlineMdx(opened ? opened.mdx : null);
  applyRestoredTitleSubsets(v.titleSubsets);
  return !!opened && hasDisplayFormats(opened.formats);
}

/**
 * Alias display belongs to the view: replace it with the view's stored
 * aliases. Values are fetched lazily; the grid re-renders once they arrive.
 */
function applyViewAliases(dimAliases: Record<string, string> | undefined): void {
  state.dimAliases = { ...(dimAliases ?? {}) };
  state.aliasMaps = {};
  fetchActiveAliasValues();
}

function fetchActiveAliasValues(): void {
  for (const d of Object.keys(state.dimAliases)) {
    const a = state.dimAliases[d];
    if (a) { vscode.postMessage({ type: 'fetchDimAliasValues', dimName: d, alias: a }); }
  }
}

function _onInitData(msg: InitData): void {
  const refs = getRefs();
  state.cubeName = msg.cubeName;
  state.dimensions = msg.dimensions ?? [];
  state.hierarchies = msg.hierarchies ?? {};
  state.defaultHiers = msg.defaultHiers ?? {};
  state.elementsCache = {};
  state.lastMatrix = null;
  const unwrapped = applyOpenedView({
    viewName: msg.existingViewName ?? null, isPrivate: !!msg.existingViewIsPrivate,
    suppressRows: !!msg.suppressRows, suppressCols: !!msg.suppressCols,
    isMdx: !!msg.isMdx, mdx: msg.mdx ?? null, titleSubsets: msg.titleSubsets,
  });

  const rowDim = msg.rowDim || msg.dimensions[0] || '';
  const colDim = msg.colDim && msg.colDim !== rowDim
    ? msg.colDim
    : (msg.dimensions[1] || msg.dimensions[0] || '');
  state.rowDims = rowDim ? [rowDim] : [];
  state.colDims = colDim && colDim !== rowDim ? [colDim] : [];
  state.titleDims = titleKeysFor(msg.dimensions, state.rowDims, state.colDims, [], state.defaultHiers);

  // Reloaded iframe (panel moved to another window): the host resent the
  // FIRST open's initData — continue with the layout that was on screen.
  const saved = storedLayout(vscode.getState(), msg.cubeName);
  if (saved) {
    applyLayout(state, saved);
    setToggleOn(refs.chkSuppRows, saved.suppressRows);
    setToggleOn(refs.chkSuppCols, saved.suppressCols);
    if (state.lastInlineMdx) { setInlineMdx(state.lastInlineMdx); }
    syncResetButton();
    fetchActiveAliasValues();
    rebuildZones();
    resetViewsLoaded();
    if (state.existingViewName) {
      showOpenedView(state.existingViewName, state.existingViewIsPrivate, state.isMdxView);
    }
    doRefresh();
    return;
  }

  applyViewAliases(msg.dimAliases);

  rebuildZones();

  // Lazy element load (2026-05-15): title-dim element lists are only fetched on
  // the first click on the dropdown (see axis.ts#_makeTitleGroup). Row/col chips
  // need the list only at filter-click time anyway. Saves a multiple of RAM on
  // open for cubes with many large dims.
  // Lazy views (P5, 2026-06-11): fetchViews only on the first click on the
  // view-picker dropdown (wireViewPicker#mousedown). Saves 2 API calls on open.
  resetViewsLoaded();
  // Still show the opened view in the dropdown right away. Without this it would
  // say "Custom selection", because without a list there is no option to select
  // - a `fetchViews` just to display a name we already have would give up the
  // savings for nothing (see `showOpenedView`).
  if (state.existingViewName) {
    showOpenedView(state.existingViewName, state.existingViewIsPrivate, state.isMdxView);
  }

  // A supplied MDX can mean two things - see `initialMdxPure.ts`.
  const mdxAction = initialMdxAction(msg);
  if (msg.autoLoad && unwrapped) {
    showLoading(true);
    vscode.postMessage({ type: 'runInlineMdx', mdx: state.originalMdx!, reqId: nextReqId(state) });
  } else if (mdxAction === 'run') {
    // A restored query loads the grid below; the view's own load would be a
    // second query racing it (review 2026-11-02, C8).
    showLoading(true);
  } else if (msg.autoLoad) {
    showLoading(true);
    vscode.postMessage({
      type: 'refreshData',
      rowDims: state.rowDims, colDims: state.colDims,
      titleAssignments: {},
      existingViewName: msg.existingViewName,
      existingViewIsPrivate: state.existingViewIsPrivate,
      reqId: nextReqId(state),
    });
  } else {
    showLoading(false);
    refs.placeholder.style.display = 'flex';
    refs.btnExport.style.display = 'none';
    refs.cellCount.textContent = '';
    // Without the initial load no `cellData` arrives that could warm up the view
    // list (see there) - and an empty viewer is exactly the situation in which a
    // view is chosen first. Here the call competes with nothing.
    ensureViewsFetched();
  }

  if (mdxAction !== 'none') {
    const restored = unwrapDisplayFormats(msg.initialMdx!);
    const mdx = restored.mdx;
    if (hasDisplayFormats(restored.formats)) {
      state.displayFormats = sanitizeDisplayFormats({ ...state.displayFormats, ...restored.formats });
      syncResetButton();
    }
    setInlineMdx(mdx);
    if (mdxAction === 'run') {
      // Restored state: execute it, do not offer it for editing. Same flow as the
      // "Execute" button in the MDX window (`mdxView.ts`), so that the suppression
      // toggles match what actually runs.
      const ne = detectNonEmptyAxes(mdx);
      const refs = getRefs();
      setToggleOn(refs.chkSuppRows, ne.rows);
      setToggleOn(refs.chkSuppCols, ne.cols);
      // What runs is a query, so later refreshes rewrite it (review 2026-11-02, C1).
      state.isMdxView = true;
      vscode.postMessage({ type: 'runInlineMdx', mdx, reqId: nextReqId(state) });
    } else {
      // Template (`newMdxViewCommand`): put it into the window so it gets edited.
      // Deferred so that the DOM and `wireMdxButton` are fully wired.
      setTimeout(() => openMdxModal(mdx), 0);
    }
  }
}

function _onCellEditResult(msg: {
  ri: number; ci: number; ok: boolean; error?: { kind?: string; message?: string };
}): void {
  const td = document.querySelector<HTMLTableCellElement>(
    `td[data-ri="${msg.ri}"][data-ci="${msg.ci}"]`,
  );
  if (!td) return;
  // Stale-grid guard: no pending metadata ⇒ render happened between dispatch + reply.
  if (td.dataset.pendingOld === undefined) return;
  const oldText = td.dataset.pendingOld!;
  const newText = td.dataset.pendingNew!;
  let coords: string[] = [];
  if (td.dataset.pendingCoords) {
    try { coords = JSON.parse(td.dataset.pendingCoords); }
    catch { coords = []; } // corrupt DOM data — degrade instead of crashing the webview
  }
  delete td.dataset.pendingOld;
  delete td.dataset.pendingNew;
  delete td.dataset.pendingCoords;
  td.className = td.className.replace(/\bcell-pending\b/g, '').trim();

  if (msg.ok) {
    // A write that TM1 accepted on a consolidation was a server-side spread
    // (e.g. "P6", which the client parser does not route). It cannot be undone
    // by writing the old value back (CubeCellWriteStatusElementIsConsolidated),
    // and older entries no longer match the leaves - drop the whole stack.
    if (state.lastMatrix?.cellFlags?.[`${msg.ri},${msg.ci}`]?.c === 1) {
      undoStack.clear();
      refreshTdClassByValue(td, newText);
      return;
    }
    undoStack.push({
      coordinates: coords, oldValue: oldText || '', newValue: newText || '',
      ri: msg.ri, ci: msg.ci,
    });
    refreshTdClassByValue(td, newText);
    return;
  }

  // Rollback
  td.textContent = oldText || '';
  refreshTdClassByValue(td, oldText || '');
  const errKind = msg.error?.kind;
  if (errKind === 'security') {
    td.classList.add('cell-security');
    showToast(fmt(L, 'cellWriteProtected', msg.error?.message ?? L.noPermission), 'error');
  } else if (errKind === 'auth') {
    showToast(L.sessionExpired, 'error');
  } else {
    td.classList.add('cell-error');
    td.title = msg.error?.message ?? L.error;
    setTimeout(() => { td.classList.remove('cell-error'); td.title = ''; }, 2000);
    showToast(fmt(L, 'errorPrefix', msg.error?.message ?? L.unknown), 'error');
  }
}

const SPREAD_KIND_LABELS: Record<string, string> = {
  'spread-failed': L.spreadFailed,
  'validation':    L.invalid,
  'security':      L.noWriteRight,
  'auth':          L.sessionExpired,
  'not-found':     L.endpointUnavailable,
  'server':        L.serverError,
  'network':       L.networkError,
};

function _onSpreadResult(msg: { ok: boolean; error?: { kind?: string; message?: string } }): void {
  if (msg.ok) {
    showToast(L.spreadOk, 'success');
    return;
  }
  const kind = msg.error?.kind ?? '';
  const label = SPREAD_KIND_LABELS[kind] ?? L.error;
  const text = msg.error?.message ?? L.unknownError;
  showToast(`${label}: ${text}`, 'error');
}

function _onSpreadBulkResult(msg: {
  ok: boolean; okCount: number; totalCount: number;
  firstError?: { ri: number; ci: number; error: { kind?: string; message?: string } } | null;
}): void {
  if (msg.ok) {
    showToast(fmt(L, 'spreadOkCount', msg.okCount), 'success');
    return;
  }
  const e = msg.firstError;
  const label = SPREAD_KIND_LABELS[e?.error?.kind ?? ''] ?? L.error;
  const text = e?.error?.message ?? L.unknownError;
  showToast(
    fmt(L, 'spreadBulkError', label, msg.okCount + 1, msg.totalCount, text)
    + (msg.okCount > 0 ? fmt(L, 'alreadyApplied', msg.okCount) : ''),
    'error',
  );
}

/**
 * Cleans up every cell marked pending by `paste.ts`: delete the pending data
 * attributes, strip `cell-pending` - the same class-strip technique as
 * `_onCellEditResult`, so that both agree. Only write the old text back if
 * `restoreText` is set.
 *
 * Two SEPARATE operations under one flag, deliberately no longer one (Task 8
 * review, fix wave 2026-08-12, defect 4): clearing the markers must run on EVERY
 * balance arrival - success and failure alike - otherwise
 * `data-paste-pending`/`cell-pending` stay stuck on the cells of a successful
 * paste whose refresh fails afterwards (network, deleted view, ...). The
 * selector is global (`[data-paste-pending]`), so a LATER, failed paste sweeps up
 * these corpses and, via rollback, writes the OLD values of the FIRST paste over
 * the server values that have meanwhile become real. Writing the text back, on
 * the other hand, belongs exclusively to the failure case - on success the
 * optimistically set values stay in place until the refresh either overwrites
 * them with the real view (which re-renders the whole table, so the markers are
 * gone anyway) or does not - in which case the grid at least shows what the
 * server has.
 *
 * Deliberately selects `[data-paste-pending]` instead of the class
 * `cell-pending`: single-cell edits (`commitEdit`, editor.ts, including its undo
 * path) use the same class AND the same `pendingOld` key for their own,
 * concurrently running cell. A sweep over `cell-pending` would therefore also
 * collect a foreign, still-open single-edit reply - its `pendingOld` disappears,
 * `_onCellEditResult` finds nothing on arrival (stale-grid guard) and the edit
 * fizzles silently: no undo entry on success, no error toast on failure. The
 * dedicated marker keeps both feature paths apart.
 */
/**
 * Before EVERY re-render that could replace an open `<td>` together with its
 * `<input>`, close the cell editor (without writing) - otherwise `activeEditor`
 * stays non-null, because Chromium fires NO `blur` for a focused element that is
 * removed from the DOM, and `startEdit`'s `if (activeEditor) return` jams cell
 * editing for the rest of the session (defect 2, review fix wave 2026-08-12).
 * Five call sites need exactly the same behavior at the same position (after
 * every staleness check, before redrawing) - bundled here so they do not drift
 * apart: the original `cellData` path (defect 3, first wave) as well as
 * `cellPage` (scroll-triggered loading - no user blur, because no focused
 * element is being left), `dimAliasValues` and `setDimAlias` (triggered by the
 * host, not by the click that would have focused the selection) and
 * `axisChildren` (the resumed collapse click whose resume callback redraws - no
 * blur, because the collapse triangle is not the focused element).
 */
function _cancelEditorBeforeRerender(): void {
  cancelEdit();
}

function _clearPendingPasteMarkers(restoreText: boolean): void {
  document.querySelectorAll<HTMLTableCellElement>('td[data-paste-pending]').forEach((td) => {
    if (restoreText && td.dataset.pendingOld !== undefined) { td.textContent = td.dataset.pendingOld; }
    delete td.dataset.pastePending;
    delete td.dataset.pendingOld;
    delete td.dataset.pendingNew;
    delete td.dataset.pendingCoords;
    td.className = td.className.replace(/\bcell-pending\b/g, '').trim();
    // Success: the new value stays (see above), but the cell class (e.g.
    // `cell-zero`) was never updated during the optimistic write - without this
    // call a cell pasted to e.g. `0` keeps showing its old numeric coloring until
    // the next refresh (defect 4, review fix wave 2026-08-12).
    if (!restoreText) { refreshTdClassByValue(td, td.textContent ?? ''); }
  });
}

function _onCellEditBulkResult(msg: {
  ok: boolean; okCount: number; totalCount: number;
  firstError?: { ri: number; ci: number; error: { kind?: string; message?: string } } | null;
}): void {
  if (msg.ok) {
    // The host only tallies writes and does not know the reason - the sender
    // (`bulkWrite.ts`) remembers it, so that "cleared" is not reported as
    // "written".
    showToast(fmt(L, lastBulkKind() === 'clear' ? 'clearOk' : 'pasteOk', msg.okCount), 'success');
    // Success: markers gone, text stays (the new value is the right one).
    _clearPendingPasteMarkers(false);
    return;
  }
  // Failure: markers gone AND old text restored.
  _clearPendingPasteMarkers(true);
  const e = msg.firstError;
  const label = SPREAD_KIND_LABELS[e?.error?.kind ?? ''] ?? L.error;
  showToast(
    fmt(L, 'spreadBulkError', label, msg.okCount + 1, msg.totalCount, e?.error?.message ?? L.unknownError)
    + (msg.okCount > 0 ? fmt(L, 'alreadyApplied', msg.okCount) : ''),
    'error',
  );
}

export function wireMessageHandler(): void {
  setRefreshFn(doRefresh); // let axis.ts trigger refreshes without a circular import
  // The layout is written shortly after every input and every host message,
  // not only after a loaded matrix: a local pivot, a collapse or a format never
  // produce one and were lost (review 2026-11-02, C2). `pagehide` would be the
  // one natural moment, but measured on "Move into New Window" the state
  // written there never arrived.
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const schedulePersist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const r = getRefs();
      vscode.setState({ cubeLayout: snapshotLayout(state, isToggleOn(r.chkSuppRows), isToggleOn(r.chkSuppCols), currentDimSubsetsAll()) });
    }, 250);
  };
  for (const ev of ['click', 'change', 'drop', 'keyup', 'message']) {
    window.addEventListener(ev, schedulePersist, true);
  }
  // let grid.ts cancel a pending picklist editor before renderGrid, without a
  // circular import (editor.ts -> actions.ts -> axis.ts -> grid.ts)
  setCancelPendingPicklistFn(cancelPendingPicklistEditor);
  window.addEventListener('message', (e: MessageEvent<HostToWebview | null | undefined>) => {
    const msg = e.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'dimSelectionUpdate': {
        if (msg.fromKey) { rekeyHierarchy(msg.fromKey, msg.dimName); }
        const sel = msg.selection;
        if (sel) state.dimSelections[msg.dimName] = sel;
        else delete state.dimSelections[msg.dimName];
        rebuildZones();
        if (msg.autoRefresh && state.rowDims.length > 0 && state.colDims.length > 0) {
          const scOverride = msg.suppressColsOverride as boolean | undefined;
          setTimeout(() => doRefresh(scOverride), 0);
        }
        break;
      }
      case 'requestState': {
        // The workbench asks WHAT is currently shown. `effectiveInlineMdx()` first:
        // if the user has a free query running, it IS the state. Otherwise
        // `buildCurrentMdx()` builds the expression from axes, title assignment and
        // aliases - exactly what `_activeInlineMdx` in the extension does NOT know once
        // a saved view has been loaded.
        const refs = getRefs();
        let mdx: string | undefined;
        try { mdx = effectiveInlineMdx() ?? buildCurrentMdx(); } catch { mdx = undefined; }
        vscode.postMessage({
          type: 'stateReply',
          token: msg.token,
          state: {
            mdx,
            ui: {
              titleAssignments: { ...state.titleAssignments },
              dimAliases: { ...state.dimAliases },
              // Suppression lives in the toggles, not in the state.
              suppressRows: isToggleOn(refs.chkSuppRows),
              suppressCols: isToggleOn(refs.chkSuppCols),
              decimals: state.numFmt.decimals,
              decComma: state.numFmt.comma,
              displayFormats: state.displayFormats,
            },
          },
        });
        break;
      }
      case 'applyState': {
        // Restoring: the MDX already arrived via the existing path
        // (`CubeViewerManager.open(..., mdx)`), only the shell on top comes here. Each
        // field is checked individually - an older workbench does not know all of
        // them.
        const ui = msg.ui;
        if (ui) {
          const refs = getRefs();
          if (ui.titleAssignments) { state.titleAssignments = { ...ui.titleAssignments }; }
          if (ui.dimAliases) { applyViewAliases(ui.dimAliases); }
          if (typeof ui.suppressRows === 'boolean') { setToggleOn(refs.chkSuppRows, ui.suppressRows); }
          if (typeof ui.suppressCols === 'boolean') { setToggleOn(refs.chkSuppCols, ui.suppressCols); }
          if (typeof ui.decimals === 'number') { state.numFmt.decimals = ui.decimals; }
          if (typeof ui.decComma === 'boolean') { state.numFmt.comma = ui.decComma; }
          if (ui.displayFormats) { state.displayFormats = sanitizeDisplayFormats(ui.displayFormats); syncResetButton(); applyNumberFormat(); }
          rebuildZones();
        }
        break;
      }
      case 'initData':
        _onInitData(msg);
        break;
      case 'elementsData': {
        state.elementsCache[msg.dimName] = msg.elements;
        // The lazy fetch this dim was waiting on landed (M12 in-flight marker).
        clearElementFetchPending(msg.dimName);
        const sel = getRefs().zoneTitles.querySelector<HTMLSelectElement>(
          `.title-elem-sel[data-dim="${CSS.escape(msg.dimName)}"]`,
        );
        if (sel) {
          fillSelect(sel, msg.elements, state.titleAssignments[msg.dimName],
            state.dimSelections[msg.dimName]);
          // The dropdown is typically open right now (the open triggered this
          // fetch) — push the freshly loaded options into the visible list.
          syncTitleCombo(sel);
        }
        if (consumePendingRefresh(state._pendingSubsetFetch, msg.dimName)) {
          // The moved dim's full element list just arrived. On an MDX view the
          // re-refresh must rebuild the pivoted MDX (not rewriteMdxSlicer), else
          // the dim stays stuck at its single former-title element.
          if (state.isMdxView) { state._mdxAxisDirty = true; }
          doRefresh();
        }
        break;
      }
      case 'cellData': {
        if (!isCurrentResponse(msg.reqId, state._reqSent)) { break; }
        // `keepUndo`: set by the host ONLY for the refresh after its own write
        // (`_refreshAfterSpread`) - which would otherwise have deleted the undo entry
        // that this very edit has just pushed. A view switch or a genuine user refresh
        // does not set it and deletes as before (defect 2, fix wave 2026-08-12).
        if (!msg.keepUndo) { undoStack.clear(); }
        // An open cell editor describes coordinates (ri/ci) against the OLD matrix -
        // `renderGrid` below replaces its `<td>` right from under it. Without this
        // closing, a later `blur` commits against coordinates that no longer exist in
        // the new matrix (defect 3, fix wave 2026-08-12). `cancelEdit` writes nothing -
        // it only clears the editor away.
        _cancelEditorBeforeRerender();
        // Individually fetched cell definitions are only valid for the data state at
        // which they were fetched - the host discards its own cell cache at the same
        // moment (`invalidatePicklistResolutions`). Two caches with different
        // lifetimes would be two truths.
        clearCellPicklistCache();
        clearSelection();
        showLoading(false);
        // Warm up the view list as soon as data is there (click test flameY3T1,
        // 2026-08-12: "the marking only appears on the second opening").
        //
        // Until then it was only fetched on `mousedown` on the dropdown - and that is
        // too late: the popup is already open at that moment, and Chromium does not
        // redraw an open `<select>` popup when the options change. On the first
        // opening, therefore, only the opened view was in there, and only on the second
        // the full list including `{}`.
        //
        // The savings measure from P5 (2026-06-11) is preserved in substance: the call
        // is still NOT in the open path but behind the first data packet, so it does not
        // compete with the expensive initial load. `ensureViewsFetched` is idempotent,
        // so repeating it on every further `cellData` costs nothing.
        ensureViewsFetched();
        getRefs().errorBanner.style.display = 'none';
        const matrix = msg.matrix;
        if (matrix.rowDims && matrix.rowDims.length) {
          state.rowDims = matrix.rowDims;
          state.colDims = matrix.colDims ?? state.colDims;
          // Title keys the cellset reports first: its slicer names the hierarchy.
          state.titleDims = titleKeysFor(state.dimensions, state.rowDims, state.colDims,
            [...Object.keys(matrix.titleAssignments ?? {}), ...state.titleDims], state.defaultHiers);
          // Adopt title assignments from the cellset so that the title selects show the
          // actual context element as placeholder (instead of "Select...").
          if (matrix.titleAssignments) {
            state.titleAssignments = { ...matrix.titleAssignments };
          }
          rebuildZones();
        }
        state.totalRows = matrix.totalRows ?? 0;
        state.numCols = matrix.numCols ?? 0;
        state.paged = !!matrix.paged;
        state._loadedRowMax = matrix.loadedRows ?? 0;
        state._cellPagePending = false;
        // P1-3 race protocol: this is the new "current" cellset generation —
        // any in-flight or late-arriving cellPage for a different cellset
        // (see 'cellPage' below) is now stale and must be discarded.
        state.cellsetId = matrix.paged ? (matrix.cellsetId ?? null) : null;
        // Base list per axis dimension: what this matrix actually HOLDS. A fresh
        // matrix means: everything visible again.
        //
        // It is read from the tuples, not from `dimSelections` - a freshly opened view
        // has no explicit selection at all, its axis comes from the saved subsets.
        // Only consulting the selection would mean: the first "Keep only" loads, and
        // only after some reload does it work without. If an axis cannot be explained
        // as a sequence of names (not a cross-product axis), it stays without a base
        // list and thus with the server. The local pivot uses the same derivation
        // (`axis.ts#moveDimToZone`).
        state.axisBaseNames = axisBaseNamesFromMatrix(matrix);
        renderGrid(matrix);
        // If a drill action was queued because we just promoted a server-side
        // filter to localFocus, apply it now using the fresh parents/children map.
        applyPendingDrillAction();
        break;
      }
      case 'cellPage': {
        if (!state.lastMatrix) break;
        // P1-3 race protocol: a refresh may have replaced the current cellset
        // while this page was in flight. Splicing it in by absolute row index
        // would corrupt the (now different) matrix — discard it instead.
        if (msg.cellsetId !== state.cellsetId) {
          state._cellPagePending = false;
          break;
        }
        // Scroll-driven loading - no user blur clears an open editor away, because
        // no focused element is being left here (defect 2, review fix wave
        // 2026-08-12). Coordinates do stay valid (merge at absolute offsets), but
        // without this closing `activeEditor` would stay non-null as soon as
        // `renderGrid` below replaces the `<td>`, and jam `startEdit` for the rest of
        // the session.
        _cancelEditorBeforeRerender();
        // Merge scroll-loaded page (absolute row,col keys) into the in-memory matrix.
        Object.assign(state.lastMatrix.values, msg.values);
        if (msg.rawValues) {
          if (!state.lastMatrix.rawValues) state.lastMatrix.rawValues = {};
          Object.assign(state.lastMatrix.rawValues, msg.rawValues);
        }
        if (!state.lastMatrix.cellFlags) state.lastMatrix.cellFlags = {};
        Object.assign(state.lastMatrix.cellFlags, msg.cellFlags);
        // NO cell picklists per page anymore (Task 15): the flat maps (attributes +
        // rule text) came with the first response and apply to every row; a picklist
        // query over the page would have the same cellset size as its data - 417 cells
        // measured at 12.5 s.
        // Merge scroll-loaded row headers at their absolute offset (paged structure).
        mergeRowPage(state.lastMatrix, msg.startRow, {
          rowElements: msg.rowElements, rowTuples: msg.rowTuples, rowLevels: msg.rowLevels,
        });
        // ADD the page's parent maps, do not replace them - the page only knows the
        // names of its own rows. A replacement would strip the already loaded rows of
        // their parent chains: they would indent flat and lose their collapse triangle.
        // Must come BEFORE `renderGrid`, which derives the indentation from it.
        state.lastMatrix.rowParents = mergeParentDelta(
          state.lastMatrix.rowParents ?? [], msg.rowParentsDelta,
        );
        state.lastMatrix.rowAllParents = mergeParentDelta(
          state.lastMatrix.rowAllParents ?? [], msg.rowAllParentsDelta,
        );
        state.lastMatrix.rowHasChildren = mergeParentDelta(
          state.lastMatrix.rowHasChildren ?? [], msg.rowHasChildrenDelta,
        );
        // Advance by the rows actually delivered (one rowElements entry per row);
        // the last short page then lands exactly on totalRows.
        state._loadedRowMax = nextLoadedRowMax(
          state._loadedRowMax, msg.startRow, msg.rowElements, CELL_PAGE_ROWS_CLIENT,
        );
        state._cellPagePending = false;
        // Re-render at current scroll position so new values appear.
        renderGrid(state.lastMatrix);
        break;
      }
      case 'axisChildren': {
        // The suspended collapse click is resumed here. Everything that does not
        // belong to the LATEST click is discarded: a second click (even on the same
        // element) has overwritten the entry, and a reply to a panel that has been
        // redrawn or closed in the meantime finds no entry at all.
        const pending = state.pendingChildLookup;
        if (!pending) { break; }
        if (pending.reqId !== msg.reqId
            || pending.dim !== msg.dimName
            || pending.elem !== msg.elem) { break; }
        state.pendingChildLookup = null;
        // The resume callback redraws if needed (`grid.ts`'s collapse logic, both
        // branches) and in doing so may replace an open `<td>` together with its
        // `<input>` - the same discard guard as for the other four arriving messages,
        // for the same reason (defect 2, review fix wave 2026-08-12): Chromium fires no
        // `blur` when the focused element is removed from the DOM, and `activeEditor`
        // would stay set.
        _cancelEditorBeforeRerender();
        pending.resume(msg.children, msg.descendants);
        break;
      }
      case 'error':
        // Drop a stale error from a superseded refresh/runInlineMdx (carries a
        // reqId that no longer matches) — else it clears the loading indicator
        // for the still-in-flight newer request and pops a spurious toast.
        // Unversioned errors (no reqId: subtree/fetchViews/cell paging/MDX-empty)
        // are always shown.
        if (msg.reqId !== undefined && !isCurrentResponse(msg.reqId, state._reqSent)) { break; }
        showLoading(false);
        showError(msg.message);
        state._cellPagePending = false;
        // Errors carry no dim name, so a failed element fetch can only be
        // released wholesale — otherwise that dropdown would never retry (M12).
        clearElementFetchPending();
        break;
      case 'cellsetExpired':
        // P1-6: host dropped the stale cellset (session-idle 404). The
        // client already holds the full current view state (row/col dims,
        // filters, title, inline MDX), so re-issue the same refresh the
        // Refresh button sends — this recreates the cellset host-side and
        // unwedges scrolling. Clear the pending flag first so doRefresh's
        // own state.loading guard isn't tripped by a leftover page-fetch flag.
        state._cellPagePending = false;
        doRefresh();
        break;
      case 'viewsData':
        populateViewSelect(msg.views ?? []);
        // If the Save-View modal is already open, apply the visibility default now.
        refreshViewSaveVisibility();
        break;
      case 'viewSwitched':
        undoStack.clear();
        // The host runs a view with format members as its plain MDX (so the
        // cells stay writable); applyOpenedView mirrors it as the inline MDX.
        applyOpenedView({
          viewName: msg.viewName ?? null, isPrivate: !!msg.isPrivate,
          suppressRows: !!msg.suppressRows, suppressCols: !!msg.suppressCols,
          isMdx: !!msg.isMdx, mdx: msg.mdx ?? null, titleSubsets: msg.titleSubsets,
        });
        // Discard any client-side modifications (focus, collapse flags,
        // header multi-selection) so re-selecting a view actually shows the
        // view's saved state instead of carrying over user tinkering.
        state.localFocus = null;
        state.collapsed = nameMap();
        state.headerSelection = {};
        state.headerSelectionAnchor = null;
        state.pendingDrillAction = null;
        applyViewAliases(msg.dimAliases);
        // axis dims sync from upcoming cellData
        break;
      case 'dimAliasDefs':
        state.aliasDefs[msg.dimName] = msg.aliases ?? [];
        refreshAliasSubmenu(msg.dimName);
        break;
      case 'dimAliasValues':
        // A reply for an alias that is no longer active belongs to no request.
        if (msg.alias !== state.dimAliases[msg.dimName]) { break; }
        state.aliasMaps[msg.dimName] = msg.values ?? {};
        // Title selects show alias labels too, and rebuildZones builds them,
        // not renderGrid.
        if (state.titleDims.includes(msg.dimName)) { rebuildZones(); }
        // Triggered by the host (the alias fetch runs during view load, not on a
        // click) - so an open editor would never receive the focus-leaving click that
        // would otherwise trigger a blur (defect 2, review fix wave 2026-08-12).
        _cancelEditorBeforeRerender();
        if (state.lastMatrix) { renderGrid(state.lastMatrix); }
        break;
      case 'setDimAlias':
        // Pushed from the dimension browser's "Apply" — mirror its alias choice.
        if (msg.alias) {
          state.dimAliases[msg.dimName] = msg.alias;
          delete state.aliasMaps[msg.dimName]; // stale (was for a previous alias)
          vscode.postMessage({ type: 'fetchDimAliasValues', dimName: msg.dimName, alias: msg.alias });
        } else {
          delete state.dimAliases[msg.dimName];
          delete state.aliasMaps[msg.dimName];
          if (state.titleDims.includes(msg.dimName)) { rebuildZones(); }
        }
        // Likewise host-pushed (dimension browser "Apply"), not click-focused
        // (defect 2, review fix wave 2026-08-12).
        _cancelEditorBeforeRerender();
        if (state.lastMatrix) { renderGrid(state.lastMatrix); }
        break;
      case 'viewSaveResult': {
        const refetch = handleViewSaveResult(msg);
        if (refetch) vscode.postMessage({ type: 'fetchViews' });
        break;
      }
      // A write can change totals and rule cells it does not repaint itself.
      // The refresh is sent from here, with the CURRENT layout and its own
      // reqId: sent by the host after the write, it overtook a newer pivot and
      // answered with the layout of the write (review 2026-11-02, C4).
      case 'cellEditResult':
        _onCellEditResult(msg);
        if (msg.ok) { doRefresh(undefined, true); }
        break;
      // A spread has no undo entry (it writes leaves the grid does not track), so
      // its refresh clears the stack: Ctrl+Z after it would otherwise replay an
      // older edit against coordinates the spread just changed.
      case 'spreadResult':
        _onSpreadResult(msg);
        if (msg.ok) { doRefresh(); }
        break;
      case 'spreadBulkResult':
        _onSpreadBulkResult(msg);
        if (msg.okCount > 0) { doRefresh(); }
        break;
      case 'cellEditBulkResult':
        _onCellEditBulkResult(msg);
        if (msg.okCount > 0) { doRefresh(undefined, true); }
        break;
      case 'picklistValues': {
        // Offer it to the paste path first (Task 12): a paste can resolve several
        // definitions at once, each via its own `reqId` - `resolvePastePicklistResponse`
        // returns `true` if the reply belonged to a running paste.
        if (resolvePastePicklistResponse(msg.reqId, msg.values)) { break; }
        // Otherwise the inline editor: discarded if the editor has meanwhile become a
        // different one (panel gone, other cell, Escape, redraw) - the reply would
        // otherwise belong to a cell that no longer exists, exactly the pattern that
        // `pendingChildLookup`/`axisChildren` above already enforce.
        if (!state.pendingPicklist || state.pendingPicklist.reqId !== msg.reqId) { break; }
        applyPicklistValues(msg.values);
        break;
      }
      case 'elementFormats':
        onElementFormats(msg);
        break;
      case 'elementFormatsWritten':
        onElementFormatsWritten(msg);
        break;
      case 'cellPicklistDef': {
        // Precursor to `picklistValues` (Task 15): the answer to "does EXACTLY THIS
        // cell have a picklist?". Same guard as above - a reply that no longer belongs
        // to the open round trip is discarded (`editor.ts` additionally checks the cell
        // and `td.isConnected`).
        if (!state.pendingCellPicklist || state.pendingCellPicklist.reqId !== msg.reqId) { break; }
        applyCellPicklistDef(msg.def);
        break;
      }
    }
  });
}

/** Every refresh is sent, also while one is loading: the newest reqId wins
 *  (`reqGuard`, and the host serializer skips superseded ones). Dropping it
 *  lost a title pick made during loading (review 2026-11-02, C5). */
export function doRefresh(suppressColsOverride?: boolean, keepUndo = false): void {
  if (state.rowDims.length === 0 || state.colDims.length === 0) {
    showError(L.needRowAndColDim);
    return;
  }
  // Header multi-selection (Ctrl/Shift pick) is transient — clear it on every
  // refresh so it doesn't linger highlighted over freshly loaded data.
  state.headerSelection = {};
  state.headerSelectionAnchor = null;
  const r = getRefs();
  showLoading(true);
  const titleAssignments: Record<string, string> = {};
  r.zoneTitles.querySelectorAll<HTMLSelectElement>('.title-elem-sel').forEach((s) => {
    if (s.dataset.dim && s.value) titleAssignments[s.dataset.dim] = s.value;
  });
  state.titleAssignments = titleAssignments;
  if (state.isMdxView) {
    let newMdx: string | null = null;
    if (state._mdxAxisDirty) {
      // A pivot rearranged the axes → rebuild the whole MDX so every dim sits in
      // exactly one place (rows/cols/slicer). rewriteMdxSlicer only patches WHERE
      // and would double-include a moved dim (rte 33).
      newMdx = buildPivotedMdx({
        cube: state.cubeName,
        rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims,
        dimSubsets: currentDimSubsetsAll(),
        titleAssignments,
        suppressRows: isToggleOn(r.chkSuppRows),
        suppressCols: suppressColsOverride !== undefined ? suppressColsOverride : isToggleOn(r.chkSuppCols),
      });
    } else if (hasAxisElementFilter(state.rowDims, state.colDims, state.dimSelections)) {
      newMdx = buildCurrentMdx();
    } else {
      const base = state.lastInlineMdx ?? state.originalMdx;
      if (base) { newMdx = rewriteMdxSlicer(base, state.titleAssignments); }
    }
    state._mdxAxisDirty = false;
    if (newMdx) {
      setInlineMdx(newMdx);
      vscode.postMessage({ type: 'runInlineMdx', mdx: newMdx, reqId: nextReqId(state), keepUndo });
      return;
    }
  }
  vscode.postMessage({
    type: 'refreshData',
    rowDims: state.rowDims, colDims: state.colDims,
    titleAssignments, titleOverride: state.titleOverride,
    existingViewName: state.existingViewName,
    existingViewIsPrivate: state.existingViewIsPrivate,
    dimSubsets: currentDimSubsetsAll(),
    suppressRows: isToggleOn(r.chkSuppRows),
    suppressCols: suppressColsOverride !== undefined ? suppressColsOverride : isToggleOn(r.chkSuppCols),
    reqId: nextReqId(state),
    keepUndo,
  });
}

export function wireButtons(): void {
  const r = getRefs();
  r.btnRefresh.addEventListener('click', () => doRefresh());

  // Axis swap sits on the divider between the row zone and the column zone.
  document.getElementById('btn-swap-axes')?.addEventListener('click', () => swapAxes());

  // Number-format toolbar: decimal separator toggle + more/fewer decimals.
  const sepBtn = document.getElementById('btn-dec-sep');
  const lessBtn = document.getElementById('btn-dec-less');
  const moreBtn = document.getElementById('btn-dec-more');
  // The button now holds an icon + a state span; only update the span so the
  // icon survives (falls back to the button itself if the span is missing).
  const syncSepLabel = () => {
    const label = sepBtn?.querySelector<HTMLElement>('.dec-sep-state') ?? sepBtn;
    if (label) { label.textContent = state.numFmt.comma ? '1,0' : '1.0'; }
  };
  syncSepLabel();
  sepBtn?.addEventListener('click', () => {
    state.numFmt.comma = !state.numFmt.comma;
    syncSepLabel();
    // Switches the display without re-rendering the numbers: without reformat,
    // `_fmtDisplay` only swaps the separators of the server representation.
    applyNumberFormat();
  });
  // The decimal buttons override every format, the modeller's and the MDX
  // FORMAT_STRING included — so the way back has to be visible while they do.
  const setReformat = (on: boolean) => {
    state.numFmt.reformat = on;
    syncResetButton();
    applyNumberFormat();
  };
  lessBtn?.addEventListener('click', () => {
    state.numFmt.decimals = Math.max(0, state.numFmt.decimals - 1);
    setReformat(true);
  });
  moreBtn?.addEventListener('click', () => {
    state.numFmt.decimals = Math.min(10, state.numFmt.decimals + 1);
    setReformat(true);
  });
  document.getElementById('btn-dec-reset')?.addEventListener('click', () => {
    state.displayFormats = nameMap();
    setReformat(false);
  });

  r.btnExport.addEventListener('click', () => {
    if (!state.lastMatrix) return;
    vscode.postMessage({
      type: 'exportCsv',
      csv: buildCsv(state.lastMatrix),
      cubeName: state.cubeName,
    });
  });

  const bindToggle = (btn: HTMLButtonElement, axis: 'rows' | 'cols') => {
    btn.addEventListener('click', () => {
      const on = !isToggleOn(btn);
      setToggleOn(btn, on);
      if (state.isMdxView) {
        // In MDX mode the suppress button maps to NON EMPTY on that axis:
        // rewrite the current MDX and re-execute so the toggle takes effect.
        const base = state.lastInlineMdx ?? state.originalMdx;
        if (base) {
          const next = setNonEmptyAxis(base, axis, on);
          setInlineMdx(next);
          vscode.postMessage({ type: 'runInlineMdx', mdx: next, reqId: nextReqId(state) });
        }
        return;
      }
      if (state.lastMatrix) { renderGrid(state.lastMatrix); }
      if (state.autoRefresh) { doRefresh(); }
    });
  };
  bindToggle(r.chkSuppRows, 'rows');
  bindToggle(r.chkSuppCols, 'cols');

  r.chkAutoRefresh.addEventListener('click', () => {
    const newVal = !isToggleOn(r.chkAutoRefresh);
    setToggleOn(r.chkAutoRefresh, newVal);
    state.autoRefresh = newVal;
  });

  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.classList && t.classList.contains('title-dim-select')) {
      // Mark the context as user-driven BEFORE any refresh: on a saved view the
      // host would otherwise re-execute the view server-side and snap the slicer
      // back to the view's own title member. Cleared when a view is (re)loaded.
      state.titleOverride = true;
      // Update the state IMMEDIATELY. `doRefresh` does read the selection fields
      // from the DOM anyway - but only if it runs at all. With auto-refresh switched
      // off, `state.titleAssignments` would otherwise stay on the old element, and
      // the next `rebuildZones()` (e.g. the `dimSelectionUpdate` reply from the
      // dimension browser) would repaint the selection field from exactly that - the
      // context selection just made was gone again (flameY3T1, 2026-08-18).
      const sel = t as HTMLSelectElement;
      if (sel.dataset.dim && sel.value) { state.titleAssignments[sel.dataset.dim] = sel.value; }
      if (state.autoRefresh) { doRefresh(); }
    }
  });
}

/**
 * DOM event bootstrap for the Dimension Browser webview.
 *
 * Hebel 9-K2b (2026-05-17): extracted from `index.ts`. Called once at
 * bootstrap through `initDomHandlers({ vscode })`; after that
 * all listeners hang on the DOM and share `state` + the submodule helpers.
 *
 * S2-12 (Review 2026-08-02): the nine blocks that used to stand here one
 * below the other have become files — a pure move, no behavior change.
 * What remains here is the wiring itself plus the three blocks that are too
 * small for a file of their own:
 *
 * 1. Toolbar (hier/refresh/attr-cube/dim-editor) ......... here
 * 2. MDX modal .......................................... `domMdxModal.ts`
 * 3. Filter bar + `_collectActiveFilters`/`_postFilterFetch` `domFilters.ts`
 * 4. Mark actions (show-all/keep/remove) ................ here
 * 5. Keyboard (Arrow, Esc, Ctrl+A/C/V, Del) ............. `domKeyboard.ts`
 * 6. Table body (dblclick + click delegate) ............. `domTableEvents.ts`
 * 7. Selection footer (confirm button) .................. here
 * 8. Drag & drop ........................................ `dragDrop.ts`
 * 9. Save subset modal .................................. `saveMode.ts`
 *
 * ⚠️ The ORDER of the `init*` calls below is the old registration
 * order of the blocks. Swapping them is only harmless where two
 * `initDragDrop` is therefore no coincidence (both wire up `table-body`).
 */

import { state } from './state';
import { _applySubsetChoice } from './subset';
import { selectionFromView } from './selectionSource';
import { currentAlias, switchHierarchy } from './viewPath';

import { initMdxModal } from './domMdxModal';
import { initKeyboard } from './domKeyboard';
import { initSaveModalHandlers } from './saveMode';
import type { WebviewToHost } from './protocol';

interface DomDeps {
  vscode: { postMessage: (msg: WebviewToHost) => void } | null;
}

export function initDomHandlers(deps: DomDeps): void {
  const vscode = deps.vscode;

  // ── 1) Toolbar ─────────────────────────────────────────── (no dim select
  // any more — every panel is bound to ONE dimension; dim switch = new
  // panel from the TM1 explorer. Hierarchy switch remains.)
  (document.getElementById('hier-select') as HTMLSelectElement).addEventListener('change', function (this: HTMLSelectElement) {
    // The switch is a new VIEW (`switchHierarchy`, which also moves
    // `state._currentHier`). An ignored switch puts the dropdown back.
    switchHierarchy(this.value);
    this.value = state._currentHier;
  });

  (document.getElementById('refresh-btn') as HTMLButtonElement).addEventListener('click', function () {
    // "Refresh" is the reset to the CHOSEN subset
    // (decision flameY3T1, 2026-08-23) — the button sits behind the
    // selection field, and that is the meaning it has there.
    // `_applySubsetChoice` covers both: the four default entries as
    // well as a real subset name.
    _applySubsetChoice();
  });


  (document.getElementById('open-attr-cube-btn') as HTMLButtonElement).addEventListener('click', function () {
    if (!vscode || !state._currentDim) { return; }
    vscode.postMessage({ type: 'openAttrCube', dimName: state._currentDim });
  });

  // Open the dimension editor on exactly what is on screen: current dim plus the
  // hierarchy picked in `hier-select` (falls back to the dim's default hier).
  (document.getElementById('open-dim-editor-btn') as HTMLButtonElement).addEventListener('click', function () {
    if (!vscode || !state._currentDim) { return; }
    vscode.postMessage({ type: 'openDimensionEditor', dimName: state._currentDim, hierName: state._currentHier });
  });

  // ── 2) MDX modal ─────────────────────────────────────────
  initMdxModal(vscode);

  // ── 4) Mark actions ──────────────────────────────────────
  // The origin of the marking decides the meaning: in the tree state a
  // marking is a filter (narrows `_subsetFilter`, tree stays tree). In the
  // list state the list IS already the selection — keep/remove acts directly
  // on `_manualRows`, position-exact via `markedListIndices` (duplicates stay
  // distinguishable that way). BOTH branches are written out completely in `keepMarkedRows`/
  // `removeMarkedRows` (listState.ts) and not inline here — otherwise they drift
  // apart again, as happened twice: first a depth reindex was missing, then
  // in the tree branches the `invalidateSubsetExpression()` that Del always
  // had (final review 2026-08-01, finding 1).
  // "All" is the only way back from deletions and drills (spec E7 — there is
  // deliberately no undo, Architect has none either). Always active, independent of
  // markings — unlike keep/remove/clear-marks below.

  // The same door as "All": a direct `renderTable()`, no fetch. Silent today,
  // because marking does not work in the new path yet and the buttons thus
  // stay disabled — the guard stands anyway, because the door exists
  // and plan 4 retrofits marking.


  // No Drill▾ in the bar (removed 2026-08-01): the same actions hang
  // on the context menu of the clicked row, where the row reference is unambiguous —
  // the toolbar variant had to guess it from marking/active row.

  // ── 5) Keyboard ──────────────────────────────────────────
  // No "reset filter" button any more (decision flameY3T1, 2026-08-26):
  // resetting is done with "All"/"Elements" in the row below — they
  // set the base anew and clear the layer stack along with it anyway. A
  // second way to the same act was only a second state.

  initKeyboard();

  // ── 6) Table body (dblclick + click delegate) ───────────

  // ── 7) Selection footer (confirm button, selection mode) ─
  (document.getElementById('btn-confirm') as HTMLButtonElement).addEventListener('click', function () {
    if (!vscode) { return; }
    // In the new path the selection comes from the VIEW; `null` means rejected
    // (incomplete window without expression capability — the message is
    // already shown). Then NOTHING may be posted: the panel closes on
    // `selectionConfirmed`, and a truncated list would then lie on the
    // axis without anyone seeing the loss.
    const selection = selectionFromView();
    if (!selection) { return; }
    vscode.postMessage({
      type: 'selectionConfirmed',
      selection,
      displayAlias: currentAlias(),
      hierName: state._currentHier,
    });
  });

  // ── 8) Drag & drop ──────────────────────────────────────
  // The order was dblclick, click, dragstart, dragend.

  // ── 9) Save subset modal ─────────────────────────────────
  initSaveModalHandlers(vscode);
}

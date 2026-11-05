/**
 * Fix wave (2026-08-12), Defect 3: `_onCellEditBulkResult` (webview-client
 * `messaging.ts`) used to call `_restorePendingPasteCells()` unconditionally,
 * BEFORE branching on `msg.ok`. The host only re-refreshes the grid
 * `if (okCount > 0)` (`src/commands/cubeViewer/messaging.ts#cellEditBulk`),
 * and that refresh can itself throw (network, deleted view, …) — so on a
 * successful-but-then-failed-refresh paste the grid rolled back to the OLD
 * values while the server was already holding the NEW ones. Stale numbers
 * shown as if they were current — silent, in a production OLAP cube.
 *
 * Fix wave 2 (2026-08-12), Defect 4: the fix above stopped restoring TEXT on
 * success, but left the `data-paste-pending`/`pendingOld`/`cell-pending`
 * markers standing forever on a successful paste (this file's OWN first test
 * used to assert exactly that as correct — `pendingOld` still `'111'` after a
 * `ok: true` result). Because the cleanup selector is global
 * (`td[data-paste-pending]`), a LATER unrelated FAILED paste swept those
 * leftovers up too and rewrote their text with the FIRST paste's pre-paste
 * value — stale numbers overwriting what the server actually holds. Marker
 * cleanup now runs on every result (success or failure); only the text
 * rollback stays failure-only. See `_clearPendingPasteMarkers`.
 *
 * Review (2026-08-12), Defect 4: on the SUCCESS path the `cell-pending` class
 * was stripped without calling `refreshTdClassByValue` — a cell pasted to
 * `0` kept its old numeric styling class (e.g. `cell-numeric`) instead of
 * `cell-zero` until the next unrelated repaint happened to pass over it.
 * `_clearPendingPasteMarkers` now calls it for every cleared cell on success.
 *
 * Exercises the real `wireMessageHandler` → `cellEditBulkResult` dispatch, not
 * an exported alias for the private handler, so this proves what production
 * actually runs. No jsdom in this project — `window`/`document` are hand-rolled
 * stubs; every OTHER webviewClient module `messaging.ts` imports is mocked to
 * a no-op, since this test is only about the paste-restore side effect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> }).__messageHandlers = [];
  (globalThis as unknown as { window?: unknown }).window = {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      if (type === 'message') {
        (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
          .__messageHandlers.push(handler);
      }
    },
  };
  (globalThis as unknown as { document?: unknown }).document = {
    querySelectorAll: () => [],
  };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(), showLoading: vi.fn(), showError: vi.fn(), showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(), setToggleOn: vi.fn(), isToggleOn: vi.fn(() => false),
}));
vi.mock('../webviewClient/cubeViewerMonaco/pureBridge', () => ({
  undoStack: { push: vi.fn(), pop: vi.fn(), isEmpty: vi.fn(() => true), clear: vi.fn(), size: vi.fn(() => 0), peek: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/axis', () => ({
  rebuildZones: vi.fn(), fillSelect: vi.fn(), currentDimSubsetsAll: vi.fn(() => ({})),
  clearElementFetchPending: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({ syncTitleCombo: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({ renderGrid: vi.fn(), applyNumberFormat: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/viewPicker', () => ({
  populateViewSelect: vi.fn(), resetViewsLoaded: vi.fn(), showOpenedView: vi.fn(), ensureViewsFetched: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/viewSave', () => ({
  handleViewSaveResult: vi.fn(), refreshViewSaveVisibility: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/csv', () => ({ buildCsv: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/selection', () => ({ clearSelection: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/contextMenu', () => ({
  applyPendingDrillAction: vi.fn(), refreshAliasSubmenu: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/pageMerge', () => ({
  mergeRowPage: vi.fn(), nextLoadedRowMax: vi.fn(), CELL_PAGE_ROWS_CLIENT: 300,
}));
vi.mock('../webviewClient/cubeViewerMonaco/parentMergePure', () => ({ mergeParentDelta: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxView', () => ({ openMdxModal: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxBuild', () => ({ buildCurrentMdx: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/gridPure', () => ({ axisBaseNamesFromMatrix: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxSlicerPure', () => ({ rewriteMdxSlicer: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxPivotPure', () => ({ buildPivotedMdx: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/pivotPure', () => ({ consumePendingRefresh: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/refreshBridge', () => ({ setRefreshFn: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxAxisFilterPure', () => ({ hasAxisElementFilter: vi.fn() }));
vi.mock('../mdx/nonEmptyAxisPure', () => ({ setNonEmptyAxis: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/reqGuard', () => ({
  nextReqId: vi.fn(() => 1), isCurrentResponse: vi.fn(() => true),
}));

import { wireMessageHandler } from '../webviewClient/cubeViewerMonaco/messaging';
import { refreshTdClassByValue } from '../webviewClient/cubeViewerMonaco/dom';

/** Fake `<td data-paste-pending>` — supports exactly what `_clearPendingPasteMarkers`
 *  touches. `document.querySelectorAll` is re-pointed per test to return these. */
function makePendingTd(oldValue: string): any {
  return {
    dataset: { pastePending: 'true', pendingOld: oldValue, pendingNew: '999', pendingCoords: '[]' },
    className: 'cell-numeric cell-pending',
    textContent: '999', // the optimistic value currently shown
  };
}

function dispatchCellEditBulkResult(msg: Record<string, unknown>): void {
  const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
    .__messageHandlers;
  handlers.forEach((h) => h({ data: { type: 'cellEditBulkResult', ...msg } }));
}

describe('webview messaging.ts — cellEditBulkResult only restores on failure (Defect 3)', () => {
  beforeEach(() => {
    (globalThis as unknown as { __messageHandlers: unknown[] }).__messageHandlers = [];
    vi.mocked(refreshTdClassByValue).mockClear();
    wireMessageHandler();
  });

  it('on success: keeps the new value AND clears the pending markers (Defect 4)', () => {
    const td = makePendingTd('111');
    (globalThis as unknown as { document: { querySelectorAll: () => any[] } }).document
      .querySelectorAll = () => [td];

    dispatchCellEditBulkResult({ ok: true, okCount: 2, totalCount: 2 });

    expect(td.textContent).toBe('999'); // still the NEW value, not rolled back to '111'
    // Markers MUST be gone — a later unrelated failed paste sweeps the global
    // `[data-paste-pending]` selector, and a leftover marker here would make it
    // stomp this cell's already-correct '999' back to this paste's '111'.
    expect(td.dataset.pastePending).toBeUndefined();
    expect(td.dataset.pendingOld).toBeUndefined();
    expect(td.dataset.pendingNew).toBeUndefined();
    expect(td.dataset.pendingCoords).toBeUndefined();
    expect(td.className).not.toMatch(/cell-pending/);
    // Review, Defect 4: the numeric styling class (e.g. `cell-zero` for a
    // pasted `0`) is only correct again once this runs — without it the cell
    // keeps whatever class the optimistic write left it with.
    expect(refreshTdClassByValue).toHaveBeenCalledWith(td, '999');
  });

  it('on failure: restores the old displayed value and clears the pending markers', () => {
    const td = makePendingTd('111');
    (globalThis as unknown as { document: { querySelectorAll: () => any[] } }).document
      .querySelectorAll = () => [td];

    dispatchCellEditBulkResult({
      ok: false, okCount: 1, totalCount: 3,
      firstError: { ri: 1, ci: 0, error: { kind: 'security', message: 'no' } },
    });

    expect(td.textContent).toBe('111'); // rolled back to the pre-paste value
    expect(td.dataset.pendingOld).toBeUndefined();
    expect(td.dataset.pendingNew).toBeUndefined();
    expect(td.className).not.toMatch(/cell-pending/);
  });
});

/**
 * Fix wave (2026-08-12), Defect 2: `_tryLocalPivot` (axis.ts) recomputed the
 * matrix for a new row/col layout but left `state.selectionAnchor`/
 * `state.selection` pointing at coordinates from the OLD layout. A Ctrl+V
 * right after a drag-pivot then wrote into cells the user never selected —
 * silent data corruption in a production OLAP cube.
 *
 * This exercises the real `moveDimToZone` → `_tryLocalPivot` → `renderGrid`
 * path (the pure pivot math is untouched and already covered by
 * `cubeViewerPivotMatrixPure.test.ts`; this test is only about the selection
 * side effect). No jsdom in this project — `document`/`window` are hand-rolled
 * stubs just complete enough for `rebuildZones()`'s chip-building
 * (`document.createElement` + `classList`/`dataset`/`appendChild`) and for
 * `selection.ts#updateSelectionReadout`'s `document.getElementById` call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  class FakeElement {
    tagName: string;
    className = '';
    draggable = false;
    textContent = '';
    title = '';
    dataset: Record<string, string> = {};
    children: FakeElement[] = [];
    classList = {
      add: (..._c: string[]) => {},
      remove: (..._c: string[]) => {},
      contains: (_c: string) => false,
      toggle: (_c: string, _v?: boolean) => {},
    };
    constructor(tagName: string) { this.tagName = tagName; }
    appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
    addEventListener(): void {}
    querySelectorAll(): FakeElement[] { return []; }
    querySelector(): null { return null; }
  }
  (globalThis as unknown as { window?: unknown }).window ??= {};
  (globalThis as unknown as { document?: unknown }).document = {
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: () => null,
  };
  (globalThis as unknown as { CSS?: unknown }).CSS ??= { escape: (s: string) => s };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn() },
}));

function makeZoneStub() {
  return {
    appendChild: vi.fn(),
    querySelectorAll: vi.fn(() => []),
  };
}

const refs = {
  zoneRows: makeZoneStub(),
  zoneCols: makeZoneStub(),
  zoneTitles: makeZoneStub(),
  gridContainer: { querySelectorAll: vi.fn(() => []) },
};

vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(() => refs),
  isToggleOn: vi.fn(() => false),
  showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({
  attachTitleCombo: vi.fn((sel: unknown) => sel),
  closeTitleCombo: vi.fn(),
}));

const { renderGridSpy, requestRefreshSpy } = vi.hoisted(() => ({
  renderGridSpy: vi.fn(),
  requestRefreshSpy: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({
  renderGrid: renderGridSpy,
}));
vi.mock('../webviewClient/cubeViewerMonaco/refreshBridge', () => ({
  requestRefresh: requestRefreshSpy,
  setRefreshFn: vi.fn(),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { moveDimToZone } from '../webviewClient/cubeViewerMonaco/axis';
import type { MatrixData } from '../webviewClient/cubeViewerMonaco/state';

/** Same shape as `cubeViewerPivotMatrixPure.test.ts#baseMatrix` — rows carry
 *  D1(A,B) × D2(X,Y), cols carry D3(P,Q); already proven there that moving
 *  D2 onto the columns axis (rowDims→['D1'], colDims→['D3','D2']) is a
 *  LOCAL pivot success (neither axis goes empty), not a server fallback. */
function baseMatrix(): MatrixData {
  const rowTuples = [['A', 'X'], ['A', 'Y'], ['B', 'X'], ['B', 'Y']];
  const colTuples = [['P'], ['Q']];
  const values: Record<string, string> = {};
  for (let ri = 0; ri < rowTuples.length; ri++) {
    for (let ci = 0; ci < colTuples.length; ci++) { values[`${ri},${ci}`] = `r${ri}c${ci}`; }
  }
  return {
    rowElements: rowTuples.map((t) => t.join(' / ')),
    colElements: colTuples.map((t) => t.join(' / ')),
    values,
    rowTuples, colTuples,
    rowDims: ['D1', 'D2'], colDims: ['D3'],
    numCols: 2,
  };
}

describe('axis.ts — _tryLocalPivot clears the selection anchor (Defect 2)', () => {
  beforeEach(() => {
    renderGridSpy.mockReset();
    requestRefreshSpy.mockReset();
    state.rowDims = ['D1', 'D2'];
    state.colDims = ['D3'];
    state.titleDims = [];
    state.titleAssignments = {};
    state.dimSelections = {};
    state.paged = false;
    state.isMdxView = false;
    state.lastMatrix = baseMatrix();
    // Selection made against the OLD (pre-pivot) matrix coordinates.
    state.selectionAnchor = { ri: 0, ci: 0 };
    state.selection = new Set(['0,0', '1,0']);
  });

  it('drops the stale anchor/selection when a drag-pivot succeeds locally', () => {
    moveDimToZone('D2', 'cols', null);

    // Confirms the LOCAL-pivot branch ran (not the server-refresh fallback) —
    // otherwise the assertions below would pass for the wrong reason (a full
    // reload also clears the selection, via the `cellData` handler).
    expect(renderGridSpy).toHaveBeenCalledTimes(1);
    expect(requestRefreshSpy).not.toHaveBeenCalled();

    expect(state.selectionAnchor).toBeNull();
    expect(state.selection.size).toBe(0);
  });

  it('actually reached the new axis layout (sanity: the pivot ran, not a no-op)', () => {
    moveDimToZone('D2', 'cols', null);
    expect(state.rowDims).toEqual(['D1']);
    expect(state.colDims).toEqual(['D3', 'D2']);
  });
});

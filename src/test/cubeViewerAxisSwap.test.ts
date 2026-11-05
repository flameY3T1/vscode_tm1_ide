/**
 * "Swap axes" (button on the divider between the row and column zone)
 * goes the same way as a zone change by dragging: `swapAxes` ->
 * `_tryLocalPivot` -> `renderGrid`, and only when that is not possible, via the
 * server. The pure swap calculation is covered by `cubeViewerPivotPure.test.ts`;
 * here it is about the effect on the state and about WHICH branch runs.
 *
 * No jsdom in the project — `document`/`window` are hand-built dummies,
 * just complete enough for `rebuildZones()`.
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
import { swapAxes } from '../webviewClient/cubeViewerMonaco/axis';
import type { MatrixData } from '../webviewClient/cubeViewerMonaco/state';

/** Rows carry D1(A,B) x D2(X,Y), columns D3(P,Q). */
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

describe('axis.ts — swapAxes', () => {
  beforeEach(() => {
    renderGridSpy.mockReset();
    requestRefreshSpy.mockReset();
    state.rowDims = ['D1', 'D2'];
    state.colDims = ['D3'];
    state.titleDims = ['D4'];
    state.titleAssignments = { D4: 'Ist' };
    state.dimSelections = {};
    state.paged = false;
    state.isMdxView = false;
    state._mdxAxisDirty = false;
    state.existingViewName = 'Monatsbericht';
    state.existingViewIsPrivate = true;
    state.lastMatrix = baseMatrix();
    state.selectionAnchor = { ri: 0, ci: 0 };
    state.selection = new Set(['0,0']);
  });

  it('swaps both axes and keeps the order within each', () => {
    swapAxes();
    expect(state.rowDims).toEqual(['D3']);
    expect(state.colDims).toEqual(['D1', 'D2']);
  });

  it('re-arranges the loaded values instead of asking the server', () => {
    swapAxes();
    expect(renderGridSpy).toHaveBeenCalledTimes(1);
    expect(requestRefreshSpy).not.toHaveBeenCalled();
  });

  it('leaves the context dimensions untouched', () => {
    swapAxes();
    expect(state.titleDims).toEqual(['D4']);
    expect(state.titleAssignments).toEqual({ D4: 'Ist' });
  });

  it('leaves saved-view mode — the layout is no longer the stored one', () => {
    swapAxes();
    expect(state.existingViewName).toBeNull();
    expect(state.existingViewIsPrivate).toBe(false);
  });

  it('drops the selection anchor: the same coordinates mean something else now', () => {
    swapAxes();
    expect(state.selectionAnchor).toBeNull();
    expect(state.selection.size).toBe(0);
  });

  it('falls back to the server when the grid pages cells', () => {
    state.paged = true;
    swapAxes();
    expect(renderGridSpy).not.toHaveBeenCalled();
    expect(requestRefreshSpy).toHaveBeenCalledWith();
    // Layout is already swapped, so the reload matches what the zones show.
    expect(state.rowDims).toEqual(['D3']);
  });

  it('marks the MDX as dirty so the server path rebuilds the whole expression', () => {
    state.isMdxView = true;
    state.paged = true;   // force the server branch, which must not clear the mark
    swapAxes();
    expect(state._mdxAxisDirty).toBe(true);
  });

  it('does nothing at all when both axes are empty', () => {
    state.rowDims = [];
    state.colDims = [];
    swapAxes();
    expect(renderGridSpy).not.toHaveBeenCalled();
    expect(requestRefreshSpy).not.toHaveBeenCalled();
    expect(state.existingViewName).toBe('Monatsbericht');
  });
});

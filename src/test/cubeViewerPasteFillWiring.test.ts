/**
 * Wiring of the fill: `applyPaste` must pass the SELECTED cells to
 * `planPaste` — otherwise the new rule ("one copied value fills
 * the whole selection") would stay stuck in the pure logic and the grid would
 * still only get the anchor cell.
 *
 * No jsdom in this project — `document`/`window` as stubs, same
 * pattern as `cubeViewerPastePicklistFixRound1.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { window?: unknown }).window = { addEventListener: () => { /* noop */ } };
  (globalThis as unknown as { document?: unknown }).document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => { /* noop */ },
  };
});

const { bulkSpy, toastSpy } = vi.hoisted(() => ({ bulkSpy: vi.fn(), toastSpy: vi.fn() }));

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({ vscode: { postMessage: vi.fn() } }));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  showToast: toastSpy, focusIsInput: vi.fn(() => false),
  getRefs: vi.fn(() => ({})), showLoading: vi.fn(), showError: vi.fn(),
  refreshTdClassByValue: vi.fn(), setToggleOn: vi.fn(), isToggleOn: vi.fn(() => false),
  getTitleAssignments: vi.fn(() => ({})),
}));
vi.mock('../webviewClient/cubeViewerMonaco/bulkWrite', () => ({
  sendBulkCellWrite: bulkSpy, lastBulkKind: vi.fn(() => 'paste'),
}));
vi.mock('../webviewClient/cubeViewerMonaco/actions', () => ({
  getTitleAssignments: vi.fn(() => ({})), sendResolvePicklist: vi.fn(),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { applyPaste } from '../webviewClient/cubeViewerMonaco/paste';

function seed(): void {
  state.dimensions = ['Region', 'Month'];
  state.rowDims = ['Region'];
  state.colDims = ['Month'];
  state.renderedRowIdx = [0, 1, 2];
  state.renderedColIdx = [0];
  state.selectionAnchor = { ri: 0, ci: 0 };
  state.lastMatrix = {
    rowElements: ['North', 'South', 'West'], colElements: ['Jan'],
    values: {}, rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [['North'], ['South'], ['West']], colTuples: [['Jan']],
    cellFlags: {},
  } as never;
}

describe('applyPaste — one value onto several selected rows', () => {
  beforeEach(() => {
    bulkSpy.mockReset();
    toastSpy.mockReset();
    seed();
  });

  it('writes into every selected row, not only into the anchor row', async () => {
    state.selection = new Set(['0,0', '1,0', '2,0']);
    await applyPaste('42');
    expect(bulkSpy).toHaveBeenCalledTimes(1);
    expect(bulkSpy.mock.calls[0][0]).toBe('paste');
    expect(bulkSpy.mock.calls[0][1]).toEqual([
      { ri: 0, ci: 0, value: 42 },
      { ri: 1, ci: 0, value: 42 },
      { ri: 2, ci: 0, value: 42 },
    ]);
  });

  it('without a multi-selection it stays with the anchor cell', async () => {
    state.selection = new Set(['1,0']);
    state.selectionAnchor = { ri: 1, ci: 0 };
    await applyPaste('42');
    expect(bulkSpy.mock.calls[0][1]).toEqual([{ ri: 1, ci: 0, value: 42 }]);
  });
});

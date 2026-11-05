/**
 * The restored contract of the input box (revert 2026-08-13).
 *
 * The input box is seeded from the RAW VALUE (`rawValues`, always
 * dot-decimal) and `parseEditedValue` reads exactly this notation —
 * regardless of which separators the DISPLAY is currently using. The
 * attempt to read typed numbers in the display convention required telling a
 * group separator apart from a decimal separator; none of the four
 * heuristics could do that reliably, twice a thousand times the value was written into the
 * cube. This test pins down the rollback, so that it does not drift back
 * unnoticed.
 *
 * The ONE place where the display convention really comes in as text
 * remains: pasted text from the clipboard (`planPaste` →
 * `normalizeDecimal`) — last case below.
 *
 * No jsdom in the project — `document`/`window` are hand stubs, just
 * complete enough for `startEdit`/`commitEdit`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  class FakeInput {
    type = '';
    value = '';
    size = 0;
    style: { textAlign: string } = { textAlign: '' };
    onkeydown: ((ev: unknown) => void) | null = null;
    onblur: (() => void) | null = null;
    focus(): void {}
    select(): void {}
  }
  (globalThis as unknown as { window?: unknown }).window = {
    addEventListener: () => {},
  };
  (globalThis as unknown as { document?: unknown }).document = {
    createElement: (_tag: string) => new FakeInput(),
    querySelector: () => null,
    activeElement: null,
  };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(),
  showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(),
}));

const { sendCellEditSpy } = vi.hoisted(() => ({ sendCellEditSpy: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/actions', () => ({
  sendCellEdit: sendCellEditSpy,
  sendSpread: vi.fn(),
  getTitleAssignments: vi.fn(() => ({})),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { startEdit, cancelEdit } from '../webviewClient/cubeViewerMonaco/editor';
import { planPaste } from '../webviewClient/cubeViewerMonaco/pasteGridPure';

/** Minimal `<td>` substitute: dataset + classList.contains + appendChild recording
 *  (so that the test gets at the `<input>` that `startEdit` appends). */
function makeTd(ri: number, ci: number, textContent: string): { td: any; getInput: () => any } {
  const children: any[] = [];
  const td: any = {
    dataset: { ri: String(ri), ci: String(ci) },
    className: 'cell-numeric',
    textContent,
    innerHTML: '',
    classList: { contains: () => false },
    appendChild: (c: unknown) => { children.push(c); return c; },
  };
  return { td, getInput: () => children[children.length - 1] };
}

/** Production-like situation: `values` carries TM1's display (comma convention),
 *  `rawValues` the full raw value in dot notation — the two must
 *  precisely NOT be the same string, otherwise the test shows nothing. */
function seedMatrix(rawValue: string, displayValue: string): void {
  state.dimensions = ['D1', 'D2'];
  state.lastMatrix = {
    rowElements: ['A'], colElements: ['B'],
    values: { '0,0': displayValue }, rawValues: { '0,0': rawValue },
    rowTuples: [['A']], colTuples: [['B']],
    rowDims: ['D1'], colDims: ['D2'],
    cellFlags: {},
  } as any;
}

describe('cube viewer editor — raw value seed and dot decimal on write (revert contract)', () => {
  beforeEach(() => {
    sendCellEditSpy.mockReset();
    // Display convention comma — exactly the mode in which the removed
    // separator guessing struck.
    state.numFmt = { comma: true, decimals: 2, reformat: false };
  });
  // `activeEditor` is a module-private singleton: without a reset, a test
  // that does not commit turns the `startEdit` of the next one into a no-op.
  afterEach(() => { cancelEdit(); });

  it('seeds the input box with the RAW VALUE (dot-decimal), not with the display', () => {
    seedMatrix('1234.5', '1.234,50');
    const { td, getInput } = makeTd(0, 0, '1.234,50');
    startEdit(td);
    expect(getInput().value).toBe('1234.5');
  });

  it('Enter without a change writes nothing', () => {
    seedMatrix('1234.5', '1.234,50');
    const { td, getInput } = makeTd(0, 0, '1.234,50');
    startEdit(td);
    // Via the real Enter path that `startEdit` has wired.
    getInput().onkeydown!({ key: 'Enter', preventDefault: () => {} });
    expect(sendCellEditSpy).not.toHaveBeenCalled();
  });

  it('changed to "1234.6" writes numeric 1234.6 (no ×1000, no string)', () => {
    seedMatrix('1234.5', '1.234,50');
    const { td, getInput } = makeTd(0, 0, '1.234,50');
    startEdit(td);
    const input = getInput();
    input.value = '1234.6';
    input.onkeydown!({ key: 'Enter', preventDefault: () => {} });
    expect(sendCellEditSpy).toHaveBeenCalledTimes(1);
    expect(sendCellEditSpy.mock.calls[0][0].value).toBe(1234.6);
  });

  it('pasting "1234,50" in comma mode still writes numeric 1234.5', () => {
    const plan = planPaste({
      grid: [['1234,50']],
      anchor: { ri: 0, ci: 0 },
      rowIndex: [0], colIndex: [0],
      cellFlags: {},
      commaDecimal: true,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.targets).toEqual([{ ri: 0, ci: 0, value: 1234.5 }]);
  });
});

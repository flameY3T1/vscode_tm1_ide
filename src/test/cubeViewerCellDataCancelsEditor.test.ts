/**
 * Fix wave 2 (2026-08-12), Defect 2 + Defect 3. Extended by the Review pass
 * (2026-08-12) for Defect 2's three additional wedge sites and Defect 3's
 * ordering gap.
 *
 * Since a previous wave made every confirmed single-cell edit trigger a
 * refresh, an incoming `cellData` after that write used to do two bad things:
 *
 * Defect 2: `cellData`'s FIRST statement was an unconditional `undoStack.clear()`
 * — wiping the very undo entry the edit's `cellEditResult` handler had just
 * pushed. Ctrl+Z stopped working for single-cell edits. Fix: the host now marks
 * a write-triggered refresh with `keepUndo: true` on the `cellData` message
 * (`view.ts#refreshCurrentLayout`); the webview only clears the stack when that
 * flag is absent (a real view switch / user refresh still clears it).
 *
 * Defect 3: nothing cancelled an OPEN cell editor before `renderGrid` replaced
 * the `<td>` its `<input>` lives in — a stale `blur` could then commit against
 * `ri`/`ci` coordinates the new matrix no longer has (wrong-cell write), or
 * never fire at all and wedge `startEdit`'s `if (activeEditor) return` for the
 * rest of the session. Fix: `cellData` now calls `cancelEdit()` (editor.ts)
 * before `renderGrid` — closes the editor WITHOUT writing.
 *
 * Review, Defect 2 (fix wave 3): three MORE handlers re-render/repaint from
 * incoming host data while a cell editor can be open — `cellPage` (scroll
 * paging: nothing blurs a focused input on scroll), `dimAliasValues` and
 * `setDimAlias` (host-pushed; the alias fetch runs on view load, not on a
 * click that would have focus-blurred the editor away). All three now share
 * the exact same guard as `cellData` (`messaging.ts#_cancelEditorBeforeRerender`).
 *
 * Review, Defect 2 (fourth pass, 2026-08-13): a FIFTH handler had the same
 * wedge — `axisChildren` resumes a paused drill click whose closure
 * (`grid.ts`, both branches) re-renders without the guard. No user blur
 * happens here either: a click on the collapse/expand triangle does not leave
 * a focused `<input>`.
 *
 * Review, Defect 3: the original version of this file mocked `renderGrid` to
 * a no-op, which proves `cancelEdit()` was CALLED but not that it ran BEFORE
 * `renderGrid` replaced the grid — a reordering would have passed silently.
 * Both the (real) `cancelEdit` and the (mocked) `renderGrid` now push into a
 * shared `callOrder` array so the sequence itself is asserted.
 *
 * Real `editor.ts` runs here (not mocked, only `cancelEdit` wrapped to also
 * record its call — see the partial `vi.mock` below, which still delegates to
 * the real implementation) so `startEdit`/`cancelEdit`'s actual module-private
 * `activeEditor` state is exercised — a mock could not show a genuinely
 * wedged/dangling editor. Every module `messaging.ts` and `editor.ts`
 * transitively pull in that talks to the extension host or touches DOM beyond
 * the hand-rolled stubs below is mocked to a no-op. No jsdom in this project.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Shared order-tracking array (Defect 3, review) — the `editor` and `grid`
 *  mocks below both push into it, so tests can assert cancel-before-render
 *  instead of merely cancel-was-called. Must come from `vi.hoisted` because
 *  the `vi.mock` factories that reference it are themselves hoisted above
 *  normal module code. */
const { callOrder } = vi.hoisted(() => ({ callOrder: [] as string[] }));

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
  (globalThis as unknown as { __FakeInput?: unknown }).__FakeInput = FakeInput;
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
    createElement: (_tag: string) => new FakeInput(),
    querySelectorAll: () => [],
    querySelector: () => null,
    activeElement: null,
  };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn(), setState: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(() => ({ errorBanner: { style: { display: '' } } })),
  showLoading: vi.fn(), showError: vi.fn(), showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(), setToggleOn: vi.fn(), isToggleOn: vi.fn(() => false),
}));
const { undoClearSpy } = vi.hoisted(() => ({ undoClearSpy: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/pureBridge', () => ({
  undoStack: { push: vi.fn(), pop: vi.fn(), isEmpty: vi.fn(() => true), clear: undoClearSpy, size: vi.fn(() => 0), peek: vi.fn() },
  buildCoordinates: vi.fn(() => ['A', 'B']),
  parseEditedValue: vi.fn((s: string) => ({ kind: 'numeric', payload: Number(s) })),
  normalizeDecimal: vi.fn((s: string) => s),
  parseSpreadToken: vi.fn(() => null),
  // Since Task 15, `startEdit` queries the definition of EVERY cell (before, only
  // of the one with an arrow) — `null` here means "no picklist", the free-text path
  // this file is about.
  pickDefinitionForCell: vi.fn(() => null),
}));
vi.mock('../webviewClient/cubeViewerMonaco/axis', () => ({
  rebuildZones: vi.fn(), fillSelect: vi.fn(), currentDimSubsetsAll: vi.fn(() => ({})),
  clearElementFetchPending: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({ syncTitleCombo: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({
  renderGrid: vi.fn(() => { callOrder.push('renderGrid'); }),
  applyNumberFormat: vi.fn(),
}));
// Partial mock (Defect 3, review): `cancelEdit` is wrapped to record its call
// in `callOrder`, but still DELEGATES to the real implementation — every other
// export (notably `startEdit`) stays the genuine `editor.ts` code, so the
// wedge/cancel behavior under test is real, not simulated.
vi.mock('../webviewClient/cubeViewerMonaco/editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../webviewClient/cubeViewerMonaco/editor')>();
  return {
    ...actual,
    cancelEdit: vi.fn((...args: Parameters<typeof actual.cancelEdit>) => {
      callOrder.push('cancelEdit');
      return actual.cancelEdit(...args);
    }),
  };
});
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
vi.mock('../webviewClient/cubeViewerMonaco/gridPure', () => ({ axisBaseNamesFromMatrix: vi.fn(() => ({})) }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxSlicerPure', () => ({ rewriteMdxSlicer: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxPivotPure', () => ({ buildPivotedMdx: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/pivotPure', () => ({ consumePendingRefresh: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/refreshBridge', () => ({ setRefreshFn: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxAxisFilterPure', () => ({ hasAxisElementFilter: vi.fn() }));
vi.mock('../mdx/nonEmptyAxisPure', () => ({ setNonEmptyAxis: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/reqGuard', () => ({
  nextReqId: vi.fn(() => 1), isCurrentResponse: vi.fn(() => true),
}));
const { sendCellEditSpy } = vi.hoisted(() => ({ sendCellEditSpy: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/actions', () => ({
  sendCellEdit: sendCellEditSpy, sendSpread: vi.fn(), getTitleAssignments: vi.fn(() => ({})),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { wireMessageHandler } from '../webviewClient/cubeViewerMonaco/messaging';
import { startEdit, cancelEdit } from '../webviewClient/cubeViewerMonaco/editor';

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

function dispatchCellData(msg: Record<string, unknown>): void {
  const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
    .__messageHandlers;
  handlers.forEach((h) => h({ data: { type: 'cellData', matrix: {}, ...msg } }));
}

describe('webview messaging.ts — cellData vs. undo stack and open editor (Fix wave 2)', () => {
  beforeEach(() => {
    (globalThis as unknown as { __messageHandlers: unknown[] }).__messageHandlers = [];
    undoClearSpy.mockReset();
    sendCellEditSpy.mockReset();
    callOrder.length = 0;
    wireMessageHandler();
    state.dimensions = ['D1', 'D2'];
    // No entry for '0,0' in values/rawValues — `startEdit` then seeds from the
    // `<td>`'s own text, exactly like a cell the matrix doesn't cover.
    state.lastMatrix = { values: {}, rawValues: {}, cellFlags: {} } as any;
  });
  // `activeEditor` is a module-private singleton — several tests below end
  // with a freshly (re)opened editor to prove the wedge is gone. Without this,
  // that leftover editor wedges the NEXT test's very first `startEdit`.
  afterEach(() => { cancelEdit(); });

  it('Defect 2: a write-triggered refresh (keepUndo: true) does NOT clear the undo stack', () => {
    dispatchCellData({ keepUndo: true });
    expect(undoClearSpy).not.toHaveBeenCalled();
  });

  it('Defect 2: a genuine refresh without the marker still clears the undo stack', () => {
    dispatchCellData({});
    expect(undoClearSpy).toHaveBeenCalledTimes(1);
  });

  it('Defect 3: an incoming cellData cancels an open editor without writing', () => {
    const { td, getInput } = makeTd(0, 0, '42');
    startEdit(td);
    const input = getInput();
    expect(input).toBeDefined(); // sanity: editor really opened

    // Mid-edit — typed a new value, but neither Enter nor blur has fired yet.
    input.value = '99';

    dispatchCellData({ keepUndo: true });

    // Cancelled, not committed: no write went out, and the cell shows its
    // original text again — not the mid-typed '99'.
    expect(sendCellEditSpy).not.toHaveBeenCalled();
    expect(td.textContent).toBe('42');

    // A stale late blur on the now-detached input must be a no-op — proves the
    // editor is genuinely closed (activeEditor === null), not just visually
    // reset, so `startEdit` on a fresh `<td>` isn't wedged for the rest of the
    // session by `if (activeEditor) return`.
    input.onblur?.();
    expect(sendCellEditSpy).not.toHaveBeenCalled();

    const { td: td2, getInput: getInput2 } = makeTd(1, 1, '7');
    startEdit(td2);
    expect(getInput2()).toBeDefined(); // editor opens again — not wedged
  });

  it('Defect 3 (review): cancelEdit runs BEFORE renderGrid, not merely at some point', () => {
    const { td } = makeTd(0, 0, '42');
    startEdit(td);

    dispatchCellData({ keepUndo: true });

    // A reordering (renderGrid first, cancelEdit second) would still satisfy
    // "cancelEdit was called" but corrupts the read that follows — this is
    // the assertion the old no-op-renderGrid mock could not make.
    expect(callOrder).toEqual(['cancelEdit', 'renderGrid']);
  });

  /**
   * Review, Defect 2: three more handlers re-render/repaint while an editor
   * may be open — none of them received a blur to close it first. Same
   * assertions as the `cellData` case above (no write, editor genuinely
   * closed, cancel runs before the repaint), one per handler.
   */
  function openEditorAt00(): { td: any; input: any } {
    const { td, getInput } = makeTd(0, 0, '42');
    startEdit(td);
    return { td, input: getInput() };
  }

  function assertEditorClosedWithoutWrite(td: any, input: any): void {
    expect(sendCellEditSpy).not.toHaveBeenCalled();
    expect(td.textContent).toBe('42');
    input.onblur?.(); // stale late blur on the detached input: must be a no-op
    expect(sendCellEditSpy).not.toHaveBeenCalled();
    const { td: td2, getInput: getInput2 } = makeTd(1, 1, '7');
    startEdit(td2);
    expect(getInput2()).toBeDefined(); // not wedged — editor opens again
  }

  it('Defect 2 (review): cellPage cancels an open editor before merging the page', () => {
    const { td, input } = openEditorAt00();
    input.value = '99';
    state.cellsetId = 'cs-1';
    const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
      .__messageHandlers;
    handlers.forEach((h) => h({
      data: {
        type: 'cellPage', startRow: 0, cellsetId: 'cs-1',
        values: {}, cellFlags: {}, rowElements: [],
      },
    }));
    assertEditorClosedWithoutWrite(td, input);
    expect(callOrder).toEqual(['cancelEdit', 'renderGrid']);
  });

  it('Defect 2 (review): dimAliasValues cancels an open editor before re-rendering', () => {
    // The reply must be for the active alias (C6), else it is dropped before the
    // re-render. Set here, not left behind by the setDimAlias test (random order).
    state.dimAliases = { D1: 'Alias1' };
    const { td, input } = openEditorAt00();
    input.value = '99';
    const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
      .__messageHandlers;
    handlers.forEach((h) => h({
      data: { type: 'dimAliasValues', dimName: 'D1', alias: 'Alias1', values: {} },
    }));
    assertEditorClosedWithoutWrite(td, input);
    expect(callOrder).toEqual(['cancelEdit', 'renderGrid']);
  });

  it('Defect 2 (review): setDimAlias cancels an open editor before re-rendering', () => {
    const { td, input } = openEditorAt00();
    input.value = '99';
    const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
      .__messageHandlers;
    handlers.forEach((h) => h({
      data: { type: 'setDimAlias', dimName: 'D1', alias: 'Alias1' },
    }));
    assertEditorClosedWithoutWrite(td, input);
    expect(callOrder).toEqual(['cancelEdit', 'renderGrid']);
  });

  /**
   * Review, Defect 2 (fourth pass, 2026-08-13): a FIFTH handler shares the
   * wedge — `axisChildren` resumes a paused drill click. The real closure
   * that `pending.resume` invokes lives in `grid.ts` (mocked wholesale here),
   * so this stand-in `resume` pushes into `callOrder` itself — exercising the
   * exact thing under test, `messaging.ts`'s own call ordering, without
   * depending on `grid.ts` internals.
   */
  it('Defect 2 (fourth pass): axisChildren cancels an open editor before resuming the click', () => {
    const { td, input } = openEditorAt00();
    input.value = '99';
    state.pendingChildLookup = {
      dim: 'D1', elem: 'E1', occ: -1, mode: 'expand', reqId: 1,
      resume: vi.fn(() => { callOrder.push('renderGrid'); }),
    };
    const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
      .__messageHandlers;
    handlers.forEach((h) => h({
      data: {
        type: 'axisChildren', reqId: 1, dimName: 'D1', elem: 'E1', children: [], descendants: [],
      },
    }));
    assertEditorClosedWithoutWrite(td, input);
    expect(callOrder).toEqual(['cancelEdit', 'renderGrid']);
  });
});

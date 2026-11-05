/**
 * Fix round 1 (2026-08-13) on Task 10 (picklist dropdown editor), Finding 3.
 * Extended in Fix round 2 for Finding 4 (bridge coverage) and the widened
 * Finding 2 (type-ahead / ArrowLeft also fire `change` in Chromium).
 *
 * The review that shipped `applyPicklistValues`'s two-layer guard (reqId in
 * `messaging.ts`, (ri,ci)+`pending` in `editor.ts`) only exercised the trivial
 * pure function (`picklistEditorPure.test.ts`). Nothing here covered the race,
 * the `null` fallback, or the guard itself — exactly what Finding 1 (the
 * detached-`<td>` wedge) and Finding 2 (arrow-key writes) slipped through.
 *
 * Real `editor.ts`, real `messaging.ts`, AND (since Fix round 2) real
 * `grid.ts` run here (not mocked) so the genuine module-private
 * `activeEditor`/`state.pendingPicklist` state is exercised — a mock could
 * not show a genuinely wedged/dangling editor, same reasoning as the
 * neighbouring `cubeViewerCellDataCancelsEditor.test.ts`, whose hand-rolled
 * `document`/`window`/`<td>` stubs this file follows (no jsdom in this
 * project). `grid.ts` was mocked in Fix round 1 — that hid the exact defect
 * Finding 4 named: `renderGrid`'s call to `cancelPendingPicklistBeforeRerender`
 * was never exercised, so the choke point could be deleted without a test
 * failing. None of the OTHER tests below ever dispatch a message that makes
 * `messaging.ts` call `renderGrid` with a real matrix, so using the real
 * module here does not need the full render machinery (DOM refs etc.) —
 * only the Finding-4 test below calls it, with `matrix: null`, which returns
 * right after the guard call. Extended (round 1) with a tag-aware
 * `createElement` and a `classList` backed by a real `Set`, because these
 * tests need to tell an `<input>` apart from a `<select>` and need
 * `td.isConnected` to be independently flippable (the neighbouring file
 * never builds a `<select>` and never detaches a `<td>`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.hoisted(() => {
  class FakeInput {
    tagName = 'INPUT';
    type = '';
    value = '';
    size = 0;
    style: { textAlign: string } = { textAlign: '' };
    onkeydown: ((ev: unknown) => void) | null = null;
    onblur: (() => void) | null = null;
    focus(): void {}
    select(): void {}
  }
  class FakeOption {
    tagName = 'OPTION';
    value = '';
    textContent = '';
  }
  class FakeSelect {
    tagName = 'SELECT';
    value = '';
    children: FakeOption[] = [];
    onkeydown: ((ev: unknown) => void) | null = null;
    onblur: (() => void) | null = null;
    onchange: (() => void) | null = null;
    onmousedown: (() => void) | null = null;
    focus(): void {}
    appendChild(o: unknown): unknown { this.children.push(o as FakeOption); return o; }
  }
  (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> }).__messageHandlers = [];
  // `editor.ts` reads `window.__l10n` once at module load (`const L = getL10n()`)
  // — without this, the foreign-value label falls back to the raw key
  // (`fmt`'s missing-key fallback), which has no `{0}` to substitute.
  (globalThis as unknown as { __l10n?: Record<string, string> }).__l10n = {
    picklistForeignValue: '{0} (not in list)',
  };
  (globalThis as unknown as { window?: unknown }).window = {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      if (type === 'message') {
        (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
          .__messageHandlers.push(handler);
      }
    },
  };
  (globalThis as unknown as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === 'select') return new FakeSelect();
      if (tag === 'option') return new FakeOption();
      return new FakeInput();
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    activeElement: null,
  };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(() => ({ errorBanner: { style: { display: '' } } })),
  showLoading: vi.fn(), showError: vi.fn(), showToast: vi.fn(),
  refreshTdClassByValue: vi.fn(), setToggleOn: vi.fn(), isToggleOn: vi.fn(() => false),
}));
vi.mock('../webviewClient/cubeViewerMonaco/pureBridge', () => ({
  undoStack: { push: vi.fn(), pop: vi.fn(), isEmpty: vi.fn(() => true), clear: vi.fn(), size: vi.fn(() => 0), peek: vi.fn() },
  buildCoordinates: vi.fn(() => ['A', 'B']),
  parseEditedValue: vi.fn((s: string) => ({ kind: 'string', payload: s })),
  normalizeDecimal: vi.fn((s: string) => s),
  parseSpreadToken: vi.fn(() => null),
  // Non-null: without this, `startEdit` would never take the picklist branch
  // and none of the tests below would exercise the round trip under test.
  pickDefinitionForCell: vi.fn(() => 'PICKDEF'),
}));
vi.mock('../webviewClient/cubeViewerMonaco/axis', () => ({
  rebuildZones: vi.fn(), fillSelect: vi.fn(), currentDimSubsetsAll: vi.fn(() => ({})),
  clearElementFetchPending: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({ syncTitleCombo: vi.fn() }));
// `grid.ts` runs FOR REAL (Fix round 2, Finding 4) — see file-header comment.
// It transitively needs `applyNumberFormat`'s cellPage caller to exist, but
// nothing here dispatches `cellPage`/`cellData`, so only its exports matter.
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
const { sendCellEditSpy, sendResolvePicklistSpy } = vi.hoisted(() => ({
  sendCellEditSpy: vi.fn(), sendResolvePicklistSpy: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/actions', () => ({
  sendCellEdit: sendCellEditSpy, sendSpread: vi.fn(), sendResolvePicklist: sendResolvePicklistSpy,
  getTitleAssignments: vi.fn(() => ({})),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { wireMessageHandler } from '../webviewClient/cubeViewerMonaco/messaging';
import { startEdit, cancelEdit } from '../webviewClient/cubeViewerMonaco/editor';
import { renderGrid } from '../webviewClient/cubeViewerMonaco/grid';

/** Fake `<td>` with a real `Set`-backed classList — `startEdit`/`applyPicklistValues`
 *  read `classList.contains`/mutate via `className` and (on the null-fallback path)
 *  `classList.remove`, and `isConnected` needs to be independently flippable to
 *  simulate a click-driven `renderGrid` detaching the cell mid-flight. */
function makeTd(
  ri: number, ci: number, textContent: string, opts: { picklist?: boolean } = {},
): { td: any; getLastChild: () => any } {
  const classes = new Set<string>(['cell-numeric']);
  if (opts.picklist) classes.add('cell-picklist');
  let lastChild: any = null;
  const td: any = {
    dataset: { ri: String(ri), ci: String(ci) },
    textContent,
    isConnected: true,
    classList: {
      contains: (c: string) => classes.has(c),
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    },
    appendChild: (c: unknown) => { lastChild = c; return c; },
  };
  Object.defineProperty(td, 'className', {
    get: () => Array.from(classes).join(' '),
    set: (v: string) => { classes.clear(); v.split(' ').filter(Boolean).forEach((c) => classes.add(c)); },
  });
  Object.defineProperty(td, 'innerHTML', {
    get: () => '',
    set: () => { lastChild = null; },
  });
  return { td, getLastChild: () => lastChild };
}

function dispatchPicklistValues(msg: { values: string[] | null; reqId: number }): void {
  const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
    .__messageHandlers;
  handlers.forEach((h) => h({ data: { type: 'picklistValues', def: 'PICKDEF', ...msg } }));
}

describe('webview editor.ts — picklist round trip (Fix round 1, Finding 3)', () => {
  beforeEach(() => {
    (globalThis as unknown as { __messageHandlers: unknown[] }).__messageHandlers = [];
    sendCellEditSpy.mockReset();
    sendResolvePicklistSpy.mockReset();
    wireMessageHandler();
    state.dimensions = ['D1', 'D2'];
    state.pendingPicklist = null;
    state.lastMatrix = {
      values: {}, rawValues: {}, cellFlags: {}, rowDims: [], colDims: [], rowTuples: [], colTuples: [],
    } as any;
  });
  // `activeEditor` is a module-private singleton — leftovers wedge the next
  // test's first `startEdit`, same reasoning as the neighbouring file.
  afterEach(() => { cancelEdit(); });

  it('ignores a stale (older reqId) answer; the matching one still applies', () => {
    const { td, getLastChild } = makeTd(0, 0, '42', { picklist: true });
    startEdit(td);
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(1);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;

    dispatchPicklistValues({ values: ['A', 'B'], reqId: reqId - 1 });
    expect(getLastChild()).toBeNull(); // stale answer: nothing built yet

    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    expect(getLastChild()?.tagName).toBe('SELECT'); // matching answer: applies
  });

  it('ignores an answer for a now-detached <td> and leaves the editor clean for the next startEdit', () => {
    const { td, getLastChild } = makeTd(0, 0, '42', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;

    // Simulate a click-driven renderGrid replacing the table body while the
    // round trip was in flight (Finding 1) — nothing left in this <td>.
    td.isConnected = false;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    expect(getLastChild()).toBeNull();

    // Not wedged: the next startEdit on a fresh cell starts a NEW round trip
    // instead of hitting `if (activeEditor) return`. (Since Task 15 the
    // mocked `pickDefinitionForCell` answers for every cell, so the fresh
    // cell takes the same known-definition path — the point stands: a second
    // request is minted and its answer builds a control.)
    const { td: td2, getLastChild: getLastChild2 } = makeTd(1, 1, '7');
    startEdit(td2);
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(2);
    dispatchPicklistValues({
      values: ['A', 'B'], reqId: sendResolvePicklistSpy.mock.calls[1][1] as number,
    });
    expect(getLastChild2()?.tagName).toBe('SELECT');
  });

  it('falls back to the free-text input when the host answers values: null', () => {
    const { td, getLastChild } = makeTd(0, 0, '42', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;

    dispatchPicklistValues({ values: null, reqId });
    const child = getLastChild();
    expect(child.tagName).toBe('INPUT');
    expect(child.type).toBe('text');
  });

  it('preselects a current value that is not in the list, marked as foreign', () => {
    const { td, getLastChild } = makeTd(0, 0, 'ZZZ', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;

    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    const sel = getLastChild();
    expect(sel.tagName).toBe('SELECT');
    expect(sel.value).toBe('ZZZ');
    expect(sel.children.map((o: any) => o.value)).toEqual(['ZZZ', 'A', 'B']);
    expect(sel.children[0].textContent).toContain('ZZZ');
  });

  it('Finding 2: an arrow-key-driven change does not commit, but Enter does', () => {
    const { td, getLastChild } = makeTd(0, 0, 'A', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    const sel = getLastChild();
    expect(sel.tagName).toBe('SELECT');

    // Any keydown (round 2: not just an allowlisted set) disarms the
    // mouse-only commit gate, then Chromium fires `change` — must NOT write.
    sel.onkeydown?.({ key: 'ArrowDown', preventDefault: () => {} });
    sel.value = 'B';
    sel.onchange?.();
    expect(sendCellEditSpy).not.toHaveBeenCalled();

    // Enter commits explicitly.
    sel.onkeydown?.({ key: 'Enter', preventDefault: () => {} });
    expect(sendCellEditSpy).toHaveBeenCalledTimes(1);
  });

  it('Finding 2 (round 2, residual): a type-ahead letter keydown does not commit', () => {
    // Chromium jumps a focused closed <select> to the option matching a typed
    // letter/digit and fires `change` — round 1's arrow/paging-only allowlist
    // missed this and still wrote on every such keystroke.
    const { td, getLastChild } = makeTd(0, 0, 'A', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    const sel = getLastChild();

    sel.onkeydown?.({ key: 'b', preventDefault: () => {} });
    sel.value = 'B';
    sel.onchange?.();
    expect(sendCellEditSpy).not.toHaveBeenCalled();
  });

  it('Finding 2 (round 2, residual): an ArrowLeft keydown does not commit', () => {
    // Outside macOS, Chromium also treats ArrowLeft/ArrowRight as list
    // navigation on a closed <select> — round 1's allowlist did not cover it.
    const { td, getLastChild } = makeTd(0, 0, 'A', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    const sel = getLastChild();

    sel.onkeydown?.({ key: 'ArrowLeft', preventDefault: () => {} });
    sel.value = 'B';
    sel.onchange?.();
    expect(sendCellEditSpy).not.toHaveBeenCalled();
  });

  it('Finding 2: a mouse-picked change (no prior keydown) commits immediately', () => {
    const { td, getLastChild } = makeTd(0, 0, 'A', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    const sel = getLastChild();

    sel.onmousedown?.();
    sel.value = 'B';
    sel.onchange?.();
    expect(sendCellEditSpy).toHaveBeenCalledTimes(1);
  });

  it('Finding 2: a keydown after mousedown disarms the pick (defends the inverted rule itself)', () => {
    const { td, getLastChild } = makeTd(0, 0, 'A', { picklist: true });
    startEdit(td);
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    const sel = getLastChild();

    sel.onmousedown?.();
    sel.onkeydown?.({ key: 'x', preventDefault: () => {} }); // stray keystroke, no pick
    sel.value = 'B';
    sel.onchange?.();
    expect(sendCellEditSpy).not.toHaveBeenCalled();
  });

  it('Finding 4: renderGrid cancels a pending picklist editor before rendering (bridge is wired, not just mocked)', () => {
    // Uses the REAL grid.ts (see file header) — a mocked renderGrid, as round 1
    // shipped, would let the choke point (`cancelPendingPicklistBeforeRerender`
    // at the top of `renderGrid`) be deleted without a single test failing.
    const { td, getLastChild } = makeTd(0, 0, '42', { picklist: true });
    startEdit(td);
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(1); // still pending, no control built yet

    // A click-driven re-render (collapse triangle, context menu, ...) calls
    // renderGrid directly, never through messaging.ts's own guard.
    renderGrid(null as any);

    // The late answer must not find anything to build into — the pending
    // editor was cancelled by the renderGrid call itself, not by the reqId/
    // isConnected checks (this <td> was never detached; the point is the
    // round trip is gone before those checks even run).
    const reqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    dispatchPicklistValues({ values: ['A', 'B'], reqId });
    expect(getLastChild()).toBeNull();

    // Not wedged: startEdit on a fresh cell mints a new round trip.
    const { td: td2, getLastChild: getLastChild2 } = makeTd(1, 1, '7');
    startEdit(td2);
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(2);
    dispatchPicklistValues({
      values: ['A', 'B'], reqId: sendResolvePicklistSpy.mock.calls[1][1] as number,
    });
    expect(getLastChild2()?.tagName).toBe('SELECT');
  });
});

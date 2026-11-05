/**
 * Task 15 (2026-08-13): the cell level is fetched LAZILY — exactly one cell,
 * exactly on double click.
 *
 * The occasion is in the measurements against 11.8: the old query over the
 * window of a saved view ran for over ten minutes and had to be
 * aborted on the server side, while the same view showed exactly ONE cell
 * with a picklist; 417 cells in one cellset cost 12.5 s, a
 * single cell 1–2 ms. This file pins down the three properties without
 * which the lazy path would not hold:
 *
 *   1. EXACTLY ONE cell is asked for, and only when nothing else knows it,
 *   2. `null` means free-text field — never an empty selection field,
 *   3. an answer for an old editor is discarded.
 *
 * Real `editor.ts` and real `messaging.ts` run here (not mocked),
 * so that the module-private `activeEditor`/`state.pendingCellPicklist` state
 * is really checked — the same construction as
 * `cubeViewerPicklistEditorApply.test.ts`, whose dummies for `document`/
 * `window`/`<td>` this file takes over (no jsdom in the project).
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
vi.mock('../webviewClient/cubeViewerMonaco/axis', () => ({
  rebuildZones: vi.fn(), fillSelect: vi.fn(), currentDimSubsetsAll: vi.fn(() => ({})),
  clearElementFetchPending: vi.fn(),
}));
vi.mock('../webviewClient/_shared/filterCombo', () => ({ syncTitleCombo: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({ renderGrid: vi.fn() }));
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

const { sendCellEditSpy, sendResolvePicklistSpy, sendFetchCellPicklistSpy } = vi.hoisted(() => ({
  sendCellEditSpy: vi.fn(), sendResolvePicklistSpy: vi.fn(), sendFetchCellPicklistSpy: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/actions', () => ({
  sendCellEdit: sendCellEditSpy, sendSpread: vi.fn(),
  sendResolvePicklist: sendResolvePicklistSpy,
  sendFetchCellPicklist: sendFetchCellPicklistSpy,
  getTitleAssignments: vi.fn(() => ({})),
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { wireMessageHandler } from '../webviewClient/cubeViewerMonaco/messaging';
import { startEdit, cancelEdit } from '../webviewClient/cubeViewerMonaco/editor';
import { clearCellPicklistCache } from '../webviewClient/cubeViewerMonaco/cellPicklistCache';

/** Fake `<td>`, class-faithful as in the neighbouring test — `isConnected` must be
 *  switchable individually, to simulate an intermediate redraw. */
function makeTd(ri: number, ci: number, textContent: string): { td: any; getLastChild: () => any } {
  const classes = new Set<string>(['cell-numeric']);
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
  Object.defineProperty(td, 'innerHTML', { get: () => '', set: () => { lastChild = null; } });
  return { td, getLastChild: () => lastChild };
}

function dispatch(data: unknown): void {
  (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
    .__messageHandlers.forEach((h) => h({ data }));
}

/** A matrix without any area definition, but WITH a control cube — exactly
 *  the situation in which the lazy single query applies. */
function matrix(overrides: Record<string, unknown> = {}): any {
  return {
    values: {}, rawValues: {}, cellFlags: {},
    rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [['North'], ['South']], colTuples: [['Jan']],
    picklistCubePresent: true,
    ...overrides,
  };
}

describe('webview — lazy cell picklist (Task 15)', () => {
  beforeEach(() => {
    (globalThis as unknown as { __messageHandlers: unknown[] }).__messageHandlers = [];
    sendCellEditSpy.mockReset();
    sendResolvePicklistSpy.mockReset();
    sendFetchCellPicklistSpy.mockReset();
    clearCellPicklistCache();
    wireMessageHandler();
    state.dimensions = ['Region', 'Month'];
    state.pendingPicklist = null;
    state.pendingCellPicklist = null;
    state.lastMatrix = matrix();
  });
  // `activeEditor` is a module-private singleton — leftovers jam the
  // first `startEdit` of the next test.
  afterEach(() => { cancelEdit(); });

  it('queries EXACTLY ONE cell on double click', () => {
    const { td } = makeTd(0, 0, '42');
    startEdit(td);

    expect(sendFetchCellPicklistSpy).toHaveBeenCalledTimes(1);
    const [coordinates] = sendFetchCellPicklistSpy.mock.calls[0];
    // One coordinate, not a range — that is exactly the difference
    // between 1–2 ms and over ten minutes.
    expect(coordinates).toEqual(['North', 'Jan']);
    // And the values query only runs once there is a definition.
    expect(sendResolvePicklistSpy).not.toHaveBeenCalled();
  });

  it('does NOT ask when the attribute map already knows the cell', () => {
    state.lastMatrix = matrix({ picklistByElem: { Region: { North: 'static:A:B' } } });
    const { td } = makeTd(0, 0, '42');
    startEdit(td);

    expect(sendFetchCellPicklistSpy).not.toHaveBeenCalled();
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT ask when the rule map already knows the cell', () => {
    // The rule map is dimensionless: it only names the element name.
    state.lastMatrix = matrix({ picklistByRuleElem: { North: 'static:A:B' } });
    const { td } = makeTd(0, 0, '42');
    startEdit(td);

    expect(sendFetchCellPicklistSpy).not.toHaveBeenCalled();
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT ask when there is no control cube at all — editing waits for nothing', () => {
    state.lastMatrix = matrix({ picklistCubePresent: false });
    const { td, getLastChild } = makeTd(0, 0, '42');
    startEdit(td);

    expect(sendFetchCellPicklistSpy).not.toHaveBeenCalled();
    expect(getLastChild()?.tagName).toBe('INPUT');
  });

  it('null leads to the free-text field, not to an empty selection field', () => {
    const { td, getLastChild } = makeTd(0, 0, '42');
    startEdit(td);
    const reqId = sendFetchCellPicklistSpy.mock.calls[0][1] as number;

    dispatch({ type: 'cellPicklistDef', def: null, reqId });

    const child = getLastChild();
    expect(child.tagName).toBe('INPUT');
    expect(child.type).toBe('text');
    // Explicitly NO empty <select> and no values query.
    expect(sendResolvePicklistSpy).not.toHaveBeenCalled();
  });

  it('a definition leads into the second stage and builds the selection field', () => {
    const { td, getLastChild } = makeTd(0, 0, '42');
    startEdit(td);
    const defReqId = sendFetchCellPicklistSpy.mock.calls[0][1] as number;

    dispatch({ type: 'cellPicklistDef', def: 'static:A:B', reqId: defReqId });
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(1);
    expect(sendResolvePicklistSpy.mock.calls[0][0]).toBe('static:A:B');

    const valReqId = sendResolvePicklistSpy.mock.calls[0][1] as number;
    // Own counter (`picklistReqSeq`), NOT `state._reqSent`: the second
    // stage draws a new number from the same picklist counter.
    expect(valReqId).not.toBe(defReqId);

    dispatch({ type: 'picklistValues', def: 'static:A:B', values: ['A', 'B'], reqId: valReqId });
    expect(getLastChild()?.tagName).toBe('SELECT');
  });

  it('discards an answer with an outdated reqId', () => {
    const { td, getLastChild } = makeTd(0, 0, '42');
    startEdit(td);
    const reqId = sendFetchCellPicklistSpy.mock.calls[0][1] as number;

    dispatch({ type: 'cellPicklistDef', def: 'static:A:B', reqId: reqId - 1 });
    expect(sendResolvePicklistSpy).not.toHaveBeenCalled();
    expect(getLastChild()).toBeNull();

    // The matching answer still applies.
    dispatch({ type: 'cellPicklistDef', def: 'static:A:B', reqId });
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(1);
  });

  it('discards an answer whose <td> no longer hangs in the document', () => {
    const { td, getLastChild } = makeTd(0, 0, '42');
    startEdit(td);
    const reqId = sendFetchCellPicklistSpy.mock.calls[0][1] as number;

    // A click-driven redraw has replaced the <td>.
    td.isConnected = false;
    dispatch({ type: 'cellPicklistDef', def: 'static:A:B', reqId });
    expect(getLastChild()).toBeNull();
    expect(sendResolvePicklistSpy).not.toHaveBeenCalled();

    // Not jammed: the next startEdit starts up again.
    const { td: td2 } = makeTd(1, 0, '7');
    startEdit(td2);
    expect(sendFetchCellPicklistSpy).toHaveBeenCalledTimes(2);
  });

  it('discards an answer that belongs to a cancelled editor', () => {
    const { td, getLastChild } = makeTd(0, 0, '42');
    startEdit(td);
    const reqId = sendFetchCellPicklistSpy.mock.calls[0][1] as number;

    cancelEdit(); // Escape during the round trip
    dispatch({ type: 'cellPicklistDef', def: 'static:A:B', reqId });
    expect(getLastChild()).toBeNull();
    expect(sendResolvePicklistSpy).not.toHaveBeenCalled();
  });

  it('does not ask for the same cell a second time — not even after a null', () => {
    const { td } = makeTd(0, 0, '42');
    startEdit(td);
    dispatch({
      type: 'cellPicklistDef', def: null,
      reqId: sendFetchCellPicklistSpy.mock.calls[0][1] as number,
    });
    cancelEdit();

    startEdit(makeTd(0, 0, '42').td);
    expect(sendFetchCellPicklistSpy).toHaveBeenCalledTimes(1);
  });

  it('uses an already fetched definition directly on the next double click', () => {
    const { td } = makeTd(0, 0, '42');
    startEdit(td);
    dispatch({
      type: 'cellPicklistDef', def: 'static:A:B',
      reqId: sendFetchCellPicklistSpy.mock.calls[0][1] as number,
    });
    cancelEdit();

    startEdit(makeTd(0, 0, '42').td);
    // No second single query, the values directly.
    expect(sendFetchCellPicklistSpy).toHaveBeenCalledTimes(1);
    expect(sendResolvePicklistSpy).toHaveBeenCalledTimes(2);
  });
});

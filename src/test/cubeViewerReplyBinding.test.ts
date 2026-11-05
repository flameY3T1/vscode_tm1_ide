/**
 * Review 2026-11-02, C4/C5/C6: replies and refreshes of the cube viewer are
 * bound to the request they belong to, in the webview that owns the query.
 *
 * - C4: the refresh after a write is sent by the webview (current layout, own
 *   reqId, `keepUndo`). Sent by the host after the write, it overtook a newer
 *   title pick and brought the old one back (proven live on a throwaway cube).
 * - C5: a refresh asked for while one is loading is sent, not dropped — the
 *   newest reqId wins. Dropped, the title pick made during loading was lost.
 * - C6: an alias value reply is applied only to the alias it was asked for.
 *
 * Drives the real `wireMessageHandler`/`doRefresh`; the DOM and neighbouring
 * modules are dummies (no jsdom in this project), as in
 * `cubeViewerTitleSelectSync.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, any>;
  g.__winListeners = {} as Record<string, Array<(e: unknown) => void>>;
  g.window = {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      (g.__winListeners[type] ??= []).push(handler);
    },
  };
  g.document = {
    addEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
});

function refsProxy(): any {
  const el = () => ({
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    dataset: {},
    style: {},
  });
  return new Proxy({}, { get: () => el() });
}

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn(), setState: vi.fn(), getState: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: () => refsProxy(), showLoading: vi.fn(), showError: vi.fn(), showToast: vi.fn(),
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
vi.mock('../webviewClient/cubeViewerMonaco/grid', () => ({
  renderGrid: vi.fn(), applyNumberFormat: vi.fn(), syncResetButton: vi.fn(),
}));
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
vi.mock('../webviewClient/cubeViewerMonaco/mdxView', () => ({ openMdxModal: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxBuild', () => ({
  buildCurrentMdx: vi.fn(), effectiveInlineMdx: vi.fn(), setInlineMdx: vi.fn(),
}));

import { vscode } from '../webviewClient/cubeViewerMonaco/vscodeApi';
import { wireMessageHandler, doRefresh } from '../webviewClient/cubeViewerMonaco/messaging';
import { state } from '../webviewClient/cubeViewerMonaco/state';

const post = vscode.postMessage as unknown as ReturnType<typeof vi.fn>;

function fire(data: unknown): void {
  const ls = (globalThis as unknown as { __winListeners: Record<string, Array<(e: unknown) => void>> })
    .__winListeners.message ?? [];
  ls.forEach((h) => h({ data }));
}

const sent = (type: string) => post.mock.calls.map((c) => c[0]).filter((m) => m.type === type);

beforeEach(() => {
  (globalThis as unknown as { __winListeners: Record<string, unknown[]> }).__winListeners = {};
  post.mockReset();
  state.rowDims = ['Region'];
  state.colDims = ['Month'];
  state.titleDims = [];
  state.isMdxView = false;
  state.loading = false;
  state.lastMatrix = null;
  state.dimAliases = {};
  state.aliasMaps = {};
  wireMessageHandler();
});

describe('C4 — the webview refreshes after its own write', () => {
  it('a confirmed single edit sends refreshData with keepUndo', () => {
    fire({ type: 'cellEditResult', ri: 0, ci: 0, ok: true });
    const r = sent('refreshData');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ keepUndo: true, rowDims: ['Region'], colDims: ['Month'] });
    expect(typeof r[0].reqId).toBe('number');
  });

  it('a rejected edit sends no refresh', () => {
    fire({ type: 'cellEditResult', ri: 0, ci: 0, ok: false, error: { kind: 'security' } });
    expect(sent('refreshData')).toHaveLength(0);
  });

  it('a bulk write refreshes when at least one target was written', () => {
    fire({ type: 'cellEditBulkResult', ok: false, okCount: 1, totalCount: 2, firstError: null });
    fire({ type: 'spreadBulkResult', ok: false, okCount: 0, totalCount: 2, firstError: null });
    expect(sent('refreshData')).toHaveLength(1);
  });

  it('in MDX mode the refresh runs the query, also with keepUndo', () => {
    state.isMdxView = true;
    state.lastInlineMdx = 'SELECT {} ON 0 FROM [C]';
    fire({ type: 'cellEditResult', ri: 0, ci: 0, ok: true });
    expect(sent('runInlineMdx')[0]).toMatchObject({ keepUndo: true });
  });

  it('a write TM1 accepted on a consolidation ("P6") pushes no undo entry and clears the stack', async () => {
    const { undoStack } = await import('../webviewClient/cubeViewerMonaco/pureBridge');
    const push = undoStack.push as unknown as ReturnType<typeof vi.fn>;
    const clear = undoStack.clear as unknown as ReturnType<typeof vi.fn>;
    push.mockClear(); clear.mockClear();
    const td = { dataset: { pendingOld: '100', pendingNew: 'P6', pendingCoords: '[]' } as Record<string, string>, className: 'cell-pending' };
    const doc = (globalThis as unknown as { document: { querySelector: (s: string) => unknown } }).document;
    const orig = doc.querySelector;
    doc.querySelector = () => td;
    try {
      state.lastMatrix = { cellFlags: { '0,0': { c: 1 } } } as unknown as typeof state.lastMatrix;
      fire({ type: 'cellEditResult', ri: 0, ci: 0, ok: true });
      expect(push).not.toHaveBeenCalled();
      expect(clear).toHaveBeenCalled();
      // a leaf write still records its undo entry
      td.dataset = { pendingOld: '1', pendingNew: '2', pendingCoords: '[]' };
      state.lastMatrix = { cellFlags: {} } as unknown as typeof state.lastMatrix;
      fire({ type: 'cellEditResult', ri: 0, ci: 0, ok: true });
      expect(push).toHaveBeenCalledTimes(1);
    } finally {
      doc.querySelector = orig;
    }
  });

  it('a spread refreshes WITHOUT keepUndo — it has no undo entry, the stack must go', () => {
    fire({ type: 'spreadResult', ok: true });
    fire({ type: 'spreadBulkResult', ok: false, okCount: 1, totalCount: 2, firstError: null });
    const r = sent('refreshData');
    expect(r).toHaveLength(2);
    for (const m of r) { expect(m.keepUndo).toBeFalsy(); }
  });
});

describe('C5 — a refresh during loading is sent, not dropped', () => {
  it('doRefresh posts while a load is in flight', () => {
    state.loading = true;
    doRefresh();
    expect(sent('refreshData')).toHaveLength(1);
  });

  it('two refreshes in a row carry increasing reqIds', () => {
    doRefresh();
    doRefresh();
    const [a, b] = sent('refreshData');
    expect(b.reqId).toBeGreaterThan(a.reqId);
  });
});

describe('C6 — alias values apply only to the alias they were asked for', () => {
  it('drops a reply for an alias that is no longer active', () => {
    state.dimAliases = { Region: 'Kurz' };
    fire({ type: 'dimAliasValues', dimName: 'Region', alias: 'Lang', values: { N: 'Nord' } });
    expect(state.aliasMaps.Region).toBeUndefined();
  });

  it('applies the reply for the active alias', () => {
    state.dimAliases = { Region: 'Kurz' };
    fire({ type: 'dimAliasValues', dimName: 'Region', alias: 'Kurz', values: { N: 'N.' } });
    expect(state.aliasMaps.Region).toEqual({ N: 'N.' });
  });

  it('a restored workbench alias fetches its values', () => {
    fire({ type: 'applyState', ui: { dimAliases: { Region: 'Kurz' } } });
    expect(sent('fetchDimAliasValues')).toEqual([{ type: 'fetchDimAliasValues', dimName: 'Region', alias: 'Kurz' }]);
  });
});

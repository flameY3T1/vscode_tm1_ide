/**
 * Task 12, Fix round 1 — the four behaviours the review said were unproven
 * (Finding 5): no round trip when the area has no picklists, the shared
 * `picklistReqSeq` counter never touches the refresh-generation guard
 * (Finding 1), the stale-view guard fires on a click-driven re-render that
 * keeps the same matrix but moves the rendered index lists (Finding 4), and
 * `resolvePastePicklistResponse` itself.
 *
 * Real `paste.ts`, `messaging.ts`, `picklistReqSeq.ts`, `reqGuard.ts`,
 * `pasteGridPure.ts`, `../../cubeViewer/cellWrite`, `../../cubeViewer/picklistPure`
 * all run un-mocked — the whole point of Finding 1 was that mocking `reqGuard`
 * (as the sibling webview-messaging tests do) would hide a real counter
 * collision, so this file leaves it real and asserts on `state._reqSent`
 * directly. No jsdom in this project — hand-rolled `window`/`document` stubs,
 * same pattern as `cubeViewerCellDataCancelsEditor.test.ts`.
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
    querySelector: () => null,
    querySelectorAll: () => [],
  };
});

const { showLoadingSpy, showToastSpy } = vi.hoisted(() => ({
  showLoadingSpy: vi.fn(), showToastSpy: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn(), setState: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(() => ({ errorBanner: { style: { display: '' } } })),
  showLoading: showLoadingSpy, showError: vi.fn(), showToast: showToastSpy,
  refreshTdClassByValue: vi.fn(), setToggleOn: vi.fn(), isToggleOn: vi.fn(() => false),
  focusIsInput: vi.fn(() => false),
  // `actions.ts` imports + re-exports this from `dom.ts` — `paste.ts` pulls it
  // from `actions.ts`, not from here directly, but the mock still has to carry
  // it since `dom.ts` itself is fully replaced.
  getTitleAssignments: vi.fn(() => ({})),
}));
vi.mock('../webviewClient/cubeViewerMonaco/pureBridge', async (importOriginal) => {
  // `pasteGridPure.ts` needs the REAL `parseEditedValue`/`normalizeDecimal` —
  // Findings 2/3 are exactly about their trimming/empty semantics, a stub
  // would defeat the point of this file. `editor.ts` (loaded transitively via
  // `messaging.ts`) pulls in the rest of this module's surface but never
  // calls it here (no `startEdit` in this file), so passing the rest through
  // unmocked is safe and cheaper than re-declaring it.
  const actual = await importOriginal<typeof import('../webviewClient/cubeViewerMonaco/pureBridge')>();
  return {
    ...actual,
    undoStack: { push: vi.fn(), pop: vi.fn(), isEmpty: vi.fn(() => true), clear: vi.fn(), size: vi.fn(() => 0), peek: vi.fn() },
  };
});
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
vi.mock('../webviewClient/cubeViewerMonaco/gridPure', () => ({ axisBaseNamesFromMatrix: vi.fn(() => ({})) }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxSlicerPure', () => ({ rewriteMdxSlicer: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxPivotPure', () => ({ buildPivotedMdx: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/pivotPure', () => ({ consumePendingRefresh: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/refreshBridge', () => ({ setRefreshFn: vi.fn() }));
vi.mock('../webviewClient/cubeViewerMonaco/mdxAxisFilterPure', () => ({ hasAxisElementFilter: vi.fn() }));
vi.mock('../mdx/nonEmptyAxisPure', () => ({ setNonEmptyAxis: vi.fn() }));
// `editor.ts` is real (Finding 1 also touches it), but `applyPicklistValues`/
// `cancelPendingPicklistEditor` are not exercised here — no `startEdit` call
// happens in this file, so the real implementations are inert no-ops for it.

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { wireMessageHandler } from '../webviewClient/cubeViewerMonaco/messaging';
import { vscode } from '../webviewClient/cubeViewerMonaco/vscodeApi';
import { applyPaste, resolvePastePicklistResponse } from '../webviewClient/cubeViewerMonaco/paste';

const post = vscode.postMessage as unknown as ReturnType<typeof vi.fn>;

function dispatchCellData(msg: Record<string, unknown>): void {
  const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
    .__messageHandlers;
  handlers.forEach((h) => h({ data: { type: 'cellData', matrix: {}, ...msg } }));
}

function dispatchPicklistValues(msg: { values: string[] | null; reqId: number; def?: string }): void {
  const handlers = (globalThis as unknown as { __messageHandlers: Array<(e: unknown) => void> })
    .__messageHandlers;
  handlers.forEach((h) => h({ data: { type: 'picklistValues', def: 'static:Offen:Zu', ...msg } }));
}

/** A matrix object with ONE picklist cell at (0,0). Since Task 15 the definition comes
 *  from the ATTRIBUTE MAP (or the rule map) — the grid-wide
 *  `"ri,ci"` map is deleted, because FILLING it measurably cost over ten minutes.
 *  For the paste pre-check that changes nothing: it checks against
 *  KNOWN definitions, and an attribute map is exactly that. */
function matrixWithPicklist() {
  return {
    rowElements: ['North'], colElements: ['Jan'],
    values: {}, rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [['North']], colTuples: [['Jan']],
    cellFlags: {},
    picklistByElem: { Region: { North: 'static:Offen:Zu' } },
  };
}

function seedPasteState(matrix: ReturnType<typeof matrixWithPicklist>): void {
  state.dimensions = ['Region', 'Month'];
  state.rowDims = ['Region'];
  state.colDims = ['Month'];
  state.existingViewName = null;
  state.existingViewIsPrivate = false;
  state.titleOverride = true;
  state.selectionAnchor = { ri: 0, ci: 0 };
  state.renderedRowIdx = [0];
  state.renderedColIdx = [0];
  state.lastMatrix = matrix as any;
}

describe('paste.ts — Fix round 1 wiring', () => {
  beforeEach(() => {
    (globalThis as unknown as { __messageHandlers: unknown[] }).__messageHandlers = [];
    post.mockReset();
    showLoadingSpy.mockReset();
    showToastSpy.mockReset();
    wireMessageHandler();
    state._reqSent = 0;
  });

  it('Finding 5: no round trip when nothing in the area carries a picklist', async () => {
    seedPasteState({
      rowElements: ['North'], colElements: ['Jan'],
      values: {}, rowDims: ['Region'], colDims: ['Month'],
      rowTuples: [['North']], colTuples: [['Jan']],
      cellFlags: {},
    } as any);
    await applyPaste('5');
    // Exactly one post — the write itself — never a `resolvePicklist`.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].type).toBe('cellEditBulk');
    expect(post.mock.calls.some((c) => c[0].type === 'resolvePicklist')).toBe(false);
  });

  it('Finding 1: minting a picklist request does not bump state._reqSent, and an in-flight refresh cellData is still accepted afterwards', () => {
    // Simulates: user hit Refresh, generation 7 is in flight, grid hidden.
    state._reqSent = 7;
    seedPasteState(matrixWithPicklist());

    // Fires synchronously up to the point where the picklist round trip is
    // posted (an async function runs synchronously up to its first await,
    // including through the nested `resolveAreaPicklists`/`resolvePicklistAsync`
    // calls) — no need to await it here; it is never resolved in this test.
    void applyPaste('Offen');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0].type).toBe('resolvePicklist');
    // The core of Finding 1: the picklist round trip must NOT touch the
    // refresh-generation counter that `isCurrentResponse` guards `cellData`/
    // `error` against.
    expect(state._reqSent).toBe(7);

    // The refresh's own answer (reqId 7) must still be accepted — before the
    // fix, minting the picklist reqId from the same counter would have bumped
    // `state._reqSent` past 7, making this `cellData` look stale and dropped
    // (`showLoading(false)` never runs, refresh button stays disabled).
    dispatchCellData({ reqId: 7 });
    expect(showLoadingSpy).toHaveBeenCalledWith(false);
  });

  it('Finding 4: a matrix swap during the picklist round trip aborts the paste with a toast, not a silent no-op', async () => {
    const matrixA = matrixWithPicklist();
    seedPasteState(matrixA);

    const pastePromise = applyPaste('Offen');
    expect(post).toHaveBeenCalledTimes(1);
    const reqId = post.mock.calls[0][0].reqId as number;

    // A refresh (or pivot) replaced the matrix while the round trip was
    // still in flight.
    state.lastMatrix = matrixWithPicklist() as any;

    dispatchPicklistValues({ values: ['Offen', 'Zu'], reqId });
    await pastePromise;

    // No cellEditBulk went out — the plan was built against pre-await
    // positions that no longer describe the current view.
    expect(post).toHaveBeenCalledTimes(1); // still just the resolvePicklist call
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy.mock.calls[0][1]).toBe('error');
  });

  it('Finding 4: a same-matrix re-render that only moves renderedRowIdx/renderedColIdx also aborts the paste', async () => {
    const matrix = matrixWithPicklist();
    seedPasteState(matrix);

    const pastePromise = applyPaste('Offen');
    expect(post).toHaveBeenCalledTimes(1);
    const reqId = post.mock.calls[0][0].reqId as number;

    // Same matrix object (collapse/expand, localFocus, ... kept the matrix),
    // but `renderGrid` always rebuilds these two arrays via `.slice()` — a
    // fresh reference even with identical content.
    state.renderedRowIdx = state.renderedRowIdx.slice();
    state.renderedColIdx = state.renderedColIdx.slice();

    dispatchPicklistValues({ values: ['Offen', 'Zu'], reqId });
    await pastePromise;

    expect(post).toHaveBeenCalledTimes(1); // no cellEditBulk followed
    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy.mock.calls[0][1]).toBe('error');
  });

  it('Finding 4: an unchanged view completes the paste normally (guard does not false-fire)', async () => {
    seedPasteState(matrixWithPicklist());

    const pastePromise = applyPaste('Offen');
    const reqId = post.mock.calls[0][0].reqId as number;
    dispatchPicklistValues({ values: ['Offen', 'Zu'], reqId });
    await pastePromise;

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0].type).toBe('cellEditBulk');
    expect(showToastSpy).not.toHaveBeenCalled();
  });

  describe('resolvePastePicklistResponse', () => {
    it('returns false and resolves nothing for an unknown reqId', () => {
      expect(resolvePastePicklistResponse(999999, ['A'])).toBe(false);
    });

    it('returns true and resolves the matching in-flight request exactly once', async () => {
      seedPasteState(matrixWithPicklist());
      const pastePromise = applyPaste('Offen');
      const reqId = post.mock.calls[0][0].reqId as number;

      expect(resolvePastePicklistResponse(reqId, ['Offen', 'Zu'])).toBe(true);
      // A second answer for the same reqId is already consumed.
      expect(resolvePastePicklistResponse(reqId, ['Offen', 'Zu'])).toBe(false);

      await pastePromise;
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[1][0].type).toBe('cellEditBulk');
    });
  });
});

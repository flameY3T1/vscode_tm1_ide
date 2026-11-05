/**
 * The write messages of `sendSpread`/`sendSpreadBulk` (actions.ts),
 * `applyPaste` (paste.ts) and `applyClear` (clear.ts) carry the write only.
 * Until review 2026-11-02 (C4) they also carried the layout, and the host
 * refreshed with it after the write — the layout of the moment of writing,
 * over any newer pivot. The refresh now comes from the webview's own state
 * (`messaging.ts`, write result handlers), so a layout field on a write would
 * be a second, older copy of the query.
 *
 * `applyPaste`'s only DOM touchpoint outside the already-mocked `dom.ts`/
 * `actions.ts` seam is a single `document.querySelector(...)` call for the
 * pending-cell flash, and its result is only read when truthy — a
 * null-returning stub is enough to run it end to end without a real DOM.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `state.ts` reads `window.__cvCopyDecimalComma` at MODULE-LOAD time (top-level
// `numFmt.comma` initialiser) — `vi.hoisted` so this exists before the `import`
// below (itself hoisted above these `vi.mock` calls) pulls `state.ts` in.
// `document.querySelector` is `applyPaste`'s one DOM touchpoint (pending-cell
// flash); its result is only used when truthy, so a stub returning `null` is
// enough for the write path to run for real.
vi.hoisted(() => {
  (globalThis as unknown as { window?: unknown }).window ??= {};
  (globalThis as unknown as { document?: unknown }).document ??= {
    querySelector: () => null,
  };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: vi.fn() },
}));
vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  // `getTitleAssignments()` reads live title-zone <select>s via this — an
  // empty NodeList-like stands in for "no title picks made". Both
  // `getTitleAssignments` and `getRefs` now live in `dom.ts` (moved there to
  // break an `actions → axis → grid → actions` cycle once `grid.ts` needed
  // it too), so mocking the module out means stubbing both directly.
  getRefs: vi.fn(() => ({ zoneTitles: { querySelectorAll: () => [] } })),
  getTitleAssignments: vi.fn(() => ({})),
  showToast: vi.fn(),
}));
vi.mock('../webviewClient/cubeViewerMonaco/axis', () => ({
  // Real `axis.ts` pulls in the grid/drag-drop/title-combo modules — far more
  // than these senders need. Stubbed so its return value is fully controlled
  // and traceable through to the posted message.
  currentDimSubsetsAll: vi.fn(),
}));

import { vscode } from '../webviewClient/cubeViewerMonaco/vscodeApi';
import { currentDimSubsetsAll } from '../webviewClient/cubeViewerMonaco/axis';
import { state } from '../webviewClient/cubeViewerMonaco/state';
import { sendSpread, sendSpreadBulk } from '../webviewClient/cubeViewerMonaco/actions';
import { applyPaste } from '../webviewClient/cubeViewerMonaco/paste';
import { applyClear } from '../webviewClient/cubeViewerMonaco/clear';
import { lastBulkKind } from '../webviewClient/cubeViewerMonaco/bulkWrite';

const post = vscode.postMessage as unknown as ReturnType<typeof vi.fn>;
const mockSubsets = currentDimSubsetsAll as unknown as ReturnType<typeof vi.fn>;

const SEEDED_SUBSETS = { Region: ['North', 'South'], Month: ['Jan'] };

describe('actions.ts senders — a write carries no layout (review 2026-11-02, C4)', () => {
  beforeEach(() => {
    post.mockReset();
    mockSubsets.mockReset().mockReturnValue(SEEDED_SUBSETS);
    state.dimensions = ['Region', 'Month'];
    state.rowDims = ['Region'];
    state.colDims = ['Month'];
    state.existingViewName = null;
    state.existingViewIsPrivate = false;
    state.titleOverride = true;
    state.lastMatrix = {
      rowElements: ['North'], colElements: ['Jan'],
      values: {}, rowDims: ['Region'], colDims: ['Month'],
      rowTuples: [['North']], colTuples: [['Jan']],
    };
  });

  it('sendSpread posts the target only', () => {
    const ok = sendSpread('repeat', 42, 0, 0);
    expect(ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    const msg = post.mock.calls[0][0];
    expect(msg.type).toBe('spread');
    expect(msg.coordinates).toEqual(['North', 'Jan']);
    for (const k of ['rowDims', 'colDims', 'titleAssignments', 'existingViewName', 'dimSubsets', 'titleOverride']) {
      expect(msg).not.toHaveProperty(k);
    }
  });

  it('sendSpreadBulk posts the targets only', () => {
    const ok = sendSpreadBulk('repeat', 7, [{ ri: 0, ci: 0 }]);
    expect(ok).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    const msg = post.mock.calls[0][0];
    expect(msg.type).toBe('spreadBulk');
    expect(msg.targets).toEqual([{ ri: 0, ci: 0, coordinates: ['North', 'Jan'] }]);
    for (const k of ['rowDims', 'colDims', 'titleAssignments', 'existingViewName', 'dimSubsets', 'titleOverride']) {
      expect(msg).not.toHaveProperty(k);
    }
  });
});

/**
 * `applyPaste` (paste.ts) follows the same rule as the two senders above. Seeds enough of `state` for `planPaste`
 * to accept the paste (a `lastMatrix` with tuples, `renderedRowIdx`/
 * `renderedColIdx`, a `selectionAnchor`) so `applyPaste` runs all the way
 * through to the real `vscode.postMessage` call, not just up to a refusal.
 */
describe('paste.ts — applyPaste posts the write only (review 2026-11-02, C4)', () => {
  beforeEach(() => {
    post.mockReset();
    mockSubsets.mockReset().mockReturnValue(SEEDED_SUBSETS);
    state.dimensions = ['Region', 'Month'];
    state.rowDims = ['Region'];
    state.colDims = ['Month'];
    state.existingViewName = null;
    state.existingViewIsPrivate = false;
    state.titleOverride = true;
    state.selectionAnchor = { ri: 0, ci: 0 };
    state.renderedRowIdx = [0];
    state.renderedColIdx = [0];
    state.lastMatrix = {
      rowElements: ['North'], colElements: ['Jan'],
      values: {}, rowDims: ['Region'], colDims: ['Month'],
      rowTuples: [['North']], colTuples: [['Jan']],
      cellFlags: {},
    };
  });

  it('posts a cellEditBulk with the pasted target and no layout', async () => {
    await applyPaste('5');
    expect(post).toHaveBeenCalledTimes(1);
    const msg = post.mock.calls[0][0];
    expect(msg.type).toBe('cellEditBulk');
    expect(msg.targets).toEqual([{ ri: 0, ci: 0, value: 5, coordinates: ['North', 'Jan'], picklistDef: null }]);
    for (const k of ['rowDims', 'colDims', 'titleAssignments', 'existingViewName', 'dimSubsets', 'titleOverride']) {
      expect(msg).not.toHaveProperty(k);
    }
  });
});

/**
 * Del (clear.ts) writes via the same path as Ctrl+V (`bulkWrite.ts`).
 * Checked here is WHAT gets written: the empty value `''` — the distinction "number vs. string"
 * when writing cells is measured live and locale-sensitive; an accidentally
 * sent `0` would be something else than a cleared cell.
 */
describe('clear.ts — applyClear clears the selection via the same write path', () => {
  beforeEach(() => {
    post.mockReset();
    mockSubsets.mockReset().mockReturnValue(SEEDED_SUBSETS);
    state.dimensions = ['Region', 'Month'];
    state.rowDims = ['Region'];
    state.colDims = ['Month'];
    state.existingViewName = null;
    state.existingViewIsPrivate = false;
    state.titleOverride = true;
    state.selection = new Set(['0,0']);
    state.lastMatrix = {
      rowElements: ['North'], colElements: ['Jan'],
      values: { '0,0': '15,50' }, rowDims: ['Region'], colDims: ['Month'],
      rowTuples: [['North']], colTuples: [['Jan']],
      cellFlags: {},
      rawValues: { '0,0': '15.5' },
    };
  });

  it('posts a cellEditBulk with the empty value', () => {
    applyClear();
    expect(post).toHaveBeenCalledTimes(1);
    const msg = post.mock.calls[0][0];
    expect(msg.type).toBe('cellEditBulk');
    expect(msg.targets).toEqual([{ ri: 0, ci: 0, value: '', coordinates: ['North', 'Jan'], picklistDef: null }]);
  });

  it('a locked cell in the selection prevents ANY write', () => {
    state.selection = new Set(['0,0']);
    state.lastMatrix!.cellFlags = { '0,0': { c: 1 } };
    applyClear();
    expect(post).not.toHaveBeenCalled();
  });

  it('an empty selection writes nothing', () => {
    state.selection = new Set();
    applyClear();
    expect(post).not.toHaveBeenCalled();
  });

  // The success message hangs on this marker: the host only tallies
  // writes and cannot tell "cleared" from "written".
  //
  // ORDER-PROOF (found under `--sequence.shuffle`, seed 20260824):
  //
  //  (a) `applyPaste` needs more preconditions than `applyClear` —
  //      `selectionAnchor`, `renderedRowIdx`, `renderedColIdx`. Otherwise those are set
  //      only by the `beforeEach` of the paste block, and that one ran first here merely
  //      because of file order. If the clear block came first, `applyPaste`
  //      refused SILENTLY (no post, no message) and the marker stayed
  //      put. The test therefore sets them itself.
  //  (b) `_lastKind` is module-global in `bulkWrite.ts` and has NO
  //      `_reset…ForTest` exit (production code is not changed here; a
  //      `vi.resetModules()` would cut the test off from the `state` object
  //      it has just filled). Instead of cleaning up the initial value, the
  //      test first sets it to 'clear' itself and then checks BOTH transitions —
  //      which makes it independent of any inherited value.
  //  (c) Every step checks that a post really happened. Without that, a
  //      silent refusal could not be told apart from a marker left standing —
  //      exactly the mix-up that (a) had hidden.
  it('remembers the occasion for the success message', async () => {
    state.selectionAnchor = { ri: 0, ci: 0 };
    state.renderedRowIdx = [0];
    state.renderedColIdx = [0];

    applyClear();
    expect(post).toHaveBeenCalledTimes(1);
    expect(lastBulkKind()).toBe('clear');

    post.mockClear();
    await applyPaste('5');
    expect(post).toHaveBeenCalledTimes(1);
    expect(lastBulkKind()).toBe('paste');

    post.mockClear();
    applyClear();
    expect(post).toHaveBeenCalledTimes(1);
    expect(lastBulkKind()).toBe('clear');
  });
});

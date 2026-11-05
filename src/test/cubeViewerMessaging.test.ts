import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
// Deliberately NOT mocked: the clamp must be exercised with the real budget,
// otherwise the test only proves that a stub returns what the stub was told.
import { rowsForCellBudget, CELL_PAGE_BUDGET } from '../commands/cubeViewer/cellBudgetPure';

// ─── module mocks ──────────────────────────────────────────────────────────────
// Keep all values inside the factory — outer consts cause TDZ when vi.mock is hoisted.

// Only the serialization is replaced; everything else, `post` included, is real.
// `post` used to be stubbed, which was harmless while handlers posted raw — since
// D1 (2026-10-04) every message goes through it and must reach the mock panel.
// Only the serialization is replaced; everything else comes for real from
// the module. A hand-written full dummy concealed, during the scoping rework,
// the new export `knownNamesPerDim` — the handler then threw `undefined is not a
// function`, which the test saw as "no cellData" instead of as a gap in the dummy.
vi.mock('../commands/cubeViewer/state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../commands/cubeViewer/state')>()),
  runSerializedRefresh: vi.fn((_key: string, task: () => Promise<void>) => task()),
  clearRefreshState: vi.fn(),
  esc: (s: string) => s.replace(/'/g, "''"),
}));

vi.mock('../commands/cubeViewer/cellsetState', () => ({
  dropPanelCellset: vi.fn(),
  _stashPageContext: vi.fn(),
}));

// Without this dummy the picklist path would run into the real network: `picklistApi`
// imports the transport directly (`tm1Rest/client`), because the facade is forbidden to the
// deep layers — a test that only mocks `tm1Client` ends here
// in timeouts instead of in a clear error (docs/architecture/import-rules.md, "Test mocks").
vi.mock('../commands/cubeViewer/picklistApi', () => ({
  hasPicklistCube: vi.fn().mockResolvedValue(false),
  fetchElementPicklists: vi.fn().mockResolvedValue({}),
  fetchRulePicklists: vi.fn().mockResolvedValue({}),
  fetchCellPicklist: vi.fn().mockResolvedValue(null),
  resolvePicklist: vi.fn().mockResolvedValue(null),
  invalidatePicklistResolutions: vi.fn(),
  disposePicklistCachesForServer: vi.fn(),
}));
vi.mock('../providers/bestEffortLog', () => ({
  logBestEffort: vi.fn(),
}));
vi.mock('../commands/cubeViewer/cubeViewerLog', () => ({
  logCubeViewer: vi.fn(),
}));

vi.mock('../commands/cubeViewer/cellset', () => ({
  _fetchCellPage: vi.fn(),
  _fetchTuplePage: vi.fn(),
  CELL_PAGE_ROWS: 300,
  CellsetNotFoundError: class CellsetNotFoundError extends Error {
    constructor(cellsetId: string) {
      super(`Cellset not found: ${cellsetId}`);
      this.name = 'CellsetNotFoundError';
    }
  },
}));

vi.mock('../commands/cubeViewer/fetch', () => ({
  _fetchDimElementsTree: vi.fn(),
  _fetchAllViews: vi.fn(),
  _fetchViewAxisConfig: vi.fn(),
  _fetchViewAxisSubsets: vi.fn(),
  _fetchSubtreeMemberNames: vi.fn(),
  _fetchCubeDimensions: vi.fn(),
  VIEW_AXIS_ELEMENTS_MAX: 10000,
}));
vi.mock('../commands/cubeViewer/cellEdit', () => ({
  handleCellEditMessage: vi.fn(),
}));
vi.mock('../commands/cubeViewer/spread', () => ({
  handleSpreadMessage: vi.fn(),
}));
vi.mock('../commands/cubeViewer/csv', () => ({
  _saveCsvFile: vi.fn(),
}));
// `_viewAxisBaseline` and `clearViewAxisWarnings` stay REAL (Task 8: they now
// live in view.ts, called directly — and only — by `saveView`/
// `clearPanelMessagingState` here, a genuine cross-module call). `_saveView`
// stays a stub so its call args can be inspected without a real write.
// `refreshCurrentLayout` stays a stub too — the decision it makes (saved
// view vs. work-in-progress, baseline merge, degradation warnings) is proven
// directly against the real function in `cubeViewerViewSubsets.test.ts`,
// because `refreshCurrentLayout` calls `_readExistingView`/
// `_refreshWithTempView`, all as SAME-MODULE references that no external mock
// of this module can intercept — leaving the real chain live here would run
// straight through to the (unmocked) network layer and hang.
vi.mock('../commands/cubeViewer/view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../commands/cubeViewer/view')>()),
  _saveView: vi.fn(),
  refreshCurrentLayout: vi.fn(),
}));
vi.mock('../commands/cubeViewer/executeMdxInline', () => ({
  _executeMdxInline: vi.fn(),
}));
// Fix Round 1, FINDING 5: `_readExistingView`/`_refreshWithTempView`/`saveMdxView`
// stay REAL via the `importOriginal` spread above, and `executeView`/`tm1Client`
// are NOT mocked anywhere in this file — no current test reaches that far, but
// the next one that exercises `switchView` (or anything else landing on
// `_readExistingView`) would fall straight through to the real network and
// hang (the same trap that already cost three timeouts before it was mocked
// elsewhere). Mocked defensively here so that stays true.
vi.mock('../commands/cubeViewer/executeView', () => ({
  _executeView: vi.fn(),
}));
vi.mock('../commands/cubeViewer/axisMeta', () => ({
  _buildAxisMeta: vi.fn(),
  levelsForSlice: vi.fn(),
}));
vi.mock('../commands/dimension/dimensionBrowser', () => ({
  openDimensionBrowser: vi.fn(),
}));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(),
  formatServerLabel: vi.fn(),
}));
vi.mock('../commands/mdx/mdxRunner', () => ({
  MdxRunnerManager: { openWithMdx: vi.fn() },
}));

import { _handleMessage, clearPanelMessagingState } from '../commands/cubeViewer/messaging';
import { _dimSelections, _activeInlineMdx, _cellsets, _panels, runSerializedRefresh } from '../commands/cubeViewer/state';
import {
  hasPicklistCube, fetchElementPicklists, fetchRulePicklists, fetchCellPicklist,
  resolvePicklist, invalidatePicklistResolutions,
} from '../commands/cubeViewer/picklistApi';
import {
  _fetchDimElementsTree, _fetchSubtreeMemberNames, _fetchViewAxisSubsets, _fetchCubeDimensions,
} from '../commands/cubeViewer/fetch';
import { handleCellEditMessage } from '../commands/cubeViewer/cellEdit';
import { _fetchCellPage, _fetchTuplePage, CellsetNotFoundError } from '../commands/cubeViewer/cellset';
import { levelsForSlice, _buildAxisMeta } from '../commands/cubeViewer/axisMeta';
import { dropPanelCellset } from '../commands/cubeViewer/cellsetState';
import { _saveView, refreshCurrentLayout } from '../commands/cubeViewer/view';
import { openDimensionBrowser } from '../commands/dimension/dimensionBrowser';
import { _executeMdxInline } from '../commands/cubeViewer/executeMdxInline';

const CONFIG = {
  serverUrl: 'http://tm1:8001',
  username: 'admin',
  password: 'p',
  rejectUnauthorized: false,
  authType: 'Basic' as const,
};
const PANEL_KEY = 'panel1';
const CUBE = 'SalesCube';

function makePanel(): vscode.WebviewPanel {
  return {
    title: 'CubeViewer',
    webview: {
      postMessage: vi.fn().mockResolvedValue(true),
      html: '',
      onDidReceiveMessage: vi.fn(),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    reveal: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

function posted(panel: vscode.WebviewPanel) {
  return (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
}

function call(panel: vscode.WebviewPanel, msg: Record<string, any>) {
  return _handleMessage(PANEL_KEY, panel, msg as any, CUBE, undefined, false, CONFIG);
}

beforeEach(() => {
  vi.resetAllMocks();
  _dimSelections.clear();
  _activeInlineMdx.clear();
  // Re-apply default: execute task immediately (cleared by resetAllMocks)
  (runSerializedRefresh as ReturnType<typeof vi.fn>).mockImplementation(
    (_key: string, task: () => Promise<void>) => task(),
  );
});

describe('_handleMessage — cubeViewer', () => {
  // ─── dimension selection (pure state + postMessage) ───────────────────────

  it('clearDimSelection — removes dim from selection map without postMessage', async () => {
    _dimSelections.set(PANEL_KEY, { Region: { kind: 'elements', names: ['North'] } });
    const panel = makePanel();
    await call(panel, { type: 'clearDimSelection', dimName: 'Region' });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({});
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('clearDimFilter — removes dim and posts null selection with autoRefresh', async () => {
    _dimSelections.set(PANEL_KEY, { Region: { kind: 'elements', names: ['North'] } });
    const panel = makePanel();
    await call(panel, { type: 'clearDimFilter', dimName: 'Region' });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({});
    expect(posted(panel)).toContainEqual({
      type: 'dimSelectionUpdate',
      dimName: 'Region',
      selection: null,
      autoRefresh: true,
    });
  });

  it('setDimFilterElements — sets named elements and posts update', async () => {
    const panel = makePanel();
    await call(panel, { type: 'setDimFilterElements', dimName: 'Period', names: ['2023', '2024'] });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Period: { kind: 'elements', names: ['2023', '2024'] },
    });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Period', autoRefresh: true }),
    );
  });

  it('setDimFilterExpression — writes the carried-forward expression along and triggers a reload', async () => {
    // Collapse click on an axis that travels as an expression (C3, 2026-08-20). The
    // host MUST keep the selection: the refresh of a NativeView reads it from
    // this map, not from the webview state.
    _dimSelections.set(PANEL_KEY, {
      Region: { kind: 'expression', expression: '{TM1SUBSETALL([Region].[Region])}' },
    });
    const panel = makePanel();
    const next = '{DRILLDOWNMEMBER({TM1SUBSETALL([Region].[Region])}, {[Region].[Region].[North]})}';
    await call(panel, { type: 'setDimFilterExpression', dimName: 'Region', expression: next });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Region: { kind: 'expression', expression: next },
    });
    expect(posted(panel)).toContainEqual({
      type: 'dimSelectionUpdate',
      dimName: 'Region',
      selection: { kind: 'expression', expression: next },
      autoRefresh: true,
    });
  });

  it('setDimFilterExpression — an empty expression clears the selection away', async () => {
    _dimSelections.set(PANEL_KEY, {
      Region: { kind: 'expression', expression: '{TM1SUBSETALL([Region].[Region])}' },
    });
    const panel = makePanel();
    await call(panel, { type: 'setDimFilterExpression', dimName: 'Region', expression: '' });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({});
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Region', selection: null }),
    );
  });

  it('setDimFilterElements — `silent` writes the selection along without triggering a refresh', async () => {
    // Collapsing only removes rows that are already loaded; the webview hides
    // them itself. The host must still know the shrunken set,
    // so that the NEXT real refresh builds on it — sending an update
    // back would mean running a refresh for it that fetches nothing.
    const panel = makePanel();
    await call(panel, {
      type: 'setDimFilterElements', dimName: 'Period', names: ['2023'], silent: true,
    });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Period: { kind: 'elements', names: ['2023'] },
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('setDimFilterElements — deletes entry when names is empty', async () => {
    _dimSelections.set(PANEL_KEY, { Period: { kind: 'elements', names: ['2023'] } });
    const panel = makePanel();
    await call(panel, { type: 'setDimFilterElements', dimName: 'Period', names: [] });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({});
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Period', selection: null }),
    );
  });

  it('expandSubtree — fetches full descendants and applies them as element filter', async () => {
    (_fetchSubtreeMemberNames as ReturnType<typeof vi.fn>).mockResolvedValue(['EU', 'DE', 'FR']);
    const panel = makePanel();
    await call(panel, { type: 'expandSubtree', dimName: 'Region', names: ['EU'] });
    expect(_fetchSubtreeMemberNames).toHaveBeenCalledWith('Region', ['EU'], expect.anything(), 'all');
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Region: { kind: 'elements', names: ['EU', 'DE', 'FR'] },
    });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Region', autoRefresh: true }),
    );
  });

  it('expandSubtree — forwards mode (leaves) to the subtree resolver', async () => {
    (_fetchSubtreeMemberNames as ReturnType<typeof vi.fn>).mockResolvedValue(['DE', 'FR']);
    const panel = makePanel();
    await call(panel, { type: 'expandSubtree', dimName: 'Region', names: ['EU'], mode: 'leaves' });
    expect(_fetchSubtreeMemberNames).toHaveBeenCalledWith('Region', ['EU'], expect.anything(), 'leaves');
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Region: { kind: 'elements', names: ['DE', 'FR'] },
    });
  });

  it('expandSubtree — posts error and leaves selection untouched on fetch failure', async () => {
    (_fetchSubtreeMemberNames as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const panel = makePanel();
    await call(panel, { type: 'expandSubtree', dimName: 'Region', names: ['EU'] });
    expect(_dimSelections.get(PANEL_KEY)).toBeUndefined();
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'error' }));
  });

  // ─── openDimBrowser — reorder-vs-no-op detection ──────────────────────────

  function captureOnSelect() {
    const calls = (openDimensionBrowser as ReturnType<typeof vi.fn>).mock.calls;
    const options = calls[calls.length - 1][2] as {
      onSelect: (sel: { kind: string; names: string[] }, displayAlias?: string) => void;
    };
    return options.onSelect;
  }

  // ─── openDimBrowser — window/column handoff ───────────────────────────────
  // The cube viewer can stand in a window of its own via "Move Editor into New
  // Window". Then it MUST pass its own `viewColumn` to the picker,
  // otherwise the Dimension Browser opens in the main window.

  function lastBrowserOptions(): Record<string, unknown> {
    const calls = (openDimensionBrowser as ReturnType<typeof vi.fn>).mock.calls;
    return calls[calls.length - 1][2] as Record<string, unknown>;
  }

  it('openDimBrowser — forwards the calling panel\'s column so the picker opens in ITS window', async () => {
    const panel = makePanel();
    (panel as { viewColumn?: vscode.ViewColumn }).viewColumn = vscode.ViewColumn.Three;
    await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'] });
    expect(lastBrowserOptions().viewColumn).toBe(vscode.ViewColumn.Three);
  });

  it('openDimBrowser — hidden panel (viewColumn undefined) omits the field instead of forcing column One', async () => {
    // Both branches in ONE test, otherwise the undefined case proves nothing: without
    // the fix the field is never set, so the undefined branch would be green
    // even then. Only the visible branch tells fixed from unfixed.
    const hidden = makePanel();
    (hidden as { viewColumn?: vscode.ViewColumn }).viewColumn = undefined;
    await call(hidden, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'] });
    const hiddenOptions = lastBrowserOptions();
    // The field must not be set at all — the host then decides with
    // its default `Active`. A `?? ViewColumn.One` would be the relapse into the bug.
    expect('viewColumn' in hiddenOptions).toBe(false);
    expect(hiddenOptions.viewColumn).not.toBe(vscode.ViewColumn.One);

    const visible = makePanel();
    (visible as { viewColumn?: vscode.ViewColumn }).viewColumn = vscode.ViewColumn.Two;
    await call(visible, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'] });
    // … but the handler is very much column-aware when there is something to
    // pass on — otherwise the omission above would only be chance.
    expect(lastBrowserOptions().viewColumn).toBe(vscode.ViewColumn.Two);
  });

  it('openDimBrowser — never hard-codes column One, whatever column the viewer sits in', async () => {
    for (const col of [vscode.ViewColumn.One, vscode.ViewColumn.Two, vscode.ViewColumn.Three]) {
      const panel = makePanel();
      (panel as { viewColumn?: vscode.ViewColumn }).viewColumn = col;
      await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'] });
      // The picker follows the viewer instead of always landing in column One.
      expect(lastBrowserOptions().viewColumn).toBe(col);
    }
  });

  // ─── openDimBrowser — axis expression as the base ───────────────────────────
  // An MDX view carries its collapse state as a DRILL*MEMBER chain on the
  // axis. `currentElements` next to it is only a projection of the RESULT:
  // until 2026-08-20 the browser therefore opened at zero (only the roots of the
  // dimension), although the axis showed something completely different.

  it('openDimBrowser — passes the axis expression through as the page base', async () => {
    const expr = '{DRILLUPMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[EBIT]})}';
    await call(makePanel(), {
      type: 'openDimBrowser', dimName: 'Konten',
      currentElements: ['EBIT'], currentExpression: expr,
    });
    expect(lastBrowserOptions().initialSourceMdx).toBe(expr);
    // The preselection stays next to it — it is the selection, not the base.
    expect(lastBrowserOptions().initialSelection).toEqual(['EBIT']);
  });

  it('openDimBrowser — without an expression the field stays absent instead of being set empty', async () => {
    // A set `initialSourceMdx: ''` would be a base that describes
    // nothing; the browser should then open on the whole dimension
    // as before.
    await call(makePanel(), { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'] });
    expect('initialSourceMdx' in lastBrowserOptions()).toBe(false);
    await call(makePanel(), {
      type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'], currentExpression: '',
    });
    expect('initialSourceMdx' in lastBrowserOptions()).toBe(false);
  });

  it('openDimBrowser — commits to the expression answer', async () => {
    await call(makePanel(), { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A'] });
    // The viewer puts MDX on the axis, so the browser may answer with MDX.
    expect(lastBrowserOptions().acceptsExpression).toBe(true);
  });

  it('openDimBrowser — a confirmed expression becomes the axis selection', async () => {
    const base = '{[Konten].[Konten].MEMBERS}';
    const drilled = '{DRILLDOWNMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[EBIT]})}';
    const panel = makePanel();
    await call(panel, {
      type: 'openDimBrowser', dimName: 'Konten',
      currentElements: ['EBIT'], currentExpression: base,
    });
    captureOnSelect()({ kind: 'expression', expression: drilled } as never);
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Konten: { kind: 'expression', expression: drilled },
    });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({
        type: 'dimSelectionUpdate', dimName: 'Konten',
        selection: { kind: 'expression', expression: drilled }, autoRefresh: true,
      }),
    );
  });

  it('openDimBrowser — the same expression back is a no-op', async () => {
    // Opening and confirming without a change must not rewrite the view:
    // otherwise the refresh tips over to the user-filter path and loses the
    // view configuration (alias, suppress).
    const base = '{DRILLUPMEMBER([Konten].[Konten].MEMBERS , {[Konten].[Konten].[EBIT]})}';
    const panel = makePanel();
    await call(panel, {
      type: 'openDimBrowser', dimName: 'Konten',
      currentElements: ['EBIT'], currentExpression: base,
    });
    captureOnSelect()({ kind: 'expression', expression: `  ${base}  ` } as never);
    expect(_dimSelections.get(PANEL_KEY)?.Konten).toBeUndefined();
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Konten', selection: null, autoRefresh: false }),
    );
  });

  it('openDimBrowser — same order confirmed → no-op, selection stays unset', async () => {
    const panel = makePanel();
    await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A', 'B', 'C'] });
    captureOnSelect()({ kind: 'elements', names: ['A', 'B', 'C'] });
    expect(_dimSelections.get(PANEL_KEY)?.Region).toBeUndefined();
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Region', selection: null, autoRefresh: false }),
    );
  });

  it('openDimBrowser — reordered confirm → NOT a no-op, selection applied with autoRefresh', async () => {
    const panel = makePanel();
    await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A', 'B', 'C'] });
    captureOnSelect()({ kind: 'elements', names: ['B', 'A', 'C'] });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Region: { kind: 'elements', names: ['B', 'A', 'C'] },
    });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({
        type: 'dimSelectionUpdate', dimName: 'Region',
        selection: { kind: 'elements', names: ['B', 'A', 'C'] }, autoRefresh: true,
      }),
    );
  });

  it('openDimBrowser — element removed → NOT a no-op', async () => {
    const panel = makePanel();
    await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A', 'B', 'C'] });
    captureOnSelect()({ kind: 'elements', names: ['A', 'B'] });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Region: { kind: 'elements', names: ['A', 'B'] },
    });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Region', autoRefresh: true }),
    );
  });

  it('openDimBrowser — duplicates moved to different positions → NOT a no-op', async () => {
    const panel = makePanel();
    await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A', 'B', 'A'] });
    captureOnSelect()({ kind: 'elements', names: ['A', 'A', 'B'] });
    expect(_dimSelections.get(PANEL_KEY)).toEqual({
      Region: { kind: 'elements', names: ['A', 'A', 'B'] },
    });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'dimSelectionUpdate', dimName: 'Region', autoRefresh: true }),
    );
  });

  // Click test flameY3T1, 2026-08-12: saved view open, filter chip of an
  // axis → "All" → confirm. Until then the host deleted the entry ("no
  // filter"), the refresh then read the saved view again — and
  // with that exactly the subset the user had just wanted to get out of. On the
  // screen nothing changed. The whole dimension is a STATEMENT and must
  // therefore stay as a selection.
  it('openDimBrowser — "All" stays a selection instead of deleting the filter', async () => {
    const panel = makePanel();
    await call(panel, { type: 'openDimBrowser', dimName: 'Region', currentElements: ['A', 'B'] });
    captureOnSelect()({ kind: 'all' } as never);
    expect(_dimSelections.get(PANEL_KEY)).toEqual({ Region: { kind: 'all' } });
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({
        type: 'dimSelectionUpdate', dimName: 'Region',
        selection: { kind: 'all' }, autoRefresh: true,
      }),
    );
  });

  // ─── fetchElements ────────────────────────────────────────────────────────

  it('fetchElements — fetches tree and posts elementsData', async () => {
    const tree = [{ name: 'North', type: 'N', level: 0, children: [] }];
    ((_fetchDimElementsTree as ReturnType<typeof vi.fn>)).mockResolvedValue(tree);
    const panel = makePanel();
    await call(panel, { type: 'fetchElements', dimName: 'Region' });
    expect(_fetchDimElementsTree).toHaveBeenCalledWith('Region', CONFIG);
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'elementsData', dimName: 'Region', elements: tree }),
    );
  });

  it('fetchElements — M12: concurrent requests for the same dim are deduped to one fetch', async () => {
    // Re-opening a slow 100k-element dropdown used to start a second (third, …)
    // _fetchDimElementsTree, holding N full element trees in host memory.
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((res) => { release = res; });
    (_fetchDimElementsTree as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await gate;
      return [{ name: 'North', depth: 0 }];
    });
    const panel = makePanel();
    const a = call(panel, { type: 'fetchElements', dimName: 'Region' });
    const b = call(panel, { type: 'fetchElements', dimName: 'Region' });
    const c = call(panel, { type: 'fetchElements', dimName: 'Region' });
    release(undefined);
    await Promise.all([a, b, c]);

    expect(_fetchDimElementsTree).toHaveBeenCalledTimes(1);
    expect(posted(panel).filter((m) => m.type === 'elementsData')).toHaveLength(1);
  });

  it('fetchElements — a different dim is not blocked by an in-flight fetch', async () => {
    (_fetchDimElementsTree as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const panel = makePanel();
    await Promise.all([
      call(panel, { type: 'fetchElements', dimName: 'Region' }),
      call(panel, { type: 'fetchElements', dimName: 'Month' }),
    ]);
    expect(_fetchDimElementsTree).toHaveBeenCalledTimes(2);
  });

  it('fetchElements — the in-flight marker is released after a failure so the dim can be retried', async () => {
    (_fetchDimElementsTree as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const panel = makePanel();
    await expect(call(panel, { type: 'fetchElements', dimName: 'Region' })).rejects.toThrow('boom');
    (_fetchDimElementsTree as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await call(panel, { type: 'fetchElements', dimName: 'Region' });
    expect(_fetchDimElementsTree).toHaveBeenCalledTimes(2);
  });

  // ─── cellEdit ────────────────────────────────────────────────────────────────

  it('cellEdit — delegates to handler and posts cellEditResult', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, ri: 0, ci: 0 });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEdit',
      dimensions: ['Region', 'Period'],
      coordinates: ['North', '2024'],
      value: 100,
      ri: 0,
      ci: 0,
    });
    expect(handleCellEditMessage).toHaveBeenCalled();
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'cellEditResult', ok: true }),
    );
  });

  // Review 2026-11-02, C4: the refresh after a write comes from the webview,
  // with its current layout and its own reqId. Sent from here, it took its
  // serializer slot only after the write and overtook a newer pivot.
  it('cellEdit — a successful write does not refresh on the host', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, ri: 0, ci: 0 });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEdit',
      dimensions: ['Region', 'Period'],
      coordinates: ['North', '2024'],
      value: 100,
      ri: 0,
      ci: 0,
      rowDims: ['Region'], colDims: ['Period'], titleAssignments: {},
    });
    expect(runSerializedRefresh).not.toHaveBeenCalled();
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'cellEditResult', ok: true }));
  });

  it('cellEdit — a failed write triggers no refresh', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ ok: false, ri: 0, ci: 0, error: { kind: 'security', message: 'no' } });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEdit',
      dimensions: ['Region', 'Period'],
      coordinates: ['North', '2024'],
      value: 100,
      ri: 0,
      ci: 0,
      rowDims: ['Region'], colDims: ['Period'], titleAssignments: {},
    });
    expect(runSerializedRefresh).not.toHaveBeenCalled();
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'cellEditResult', ok: false }),
    );
  });

  // ─── runInlineMdx guard ───────────────────────────────────────────────────

  it('runInlineMdx — posts error immediately when MDX is whitespace-only', async () => {
    const panel = makePanel();
    await call(panel, { type: 'runInlineMdx', mdx: '   ' });
    expect(posted(panel)).toContainEqual({ type: 'error', message: 'MDX is empty.' });
    expect(runSerializedRefresh).not.toHaveBeenCalled();
  });

  it('runInlineMdx — posts error when MDX property is absent', async () => {
    const panel = makePanel();
    await call(panel, { type: 'runInlineMdx' });
    expect(posted(panel)).toContainEqual({ type: 'error', message: 'MDX is empty.' });
  });

  // ─── fetchCellPage ────────────────────────────────────────────────────────────

  it('fetchCellPage — calls _fetchCellPage with correct args and posts cellPage', async () => {
    const values = { '100,0': '7,00' };
    const cellFlags = {};
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values, cellFlags });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID', numCols: 10, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2 });

    expect(_fetchCellPage).toHaveBeenCalledWith('CID', 100, 2, 10, CONFIG);
    expect(posted(panel)).toContainEqual({
      type: 'cellPage',
      startRow: 100,
      cellsetId: 'CID',
      values,
      cellFlags,
      rowElements: [],
      rowTuples: [],
      rowLevels: undefined,
    });
  });

  it('fetchCellPage — race protocol (P1-3): drops the response when the cellset was superseded mid-flight', async () => {
    // Simulate a refresh completing WHILE the page fetch is in flight: the
    // mocked _fetchCellPage mutates _cellsets to a new generation before
    // resolving, mirroring a runSerializedRefresh-driven cellset swap that
    // races with the (unserialized) fetchCellPage handler.
    const values = { '100,0': 'STALE' };
    const cellFlags = {};
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_NEW', numCols: 10, totalRows: 5000, config: CONFIG });
      return { values, cellFlags };
    });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_OLD', numCols: 10, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2 });

    // The stale page must never reach the webview — splicing it in by
    // absolute row index would corrupt the (now different) current matrix.
    expect(posted(panel).some((m) => m.type === 'cellPage')).toBe(false);
    expect(posted(panel).some((m) => m.type === 'error')).toBe(false);
  });

  it('fetchCellPage — skips the fetch entirely when the client-reported cellsetId is already stale', async () => {
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_HOST', numCols: 10, totalRows: 5000, config: CONFIG });
    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2, cellsetId: 'CID_CLIENT_STALE' });

    expect(_fetchCellPage).not.toHaveBeenCalled();
    expect(_fetchTuplePage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('fetchCellPage — no-op when panel has no registered cellset', async () => {
    (_cellsets as Map<string, any>).clear();
    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 0, rowCount: 10 });
    expect(_fetchCellPage).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('fetchCellPage — posts rowTuples + rowElements + rowLevels when cellset has rowDims/levelMaps', async () => {
    const values = {};
    const cellFlags = {};
    const tuples: string[][] = [['A'], ['A']];
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values, cellFlags });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue(tuples);
    (levelsForSlice as ReturnType<typeof vi.fn>).mockReturnValue([[0], [0]]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, {
      id: 'CID2', numCols: 5, totalRows: 1000, config: CONFIG,
      rowDims: ['dimA'], levelMaps: [new Map([['A', 0]])],
    });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 300, rowCount: 300 });

    expect(_fetchTuplePage).toHaveBeenCalledWith('CID2', 1, 300, 300, CONFIG);
    const msg = (posted(panel) as any[]).find((m) => m.type === 'cellPage');
    expect(msg).toBeDefined();
    expect(msg.rowTuples).toEqual(tuples);
    expect(msg.rowElements).toEqual(['A', 'A']);
    expect(msg.rowLevels).toEqual([[0], [0]]);
  });

  it('fetchCellPage — passes along the parentage of the new rows when loading more', async () => {
    // Since the scoping (Task 1–4) the client only holds the parent maps
    // of its loaded rows. A page loaded later brings NEW names along —
    // without a top-up they indent flat and lose their collapse triangle.
    const tuples: string[][] = [['Kto100'], ['Kto200']];
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue(tuples);
    (levelsForSlice as ReturnType<typeof vi.fn>).mockReturnValue([[2], [2]]);
    // The mock builds its answer from the passed tuple argument, so that the
    // test blows up if the scoping ran over the wrong tuples
    // (e.g. over those of the first page instead of over the ones loaded later).
    (_buildAxisMeta as ReturnType<typeof vi.fn>).mockImplementation(
      async (dims: string[], tp: string[][]) => ({
        levels: null,
        parents: dims.map((_d, di) => Object.fromEntries(tp.map((t) => [t[di], `P_${t[di]}`]))),
        allParents: dims.map((_d, di) => Object.fromEntries(tp.map((t) => [t[di], [`P_${t[di]}`]]))),
        hasChildren: dims.map(() => ({ P_Kto100: true })),
        levelMaps: [],
      }),
    );
    (_cellsets as Map<string, any>).set(PANEL_KEY, {
      id: 'CID_DELTA', numCols: 5, totalRows: 85777, config: CONFIG,
      rowDims: ['Konten'], levelMaps: [new Map([['Kto100', 2]])],
    });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 8333, rowCount: 300 });

    expect(_buildAxisMeta).toHaveBeenCalledWith(['Konten'], tuples, CONFIG);
    const page = (posted(panel) as any[]).filter((m) => m.type === 'cellPage').pop();
    expect(page.rowParentsDelta).toBeDefined();
    // One map per row dimension — the tuple width is the same number.
    expect(page.rowParentsDelta.length).toBe(page.rowTuples[0].length);
    // The name of the first row loaded later must be resolvable in its dimension:
    expect(page.rowParentsDelta[0][page.rowTuples[0][0]]).toBe('P_Kto100');
    expect(page.rowAllParentsDelta[0][page.rowTuples[1][0]]).toEqual(['P_Kto200']);
    expect(page.rowHasChildrenDelta[0]).toEqual({ P_Kto100: true });
  });

  it('fetchCellPage — discards the page when the cellset is superseded only DURING the scoping', async () => {
    // The scoping is an additional await after the previous check —
    // without a second check, a page of a superseded cellset would go out after all.
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([['A']]);
    (_buildAxisMeta as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_NEWER', numCols: 5, totalRows: 100, config: CONFIG });
      return { levels: null, parents: [{}], allParents: [{}], hasChildren: [{}], levelMaps: [] };
    });
    (_cellsets as Map<string, any>).set(PANEL_KEY, {
      id: 'CID_OLDER', numCols: 5, totalRows: 100, config: CONFIG,
      rowDims: ['dimA'], levelMaps: [new Map([['A', 0]])],
    });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 300, rowCount: 300 });

    expect(posted(panel).some((m) => m.type === 'cellPage')).toBe(false);
    expect(posted(panel).some((m) => m.type === 'error')).toBe(false);
  });

  it('fetchCellPage — without rowDims no scoping and no delta fields', async () => {
    // No row dimension context (e.g. a pure MDX axis without dim names) →
    // the host must not touch the structure cache at all.
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([['A']]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, {
      id: 'CID_NODIMS', numCols: 5, totalRows: 100, config: CONFIG,
    });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2 });

    expect(_buildAxisMeta).not.toHaveBeenCalled();
    const page = (posted(panel) as any[]).filter((m) => m.type === 'cellPage').pop();
    expect(page.rowParentsDelta).toBeUndefined();
    expect(page.rowAllParentsDelta).toBeUndefined();
    expect(page.rowHasChildrenDelta).toBeUndefined();
  });

  it('fetchCellPage — rowLevels is undefined when all levelMaps are empty (mirrors page-0 null semantics)', async () => {
    // This guards the hasLevels path: levelMaps is non-empty array but every Map has size=0.
    // levelsForSlice is mocked, but hasLevels short-circuits BEFORE calling it.
    const values = {};
    const cellFlags = {};
    const tuples: string[][] = [['X'], ['Y']];
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values, cellFlags });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue(tuples);
    // levelMaps has one entry but the Map is empty (size === 0) → hasLevels must be false
    (_cellsets as Map<string, any>).set(PANEL_KEY, {
      id: 'CID_EMPTY', numCols: 5, totalRows: 5000, config: CONFIG,
      rowDims: ['dimA'], levelMaps: [new Map()],
    });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 300, rowCount: 300 });

    const msg = (posted(panel) as any[]).find((m) => m.type === 'cellPage');
    expect(msg).toBeDefined();
    // Must be undefined — NOT an array. If it were an array with holes, renderGrid crashes.
    expect(msg.rowLevels).toBeUndefined();
    // levelsForSlice must NOT have been called (hasLevels === false short-circuits it)
    expect(levelsForSlice).not.toHaveBeenCalled();
  });

  it('fetchCellPage — posts error (not cellPage) when _fetchTuplePage rejects', async () => {
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network timeout'));
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID3', numCols: 5, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 300, rowCount: 300 });

    const msgs = posted(panel);
    expect(msgs.some((m) => m.type === 'cellPage')).toBe(false);
    expect(msgs).toContainEqual({
      type: 'error',
      message: 'Failed to load cell page: Network timeout',
    });
  });

  it('fetchCellPage — posts error (not cellPage) when _fetchCellPage rejects', async () => {
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Server error 500'));
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID4', numCols: 5, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 600, rowCount: 300 });

    const msgs = posted(panel);
    expect(msgs.some((m) => m.type === 'cellPage')).toBe(false);
    expect(msgs).toContainEqual({
      type: 'error',
      message: 'Failed to load cell page: Server error 500',
    });
  });

  // ─── fetchCellPage — P1-6 cellset-expiry 404 recovery ──────────────────────

  it('fetchCellPage — 404 (CellsetNotFoundError) drops the cellset and posts cellsetExpired, not a generic error', async () => {
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockRejectedValue(new CellsetNotFoundError('CID_EXPIRED'));
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_EXPIRED', numCols: 5, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2 });

    expect(dropPanelCellset).toHaveBeenCalledWith(PANEL_KEY);
    const msgs = posted(panel);
    expect(msgs).toContainEqual({ type: 'cellsetExpired' });
    expect(msgs.some((m) => m.type === 'error')).toBe(false);
    expect(msgs.some((m) => m.type === 'cellPage')).toBe(false);
  });

  it('fetchCellPage — 404 arriving AFTER the cellset was already superseded is ignored silently (no drop, no cellsetExpired)', async () => {
    // Mirrors the real race: a refresh replaces the panel's cellset with a new
    // generation WHILE this fetch is in flight, and the stale in-flight fetch
    // then 404s (TM1 GC'd the old cellset right after the new one was minted).
    // The 404 belongs to a superseded request and must be dropped silently —
    // like the T2 post-await guard does for the success path — NOT treated as
    // a genuine expiry of the panel's (now different, current) cellset.
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_NEW', numCols: 5, totalRows: 5000, config: CONFIG });
      throw new CellsetNotFoundError('CID_OLD');
    });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_OLD', numCols: 5, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2 });

    expect(dropPanelCellset).not.toHaveBeenCalled();
    const msgs = posted(panel);
    expect(msgs.some((m) => m.type === 'cellsetExpired')).toBe(false);
    expect(msgs.some((m) => m.type === 'error')).toBe(false);
    expect(msgs.some((m) => m.type === 'cellPage')).toBe(false);
    // The new (current) cellset must remain registered — not clobbered by the stale fetch.
    expect((_cellsets as Map<string, any>).get(PANEL_KEY)?.id).toBe('CID_NEW');
  });

  it('fetchCellPage — non-404 error still posts the generic error and does NOT drop the cellset', async () => {
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network timeout'));
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_LIVE', numCols: 5, totalRows: 5000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 2 });

    expect(dropPanelCellset).not.toHaveBeenCalled();
    const msgs = posted(panel);
    expect(msgs).toContainEqual({
      type: 'error',
      message: 'Failed to load cell page: Network timeout',
    });
    expect(msgs.some((m) => m.type === 'cellsetExpired')).toBe(false);
  });

  // ─── fetchCellPage — cell budget (host clamps what the webview asks for) ───

  it('fetchCellPage — clamps a wide-view request to the cell budget', async () => {
    // The webview asks in ROWS and does not know how wide the view is; the host
    // request costs rowCount * numCols cells. 300 rows x 1000 cols = 300k cells.
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, rawValues: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_WIDE', numCols: 1000, totalRows: 500000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 0, rowCount: 300 });

    const budgeted = rowsForCellBudget(1000);
    expect((_fetchCellPage as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(budgeted);
    // Row tuples must follow the same window, otherwise headers and cells desync.
    expect((_fetchTuplePage as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe(budgeted);
  });

  it('fetchCellPage — leaves a narrow-view request untouched', async () => {
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, rawValues: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_NARROW', numCols: 5, totalRows: 500000, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 0, rowCount: 300 });

    // 300 x 5 = 1500 cells, far below the budget — no reason to shrink it.
    expect((_fetchCellPage as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(300);
  });

  it('fetchCellPage — a hostile rowCount cannot exceed the budget', async () => {
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, rawValues: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, { id: 'CID_HOSTILE', numCols: 200, totalRows: 9e6, config: CONFIG });

    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 0, rowCount: 10_000_000 });

    const asked = (_fetchCellPage as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(asked).toBe(rowsForCellBudget(200));
    expect(asked * 200).toBeLessThanOrEqual(CELL_PAGE_BUDGET);
  });

  // ─── refreshData: saved view vs. user-picked context ───────────────────────

  const REFRESH_BASE = {
    type: 'refreshData',
    rowDims: ['Region'], colDims: ['Month'],
    titleAssignments: { Year: '2026' },
    existingViewName: 'MyView', existingViewIsPrivate: false,
    dimSubsets: { Region: ['North', 'South'], Month: ['Jan'] },
    suppressRows: false, suppressCols: false,
    reqId: 42,
  };

  // The DECISION itself (saved view vs. work-in-progress, baseline merge,
  // degradation warnings) now lives in `refreshCurrentLayout` (view.ts) —
  // proven directly against the
  // real function in `cubeViewerViewSubsets.test.ts`, because it calls
  // `_readExistingView`/`_refreshWithTempView`/`_viewAxisBaseline` as
  // SAME-MODULE references that no external mock of view.ts can intercept.
  // What's left to prove here is refreshData's OWN job: resolving the layout
  // from the message/ctx and handing it off unchanged.
  it('refreshData — forwards the resolved layout to refreshCurrentLayout unchanged', async () => {
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE });
    expect(refreshCurrentLayout).toHaveBeenCalledTimes(1);
    const args = (refreshCurrentLayout as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[2]).toBe(CUBE);                  // cubeName
    expect(args[3]).toBe('MyView');               // viewName
    expect(args[4]).toBe(false);                  // isPriv
    expect(args[5]).toEqual(['Region']);           // rowDims
    expect(args[6]).toEqual(['Month']);            // colDims
    expect(args[7]).toEqual({ Year: '2026' });     // titleAssignments
    expect(args[8]).toEqual({ Region: ['North', 'South'], Month: ['Jan'] }); // dimSubsets
    expect(args[9]).toBe(false);                   // hasTitleOverride
    expect(args[10]).toBe(false);                  // suppressRows
    expect(args[11]).toBe(false);                  // suppressCols
    // F7: dropping msg.reqId would break the webview's stale-response matching
    // with no failing test — args[12] is config, reqId is the trailing arg.
    expect(args[13]).toBe(42);                     // reqId
  });

  it('refreshData — forwards titleOverride to refreshCurrentLayout', async () => {
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, titleOverride: true });
    const args = (refreshCurrentLayout as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[9]).toBe(true);
  });

  it('refreshData — a pivot\'s explicit null leaves saved-view mode instead of falling back', async () => {
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, existingViewName: null });
    const args = (refreshCurrentLayout as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[3]).toBeUndefined();
  });

  // ─── MED-2: Save must use the same axis source as the refresh ─────────────

  const SAVE_BASE = {
    type: 'saveView',
    viewName: 'Copy', isPrivate: false, overwrite: false,
    rowDims: ['Region'], colDims: ['Month'],
    titleAssignments: { Year: '2026' },
    dimSubsets: { Region: ['North', 'South'], Month: ['Jan'] },
    suppressRows: false, suppressCols: false,
    dimAliases: {}, titleSubsets: {},
  };

  it('saveView — after a context pick, Save persists the VIEW axes, not the loaded tuples', async () => {
    (_fetchViewAxisSubsets as ReturnType<typeof vi.fn>).mockResolvedValue({
      subsets: { Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false } },
      oversized: [],
    });
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const panel = makePanel();
    // Refresh first — that is what puts the panel into "saved view + sticky
    // context override" state, which is exactly when Save used to truncate.
    await call(panel, { ...REFRESH_BASE, titleOverride: true });
    await call(panel, { ...SAVE_BASE });

    // Target visibility travels: a public Save cannot bind a private subset.
    expect(_fetchViewAxisSubsets).toHaveBeenLastCalledWith(
      CUBE, 'MyView', false, CONFIG, { targetIsPrivate: false },
    );
    const sel = (_saveView as ReturnType<typeof vi.fn>).mock.calls[0][7];
    expect(sel.Region).toEqual({ kind: 'namedSubset', name: 'AllRegions', isPrivate: false });
    expect(sel.Region.names).toBeUndefined();
    expect(posted(panel)).toContainEqual(
      expect.objectContaining({ type: 'viewSaveResult', ok: true }),
    );
  });

  it('saveView — a PRIVATE save reports its target so a private subset can stay by reference', async () => {
    (_fetchViewAxisSubsets as ReturnType<typeof vi.fn>).mockResolvedValue({
      subsets: { Region: { kind: 'namedSubset', name: 'MyRegions', isPrivate: true } },
      oversized: [],
    });
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, existingViewIsPrivate: true, titleOverride: true });
    await call(panel, { ...SAVE_BASE, isPrivate: true });
    expect(_fetchViewAxisSubsets).toHaveBeenLastCalledWith(
      CUBE, 'MyView', true, CONFIG, { targetIsPrivate: true },
    );
    expect((_saveView as ReturnType<typeof vi.fn>).mock.calls[0][7].Region)
      .toEqual({ kind: 'namedSubset', name: 'MyRegions', isPrivate: true });
  });

  it('saveView — without a context override the axis source is unchanged (client baseline)', async () => {
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE });
    await call(panel, { ...SAVE_BASE });
    expect(_fetchViewAxisSubsets).not.toHaveBeenCalled();
    expect((_saveView as ReturnType<typeof vi.fn>).mock.calls[0][7]).toEqual({
      Region: { kind: 'elements', names: ['North', 'South'] },
      Month: { kind: 'elements', names: ['Jan'] },
    });
  });

  it('saveView — an explicit dim filter still wins over the view axes', async () => {
    (_fetchViewAxisSubsets as ReturnType<typeof vi.fn>).mockResolvedValue({
      subsets: { Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false } },
      oversized: [],
    });
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, titleOverride: true });
    _dimSelections.set(PANEL_KEY, { Region: { kind: 'elements', names: ['North'] } });
    await call(panel, { ...SAVE_BASE });
    expect((_saveView as ReturnType<typeof vi.fn>).mock.calls[0][7].Region)
      .toEqual({ kind: 'elements', names: ['North'] });
  });

  // ─── LOW-2: per-panel state is released on panel dispose ──────────────────
  // `manager.ts#onDidDispose` calls `clearPanelMessagingState(panelKey)` next to
  // `_dimSelections` & Co.; without it both module-level maps kept one entry per
  // panel key for the whole session.

  // `refreshCurrentLayout` is stubbed here (Task 8: its decision — incl. the
  // degradation warnings — is proven for real in `cubeViewerViewSubsets.test.ts`),
  // so a `refreshData` call alone never reaches `_viewAxisBaseline`/warns any
  // more. It still sets `_panelViewState` synchronously though, so these tests
  // drive the warning through `saveView`'s own (real, cross-module) call to
  // `_viewAxisBaseline` instead — `refreshData` only sets up the mirrored state
  // `saveView` reads.

  it('clearPanelMessagingState — drops the "already warned" marks for that panel', async () => {
    (_fetchViewAxisSubsets as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const warn = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, existingViewName: 'DisposedView', titleOverride: true });
    await call(panel, { ...SAVE_BASE });
    await call(panel, { ...SAVE_BASE });
    expect(warn).toHaveBeenCalledTimes(1);
    // Panel closed and reopened under the same key → the warning is due again.
    clearPanelMessagingState(PANEL_KEY);
    await call(panel, { ...REFRESH_BASE, existingViewName: 'DisposedView', titleOverride: true });
    await call(panel, { ...SAVE_BASE });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('clearPanelMessagingState — drops the mirrored view state for that panel', async () => {
    (_fetchViewAxisSubsets as ReturnType<typeof vi.fn>).mockResolvedValue({
      subsets: { Region: { kind: 'namedSubset', name: 'AllRegions', isPrivate: false } },
      oversized: [],
    });
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, titleOverride: true });
    clearPanelMessagingState(PANEL_KEY);
    await call(panel, { ...SAVE_BASE });
    // No mirrored "saved view + sticky override" left → Save takes the client
    // baseline and never even asks for the view axes.
    expect(_fetchViewAxisSubsets).not.toHaveBeenCalled();
    expect((_saveView as ReturnType<typeof vi.fn>).mock.calls[0][7]).toEqual({
      Region: { kind: 'elements', names: ['North', 'South'] },
      Month: { kind: 'elements', names: ['Jan'] },
    });
  });

  it('clearPanelMessagingState — leaves other panels alone', async () => {
    (_fetchViewAxisSubsets as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (_saveView as ReturnType<typeof vi.fn>).mockResolvedValue('saved');
    const warn = vscode.window.showWarningMessage as unknown as ReturnType<typeof vi.fn>;
    const panel = makePanel();
    await call(panel, { ...REFRESH_BASE, existingViewName: 'OtherPanelView', titleOverride: true });
    await call(panel, { ...SAVE_BASE });
    clearPanelMessagingState('some-other-panel');
    await call(panel, { ...SAVE_BASE });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // ─── runInlineMdx: hasChildren travels with the cell data ─────

  const MDX_RUN = { type: 'runInlineMdx', mdx: 'SELECT {[Month].[Jan]} ON 0, {[Region].[North]} ON 1 FROM [SalesCube]', reqId: 1 };

  it('runInlineMdx — posts hasChildren per axis dimension with the cell data', async () => {
    (_executeMdxInline as ReturnType<typeof vi.fn>).mockResolvedValue({
      rowDims: ['Region'], colDims: ['Month'],
      rowTuples: [['North']], colTuples: [['Jan']],
      rowElements: ['North'], colElements: ['Jan'],
      values: {}, numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
    });
    // Row call first, col call second (Promise.all order in
    // messaging.ts) — different values, so that the assignment is provable.
    (_buildAxisMeta as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ levels: null, parents: [{}], allParents: [{}], hasChildren: [{ North: true }], levelMaps: [new Map()] })
      .mockResolvedValueOnce({ levels: null, parents: [{}], allParents: [{}], hasChildren: [{}], levelMaps: [new Map()] });
    const panel = makePanel();
    await call(panel, { ...MDX_RUN });

    const cellData = posted(panel).filter((m) => m.type === 'cellData').pop();
    expect(Array.isArray(cellData.matrix.rowHasChildren)).toBe(true);
    expect(cellData.matrix.rowHasChildren.length).toBe(cellData.matrix.rowDims.length);
    expect(cellData.matrix.rowHasChildren).toEqual([{ North: true }]);
    expect(cellData.matrix.colHasChildren).toEqual([{}]);

    // Wiring: the active filter list per dim goes as the 4th argument (`extraKnown`)
    // into `_buildAxisMeta` — without a user dim filter it is empty, but present.
    const calls = (_buildAxisMeta as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][3]).toEqual([[]]);
    expect(calls[1][3]).toEqual([[]]);
  });

  it('runInlineMdx — passes an active element filter list on as extraKnown per dimension', async () => {
    _dimSelections.set(PANEL_KEY, { Region: { kind: 'elements', names: ['North', 'South'] } });
    (_executeMdxInline as ReturnType<typeof vi.fn>).mockResolvedValue({
      rowDims: ['Region'], colDims: ['Month'],
      rowTuples: [['North']], colTuples: [['Jan']],
      rowElements: ['North'], colElements: ['Jan'],
      values: {}, numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
    });
    (_buildAxisMeta as ReturnType<typeof vi.fn>).mockResolvedValue({
      levels: null, parents: [{}], allParents: [{}], hasChildren: [{}], levelMaps: [new Map()],
    });
    const panel = makePanel();
    await call(panel, { ...MDX_RUN });

    const calls = (_buildAxisMeta as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][3]).toEqual([['North', 'South']]); // rowDims = ['Region']
    expect(calls[1][3]).toEqual([[]]);                 // colDims = ['Month'], no selection
  });

  // ─── cellEditBulk ──────────────────────────────────────────────────────────

  it('cellEditBulk writes all targets and reports the tally', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, ri: 0, ci: 0 });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEditBulk',
      dimensions: ['Region', 'Month'],
      targets: [
        { ri: 0, ci: 0, coordinates: ['A', 'Jan'], value: 5 },
        { ri: 1, ci: 0, coordinates: ['B', 'Jan'], value: 50 },
      ],
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    });
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'cellEditBulkResult', ok: true, okCount: 2, totalCount: 2,
    }));

    // Every target keeps its OWN coordinates/value/ri/ci — that is the
    // whole difference to spreadBulk (one value for all targets).
    const calls = (handleCellEditMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toEqual(expect.objectContaining({
      cubeName: CUBE, dimensions: ['Region', 'Month'],
      coordinates: ['A', 'Jan'], value: 5, ri: 0, ci: 0,
    }));
    expect(calls[1][0]).toEqual(expect.objectContaining({
      cubeName: CUBE, dimensions: ['Region', 'Month'],
      coordinates: ['B', 'Jan'], value: 50, ri: 1, ci: 0,
    }));
  });

  it('cellEditBulk — empty targets: no call, no refresh, tally 0/0', async () => {
    const panel = makePanel();
    await call(panel, {
      type: 'cellEditBulk',
      dimensions: ['Region', 'Month'],
      targets: [],
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    });
    expect(handleCellEditMessage).not.toHaveBeenCalled();
    expect(runSerializedRefresh).not.toHaveBeenCalled();
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'cellEditBulkResult', ok: true, okCount: 0, totalCount: 0,
    }));
  });

  it('cellEditBulk — falsy values (0 and empty string) survive unchanged', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, ri: 0, ci: 0 });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEditBulk',
      dimensions: ['Region', 'Month'],
      targets: [
        { ri: 0, ci: 0, coordinates: ['A', 'Jan'], value: 0 },
        { ri: 1, ci: 0, coordinates: ['B', 'Jan'], value: '' },
      ],
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    });
    const calls = (handleCellEditMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toEqual(expect.objectContaining({ value: 0 }));
    expect(calls[1][0]).toEqual(expect.objectContaining({ value: '' }));
  });

  it('cellEditBulk stops at the first error', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, ri: 0, ci: 0 })
      .mockResolvedValueOnce({ ok: false, ri: 1, ci: 0, error: { kind: 'security', message: 'no' } });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEditBulk',
      dimensions: ['Region', 'Month'],
      targets: [
        { ri: 0, ci: 0, coordinates: ['A', 'Jan'], value: 5 },
        { ri: 1, ci: 0, coordinates: ['B', 'Jan'], value: 50 },
        { ri: 2, ci: 0, coordinates: ['C', 'Jan'], value: 11 },
      ],
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    });
    expect(handleCellEditMessage).toHaveBeenCalledTimes(2); // the third target never attempted
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'cellEditBulkResult', ok: false, okCount: 1, totalCount: 3,
      firstError: { ri: 1, ci: 0, error: { kind: 'security', message: 'no' } },
    }));
  });

  // Fix round 1 (Finding 1): every target passes ITS OWN picklist definition
  // through — important for the Del path (`bulkWrite.ts`), which has no
  // values pre-check. The failed second target must get the definition
  // of target 2, not that of target 1 (different cells can
  // carry different — or no — lists at all).
  it('cellEditBulk passes picklistDef through PER TARGET, not that of the first target', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, ri: 0, ci: 0 })
      .mockResolvedValueOnce({ ok: false, ri: 1, ci: 0, error: { kind: 'picklist', message: 'nope' } });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEditBulk',
      dimensions: ['Region', 'Month'],
      targets: [
        { ri: 0, ci: 0, coordinates: ['A', 'Jan'], value: 5, picklistDef: 'static:1:2' },
        { ri: 1, ci: 0, coordinates: ['B', 'Jan'], value: 50, picklistDef: 'static:X:Y:Z' },
        { ri: 2, ci: 0, coordinates: ['C', 'Jan'], value: 11, picklistDef: 'static:9' }, // never attempted
      ],
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    });
    const calls = (handleCellEditMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toEqual(expect.objectContaining({ ri: 0, ci: 0, picklistDef: 'static:1:2' }));
    expect(calls[1][0]).toEqual(expect.objectContaining({ ri: 1, ci: 0, picklistDef: 'static:X:Y:Z' }));
  });

  it('cellEditBulk — a target without picklistDef passes null through (e.g. Del on a non-picklist cell)', async () => {
    (handleCellEditMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, ri: 0, ci: 0 });
    const panel = makePanel();
    await call(panel, {
      type: 'cellEditBulk',
      dimensions: ['Region', 'Month'],
      targets: [{ ri: 0, ci: 0, coordinates: ['A', 'Jan'], value: '' }],
      rowDims: ['Region'], colDims: ['Month'], titleAssignments: {},
    });
    const calls = (handleCellEditMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toEqual(expect.objectContaining({ picklistDef: null }));
  });

  // ─── Picklists ────────────────────────────────────────────────────────────

  const MDX_MATRIX = {
    rowDims: ['Region'], colDims: ['Month'],
    rowTuples: [['North']], colTuples: [['Jan']],
    rowElements: ['North'], colElements: ['Jan'],
    values: {}, numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
    titleAssignments: { Produkt: 'P1' },
  };

  function armMdxRefresh(): void {
    (_executeMdxInline as ReturnType<typeof vi.fn>).mockResolvedValue(MDX_MATRIX);
    (_buildAxisMeta as ReturnType<typeof vi.fn>).mockResolvedValue({
      levels: null, parents: [{}], allParents: [{}], hasChildren: [{}], levelMaps: [new Map()],
    });
  }

  it('cellData — the area picklist maps travel RAW with the matrix', async () => {
    armMdxRefresh();
    (hasPicklistCube as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (fetchElementPicklists as ReturnType<typeof vi.fn>).mockResolvedValue({ Region: { North: 'dimension:Kostenstelle' } });
    (fetchRulePicklists as ReturnType<typeof vi.fn>).mockResolvedValue({ Status: 'static:A:B' });
    const panel = makePanel();
    await call(panel, { ...MDX_RUN });

    const cellData = posted(panel).filter((m) => m.type === 'cellData').pop();
    // Raw — the resolved list of a large dimension would have 100k names.
    expect(cellData.matrix.picklistByElem).toEqual({ Region: { North: 'dimension:Kostenstelle' } });
    expect(cellData.matrix.picklistByRuleElem).toEqual({ Status: 'static:A:B' });
    expect(cellData.matrix.picklistCubePresent).toBe(true);
    // The title dimension belongs to the cube, even if it lies on no axis.
    expect(fetchElementPicklists).toHaveBeenCalledWith(CONFIG, ['Region', 'Month', 'Produkt']);
    expect(fetchRulePicklists).toHaveBeenCalledWith(CONFIG, CUBE);
  });

  it('cellData — REGRESSION GUARD: no refresh queries cells of the control cube', async () => {
    // The bug that triggered Task 15: the query over the window
    // of a real saved view ran > 10 min and had to be
    // aborted on the server side. Only rule text (1 ms)
    // and attribute lists are allowed now.
    armMdxRefresh();
    (hasPicklistCube as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    await call(makePanel(), { ...MDX_RUN });
    expect(fetchCellPicklist).not.toHaveBeenCalled();
  });

  it('cellData — every refresh throws away the resolved definitions', async () => {
    // Spec §E3: a picklist changed in TM1 would otherwise stay old for the whole session,
    // because `_resolved` gets rid of nothing by itself.
    armMdxRefresh();
    (hasPicklistCube as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await call(makePanel(), { ...MDX_RUN });
    expect(invalidatePicklistResolutions).toHaveBeenCalledWith(CONFIG.serverUrl);
  });

  it('cellData — without a control cube the host reports that to the client', async () => {
    // Then the client saves itself the single-cell round trip on double click.
    armMdxRefresh();
    (hasPicklistCube as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const panel = makePanel();
    await call(panel, { ...MDX_RUN });

    expect(posted(panel).filter((m) => m.type === 'cellData').pop().matrix.picklistCubePresent)
      .toBe(false);
  });

  it('cellPage — a page loaded later costs NO picklist query', async () => {
    // The area maps came with the first answer and apply to every
    // row; a picklist query per page would have the same cellset size
    // as its data — 417 cells measurably cost 12.5 s.
    (_fetchCellPage as ReturnType<typeof vi.fn>).mockResolvedValue({ values: {}, rawValues: {}, cellFlags: {} });
    (_fetchTuplePage as ReturnType<typeof vi.fn>).mockResolvedValue([['South']]);
    (_cellsets as Map<string, any>).set(PANEL_KEY, {
      id: 'CID_PL', numCols: 1, totalRows: 5000, config: CONFIG, rowDims: ['Region'],
    });
    (_buildAxisMeta as ReturnType<typeof vi.fn>).mockResolvedValue({
      levels: null, parents: [{}], allParents: [{}], hasChildren: [{}], levelMaps: [new Map()],
    });
    const panel = makePanel();
    await call(panel, { type: 'fetchCellPage', startRow: 100, rowCount: 1, cellsetId: 'CID_PL' });

    expect(fetchCellPicklist).not.toHaveBeenCalled();
    // The page still goes out — just without the picklist part.
    expect(posted(panel).filter((m) => m.type === 'cellPage').pop()).toBeDefined();
  });

  it('fetchCellPicklist — answers with reqId, and null stays null', async () => {
    (fetchCellPicklist as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const panel = makePanel();
    _panels.set(PANEL_KEY, panel);
    await call(panel, {
      type: 'fetchCellPicklist', coordinates: ['A', 'Jan'], dimensions: ['Region', 'Month'], reqId: 9,
    });

    // null means "this cell has no picklist" — NOT the empty list.
    expect(posted(panel)).toContainEqual({ type: 'cellPicklistDef', def: null, reqId: 9 });
    expect(fetchCellPicklist).toHaveBeenCalledWith(CONFIG, CUBE, ['Region', 'Month'], ['A', 'Jan']);
    _panels.delete(PANEL_KEY);
  });

  it('fetchCellPicklist — passes the raw definition through', async () => {
    (fetchCellPicklist as ReturnType<typeof vi.fn>).mockResolvedValue('static:A:B');
    const panel = makePanel();
    _panels.set(PANEL_KEY, panel);
    await call(panel, {
      type: 'fetchCellPicklist', coordinates: ['A', 'Jan'], dimensions: ['Region', 'Month'], reqId: 4,
    });
    expect(posted(panel)).toContainEqual({ type: 'cellPicklistDef', def: 'static:A:B', reqId: 4 });
    _panels.delete(PANEL_KEY);
  });

  it('fetchCellPicklist — a panel closed in the meantime gets nothing anymore', async () => {
    (fetchCellPicklist as ReturnType<typeof vi.fn>).mockResolvedValue('static:A');
    const panel = makePanel();
    // `_panels` does not know the panel (any more) — exactly the state after dispose.
    await call(panel, {
      type: 'fetchCellPicklist', coordinates: ['A', 'Jan'], dimensions: ['Region', 'Month'], reqId: 1,
    });
    expect(posted(panel)).toEqual([]);
  });

  it('resolvePicklist — answers with reqId, and null stays null', async () => {
    (resolvePicklist as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const panel = makePanel();
    _panels.set(PANEL_KEY, panel);
    await call(panel, { type: 'resolvePicklist', def: 'dimension:Tot', reqId: 7 });

    // null means "TM1 allows anything here" — NOT the empty list.
    expect(posted(panel)).toContainEqual({
      type: 'picklistValues', def: 'dimension:Tot', values: null, reqId: 7,
    });
    _panels.delete(PANEL_KEY);
  });

  it('resolvePicklist — a panel closed in the meantime gets nothing anymore', async () => {
    (resolvePicklist as ReturnType<typeof vi.fn>).mockResolvedValue(['A']);
    const panel = makePanel();
    // `_panels` does not know the panel (any more) — exactly the state after dispose.
    await call(panel, { type: 'resolvePicklist', def: 'static:A', reqId: 1 });
    expect(posted(panel)).toEqual([]);
  });
});

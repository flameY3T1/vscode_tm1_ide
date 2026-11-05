import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE regression guard for task 15 (2026-08-13), version after review finding 7.
 *
 * The property at stake is a property of the NETWORK TRAFFIC, not
 * that of a particular function: opening a view must NOT query the
 * control cube `}PickList_<Cube>` over an area. Measured
 * against 11.8, exactly that ran for over TEN MINUTES and had to be aborted
 * server-side — for a view with exactly one picklist cell; 417
 * cells in one cellset cost 12.5 s, ONE cell 1–2 ms, the rule text 1 ms.
 *
 * The version kept here earlier mocked `picklistApi` completely and only checked
 * that `fetchCellPicklist` was not called. A regression in the
 * most likely form — a freshly written `ExecuteMDX` query in
 * `picklistWiring` or `picklistApi` — would have slipped past it. That is why
 * `picklistWiring` AND `picklistApi` run for REAL here, the TRANSPORT is
 * mocked, and the invariant itself is checked: no `POST ExecuteMDX`
 * whose body names `}PickList_`. Which function sends the query does
 * not matter for that.
 *
 * Both transport paths point to the SAME double (docs/architecture/import-rules.md, "Test mocks"):
 * `picklistApi` imports `tm1Rest/client` directly, a mock only on the
 * facade would let it run into the real network.
 */
const { apiRequest, assertOk } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn(),
}));
vi.mock('../../tm1Rest/client', () => ({ apiRequest, assertOk }));
vi.mock('../../tm1Client', () => ({ apiRequest, assertOk }));

vi.mock('../../tm1Rest/cubeApi', async (orig) => {
  const actual = await orig<typeof import('../../tm1Rest/cubeApi')>();
  return { ...actual, probeViewKind: vi.fn(), deleteView: vi.fn(), createView: vi.fn(), updateView: vi.fn() };
});
vi.mock('../../commands/cubeViewer/executeView', () => ({ _executeView: vi.fn() }));
vi.mock('../../commands/cubeViewer/executeMdxInline', () => ({ _executeMdxInline: vi.fn() }));
vi.mock('../../commands/cubeViewer/axisMeta', () => ({ _buildAxisMeta: vi.fn() }));
vi.mock('../../commands/cubeViewer/cellsetState', () => ({
  dropPanelCellset: vi.fn(),
  _stashPageContext: vi.fn(),
}));
vi.mock('../../commands/cubeViewer/fetch', () => ({
  _fetchDimElements: vi.fn(),
  _fetchViewAxisSubsets: vi.fn(),
  _fetchCubeDimensions: vi.fn(),
  VIEW_AXIS_ELEMENTS_MAX: 10000,
}));
vi.mock('../../commands/cubeViewer/viewSizeGuard', () => ({ assertLayoutExecutable: vi.fn() }));
vi.mock('../../commands/cubeViewer/cubeViewerLog', () => ({ logCubeViewer: vi.fn() }));

import type * as vscode from 'vscode';
import { _readExistingView, _refreshWithTempView } from '../../commands/cubeViewer/view';
import { _executeView } from '../../commands/cubeViewer/executeView';
import { _executeMdxInline } from '../../commands/cubeViewer/executeMdxInline';
import { _buildAxisMeta } from '../../commands/cubeViewer/axisMeta';
import { _fetchCubeDimensions, _fetchDimElements } from '../../commands/cubeViewer/fetch';
import { createView, deleteView } from '../../tm1Rest/cubeApi';
import { _clearPicklistCachesForTest } from '../../commands/cubeViewer/picklistApi';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
} as never;
const PANEL_KEY = 'panel1';
const CUBE = 'Plan';

function makePanel(): vscode.WebviewPanel {
  return {
    webview: { postMessage: vi.fn().mockResolvedValue(true), html: '', onDidReceiveMessage: vi.fn() },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(), reveal: vi.fn(),
  } as unknown as vscode.WebviewPanel;
}

/** A fully read grid, as `_executeView`/`_executeMdxInline` deliver it. */
function matrix(): Record<string, unknown> {
  return {
    rowDims: ['Region'], colDims: ['Monat'],
    rowTuples: [['Nord']], colTuples: [['Jan']],
    titleAssignments: { Jahr: '2026' },
    rowElements: ['Nord'], colElements: ['Jan'],
    values: {}, rawValues: {}, cellFlags: {},
    numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
  };
}

/**
 * The control cube EXISTS and carries a rule — exactly the situation in which
 * a fallback to the area query "would" pay off. Everything else
 * answers as an empty collection.
 */
function transportReplies(): void {
  apiRequest.mockImplementation(async (_method: string, path: string) => {
    if (/\/Rules$/.test(String(path))) {
      return { statusCode: 200, body: JSON.stringify({ value: "['Status'] = S: 'static:A:B';" }) };
    }
    if (/ElementAttributes/.test(String(path))) {
      return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Picklist' }] }) };
    }
    if (/\/Elements/.test(String(path))) {
      return {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Nord', Attributes: { Picklist: 'static:A' } }] }),
      };
    }
    return { statusCode: 200, body: '{"value":[]}' };
  });
}

/** Every request that queries the control cube via a cellset. */
function picklistCellsetCalls(): unknown[][] {
  return apiRequest.mock.calls.filter((c) => {
    const method = String(c[0] ?? '').toUpperCase();
    const path = String(c[1] ?? '');
    const body = typeof c[2] === 'string' ? c[2] : JSON.stringify(c[2] ?? '');
    return method === 'POST' && /ExecuteMDX/i.test(path) && body.includes('}PickList_');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearPicklistCachesForTest();
  transportReplies();
  (_buildAxisMeta as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    levels: [], parents: {}, allParents: {}, hasChildren: {}, levelMaps: [],
  });
  (_executeView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(matrix());
  (_executeMdxInline as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(matrix());
  (_fetchCubeDimensions as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(['Region', 'Monat', 'Jahr']);
  (_fetchDimElements as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(['Jan']);
  (createView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (deleteView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe('opening a view costs NO area query against the control cube', () => {
  it('_readExistingView sends no ExecuteMDX against }PickList_', async () => {
    await _readExistingView(PANEL_KEY, makePanel(), CUBE, 'Default', false, 'Region', 'Monat', CONFIG, 1);
    // Exactly the query that blocked a real view for over ten minutes.
    expect(picklistCellsetCalls()).toEqual([]);
    // And the path still ran (otherwise the guard checks nothing):
    // the rule text was read.
    expect(apiRequest.mock.calls.some((c) => /\/Rules$/.test(String(c[1])))).toBe(true);
  });

  it('_refreshWithTempView sends no ExecuteMDX against }PickList_', async () => {
    await _refreshWithTempView(
      PANEL_KEY, makePanel(), CUBE, ['Region'], ['Monat'], { Jahr: '2026' },
      { Region: { kind: 'elements', names: ['Nord'] }, Monat: { kind: 'elements', names: ['Jan'] } },
      false, false, CONFIG, 1,
    );
    expect(picklistCellsetCalls()).toEqual([]);
  });

  it('queries the control cube only for reading (GET) at all, never for writing', async () => {
    await _readExistingView(PANEL_KEY, makePanel(), CUBE, 'Default', false, 'Region', 'Monat', CONFIG, 1);
    const toControlCube = apiRequest.mock.calls
      .filter((c) => String(c[1]).includes('PickList_'));
    expect(toControlCube.length).toBeGreaterThan(0);
    for (const c of toControlCube) {
      expect(String(c[0]).toUpperCase()).toBe('GET');
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Task 7b/1 — the SAVED view carries the picklist maps.
 * Task 15 (2026-08-13) — and it carries them WITHOUT a cell query.
 *
 * This is where the WIRING lives: which maps travel with `cellData`, over
 * which dimensions they are read, what the client learns about the control cube.
 * Allowed on this path are only the existence check of the
 * control cube, its rule text (1 ms) and the attribute lists per dimension;
 * that no AREA query gets added is checked by the guard in
 * `cubeViewer/picklistNoAreaQueryOnOpen.test.ts` (see note below).
 *
 * `./picklistApi` is mocked VIA THE PATH (docs/architecture/import-rules.md, "Test mocks"): the
 * module imports the transport directly (`tm1Rest/client`); a mock only on
 * `tm1Client` would let the picklist path run into the real network and the test
 * would end in timeouts instead of in a clear error.
 */

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/cubeApi', async (orig) => {
  const actual = await orig<typeof import('../tm1Rest/cubeApi')>();
  return { ...actual, probeViewKind: vi.fn(), deleteView: vi.fn(), createView: vi.fn(), updateView: vi.fn() };
});
vi.mock('../commands/cubeViewer/executeView', () => ({ _executeView: vi.fn() }));
vi.mock('../commands/cubeViewer/executeMdxInline', () => ({ _executeMdxInline: vi.fn() }));
vi.mock('../commands/cubeViewer/axisMeta', () => ({ _buildAxisMeta: vi.fn() }));
vi.mock('../commands/cubeViewer/cellsetState', () => ({
  dropPanelCellset: vi.fn(),
  _stashPageContext: vi.fn(),
}));
vi.mock('../commands/cubeViewer/fetch', () => ({
  _fetchDimElements: vi.fn(),
  _fetchViewAxisSubsets: vi.fn(),
  _fetchCubeDimensions: vi.fn(),
  VIEW_AXIS_ELEMENTS_MAX: 10000,
}));
vi.mock('../commands/cubeViewer/viewSizeGuard', () => ({ assertLayoutExecutable: vi.fn() }));
vi.mock('../commands/cubeViewer/picklistApi', () => ({
  hasPicklistCube: vi.fn(),
  fetchElementPicklists: vi.fn(),
  fetchRulePicklists: vi.fn(),
  fetchCellPicklist: vi.fn(),
  resolvePicklist: vi.fn(),
  invalidatePicklistResolutions: vi.fn(),
  disposePicklistCachesForServer: vi.fn(),
}));
vi.mock('../commands/cubeViewer/cubeViewerLog', () => ({ logCubeViewer: vi.fn() }));

import * as vscode from 'vscode';
import { _panels } from '../commands/cubeViewer/state';
import { _readExistingView, _refreshWithTempView } from '../commands/cubeViewer/view';
import { _executeView } from '../commands/cubeViewer/executeView';
import { _executeMdxInline } from '../commands/cubeViewer/executeMdxInline';
import { _buildAxisMeta } from '../commands/cubeViewer/axisMeta';
import { _fetchCubeDimensions, _fetchDimElements } from '../commands/cubeViewer/fetch';
import { createView, deleteView } from '../tm1Rest/cubeApi';
import {
  hasPicklistCube, fetchElementPicklists, fetchRulePicklists,
  invalidatePicklistResolutions,
} from '../commands/cubeViewer/picklistApi';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
} as never;
const PANEL_KEY = 'panel1';
const CUBE = 'Plan';

const mockExec = _executeView as unknown as ReturnType<typeof vi.fn>;
const mockExecMdx = _executeMdxInline as unknown as ReturnType<typeof vi.fn>;
const mockMeta = _buildAxisMeta as unknown as ReturnType<typeof vi.fn>;
const mockCubeDims = _fetchCubeDimensions as unknown as ReturnType<typeof vi.fn>;
const mockDimElements = _fetchDimElements as unknown as ReturnType<typeof vi.fn>;
const mockHasCube = hasPicklistCube as unknown as ReturnType<typeof vi.fn>;
const mockByElem = fetchElementPicklists as unknown as ReturnType<typeof vi.fn>;
const mockByRule = fetchRulePicklists as unknown as ReturnType<typeof vi.fn>;

function makePanel(): vscode.WebviewPanel {
  // Registered: the temp view is only kept for a panel that is still open.
  const panel = {
    webview: { postMessage: vi.fn().mockResolvedValue(true), html: '', onDidReceiveMessage: vi.fn() },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(), reveal: vi.fn(),
  } as unknown as vscode.WebviewPanel;
  _panels.set(PANEL_KEY, panel);
  return panel;
}

function cellData(panel: vscode.WebviewPanel): any {
  return (panel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0]).filter((m) => m.type === 'cellData').pop();
}

/** A fully read grid, the way `_executeView`/`_executeMdxInline` deliver it. */
function matrix() {
  return {
    rowDims: ['Region'], colDims: ['Monat'],
    rowTuples: [['Nord']], colTuples: [['Jan']],
    titleAssignments: { Jahr: '2026' },
    rowElements: ['Nord'], colElements: ['Jan'],
    values: {}, rawValues: {}, cellFlags: {},
    numCols: 1, totalRows: 1, loadedRows: 1, paged: false,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockMeta.mockResolvedValue({
    levels: [], parents: {}, allParents: {}, hasChildren: {}, levelMaps: [],
  });
  mockExec.mockResolvedValue(matrix());
  mockExecMdx.mockResolvedValue(matrix());
  mockCubeDims.mockResolvedValue(['Region', 'Monat', 'Jahr']);
  mockDimElements.mockResolvedValue(['Jan']);
  (createView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (deleteView as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  mockHasCube.mockResolvedValue(true);
  mockByElem.mockResolvedValue({ Region: { Nord: 'dimension:Kostenstelle' } });
  mockByRule.mockResolvedValue({ Status_Maintenance: 'Dimension:Dropdown' });
});

// The regression guard against the area query no longer stands HERE,
// but in `cubeViewer/picklistNoAreaQueryOnOpen.test.ts` (review finding 7,
// 2026-08-13). Reason: this file mocks `picklistApi` completely, so it could
// only check which function was NOT called. A relapse in the
// most likely form — a freshly written `ExecuteMDX` query in
// `picklistWiring` or `picklistApi` — would have slipped past it. The new
// guard mocks the TRANSPORT and checks the invariant itself: no
// `POST ExecuteMDX` whose body names `}PickList_`.

describe('saved view — _readExistingView', () => {
  it('sends both area picklist maps with the matrix', async () => {
    const panel = makePanel();
    await _readExistingView(PANEL_KEY, panel, CUBE, 'Planung_Maintenance', false, 'Region', 'Monat', CONFIG, 1);
    const msg = cellData(panel);
    expect(msg.matrix.picklistByElem).toEqual({ Region: { Nord: 'dimension:Kostenstelle' } });
    expect(msg.matrix.picklistByRuleElem).toEqual({ Status_Maintenance: 'Dimension:Dropdown' });
  });

  it('tells the client whether the control cube is there', async () => {
    // Without it, the client saves itself the round trip on double click entirely.
    mockHasCube.mockResolvedValue(false);
    const panel = makePanel();
    await _readExistingView(PANEL_KEY, panel, CUBE, 'V', false, 'Region', 'Monat', CONFIG, 1);
    expect(cellData(panel).matrix.picklistCubePresent).toBe(false);
  });

  it('reads the attribute map over ALL cube dimensions, including the title dimension', async () => {
    await _readExistingView(PANEL_KEY, makePanel(), CUBE, 'V', false, 'Region', 'Monat', CONFIG, 1);
    expect(mockByElem).toHaveBeenCalledWith(CONFIG, ['Region', 'Monat', 'Jahr']);
  });
});

describe('working state — _refreshWithTempView', () => {
  it('MDX path: both maps travel along', async () => {
    const panel = makePanel();
    await _refreshWithTempView(
      PANEL_KEY, panel, CUBE, ['Region'], ['Monat'], { Jahr: '2026' },
      { Region: { kind: 'elements', names: ['Nord'] }, Monat: { kind: 'elements', names: ['Jan'] } },
      false, false, CONFIG, 1,
    );
    expect(mockExecMdx).toHaveBeenCalled();
    const msg = cellData(panel);
    expect(msg.matrix.picklistByElem).toEqual({ Region: { Nord: 'dimension:Kostenstelle' } });
    expect(msg.matrix.picklistByRuleElem).toEqual({ Status_Maintenance: 'Dimension:Dropdown' });
  });

  it('NativeView path (private subset, no MDX expression): both maps travel along', async () => {
    const panel = makePanel();
    await _refreshWithTempView(
      PANEL_KEY, panel, CUBE, ['Region'], ['Monat'], { Jahr: '2026' },
      { Region: { kind: 'namedSubset', name: 'Meins', isPrivate: true } },
      false, false, CONFIG, 1,
    );
    // No MDX path — the private subset reference has no MDX form.
    expect(mockExecMdx).not.toHaveBeenCalled();
    expect(mockExec).toHaveBeenCalled();
    const msg = cellData(panel);
    expect(msg.matrix.picklistByElem).toEqual({ Region: { Nord: 'dimension:Kostenstelle' } });
    expect(msg.matrix.picklistByRuleElem).toEqual({ Status_Maintenance: 'Dimension:Dropdown' });
  });
});

describe('invalidation in the refresh path', () => {
  it('throws away the resolved definitions of this server', async () => {
    const panel = makePanel();
    await _readExistingView(PANEL_KEY, panel, CUBE, 'V', false, 'Region', 'Monat', CONFIG, 1);
    expect(invalidatePicklistResolutions).toHaveBeenCalledWith('http://tm1:8001');
  });
});

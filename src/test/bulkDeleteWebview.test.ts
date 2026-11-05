// Host-side guards of bulk delete. Two things that no other
// test covers: that a successful delete triggers the same follow-up work
// as the single command in the tree, and that a failed
// dimension-cube query does not pass as "nothing depends on it".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

const deleteCube = vi.fn(async () => { /* success */ });
const deleteProcess = vi.fn(async () => { /* success */ });
const listCubes = vi.fn(async () => [] as Array<{ Name: string }>);
const listProcesses = vi.fn(async () => [] as Array<{ Name: string }>);
const listChores = vi.fn(async () => [] as Array<{ Name: string }>);
const listDimensionNames = vi.fn(async () => [] as string[]);

vi.mock('../tm1Rest/cubeApi', () => ({
  listCubes: (...a: unknown[]) => listCubes(...(a as [])),
  deleteCube: (...a: unknown[]) => deleteCube(...(a as [])),
  deleteView: vi.fn(async () => { /* unused */ }),
}));
vi.mock('../tm1Rest/processApi', () => ({
  listProcesses: (...a: unknown[]) => listProcesses(...(a as [])),
  deleteProcess: (...a: unknown[]) => deleteProcess(...(a as [])),
}));
vi.mock('../tm1Rest/choreApi', () => ({
  listChores: (...a: unknown[]) => listChores(...(a as [])),
  deleteChore: vi.fn(async () => { /* unused */ }),
}));
vi.mock('../tm1Rest/subsetApi', () => ({ deleteSubset: vi.fn(async () => { /* unused */ }) }));
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../providers/fetchNames', () => ({ invalidateCache: vi.fn() }));

const fetchDimensionCubeNames = vi.fn();
vi.mock('../tm1Rest/dimensionApi', () => ({
  listDimensionNames: (...a: unknown[]) => listDimensionNames(...(a as [])),
  deleteDimension: vi.fn(async () => { /* unused */ }),
  fetchDimensionCubeNames: (...a: unknown[]) => fetchDimensionCubeNames(...(a as [])),
}));

const emptyIndex = {
  byCube: new Map(), byDim: new Map(), byProcess: new Map(),
  choreTasks: new Map(), choreCasing: new Map(), processDataSources: new Map(),
  subsetViews: new Map(), dynamicDataSources: [] as unknown[],
  incomplete: [] as string[],
};
let index: typeof emptyIndex = emptyIndex;
vi.mock('../references/referenceIndexService', () => ({
  getOrBuildIndex: vi.fn(async () => index),
  invalidateReferenceIndex: vi.fn(),
}));

import { BulkDeletePanel } from '../webviews/bulkDeleteWebview';
import { loadUsage } from '../commands/bulk/bulkDeleteOps';
import { rowKey } from '../webviews/bulkObjectsPure';
import { getOrBuildIndex } from '../references/referenceIndexService';
import type { DeleteItem } from '../webviewClient/bulkDelete/protocol';

const cfg = { serverUrl: 'http://tm1:1234' } as never;

function fakePanel(): vscode.WebviewPanel {
  return { webview: { postMessage: vi.fn() } } as unknown as vscode.WebviewPanel;
}

/** Like `send`, but with access to what the host sent back. */
async function sendCollecting(msg: unknown): Promise<unknown[]> {
  const posted: unknown[] = [];
  const panel = {
    webview: { postMessage: (m: unknown) => { posted.push(m); } },
  } as unknown as vscode.WebviewPanel;
  await (BulkDeletePanel as unknown as {
    onMessage(m: unknown, p: vscode.WebviewPanel, c: unknown, s: string): Promise<void>;
  }).onMessage(msg, panel, cfg, 'srv1');
  return posted;
}

/** `onMessage` is private — the guard checks exactly this path. */
function send(msg: unknown, serverId = 'srv1'): Promise<void> {
  return (BulkDeletePanel as unknown as {
    onMessage(m: unknown, p: vscode.WebviewPanel, c: unknown, s: string): Promise<void>;
  }).onMessage(msg, fakePanel(), cfg, serverId);
}

describe('follow-up work after a successful bulk delete', () => {
  const seen: Array<{ item: DeleteItem; serverId: string }> = [];

  beforeEach(() => {
    seen.length = 0;
    deleteCube.mockClear();
    deleteProcess.mockClear();
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Delete' as never);
    BulkDeletePanel.initialize({ fsPath: '/x' } as never, () => { /* no tree */ },
      (item, _c, serverId) => { seen.push({ item, serverId }); });
  });

  it('reports every deleted item with kind, name and server', async () => {
    await send({ type: 'delete', items: [
      { kind: 'cube', name: 'Sales' }, { kind: 'process', name: 'Load' },
    ] });
    expect(seen.map(s => `${s.item.kind}:${s.item.name}:${s.serverId}`))
      .toEqual(['process:Load:srv1', 'cube:Sales:srv1']);
  });

  it('does NOT report what the server rejected', async () => {
    // The panel of an object that still stands belongs open.
    deleteCube.mockRejectedValueOnce(new Error('HTTP 409'));
    await send({ type: 'delete', items: [{ kind: 'cube', name: 'Sales' }] });
    expect(seen).toEqual([]);
  });
});

describe('loadUsage', () => {
  beforeEach(() => { fetchDimensionCubeNames.mockReset(); });

  it('reports the analysis as incomplete when the cube bindings are missing', async () => {
    fetchDimensionCubeNames.mockRejectedValue(new Error('HTTP 403'));
    const res = await loadUsage(cfg, [{ kind: 'dimension', name: 'Region', isControl: false }]);
    expect(res.usage[0].usage.hard).toEqual([]);
    expect(res.incomplete).toContain('cube dimensions');
  });

  it('a successfully empty answer stays complete', async () => {
    fetchDimensionCubeNames.mockResolvedValue(new Map());
    const res = await loadUsage(cfg, [{ kind: 'dimension', name: 'Region', isControl: false }]);
    expect(res.incomplete).toEqual([]);
  });
});

describe('searching and checking are separate jobs', () => {
  beforeEach(() => {
    index = emptyIndex;
    for (const m of [listCubes, listProcesses, listChores, listDimensionNames]) { m.mockClear(); }
    fetchDimensionCubeNames.mockReset();
    fetchDimensionCubeNames.mockResolvedValue(new Map());
    BulkDeletePanel.initialize({ fsPath: '/x' } as never, () => { /* no tree */ });
  });

  it('loads NOTHING on open — only the texts', async () => {
    const posted = await sendCollecting({ type: 'ready' });
    expect(posted.map(p => (p as { type: string }).type)).toEqual(['init']);
    expect(listCubes).not.toHaveBeenCalled();
    expect(listProcesses).not.toHaveBeenCalled();
  });

  it('fetches only the checked kinds', async () => {
    listProcesses.mockResolvedValue([{ Name: 'Load.Sales' }]);
    const posted = await sendCollecting(
      { type: 'search', kinds: ['process'], pattern: '', includeControl: false });
    expect(listProcesses).toHaveBeenCalledTimes(1);
    expect(listCubes).not.toHaveBeenCalled();
    expect(listDimensionNames).not.toHaveBeenCalled();
    const rows = posted.find(p => (p as { type: string }).type === 'rows') as
      { rows: Array<{ name: string }> };
    expect(rows.rows.map(r => r.name)).toEqual(['Load.Sales']);
  });

  it('the search checks NO dependencies — only `analyze` does that', async () => {
    await sendCollecting({ type: 'search', kinds: ['dimension'], pattern: '', includeControl: false });
    expect(fetchDimensionCubeNames).not.toHaveBeenCalled();
    await sendCollecting({ type: 'analyze', rows: [{ kind: 'dimension', name: 'Region' }] });
    expect(fetchDimensionCubeNames).toHaveBeenCalledTimes(1);
  });

  it('the host already filters pattern and control objects', async () => {
    listCubes.mockResolvedValue([{ Name: 'zzTest_Sales' }, { Name: 'Sales' }, { Name: '}Stats' }]);
    const posted = await sendCollecting(
      { type: 'search', kinds: ['cube'], pattern: 'zz*', includeControl: false });
    const rows = posted.find(p => (p as { type: string }).type === 'rows') as
      { rows: Array<{ name: string }> };
    expect(rows.rows.map(r => r.name)).toEqual(['zzTest_Sales']);
  });
});

describe('dependencies are listed BY NAME', () => {
  beforeEach(() => {
    fetchDimensionCubeNames.mockResolvedValue(new Map([['Region', ['Sales', '}StatsByCube']]]));
    listChores.mockResolvedValue([{ Name: 'NightlyLoad' }]);
    index = {
      ...emptyIndex,
      byDim: new Map([['region', [
        { sourceKind: 'process', sourceName: 'Load.Sales' },
        { sourceKind: 'process', sourceName: 'Load.Sales' },
        { sourceKind: 'rule', sourceName: 'Sales' },
      ]]]),
      choreTasks: new Map([['nightlyload', [{ processName: 'Load.Sales' }]]]),
      choreCasing: new Map([['nightlyload', 'NightlyLoad']]),
    } as unknown as typeof emptyIndex;
  });

  it('names holding cubes, processes and rule sets by name', async () => {
    const res = await loadUsage(cfg, [{ kind: 'dimension', name: 'Region', isControl: false }]);
    expect(res.usage[0].usage.hard).toEqual([
      { kind: 'cube', name: 'Sales' }, { kind: 'cube', name: '}StatsByCube' },
    ]);
    // Two hits in the same process are ONE process.
    expect(res.usage[0].usage.soft.processes).toEqual(['Load.Sales']);
    expect(res.usage[0].usage.soft.rules).toEqual(['Sales']);
  });

  it('names the chores of a process in their spelling', async () => {
    const res = await loadUsage(cfg, [{ kind: 'process', name: 'Load.Sales', isControl: false }]);
    // `choreTasks` is keyed in lower case — the tree shows `NightlyLoad`.
    expect(res.usage[0].usage.soft.chores).toEqual(['NightlyLoad']);
  });
});

describe('data source is a path of its own', () => {
  beforeEach(() => {
    fetchDimensionCubeNames.mockResolvedValue(new Map());
    listChores.mockResolvedValue([]);
  });

  it('data source and code are the same process, named once', async () => {
    index = {
      ...emptyIndex,
      byCube: new Map([['sales', [
        { sourceKind: 'process', sourceName: 'Load.Sales', section: 'datasource' },
        { sourceKind: 'process', sourceName: 'Load.Sales', section: 'epilog' },
        { sourceKind: 'process', sourceName: 'Report', section: 'datasource' },
        { sourceKind: 'process', sourceName: 'Clear', section: 'prolog' },
      ]]]),
    } as unknown as typeof emptyIndex;
    const res = await loadUsage(cfg, [{ kind: 'cube', name: 'Sales', isControl: false }]);
    expect(res.usage[0].usage.soft.processes).toEqual(['Clear', 'Load.Sales', 'Report']);
  });

  it('a view no longer shows "nothing depends on it"', async () => {
    index = {
      ...emptyIndex,
      processDataSources: new Map([
        ['load.sales', {
          processName: 'Load.Sales',
          declared: { type: 'TM1CubeView', nameForServer: 'Sales', view: 'Monthly' },
          assigned: [],
        }],
        // Another view of the same cube — must NOT come along.
        ['other', {
          processName: 'Other',
          declared: { type: 'TM1CubeView', nameForServer: 'Sales', view: 'Daily' },
          assigned: [],
        }],
      ]),
    } as unknown as typeof emptyIndex;
    const res = await loadUsage(cfg,
      [{ kind: 'view', name: 'Monthly', parent: 'Sales', isControl: false }]);
    expect(res.usage[0].usage.soft.processes).toEqual(['Load.Sales']);
  });

  it('the source set in the Prolog counts just the same', async () => {
    index = {
      ...emptyIndex,
      processDataSources: new Map([
        ['switcher', {
          processName: 'Switcher',
          declared: { type: 'None' },
          assigned: ['Region', 'AllRegions'],
        }],
      ]),
    } as unknown as typeof emptyIndex;
    const res = await loadUsage(cfg,
      [{ kind: 'subset', name: 'AllRegions', parent: 'Region', hierarchy: 'Region', isControl: false }]);
    expect(res.usage[0].usage.soft.processes).toEqual(['Switcher']);
  });

  it('a view on the subset LOCKS the delete', async () => {
    index = {
      ...emptyIndex,
      subsetViews: new Map([
        ['region|region|alleregionen', [
          { cube: 'Planung', view: 'Standard' },
          { cube: '}Stats', view: 'Default' },
        ]],
      ]),
    } as unknown as typeof emptyIndex;
    const res = await loadUsage(cfg, [
      { kind: 'subset', name: 'AlleRegionen', parent: 'Region', hierarchy: 'Region', isControl: false },
      // Another hierarchy, same name — the view does not hold it.
      { kind: 'subset', name: 'AlleRegionen', parent: 'Region', hierarchy: 'Kontinente', isControl: false },
    ]);
    expect(res.usage[0].usage.hard).toEqual([
      { kind: 'view', name: 'Default', parent: '}Stats' },
      { kind: 'view', name: 'Standard', parent: 'Planung' },
    ]);
    expect(res.usage[1].usage.hard).toEqual([]);
  });

  it('ONE matching name is not enough — parent object AND child must match', async () => {
    index = {
      ...emptyIndex,
      processDataSources: new Map([
        ['nur-cube', { processName: 'NurCube', assigned: ['Sales'] }],
        ['nur-sicht', { processName: 'NurSicht', assigned: ['Monthly'] }],
      ]),
    } as unknown as typeof emptyIndex;
    const res = await loadUsage(cfg,
      [{ kind: 'view', name: 'Monthly', parent: 'Sales', isControl: false }]);
    expect(res.usage[0].usage.soft.processes).toEqual([]);
  });
});

// ─── Contract between host and renderer ──────────────────────────────────────
//
// The daily review of 19.09. found a bug here that NO test
// noticed: the existing tests read `loadUsage()` directly, but the
// renderer assigns the results via `rowKey()`. In between,
// parent object and hierarchy got lost, and with that EVERY view and
// subset row no longer found its result. This block assigns like the
// renderer — otherwise it does not check the gap in which the bug sat.
describe('check results find their row', () => {
  beforeEach(() => {
    fetchDimensionCubeNames.mockResolvedValue(new Map());
    listChores.mockResolvedValue([]);
  });

  /** Exactly what `webviewClient/bulkDelete/index.ts` does on `usage` arrival. */
  const zuordnen = (
    ergebnisse: Array<{ kind: string; name: string; parent?: string; hierarchy?: string; usage: unknown }>,
    zeilen: Array<{ kind: string; name: string; parent?: string; hierarchy?: string }>,
  ) => {
    const byKey = new Map(ergebnisse.map(u => [rowKey(u as never), u.usage]));
    return zeilen.map(z => byKey.get(rowKey(z as never)));
  };

  it('a view gets its result — the parent object does not get lost', async () => {
    index = {
      ...emptyIndex,
      processDataSources: new Map([
        ['load', {
          processName: 'Load',
          declared: { type: 'TM1CubeView', nameForServer: 'Sales', view: 'Monthly' },
          assigned: [],
        }],
      ]),
    } as unknown as typeof emptyIndex;
    const zeile = { kind: 'view' as const, name: 'Monthly', parent: 'Sales', isControl: false };
    const res = await loadUsage(cfg, [zeile]);
    expect(zuordnen(res.usage, [zeile])[0]).toBeDefined();
    expect((zuordnen(res.usage, [zeile])[0] as { soft: { processes: string[] } }).soft.processes)
      .toEqual(['Load']);
  });

  it('two subsets of the same name in different hierarchies do not collide', async () => {
    index = {
      ...emptyIndex,
      subsetViews: new Map([['region|region|alle', [{ cube: 'Planung', view: 'Standard' }]]]),
    } as unknown as typeof emptyIndex;
    const a = { kind: 'subset' as const, name: 'Alle', parent: 'Region', hierarchy: 'Region', isControl: false };
    const b = { kind: 'subset' as const, name: 'Alle', parent: 'Region', hierarchy: 'Kontinente', isControl: false };
    const res = await loadUsage(cfg, [a, b]);
    const [hatA, hatB] = zuordnen(res.usage, [a, b]) as Array<{ hard: unknown[] }>;
    expect(hatA.hard).toHaveLength(1);
    expect(hatB.hard).toEqual([]);
  });
});

describe('analysis limits belong to the shown table', () => {
  beforeEach(() => {
    fetchDimensionCubeNames.mockResolvedValue(new Map());
    listChores.mockResolvedValue([]);
    index = {
      ...emptyIndex,
      dynamicDataSources: [
        { process: 'NurSicht', scope: 'view' },
        { process: 'NurCube', scope: 'parent' },
      ],
    } as unknown as typeof emptyIndex;
  });

  it('a cube list reports only the limit that concerns cubes', async () => {
    const res = await loadUsage(cfg, [{ kind: 'cube', name: 'Sales', isControl: false }]);
    expect(res.dynamicDataSources).toEqual(['NurCube']);
  });

  it('a view list reports only the limit that concerns views', async () => {
    const res = await loadUsage(cfg,
      [{ kind: 'view', name: 'Monthly', parent: 'Sales', isControl: false }]);
    expect(res.dynamicDataSources).toEqual(['NurSicht']);
  });

  it('a process list reports none at all — a data source never points to a process', async () => {
    const res = await loadUsage(cfg, [{ kind: 'process', name: 'Load', isControl: false }]);
    expect(res.dynamicDataSources).toEqual([]);
  });
});

describe('job generation', () => {
  beforeEach(() => {
    index = emptyIndex;
    fetchDimensionCubeNames.mockReset();
    fetchDimensionCubeNames.mockResolvedValue(new Map());
    listChores.mockResolvedValue([]);
    listProcesses.mockResolvedValue([{ Name: 'Load' }]);
    BulkDeletePanel.initialize({ fsPath: '/x' } as never, () => { /* no tree */ });
  });

  /**
   * The renderer throws away what does not belong to the running generation. That
   * only works if the host returns it UNCHANGED — also on `busy`,
   * otherwise the end of an old search deletes the notice of the new one.
   */
  it('every answer carries the generation of its job', async () => {
    const posted = await sendCollecting(
      { type: 'search', kinds: ['process'], pattern: '', includeControl: false, gen: 7 });
    expect(posted.length).toBeGreaterThan(0);
    for (const p of posted) { expect((p as { gen: number }).gen).toBe(7); }
    expect(posted.map(p => (p as { type: string }).type)).toEqual(['busy', 'rows', 'busy']);
  });

  it('the check also returns its generation', async () => {
    const posted = await sendCollecting(
      { type: 'analyze', rows: [{ kind: 'process', name: 'Load' }], gen: 3 });
    for (const p of posted) { expect((p as { gen: number }).gen).toBe(3); }
  });

  it('an error keeps the generation — otherwise it would stay invisible', async () => {
    (getOrBuildIndex as unknown as { mockRejectedValueOnce(e: Error): void })
      .mockRejectedValueOnce(new Error('HTTP 500'));
    const posted = await sendCollecting(
      { type: 'analyze', rows: [{ kind: 'process', name: 'Load' }], gen: 9 });
    const err = posted.find(p => (p as { type: string }).type === 'error');
    expect(err).toBeDefined();
    expect((err as { gen: number }).gen).toBe(9);
  });
});

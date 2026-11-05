import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tm1Config } from '../../../tm1Rest/transport/types';
import type { HostToOverview } from '../../../webviews/objectOverview/overviewProtocol';
import type { ColumnPatch } from '../../../webviews/objectOverview/overviewTypes';

const listCubesOverview = vi.fn();
const fetchAllCubeRules = vi.fn();
const fetchAllCubeViewCounts = vi.fn();
const fetchAllCubeStats = vi.fn();

vi.mock('../../../tm1Rest/cubeApi', () => ({
  listCubesOverview: (...a: unknown[]) => listCubesOverview(...a),
  fetchAllCubeRules: (...a: unknown[]) => fetchAllCubeRules(...a),
  fetchAllCubeViewCounts: (...a: unknown[]) => fetchAllCubeViewCounts(...a),
}));
vi.mock('../../../cubeStats/cubeStatsApi', () => ({
  fetchAllCubeStats: (...a: unknown[]) => fetchAllCubeStats(...a),
  formatBytes: (n: number) => `${n} B`,
}));
vi.mock('../../../commands/serverManager', () => ({ getServerIdByUrl: () => 'srv' }));

import { buildCubeOverviewConfig } from '../../../commands/cubeViewer/cubeOverviewConfig';
import { buildCubeRows } from '../../../commands/cubeViewer/cubeOverviewPure';
import { cellDisplayState } from '../../../webviews/objectOverview/overviewCellsPure';

const cfg = { serverUrl: 'http://tm1', authType: 'Basic' } as unknown as Tm1Config;

/** Last patched value per column key across all emitted patch messages. */
function lastValues(msgs: HostToOverview[]): Map<string, ColumnPatch['value']> {
  const out = new Map<string, ColumnPatch['value']>();
  for (const m of msgs) {
    if (m.type !== 'patch') { continue; }
    for (const p of m.patches) { out.set(p.columnKey, p.value); }
  }
  return out;
}

describe('cube overview lazy failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCubesOverview.mockResolvedValue([{ Name: 'Sales', Dimensions: [{ Name: 'Time' }] }]);
  });

  it('resolves EVERY lazy column when rules and }StatsByCube both fail', async () => {
    // The defect: `hasRules`/`hasFeeders`/`cells` were patched with `null`, which
    // the client reads as "still loading" → those cells spin forever while the
    // sibling columns in the same row show "—".
    fetchAllCubeRules.mockRejectedValue(new Error('403'));
    fetchAllCubeViewCounts.mockRejectedValue(new Error('403'));
    fetchAllCubeStats.mockRejectedValue(new Error('no }StatsByCube'));

    const config = buildCubeOverviewConfig();
    const rows = buildCubeRows([{ Name: 'Sales', Dimensions: [{ Name: 'Time' }] }]);
    const msgs: HostToOverview[] = [];
    await config.lazyFetch!(cfg, rows, (m) => msgs.push(m));

    const values = lastValues(msgs);
    const lazyKeys = config.columns.filter(c => c.lazy).map(c => c.key);
    expect(lazyKeys).toEqual(['hasRules', 'ruleLines', 'hasFeeders', 'cells', 'ram', 'views', 'fedRatio', 'cacheMiss']);
    for (const key of lazyKeys) {
      const col = config.columns.find(c => c.key === key)!;
      expect(values.has(key), `no patch emitted for lazy column "${key}"`).toBe(true);
      expect(cellDisplayState(col, values.get(key)!), `lazy column "${key}" still spins`).toBe('empty');
    }
  });

  it('still emits real values when the fetches succeed', async () => {
    fetchAllCubeRules.mockResolvedValue(new Map([['Sales', '[]=N: 1;\nFEEDERS;\n[]=>DB(\'x\');']]));
    fetchAllCubeViewCounts.mockResolvedValue(new Map([['Sales', 3]]));
    fetchAllCubeStats.mockResolvedValue(new Map([
      ['Sales', { values: { totalMemoryBytes: 2048, numericCells: 10, stringCells: 5 } }],
    ]));

    const config = buildCubeOverviewConfig();
    const rows = buildCubeRows([{ Name: 'Sales', Dimensions: [{ Name: 'Time' }] }]);
    const msgs: HostToOverview[] = [];
    await config.lazyFetch!(cfg, rows, (m) => msgs.push(m));

    const values = lastValues(msgs);
    expect(values.get('hasRules')).toBe(true);
    expect(values.get('hasFeeders')).toBe(true);
    expect(values.get('cells')).toBe(15);
    expect(values.get('ram')).toBe('2048 B');
    expect(values.get('views')).toBe(3);
  });
});

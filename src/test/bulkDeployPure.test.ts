import { describe, it, expect, vi } from 'vitest';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { rowKey } from '../webviews/bulkObjectsPure';
import { sortForDeploy, openMissing, emptyCheck, hardBlockers,
} from '../webviews/bulkDeployPure';

describe('bulk migration — order and missing objects', () => {
  it('writes processes before chores and subsets before views', () => {
    const items = [
      { kind: 'chore' as const, name: 'Nightly' },
      { kind: 'view' as const, name: 'Default', parent: 'Sales' },
      { kind: 'process' as const, name: 'Load' },
      { kind: 'subset' as const, name: 'Top', parent: 'Region', hierarchy: 'Region' },
      { kind: 'rule' as const, name: 'Sales' },
    ];
    expect(sortForDeploy(items).map(i => i.kind))
      .toEqual(['process', 'rule', 'subset', 'view', 'chore']);
  });

  it('does not count as missing what goes along in the same run', () => {
    const check = emptyCheck();
    check.missing = [
      { kind: 'process', name: 'Load' },
      { kind: 'cube', name: 'Sales' },
    ];
    // The process is selected too: it stands over there before its chore
    // is written (see DEPLOY_ORDER). The cube is not — this page
    // creates no cubes, so it remains a finding.
    const selected = new Set([rowKey({ kind: 'process', name: 'Load' })]);
    expect(openMissing(check, selected)).toEqual([{ kind: 'cube', name: 'Sales' }]);
  });

  it('distinguishes subsets of the same name in different hierarchies', () => {
    const check = emptyCheck();
    check.missing = [{ kind: 'subset', name: 'Default', parent: 'Region', hierarchy: 'Sales' }];
    // Selected is the subset of the same dimension, but of the default
    // hierarchy — a different subset, so the finding remains.
    const selected = new Set([
      rowKey({ kind: 'subset', name: 'Default', parent: 'Region', hierarchy: 'Region' }),
    ]);
    expect(openMissing(check, selected)).toHaveLength(1);
  });
});

// ── Follow-up review 2026-09-19 ────────────────────────────────────────────────────

// Network kill switch. This half of the file loads `commands/deploy/*` — that is, real
// modules that call REST. Only `objectListingApi`, `dimensionApi`
// and `choreApi` were mocked; every other path (`subsetApi`, `cubeApi`, `viewCopyApi`,
// `processApi`) would run into the real network and end in a timeout instead of in
// a clear error. The bolt sits at the shared exit, not at each
// facade individually: modules under `tm1Rest/` call `client` directly.
vi.mock('../tm1Rest/client', () => ({
  apiRequest: () => Promise.reject(new Error(
    'bulkDeployPure.test.ts: unerwarteter Netzaufruf — fehlt ein vi.mock?')),
}));

const listedKinds: string[][] = [];
vi.mock('../tm1Rest/objectListingApi', () => ({
  listObjectRows: (_cfg: unknown, kinds: string[]) => {
    listedKinds.push([...kinds]);
    return Promise.resolve({ rows: [], failed: [] });
  },
  objectRow: () => ({}),
}));
vi.mock('../tm1Rest/dimensionApi', () => ({ listDimensionsWithHierarchies: () => Promise.resolve([]) }));
vi.mock('../tm1Rest/choreApi', () => ({
  createChore: () => Promise.resolve(),
  updateChore: () => Promise.reject(new Error('activation refused')),
  clearChoreTasks: () => Promise.resolve(),
  getChoreDetail: () => Promise.resolve({ data: { Name: 'Nightly', Active: true, Tasks: [] } }),
}));

const cfg: Tm1Config = {
  serverUrl: 'http://t', username: 'u', password: 'p',
  authType: 'Basic', rejectUnauthorized: false,
};

describe('bulk migration — inventory and chore report', () => {
  it('loads views and subsets even when only processes are chosen', async () => {
    const { readTargetInventory } = await import('../commands/deploy/deployCheck');
    listedKinds.length = 0;
    await readTargetInventory(cfg, ['process']);
    // Without these two lists, `checkProcess` reports every existing
    // data source view as "missing over there".
    expect(listedKinds[0]).toContain('view');
    expect(listedKinds[0]).toContain('subset');
  });

  it('reports a created but not activated chore as a warning', async () => {
    const { deployOne } = await import('../commands/deploy/deployWrite');
    const res = await deployOne({ kind: 'chore', name: 'Nightly' }, cfg, cfg, false);
    expect(typeof res === 'object' && res.warn).toMatch(/not activated/);
  });
});

describe('bulk migration — what really blocks the write', () => {
  const cube = { kind: 'cube', name: 'c1' };
  const dim = { kind: 'dimension', name: 'a' };

  it('blocks rule, view, subset and chore at their carrier', () => {
    expect(hardBlockers({ kind: 'rule', name: 'c1' }, [cube])).toHaveLength(1);
    expect(hardBlockers({ kind: 'view', name: 'Standard', parent: 'c1' }, [cube])).toHaveLength(1);
    expect(hardBlockers({ kind: 'subset', name: 'subset_1', parent: 'a' }, [dim])).toHaveLength(1);
    expect(hardBlockers({ kind: 'chore', name: 'Nightly' },
      [{ kind: 'process', name: '90020_SaveDataAll' }])).toHaveLength(1);
  });

  it('blocks no process and no rule on a FOREIGN cube', () => {
    // The process can be created and only fails at run time; the
    // rule text is written and reports its error on compile.
    expect(hardBlockers({ kind: 'process', name: 'Load' }, [cube])).toHaveLength(0);
    expect(hardBlockers({ kind: 'rule', name: 'c2' }, [cube])).toHaveLength(0);
  });
});

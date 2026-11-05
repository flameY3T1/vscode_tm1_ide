// Guard for the jump from bulk delete into the usage view.
//
// The bug it pins down: the dependency column named `}Drill_test`
// and `}Drill_test2`, the window behind "show all" showed neither —
// `buildCubeOrDimUsages` throws away sources with `}` as soon as the tree
// hides control objects. The column does not do that, because a control process
// breaks just like any other.
import { describe, it, expect, vi } from 'vitest';
import { buildReferenceIndex } from '../references/referenceIndex';
import { buildCubeOrDimUsages } from '../references/callGraph';

vi.mock('../tm1Rest/cubeApi', () => ({
  listCubes: vi.fn(), deleteCube: vi.fn(), deleteView: vi.fn(),
}));
vi.mock('../tm1Rest/processApi', () => ({ listProcesses: vi.fn(), deleteProcess: vi.fn() }));
vi.mock('../tm1Rest/choreApi', () => ({ listChores: vi.fn(), deleteChore: vi.fn() }));
vi.mock('../tm1Rest/subsetApi', () => ({ deleteSubset: vi.fn() }));
vi.mock('../tm1Rest/dimensionApi', () => ({
  listDimensionNames: vi.fn(), deleteDimension: vi.fn(), fetchDimensionCubeNames: vi.fn(),
}));
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../providers/fetchNames', () => ({ invalidateCache: vi.fn() }));
vi.mock('../references/referenceIndexService', () => ({
  getOrBuildIndex: vi.fn(), invalidateReferenceIndex: vi.fn(),
}));

import { usageNode } from '../webviews/bulkDeleteWebview';

const idxWithControlSources = () => buildReferenceIndex({
  fetchProcesses: async () => [
    { name: '}Drill_test', prolog: "v = CellGetN('c2', 'x');", metadata: '', data: '', epilog: '' },
    { name: 'Normal',      prolog: "v = CellGetN('c2', 'x');", metadata: '', data: '', epilog: '' },
  ],
  fetchCubesWithRules: async () => [{ cubeName: 'c2', rulesText: '' }],
});

describe('"show all" shows the same sources as the column', () => {
  it('the node forces the control objects', () => {
    expect(usageNode('cube', 'c2', 'srv')?.meta.includeSystem).toBe(true);
    expect(usageNode('process', 'P', 'srv')?.meta.includeSystem).toBe(true);
  });

  it('view and subset have no target there', () => {
    expect(usageNode('view', 'V', 'srv')).toBeUndefined();
    expect(usageNode('subset', 'S', 'srv')).toBeUndefined();
  });

  it('with forced control objects }Drill_test is included — without, it is not', async () => {
    const idx = await idxWithControlSources();
    expect(buildCubeOrDimUsages(idx, 'cube', 'c2', { includeSystem: true })
      .map(u => u.sourceName).sort()).toEqual(['Normal', '}Drill_test']);
    // Exactly the case from the click test: without the flag the row that
    // stands in the column is missing.
    expect(buildCubeOrDimUsages(idx, 'cube', 'c2', { includeSystem: false })
      .map(u => u.sourceName)).toEqual(['Normal']);
  });
});

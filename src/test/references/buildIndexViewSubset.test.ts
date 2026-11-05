import { describe, it, expect } from 'vitest';
import { buildReferenceIndex, subsetKey } from '../../references/referenceIndex';
import { parseViewSubsetUses } from '../../references/referenceIndexService';
import { buildCubeOrDimUsages } from '../../references/callGraph';

const base = {
  fetchProcesses: async () => [],
  fetchCubesWithRules: async () => [],
  fetchChores: async () => [],
  fetchDimNames: async () => ['Region', 'Product', 'Time'],
};

describe('buildReferenceIndex — subset/view edges', () => {
  it('does NOT index a subset under its own dim', async () => {
    // By definition a subset belongs to exactly one dimension — showing its own
    // dimension as a "usage" says nothing and floods the
    // usage view with the whole subset list.
    const idx = await buildReferenceIndex({
      ...base,
      fetchSubsets: async () => [{ dim: 'Region', hier: 'Region', subset: 'Europe', expression: null }],
      fetchMdxViews: async () => [],
    });
    expect((idx.byDim.get('region') ?? []).some(r => r.sourceKind === 'subset')).toBe(false);
  });

  it('dynamic subset cross-references a foreign dim, but not its own', async () => {
    const idx = await buildReferenceIndex({
      ...base,
      fetchSubsets: async () => [{ dim: 'Region', hier: 'Region', subset: 'Dyn', expression: '{[Product].[A]}' }],
      fetchMdxViews: async () => [],
    });
    expect((idx.byDim.get('product') ?? []).some(r => r.sourceKind === 'subset')).toBe(true);
    expect((idx.byDim.get('region') ?? []).some(r => r.sourceKind === 'subset')).toBe(false);
  });

  it('indexes an MDX view under each referenced dim', async () => {
    const idx = await buildReferenceIndex({
      ...base,
      fetchSubsets: async () => [],
      fetchMdxViews: async () => [{ cube: 'Sales', view: 'V1', mdx: 'SELECT {[Region].Members} ON 0 FROM [Sales]' }],
    });
    expect((idx.byDim.get('region') ?? []).some(r => r.sourceKind === 'view' && r.sourceName === 'Sales:V1')).toBe(true);
  });

  it('is backward-compatible when the new fetchers are absent', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [], fetchCubesWithRules: async () => [],
    });
    expect(idx.byDim.size).toBe(0);
  });
});

describe('buildCubeOrDimUsages — subset/view pass-through', () => {
  it('returns cross-dim subset + view usage rows for a dimension', async () => {
    const idx = await buildReferenceIndex({
      ...base,
      // Subset on Region that filters Product → usage of PRODUCT.
      fetchSubsets: async () => [{ dim: 'Region', hier: 'Region', subset: 'Dyn', expression: '{[Product].[A]}' }],
      fetchMdxViews: async () => [{ cube: 'Sales', view: 'V1', mdx: 'SELECT {[Product].Members} ON 0 FROM [Sales]' }],
    });
    const rows = buildCubeOrDimUsages(idx, 'dimension', 'Product');
    expect(rows.some(r => r.sourceKind === 'subset' && r.sourceName === 'Region:Region:Dyn')).toBe(true);
    expect(rows.some(r => r.sourceKind === 'view' && r.sourceName === 'Sales:V1')).toBe(true);
  });

  it('a dimension does not list its own subsets', () => {
    // Regression guard for the report: "is used in its own
    // subsets" was the most frequent line in the usage view.
    return buildReferenceIndex({
      ...base,
      fetchSubsets: async () => [
        { dim: 'Region', hier: 'Region', subset: 'Europe', expression: null },
        { dim: 'Region', hier: 'Region', subset: 'Dyn', expression: '{[Region].Members}' },
      ],
      fetchMdxViews: async () => [],
    }).then(idx => {
      const rows = buildCubeOrDimUsages(idx, 'dimension', 'Region');
      expect(rows.filter(r => r.sourceKind === 'subset')).toEqual([]);
    });
  });
});

// ─── Achsen nativer Sichten ──────────────────────────────────────────────────

describe('parseViewSubsetUses', () => {
  it('reads named axis subsets and leaves out anonymous ones', () => {
    const uses = parseViewSubsetUses({
      value: [{
        Name: 'Planung',
        Views: [{
          Name: 'Standard',
          Rows: [{ Subset: { Name: 'Alle', Hierarchy: { Name: 'Region', Dimension: { Name: 'Region' } } } }],
          // Anonymous axis: not an object anyone could delete.
          Columns: [{ Subset: { Hierarchy: { Name: 'Zeit', Dimension: { Name: 'Zeit' } } } }],
          Titles: [{ Subset: { Name: 'Top', Hierarchy: { Name: 'Kontinente', Dimension: { Name: 'Region' } } } }],
        }],
      }],
    });
    expect(uses).toEqual([
      { cube: 'Planung', view: 'Standard', dim: 'Region', hier: 'Region', subset: 'Alle' },
      { cube: 'Planung', view: 'Standard', dim: 'Region', hier: 'Kontinente', subset: 'Top' },
    ]);
  });

  it('the same subset on two axes is ONE holder', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [],
      fetchCubesWithRules: async () => [],
      fetchViewSubsetUses: async () => [
        { cube: 'Planung', view: 'Standard', dim: 'Region', hier: 'Region', subset: 'Alle' },
        { cube: 'Planung', view: 'Standard', dim: 'Region', hier: 'Region', subset: 'Alle' },
      ],
    });
    expect(idx.subsetViews.get(subsetKey('Region', 'Region', 'Alle')))
      .toEqual([{ cube: 'Planung', view: 'Standard' }]);
  });

  it('if the query fails, that shows up in `incomplete` — not as "no view"', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [],
      fetchCubesWithRules: async () => [],
      fetchViewSubsetUses: async () => { throw new Error('HTTP 400'); },
    });
    expect(idx.incomplete).toContain('view axes');
    expect(idx.subsetViews.size).toBe(0);
  });
});

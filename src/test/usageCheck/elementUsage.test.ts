// src/test/usageCheck/elementUsage.test.ts
import { describe, it, expect } from 'vitest';
import { findElementReferences } from '../../usageCheck/elementUsage';
import type { ReferenceIndex, TmReference } from '../../references/referenceTypes';

function mockIndex(refs: TmReference[]): ReferenceIndex {
  return {
    bySourceProcess: new Map(),
    byTarget: new Map(),
    all: refs,
    stats: { scannedProcesses: 0, scannedCubes: 0, scannedSubsets: 0 },
  } as any;
}

describe('findElementReferences', () => {
  it('returns empty list when element not referenced', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Ghost',
      index: mockIndex([]),
      cubesContainingDim: [],
      subsetsFetcher: async () => [],
      viewsFetcher: async () => [],
    });
    expect(refs).toEqual([]);
  });

  it('finds element referenced in rule [dim].[elem]', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Phone',
      index: mockIndex([
        {
          sourceKind: 'rule', sourceName: 'Sales', section: 'rules',
          line: 10, snippet: "['Products':'Phone'] = N: 100;",
          targetKind: 'dimension', targetName: 'Products',
        } as any,
      ]),
      cubesContainingDim: ['Sales'],
      subsetsFetcher: async () => [],
      viewsFetcher: async () => [],
    });
    expect(refs.length).toBe(1);
    expect(refs[0].kind).toBe('rule');
  });

  it('finds element in process string literal arg of HierarchyElementInsert', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Phone',
      index: mockIndex([
        {
          sourceKind: 'process', sourceName: 'LoadProd', section: 'prolog',
          line: 5, snippet: "HierarchyElementInsert('Products','Products','Phone','','N');",
          targetKind: 'dimension', targetName: 'Products',
          funcName: 'HierarchyElementInsert',
        } as any,
      ]),
      cubesContainingDim: [],
      subsetsFetcher: async () => [],
      viewsFetcher: async () => [],
    });
    expect(refs.length).toBe(1);
    expect(refs[0].kind).toBe('process');
  });

  it('is case-insensitive for element match', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'phone',
      index: mockIndex([
        {
          sourceKind: 'rule', sourceName: 'Sales', section: 'rules',
          line: 10, snippet: "['Products':'Phone'] = N: 100;",
          targetKind: 'dimension', targetName: 'Products',
        } as any,
      ]),
      cubesContainingDim: ['Sales'],
      subsetsFetcher: async () => [],
      viewsFetcher: async () => [],
    });
    expect(refs.length).toBe(1);
  });

  it('finds element in subset', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Phone',
      index: mockIndex([]),
      cubesContainingDim: [],
      subsetsFetcher: async () => [
        { name: 'Premium', isPrivate: false, elements: ['Phone', 'Laptop'] },
      ],
      viewsFetcher: async () => [],
    });
    expect(refs.length).toBe(1);
    expect(refs[0].kind).toBe('subset');
  });

  it('dedupes repeated matches in same source', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Phone',
      index: mockIndex([
        {
          sourceKind: 'rule', sourceName: 'Sales', section: 'rules',
          line: 10, snippet: "['Products':'Phone'] = N: 100;",
          targetKind: 'dimension', targetName: 'Products',
        } as any,
        {
          sourceKind: 'rule', sourceName: 'Sales', section: 'rules',
          line: 11, snippet: "['Products':'Phone'] = C: 200;",
          targetKind: 'dimension', targetName: 'Products',
        } as any,
      ]),
      cubesContainingDim: ['Sales'],
      subsetsFetcher: async () => [],
      viewsFetcher: async () => [],
    });
    // Two distinct lines → two UsageRefs
    expect(refs.length).toBe(2);
  });

  it('filters out refs where element name just happens to appear elsewhere', async () => {
    // Snippet mentions 'Phone Accessories' but not 'Phone' as element
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Phone',
      index: mockIndex([
        {
          sourceKind: 'rule', sourceName: 'Sales', section: 'rules',
          line: 10, snippet: "['Products':'Phone Accessories'] = N: 100;",
          targetKind: 'dimension', targetName: 'Products',
        } as any,
      ]),
      cubesContainingDim: ['Sales'],
      subsetsFetcher: async () => [],
      viewsFetcher: async () => [],
    });
    expect(refs).toEqual([]);
  });

  it('collects refs from multiple sources: rule + process + subset', async () => {
    const refs = await findElementReferences({
      dim: 'Products',
      element: 'Phone',
      index: mockIndex([
        {
          sourceKind: 'rule', sourceName: 'Sales', section: 'rules',
          line: 10, snippet: "['Products':'Phone'] = N: 100;",
          targetKind: 'dimension', targetName: 'Products',
        } as any,
        {
          sourceKind: 'process', sourceName: 'LoadProd', section: 'prolog',
          line: 5, snippet: "HierarchyElementDelete('Products','Products','Phone');",
          targetKind: 'dimension', targetName: 'Products',
          funcName: 'HierarchyElementDelete',
        } as any,
      ]),
      cubesContainingDim: ['Sales'],
      subsetsFetcher: async () => [
        { name: 'Premium', isPrivate: true, elements: ['Phone'] },
      ],
      viewsFetcher: async () => [],
    });
    expect(refs.length).toBe(3);
    const kinds = refs.map(r => r.kind).sort();
    expect(kinds).toEqual(['process', 'rule', 'subset']);
  });
});

import { describe, it, expect } from 'vitest';
import { findBuiltin } from '../../../tiSimulator/eval/builtins';
import { emptyFixtures } from '../../../tiSimulator/types';
import type { Fixtures, Value } from '../../../tiSimulator/types';

/** All 30 object-level attribute-read builtins this suite covers. */
const ALL_NAMES = [
  'ChoreAttrN', 'ChoreAttrNL', 'ChoreAttrS', 'ChoreAttrSL',
  'CubeAttrN', 'CubeAttrNL', 'CubeAttrS', 'CubeAttrSL',
  'DimensionAttrNL', 'DimensionAttrSL',
  'HierarchyAttrN', 'HierarchyAttrNL', 'HierarchyAttrS', 'HierarchyAttrSL',
  'HierarchySubsetAttrN', 'HierarchySubsetAttrNL', 'HierarchySubsetAttrS', 'HierarchySubsetAttrSL',
  'ProcessAttrN', 'ProcessAttrNL', 'ProcessAttrS', 'ProcessAttrSL',
  'SubsetAttrN', 'SubsetAttrNL', 'SubsetAttrS', 'SubsetAttrSL',
  'ViewAttrN', 'ViewAttrNL', 'ViewAttrS', 'ViewAttrSL',
];

function fxWith(entries: Array<[string, Value]>): Fixtures {
  const fx = emptyFixtures();
  for (const [k, v] of entries) fx.objectAttributes!.set(k, v);
  return fx;
}

describe('object-level attribute-read builtins', () => {
  it('registers all 30 names (case-insensitive)', () => {
    for (const n of ALL_NAMES) {
      expect(findBuiltin(n), n).toBeDefined();
      expect(findBuiltin(n.toLowerCase()), n).toBeDefined();
      expect(findBuiltin(n.toUpperCase()), n).toBeDefined();
    }
  });

  it('CubeAttrS resolves a captured string value', () => {
    const fx = fxWith([['cubeattrs\t}Cubes\tOwner', 'admin']]);
    expect(findBuiltin('CubeAttrS')!.invoke(['}Cubes', 'Owner'], fx)).toBe('admin');
  });

  it('CubeAttrN resolves a captured numeric value', () => {
    const fx = fxWith([['cubeattrn\t}Cubes\tRank', 7]]);
    expect(findBuiltin('CubeAttrN')!.invoke(['}Cubes', 'Rank'], fx)).toBe(7);
  });

  it('HierarchyAttrS with 3 args keys as dim\\thier\\tattr', () => {
    const fx = fxWith([['hierarchyattrs\tPeriod\tPeriod\tCaption', 'Zeit']]);
    expect(findBuiltin('HierarchyAttrS')!.invoke(['Period', 'Period', 'Caption'], fx)).toBe('Zeit');
  });

  it('string miss returns "" and records the key in cellReadMisses', () => {
    const fx = emptyFixtures();
    expect(findBuiltin('CubeAttrS')!.invoke(['}Cubes', 'Owner'], fx)).toBe('');
    expect(fx.cellReadMisses!.has('cubeattrs\t}Cubes\tOwner')).toBe(true);
  });

  it('numeric miss returns 0 and records the key in cellReadMisses', () => {
    const fx = emptyFixtures();
    expect(findBuiltin('CubeAttrN')!.invoke(['}Cubes', 'Rank'], fx)).toBe(0);
    expect(fx.cellReadMisses!.has('cubeattrn\t}Cubes\tRank')).toBe(true);
  });

  it('coerces mismatched fixture types (string in N slot, number in S slot)', () => {
    const fxN = fxWith([['cubeattrn\t}Cubes\tRank', '12']]);
    expect(findBuiltin('CubeAttrN')!.invoke(['}Cubes', 'Rank'], fxN)).toBe(12);
    const fxS = fxWith([['cubeattrs\t}Cubes\tRank', 12]]);
    expect(findBuiltin('CubeAttrS')!.invoke(['}Cubes', 'Rank'], fxS)).toBe('12');
  });

  it('NL/SL variants key by their own lowercased name', () => {
    const fx = fxWith([
      ['dimensionattrsl\tPeriod\tCaption', 'Zeit'],
      ['dimensionattrnl\tPeriod\tSort', 3],
    ]);
    expect(findBuiltin('DimensionAttrSL')!.invoke(['Period', 'Caption'], fx)).toBe('Zeit');
    expect(findBuiltin('DimensionAttrNL')!.invoke(['Period', 'Sort'], fx)).toBe(3);
  });
});

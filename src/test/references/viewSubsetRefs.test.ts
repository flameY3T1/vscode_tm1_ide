import { describe, it, expect } from 'vitest';
import { dimsFromMdx, cubesFromMdx, subsetToRefs, mdxViewToRefs, type SubsetFetchResult, type MdxViewFetchResult } from '../../references/referenceIndex';

const known = new Set(['region', 'product', 'time', 'period']);

describe('dimsFromMdx', () => {
  it('collects distinct known dims, drops unknown + dedups', () => {
    const mdx = '{ [Region].[North] } * { [Product].Members } * { [Region].[South] } * { [Ghost].[X] }';
    expect(dimsFromMdx(mdx, known).sort()).toEqual(['Product', 'Region']);
  });
  it('returns [] for empty text', () => {
    expect(dimsFromMdx('', known)).toEqual([]);
  });
  it('handles `]]`-escaped literal `]` in bracketed names (L7)', () => {
    // TM1 escapes a literal `]` inside `[…]` as `]]`. The dim "re]gion" is
    // written [re]]gion]; the old scan closed the token at the first `]` and
    // never matched it. Now it consumes `]]` as one literal `]` and unescapes.
    const bracketed = new Set(['re]gion', 'product']);
    const mdx = '{ [re]]gion].[North] } * { [Product].Members }';
    expect(dimsFromMdx(mdx, bracketed).sort()).toEqual(['Product', 're]gion']);
  });
});

describe('subsetToRefs', () => {
  it('static subset → no edge at all (own dim is not a usage)', () => {
    const s: SubsetFetchResult = { dim: 'Region', hier: 'Region', subset: 'Europe', expression: null };
    expect(subsetToRefs(s, known)).toEqual([]);
  });
  it('dynamic subset → only the OTHER dims of the expression', () => {
    const s: SubsetFetchResult = {
      dim: 'Region', hier: 'Region', subset: 'Dyn',
      expression: '{ TM1FILTERBYLEVEL( {[Region].Members}, 0) } * { [Product].[A] }',
    };
    const refs = subsetToRefs(s, known);
    expect(refs.map(r => r.targetName)).toEqual(['Product']);
    expect(refs[0]).toMatchObject({
      sourceKind: 'subset', sourceName: 'Region:Region:Dyn',
      targetKind: 'dimension', section: 'subset',
    });
  });
  it('own dim in the expression is dropped too (case-insensitive)', () => {
    const s: SubsetFetchResult = { dim: 'Region', hier: 'Region', subset: 'Dyn', expression: '{[REGION].Members}' };
    expect(subsetToRefs(s, new Set(['region']))).toEqual([]);
  });
});

describe('mdxViewToRefs', () => {
  it('MDX view → one deduped edge per referenced known dim', () => {
    const v: MdxViewFetchResult = {
      cube: 'Sales', view: 'ByRegion',
      mdx: 'SELECT {[Region].Members} ON 0, {[Time].[2026]} ON 1 FROM [Sales] WHERE ([Region].[North])',
    };
    const refs = mdxViewToRefs(v, known);
    expect(refs.map(r => r.targetName).sort()).toEqual(['Region', 'Time']);
    expect(refs[0]).toMatchObject({ sourceKind: 'view', sourceName: 'Sales:ByRegion', section: 'view' });
  });
  it('empty/native mdx → no edges', () => {
    expect(mdxViewToRefs({ cube: 'Sales', view: 'Native', mdx: '' }, known)).toEqual([]);
  });
});

const knownCubes = new Set(['sales', 'costs', 'rate']);

describe('cubesFromMdx', () => {
  it('matches the same bracket form against the cube inventory', () => {
    expect(cubesFromMdx('([Sales].([Region].[North]))', knownCubes)).toEqual(['Sales']);
  });
  it('whatever is not a cube falls through', () => {
    expect(cubesFromMdx('{[Region].Members}', knownCubes)).toEqual([]);
  });
});

describe('cube edges from views and subsets', () => {
  it('an MDX view names the FOREIGN cube, not its own', () => {
    // `FROM [Sales]` is its own cube — every view names it, and when Sales
    // is deleted the view goes with it anyway. `Rate` is the cross-reference.
    const v: MdxViewFetchResult = {
      cube: 'Sales', view: 'Umgerechnet',
      mdx: 'WITH MEMBER [Measures].[X] AS [Rate].([Region].[North]) SELECT {[Region].Members} ON 0 FROM [Sales]',
    };
    const cubes = mdxViewToRefs(v, known, knownCubes)
      .filter(r => r.targetKind === 'cube').map(r => r.targetName);
    expect(cubes).toEqual(['Rate']);
  });

  it('a dynamic subset hangs on the cube that its expression filters', () => {
    const sub: SubsetFetchResult = {
      dim: 'Region', hier: 'Region', subset: 'Top',
      expression: '{FILTER([Region].Members, [Sales].([Measures].[Value]) > 0)}',
    };
    const refs = subsetToRefs(sub, known, knownCubes);
    expect(refs.filter(r => r.targetKind === 'cube').map(r => r.targetName)).toEqual(['Sales']);
    expect(refs.every(r => r.sourceKind === 'subset')).toBe(true);
  });

  it('without a cube inventory everything stays as it was', () => {
    // The default value keeps the callers green that only know dimensions.
    const sub: SubsetFetchResult = {
      dim: 'Region', hier: 'Region', subset: 'Top',
      expression: '{FILTER([Region].Members, [Sales].([Measures].[Value]) > 0)}',
    };
    expect(subsetToRefs(sub, known).every(r => r.targetKind === 'dimension')).toBe(true);
  });
});

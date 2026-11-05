import { describe, it, expect } from 'vitest';
import { hierKey, splitHierKey, hierMdxRef, memberMdxRef, hierODataPath } from '../../utils/hierKeyPure';
import { axisKeyOf, parseTitleAndTuples } from '../../commands/cubeViewer/cellParse';
import { buildCoordinates, cellTarget, coordinateKeys, namesDimTwice } from '../../cubeViewer/cellWrite';
import { buildViewMdx } from '../../cubeViewer/axisMdxPure';
import { buildSpreadMdx } from '../../cubeViewer/cubeSpreadApi';
import { titleKeysFor, replaceKey, addKeyAfter, computeZoneMoveAt } from '../../webviewClient/cubeViewerMonaco/pivotPure';
import { dimSet, memberRef } from '../../webviewClient/cubeViewerMonaco/mdxParts';
import { syncAliasIntoMdx } from '../../webviewClient/cubeViewerMonaco/aliasMdxSyncPure';
import { detectDimensionProperties } from '../../mdx/dimensionPropertiesPure';
import { axisFactorForDim, mapAxisFactorForDim } from '../../mdx/axisFactorsPure';

describe('hierarchy keys', () => {
  it('default hierarchy keeps the bare dimension name', () => {
    expect(hierKey('Region', 'Region')).toBe('Region');
    expect(hierKey('Region', '')).toBe('Region');
    expect(splitHierKey('Region')).toEqual({ dim: 'Region', hier: 'Region' });
  });
  it('alternate hierarchy is dim:hier and round-trips', () => {
    expect(hierKey('Region', 'Alt')).toBe('Region:Alt');
    expect(splitHierKey('Region:Alt')).toEqual({ dim: 'Region', hier: 'Alt' });
  });
  it('builds MDX and OData references with escaping', () => {
    expect(hierMdxRef('R]x:Alt')).toBe('[R]]x].[Alt]');
    expect(memberMdxRef('Region:Alt', 'Grp1')).toBe('[Region].[Alt].[Grp1]');
    expect(memberMdxRef('Region', 'EU')).toBe('[Region].[Region].[EU]');
    expect(hierODataPath("O'Brien:Alt")).toBe("Dimensions('O''Brien')/Hierarchies('Alt')");
  });
});

describe('cellset axes → keys', () => {
  it('uses the expanded Dimension to tell an alternate hierarchy', () => {
    expect(axisKeyOf({ Name: 'Alt', Dimension: { Name: 'Region' } })).toBe('Region:Alt');
    expect(axisKeyOf({ Name: 'Region', Dimension: { Name: 'Region' } })).toBe('Region');
    expect(axisKeyOf({ Name: 'Region' })).toBe('Region');
  });
  it('two hierarchies of one dimension on two axes stay two keys', () => {
    const t = parseTitleAndTuples(
      [
        { Ordinal: 0, Hierarchies: [{ Name: 'Alt', Dimension: { Name: 'D' } }], Tuples: [] },
        { Ordinal: 1, Hierarchies: [{ Name: 'D', Dimension: { Name: 'D' } }], Tuples: [] },
        { Ordinal: 2, Hierarchies: [{ Name: 'MAlt', Dimension: { Name: 'M' } }], Tuples: [{ Members: [{ Name: 'W1' }] }] },
      ],
      { Ordinal: 1, Hierarchies: [{ Name: 'D', Dimension: { Name: 'D' } }], Tuples: [] },
      { Ordinal: 0, Hierarchies: [{ Name: 'Alt', Dimension: { Name: 'D' } }], Tuples: [] },
    );
    expect(t.colDims).toEqual(['D:Alt']);
    expect(t.rowDims).toEqual(['D']);
    expect(t.titleAssignments).toEqual({ 'M:MAlt': 'W1' });
  });
});

describe('write coordinates with alternate hierarchies', () => {
  const base = {
    cubeDims: ['D', 'M'],
    rowDims: ['D'], colDims: ['D:Alt'],
    rowTuples: [['A']], colTuples: [['Grp1']],
    ri: 0, ci: 0,
    titleAssignments: { M: 'W1' },
  };
  it('one coordinate per cube dimension, taken from the first key of that dimension', () => {
    expect(buildCoordinates(base)).toEqual(['A', 'W1']);
    expect(coordinateKeys(base)).toEqual(['D', 'M']);
  });
  it('an alternate hierarchy alone addresses through that hierarchy', () => {
    const a = { ...base, rowDims: ['D:Alt'], colDims: ['M'], rowTuples: [['B']], colTuples: [['W2']], titleAssignments: {} };
    expect(buildCoordinates(a)).toEqual(['B', 'W2']);
    expect(coordinateKeys(a)).toEqual(['D:Alt', 'M']);
  });
  it('a title on an alternate hierarchy counts for its dimension', () => {
    const a = { ...base, rowDims: ['D'], colDims: [], rowTuples: [['A']], colTuples: [[]], titleAssignments: { 'M:MAlt': 'W1' } };
    expect(buildCoordinates(a)).toEqual(['A', 'W1']);
    expect(coordinateKeys(a)).toEqual(['D', 'M:MAlt']);
  });
});

describe('MDX with alternate hierarchies', () => {
  it('host layout MDX addresses [dim].[hier] and slices per dimension', () => {
    const mdx = buildViewMdx({
      cubeName: 'C', rowDims: ['D'], colDims: ['D:Alt'],
      titleAssignments: { 'D:Alt': 'Grp1', M: 'W1' },
      dimSelections: {}, suppressRows: false, suppressCols: false,
    });
    expect(mdx).toBe('SELECT {TM1SUBSETALL([D].[Alt])} ON 0, {TM1SUBSETALL([D].[D])} ON 1 FROM [C] WHERE ([M].[M].[W1])');
    const sliced = buildViewMdx({
      cubeName: 'C', rowDims: ['D'], colDims: ['M'],
      titleAssignments: { 'D:Alt': 'Grp1' },
      dimSelections: {}, suppressRows: false, suppressCols: false,
    });
    expect(sliced).toContain('WHERE ([D].[Alt].[Grp1])');
  });
  it('webview MDX parts address the hierarchy of the key', () => {
    expect(memberRef('D:Alt', 'Grp1')).toBe('[D].[Alt].[Grp1]');
    expect(dimSet('D:Alt', undefined)).toBe('{ TM1SUBSETALL( [D].[Alt] ) }');
  });
  it('spread MDX uses three-part refs', () => {
    expect(buildSpreadMdx('C', ['D:Alt', 'M'], ['Grp1', 'W1'])).toBe('SELECT {([D].[Alt].[Grp1], [M].[M].[W1])} ON 0 FROM [C]');
  });
});

describe('pivot with alternate hierarchies', () => {
  it('title keys: one per uncovered dimension, keeping a switched title hierarchy', () => {
    expect(titleKeysFor(['D', 'M', 'V'], ['D'], ['D:Alt'], ['M:MAlt'])).toEqual(['M:MAlt', 'V']);
    // Default hierarchy on an axis, alternate one as title: allowed.
    expect(titleKeysFor(['D', 'M'], ['D:Alt'], [], ['D', 'M'])).toEqual(['D', 'M']);
    expect(titleKeysFor(['D', 'M'], ['D'], ['M'], ['D:Alt'])).toEqual(['D:Alt']);
    // A default hierarchy not named like its dimension is addressed explicitly.
    expect(titleKeysFor(['a', 'M'], ['M'], [], [], { a: 'b' })).toEqual(['a:b']);
    // The very hierarchy on an axis leaves the titles.
    expect(titleKeysFor(['D', 'M'], ['D:Alt'], ['M'], ['D:Alt'])).toEqual([]);
  });
  it('replaceKey swaps in place, addKeyAfter nests on the same axis', () => {
    const axes = { rowDims: ['D', 'X'], colDims: ['M'], titleDims: ['V'] };
    expect(replaceKey(axes, 'D', 'D:Alt').rowDims).toEqual(['D:Alt', 'X']);
    expect(addKeyAfter(axes, 'D', 'D:Alt').rowDims).toEqual(['D', 'D:Alt', 'X']);
    expect(addKeyAfter(axes, 'M', 'M:MAlt').colDims).toEqual(['M', 'M:MAlt']);
  });
  it('one of two hierarchies moves to the titles while the other stays on its axis', () => {
    const { axes } = computeZoneMoveAt('D:Alt', 'titles', null, { rowDims: ['D'], colDims: ['D:Alt', 'M'], titleDims: [] });
    expect(axes).toEqual({ rowDims: ['D'], colDims: ['M'], titleDims: ['D:Alt'] });
  });
});

// Codex review 2026-09-28
describe('F1: a write/spread keeps a second hierarchy of the same dimension', () => {
  const input = {
    cubeDims: ['D', 'M'], rowDims: ['D'], colDims: ['M'],
    rowTuples: [['All']], colTuples: [['Value']], ri: 0, ci: 0,
    titleAssignments: { 'D:Alt': 'GroupA' },
  };
  it('cellTarget sends every member, the title filter included', () => {
    expect(namesDimTwice(['D', 'M', 'D:Alt'])).toBe(true);
    const t = cellTarget(input);
    expect(t).toEqual({ keys: ['D', 'M', 'D:Alt'], elems: ['All', 'Value', 'GroupA'] });
    expect(buildSpreadMdx('C', t.keys, t.elems))
      .toBe('SELECT {([D].[D].[All], [M].[M].[Value], [D].[Alt].[GroupA])} ON 0 FROM [C]');
  });
  it('two hierarchies on two axes both stay in the target', () => {
    const t = cellTarget({ ...input, colDims: ['D:Alt'], colTuples: [['GroupA']], titleAssignments: { M: 'Value' } });
    expect(t.keys).toEqual(['D', 'D:Alt', 'M']);
    expect(t.elems).toEqual(['All', 'GroupA', 'Value']);
  });
  it('still names a missing dimension', () => {
    expect(() => cellTarget({ ...input, colDims: [], colTuples: [[]], titleAssignments: {} })).toThrow("Dimension 'M'");
  });
});

describe('F2: alias of an alternate hierarchy', () => {
  const mdx = 'SELECT {[M].[M].[Value]} ON 0, {[D].[Alt].[GroupA]} ON 1 FROM [C]';
  it('writes [D].[Alt].[attr] and reads it back under the same key', () => {
    const next = syncAliasIntoMdx({ mdx, isMdxView: true, dim: 'D:Alt', alias: 'Caption', rowDims: ['D:Alt'], colDims: ['M'] })!;
    expect(next).toContain('DIMENSION PROPERTIES [D].[Alt].[Caption] ON 1');
    expect(detectDimensionProperties(next)).toEqual({ 'D:Alt': 'Caption' });
  });
  it('two hierarchies of one dimension on one axis keep separate entries', () => {
    const both = 'SELECT {[M].[M].[Value]} ON 0, {[D].[D].[A]}*{[D].[Alt].[GroupA]} ON 1 FROM [C]';
    const a = syncAliasIntoMdx({ mdx: both, isMdxView: true, dim: 'D', alias: 'X', rowDims: ['D', 'D:Alt'], colDims: ['M'] })!;
    const b = syncAliasIntoMdx({ mdx: a, isMdxView: true, dim: 'D:Alt', alias: 'Y', rowDims: ['D', 'D:Alt'], colDims: ['M'] })!;
    expect(detectDimensionProperties(b)).toEqual({ D: 'X', 'D:Alt': 'Y' });
  });
});

describe('F4: axis factors per hierarchy', () => {
  const mdx = 'SELECT {[M].[M].[Value]} ON 0, {[D].[Alt].[GroupA]} ON 1 FROM [C]';
  it('finds the factor of an alternate-hierarchy key', () => {
    expect(axisFactorForDim(mdx, 'D:Alt')).toBe('{[D].[Alt].[GroupA]}');
    expect(axisFactorForDim(mdx, 'D')).toBeNull();
    expect(mapAxisFactorForDim(mdx, 'D:Alt', (f) => `EXCEPT(${f},{})`)).toContain('EXCEPT({[D].[Alt].[GroupA]},{})');
  });
  it('tells two hierarchies of one dimension apart, also the viewer\'s own TM1SUBSETALL([D].[Alt])', () => {
    const two = 'SELECT {TM1SUBSETALL( [D].[Alt] )} ON 0, {[D].[D].[A], [D].[D].[B]} ON 1 FROM [C]';
    expect(axisFactorForDim(two, 'D:Alt', ['Alt'])).toBe('{TM1SUBSETALL( [D].[Alt] )}');
    expect(axisFactorForDim(two, 'D', ['Alt'])).toBe('{[D].[D].[A], [D].[D].[B]}');
  });
  it('a two-part member of the default hierarchy stays the default', () => {
    expect(axisFactorForDim('SELECT {[D].[A]} ON 0 FROM [C]', 'D', ['Alt'])).toBe('{[D].[A]}');
  });
});

import { describe, it, expect } from 'vitest';
import { buildAxisSetMdx, buildViewMdx } from '../../cubeViewer/axisMdxPure';
import type { ViewDimSelection } from '../../cubeViewer/viewTypes';

describe('buildAxisSetMdx', () => {
  it('takes the whole dimension when nothing is selected', () => {
    expect(buildAxisSetMdx('Jahre', undefined)).toBe('{TM1SUBSETALL([Jahre].[Jahre])}');
    expect(buildAxisSetMdx('Jahre', { kind: 'all' })).toBe('{TM1SUBSETALL([Jahre].[Jahre])}');
  });

  it('resolves a public named subset by reference, not by listing members', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'namedSubset', name: 'Plan' }))
      .toBe('{TM1SUBSETTOSET([Jahre].[Jahre], "Plan")}');
  });

  it('doubles a quote inside a subset name', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'namedSubset', name: 'a"b' }))
      .toBe('{TM1SUBSETTOSET([Jahre].[Jahre], "a""b")}');
  });

  it('refuses a private subset — TM1SUBSETTOSET cannot address one', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'namedSubset', name: 'Plan', isPrivate: true })).toBeNull();
  });

  it('passes a subset expression through verbatim', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'expression', expression: '{HEAD([Jahre].MEMBERS, 5)}' }))
      .toBe('{HEAD([Jahre].MEMBERS, 5)}');
  });

  it('enumerates an explicit element list', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'elements', names: ['2025', '2026'] }))
      .toBe('{[Jahre].[Jahre].[2025], [Jahre].[Jahre].[2026]}');
  });

  it('escapes a bracket in an element name', () => {
    expect(buildAxisSetMdx('D', { kind: 'elements', names: ['a]b'] }))
      .toBe('{[D].[D].[a]]b]}');
  });

  it('falls back to the whole dimension for an empty element list', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'elements', names: [] }))
      .toBe('{TM1SUBSETALL([Jahre].[Jahre])}');
  });

  it('takes a consolidation as a single member', () => {
    expect(buildAxisSetMdx('Jahre', { kind: 'consolidation', name: 'SuJahre' }))
      .toBe('{[Jahre].[Jahre].[SuJahre]}');
  });
});

describe('buildViewMdx', () => {
  const base = {
    cubeName: 'Reporting',
    rowDims: ['Konten'],
    colDims: ['Jahre'],
    titleAssignments: {} as Record<string, string>,
    dimSelections: {} as Record<string, ViewDimSelection>,
    suppressRows: false,
    suppressCols: false,
  };

  it('puts columns on axis 0 and rows on axis 1, like a NativeView', () => {
    expect(buildViewMdx(base)).toBe(
      'SELECT {TM1SUBSETALL([Jahre].[Jahre])} ON 0, '
      + '{TM1SUBSETALL([Konten].[Konten])} ON 1 FROM [Reporting]',
    );
  });

  it('maps the suppression flags to NON EMPTY per axis', () => {
    expect(buildViewMdx({ ...base, suppressCols: true })).toContain('SELECT NON EMPTY {TM1SUBSETALL([Jahre]');
    expect(buildViewMdx({ ...base, suppressRows: true })).toContain('ON 0, NON EMPTY {TM1SUBSETALL([Konten]');
  });

  it('crossjoins several dimensions on one axis, left to right', () => {
    const mdx = buildViewMdx({ ...base, rowDims: ['Konten', 'Stations', 'Monate'] });
    expect(mdx).toContain(
      'CROSSJOIN(CROSSJOIN({TM1SUBSETALL([Konten].[Konten])}, '
      + '{TM1SUBSETALL([Stations].[Stations])}), '
      + '{TM1SUBSETALL([Monate].[Monate])}) ON 1',
    );
  });

  it('slices the context dimensions in a WHERE clause', () => {
    const mdx = buildViewMdx({ ...base, titleAssignments: { Datenarten: 'Ist', Monate: 'Jan' } });
    expect(mdx).toContain(' WHERE ([Datenarten].[Datenarten].[Ist], [Monate].[Monate].[Jan])');
  });

  it('escapes brackets in the cube and title members', () => {
    const mdx = buildViewMdx({ ...base, cubeName: 'c]1', titleAssignments: { D: 'a]b' } });
    expect(mdx).toContain('FROM [c]]1]');
    expect(mdx).toContain('WHERE ([D].[D].[a]]b])');
  });

  it('returns null when any axis dimension cannot be expressed in MDX', () => {
    expect(buildViewMdx({
      ...base,
      dimSelections: { Jahre: { kind: 'namedSubset', name: 'Mine', isPrivate: true } },
    })).toBeNull();
  });

  it('returns null without a row or a column axis — MDX needs both', () => {
    expect(buildViewMdx({ ...base, rowDims: [] })).toBeNull();
    expect(buildViewMdx({ ...base, colDims: [] })).toBeNull();
  });

  it('ignores a title assignment for a dimension that sits on an axis', () => {
    // The axis wins; a member cannot be both sliced and enumerated.
    const mdx = buildViewMdx({ ...base, titleAssignments: { Jahre: '2026', Datenarten: 'Ist' } });
    expect(mdx).toContain('WHERE ([Datenarten].[Datenarten].[Ist])');
    expect(mdx).not.toContain('[Jahre].[Jahre].[2026]');
  });
});

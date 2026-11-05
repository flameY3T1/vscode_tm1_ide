import { describe, it, expect } from 'vitest';
import { detectDimensionProperties, setDimensionProperty } from '../mdx/dimensionPropertiesPure';
import { detectNonEmptyAxes } from '../mdx/nonEmptyAxisPure';

describe('detectDimensionProperties', () => {
  it('reads the three-part [Dim].[Hier].[Attr] form', () => {
    const mdx = 'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[Konten].[ALIAS_TEXT] ON 0 FROM [Cube]';
    expect(detectDimensionProperties(mdx)).toEqual({ Konten: 'ALIAS_TEXT' });
  });

  it('reads the two-part [Dim].[Attr] form', () => {
    const mdx = 'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[ALIAS_TEXT] ON 0 FROM [Cube]';
    expect(detectDimensionProperties(mdx)).toEqual({ Konten: 'ALIAS_TEXT' });
  });

  it('collects properties across all axes', () => {
    const mdx = 'SELECT {c} DIMENSION PROPERTIES [Konten].[Konten].[ALIAS_TEXT] ON COLUMNS, '
      + '{r} DIMENSION PROPERTIES [Jahre].[Jahre].[Kurz] ON ROWS FROM [Cube]';
    expect(detectDimensionProperties(mdx)).toEqual({ Konten: 'ALIAS_TEXT', Jahre: 'Kurz' });
  });

  it('collects several dimensions from one crossjoin axis', () => {
    const mdx = 'SELECT {[A].MEMBERS} * {[B].MEMBERS} '
      + 'DIMENSION PROPERTIES [A].[A].[ALIAS_TEXT], [B].[B].[Kurz] ON 0, {[J].MEMBERS} ON 1 FROM [Cube]';
    expect(detectDimensionProperties(mdx)).toEqual({ A: 'ALIAS_TEXT', B: 'Kurz' });
  });

  it('unescapes `]]` back to `]`', () => {
    const mdx = 'SELECT {x} DIMENSION PROPERTIES [Di]]m].[Hi]]er].[At]]tr] ON 0 FROM [Cube]';
    // Keyed like the cube viewer's axes: `dim:hier` for another hierarchy.
    expect(detectDimensionProperties(mdx)).toEqual({ 'Di]m:Hi]er': 'At]tr' });
  });

  it('returns an empty map for MDX without the clause and for garbage', () => {
    expect(detectDimensionProperties('SELECT {c} ON 0, {r} ON 1 FROM [Cube]')).toEqual({});
    expect(detectDimensionProperties('not an mdx')).toEqual({});
  });
});

describe('setDimensionProperty', () => {
  const twoAxes = 'SELECT {[Konten].MEMBERS} ON COLUMNS, {[Jahre].MEMBERS} ON ROWS FROM [Cube]';

  it('adds a clause on the columns axis', () => {
    expect(setDimensionProperty(twoAxes, 'Konten', 'Konten', 'ALIAS_TEXT', 0)).toBe(
      'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[Konten].[ALIAS_TEXT] ON COLUMNS, '
      + '{[Jahre].MEMBERS} ON ROWS FROM [Cube]',
    );
  });

  it('adds a clause on the rows axis without touching the columns axis', () => {
    const out = setDimensionProperty(twoAxes, 'Jahre', 'Jahre', 'Kurz', 1);
    expect(out).toBe(
      'SELECT {[Konten].MEMBERS} ON COLUMNS, '
      + '{[Jahre].MEMBERS} DIMENSION PROPERTIES [Jahre].[Jahre].[Kurz] ON ROWS FROM [Cube]',
    );
    expect(detectDimensionProperties(out)).toEqual({ Jahre: 'Kurz' });
  });

  it('addresses a third axis by its ordinal', () => {
    const mdx = 'SELECT {c} ON COLUMNS, {r} ON ROWS, {[Version].MEMBERS} ON 2 FROM [Cube]';
    expect(setDimensionProperty(mdx, 'Version', 'Version', 'ALIAS_TEXT', 2)).toBe(
      'SELECT {c} ON COLUMNS, {r} ON ROWS, '
      + '{[Version].MEMBERS} DIMENSION PROPERTIES [Version].[Version].[ALIAS_TEXT] ON 2 FROM [Cube]',
    );
  });

  it('writes the two-part form when no hierarchy is given', () => {
    expect(setDimensionProperty(twoAxes, 'Konten', '', 'ALIAS_TEXT', 0)).toBe(
      'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[ALIAS_TEXT] ON COLUMNS, '
      + '{[Jahre].MEMBERS} ON ROWS FROM [Cube]',
    );
  });

  it('replaces the attribute of a dimension that already has one', () => {
    const first = setDimensionProperty(twoAxes, 'Konten', 'Konten', 'ALIAS_TEXT', 0);
    const second = setDimensionProperty(first, 'Konten', 'Konten', 'Kurz', 0);
    expect(second).toBe(
      'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[Konten].[Kurz] ON COLUMNS, '
      + '{[Jahre].MEMBERS} ON ROWS FROM [Cube]',
    );
    expect(detectDimensionProperties(second)).toEqual({ Konten: 'Kurz' });
  });

  it('matches the existing entry case-insensitively instead of adding a second one', () => {
    const first = setDimensionProperty(twoAxes, 'Konten', 'Konten', 'ALIAS_TEXT', 0);
    const second = setDimensionProperty(first, 'KONTEN', 'Konten', 'Kurz', 0);
    expect(detectDimensionProperties(second)).toEqual({ KONTEN: 'Kurz' });
    expect(second.match(/DIMENSION PROPERTIES/g)).toHaveLength(1);
  });

  describe('crossjoin axis', () => {
    const crossjoin = 'SELECT {[A].MEMBERS} * {[B].MEMBERS} ON 0, {[J].MEMBERS} ON 1 FROM [Cube]';
    const withA = 'SELECT {[A].MEMBERS} * {[B].MEMBERS} DIMENSION PROPERTIES [A].[A].[ALIAS_TEXT] ON 0, '
      + '{[J].MEMBERS} ON 1 FROM [Cube]';
    const withAB = 'SELECT {[A].MEMBERS} * {[B].MEMBERS} '
      + 'DIMENSION PROPERTIES [A].[A].[ALIAS_TEXT], [B].[B].[Kurz] ON 0, {[J].MEMBERS} ON 1 FROM [Cube]';

    it('starts with a single entry when only one dimension has an alias', () => {
      expect(setDimensionProperty(crossjoin, 'A', 'A', 'ALIAS_TEXT', 0)).toBe(withA);
      expect(detectDimensionProperties(withA)).toEqual({ A: 'ALIAS_TEXT' });
    });

    it('appends the second dimension into the same clause', () => {
      expect(setDimensionProperty(withA, 'B', 'B', 'Kurz', 0)).toBe(withAB);
      expect(detectDimensionProperties(withAB)).toEqual({ A: 'ALIAS_TEXT', B: 'Kurz' });
    });

    it('keeps the clause with the remaining entry when one alias is dropped', () => {
      const out = setDimensionProperty(withAB, 'A', 'A', null, 0);
      expect(out).toBe('SELECT {[A].MEMBERS} * {[B].MEMBERS} DIMENSION PROPERTIES [B].[B].[Kurz] ON 0, '
        + '{[J].MEMBERS} ON 1 FROM [Cube]');
      expect(detectDimensionProperties(out)).toEqual({ B: 'Kurz' });
    });

    it('round-trips back to the untouched MDX once the last alias is gone', () => {
      const out = setDimensionProperty(setDimensionProperty(withAB, 'A', 'A', null, 0), 'B', 'B', null, 0);
      expect(out).toBe(crossjoin);
      expect(detectDimensionProperties(out)).toEqual({});
    });
  });

  it('removes the whole clause including its leading whitespace', () => {
    const mdx = 'SELECT {[Konten].MEMBERS}\n       DIMENSION PROPERTIES [Konten].[Konten].[ALIAS_TEXT] ON 0\n'
      + 'FROM [Cube]';
    expect(setDimensionProperty(mdx, 'Konten', 'Konten', null, 0))
      .toBe('SELECT {[Konten].MEMBERS} ON 0\nFROM [Cube]');
  });

  it('preserves line breaks and indentation outside the touched segment', () => {
    const mdx = 'SELECT\n  {[Konten].MEMBERS} ON COLUMNS,\n  {[Jahre].MEMBERS} ON ROWS\n'
      + 'FROM [Cube]\nWHERE ([Version].[Ist])';
    const out = setDimensionProperty(mdx, 'Jahre', 'Jahre', 'Kurz', 1);
    expect(out).toBe('SELECT\n  {[Konten].MEMBERS} ON COLUMNS,\n'
      + '  {[Jahre].MEMBERS} DIMENSION PROPERTIES [Jahre].[Jahre].[Kurz] ON ROWS\n'
      + 'FROM [Cube]\nWHERE ([Version].[Ist])');
    expect(setDimensionProperty(out, 'Jahre', 'Jahre', null, 1)).toBe(mdx);
  });

  it('leaves a NON EMPTY modifier in place', () => {
    const mdx = 'SELECT NON EMPTY {[Jahre].MEMBERS} ON ROWS FROM [Cube]';
    const out = setDimensionProperty(mdx, 'Jahre', 'Jahre', 'Kurz', 1);
    expect(out).toBe(
      'SELECT NON EMPTY {[Jahre].MEMBERS} DIMENSION PROPERTIES [Jahre].[Jahre].[Kurz] ON ROWS FROM [Cube]',
    );
    expect(detectNonEmptyAxes(out)).toEqual({ rows: true, cols: false });
  });

  it('escapes `]` in dimension, hierarchy and attribute names', () => {
    const mdx = 'SELECT {[X].MEMBERS} ON 0 FROM [Cube]';
    const out = setDimensionProperty(mdx, 'Di]m', 'Hi]er', 'At]tr', 0);
    expect(out).toBe('SELECT {[X].MEMBERS} DIMENSION PROPERTIES [Di]]m].[Hi]]er].[At]]tr] ON 0 FROM [Cube]');
    expect(detectDimensionProperties(out)).toEqual({ 'Di]m:Hi]er': 'At]tr' });
    expect(setDimensionProperty(out, 'Di]m', 'Hi]er', null, 0)).toBe(mdx);
  });

  it('returns the input unchanged when there is nothing to do', () => {
    // no SELECT at all
    expect(setDimensionProperty('garbage', 'A', 'A', 'x', 0)).toBe('garbage');
    // axis ordinal not present in the statement
    expect(setDimensionProperty(twoAxes, 'Konten', 'Konten', 'ALIAS_TEXT', 5)).toBe(twoAxes);
    // removing a property that was never set
    expect(setDimensionProperty(twoAxes, 'Konten', 'Konten', null, 0)).toBe(twoAxes);
    // setting the very same property twice
    const once = setDimensionProperty(twoAxes, 'Konten', 'Konten', 'ALIAS_TEXT', 0);
    expect(setDimensionProperty(once, 'Konten', 'Konten', 'ALIAS_TEXT', 0)).toBe(once);
  });
});

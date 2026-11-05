import { describe, it, expect } from 'vitest';
import { axisOf, parseSelect, splitTopLevelCommas } from '../mdx/selectAxesPure';

describe('parseSelect', () => {
  it('splits a two-axis SELECT into pre / segments / post', () => {
    const mdx = 'SELECT {c} ON COLUMNS, {r} ON ROWS FROM [Sales]';
    const p = parseSelect(mdx)!;
    expect(p.pre).toBe('SELECT');
    expect(p.segments).toEqual([' {c} ON COLUMNS', ' {r} ON ROWS ']);
    expect(p.post).toBe('FROM [Sales]');
  });

  it('reassembles the input verbatim', () => {
    const mdx = 'SELECT\n  {c} ON COLUMNS,\n  {r} ON ROWS\nFROM [Sales]\nWHERE ([T].[2026])';
    const p = parseSelect(mdx)!;
    expect(p.pre + p.segments.join(',') + p.post).toBe(mdx);
  });

  it('does not split on commas nested in a set or function', () => {
    const p = parseSelect('SELECT {FILTER([d].Members, 1)} ON 0 FROM [Sales]')!;
    expect(p.segments).toHaveLength(1);
  });

  it('does not split on a comma inside a bracketed member name', () => {
    const p = parseSelect('SELECT {[Dim].[Berlin, Mitte]} ON 0 FROM [Sales]')!;
    expect(p.segments).toEqual([' {[Dim].[Berlin, Mitte]} ON 0 ']);
  });

  it('keeps a name with an escaped `]]` balanced', () => {
    const mdx = 'SELECT {[Dim].[Mem]]ber]} ON 0, {r} ON 1 FROM [Sales]';
    const p = parseSelect(mdx)!;
    expect(p.segments).toEqual([' {[Dim].[Mem]]ber]} ON 0', ' {r} ON 1 ']);
    expect(p.post).toBe('FROM [Sales]');
  });

  it('ignores a FROM inside a sub-select', () => {
    const p = parseSelect('SELECT {c} ON 0 FROM (SELECT {x} ON 0 FROM [Inner])')!;
    expect(p.post).toBe('FROM (SELECT {x} ON 0 FROM [Inner])');
  });

  it('returns null without a SELECT keyword', () => {
    expect(parseSelect('not an mdx')).toBeNull();
  });
});

describe('axisOf', () => {
  it('maps the named axes to their ordinals', () => {
    expect(axisOf('{c} ON COLUMNS')).toEqual({ kind: 'cols', index: 0 });
    expect(axisOf('{r} ON ROWS')).toEqual({ kind: 'rows', index: 1 });
  });

  it('maps the numeric aliases of the named axes', () => {
    expect(axisOf('{c} ON 0')).toEqual({ kind: 'cols', index: 0 });
    expect(axisOf('{r} ON 1')).toEqual({ kind: 'rows', index: 1 });
  });

  it('reports axes beyond rows/columns with an index but no kind', () => {
    expect(axisOf('{p} ON 2')).toEqual({ kind: null, index: 2 });
    expect(axisOf('{p} ON 7')).toEqual({ kind: null, index: 7 });
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(axisOf('\n  {r} on rows\n')).toEqual({ kind: 'rows', index: 1 });
  });

  it('returns null for a segment without a trailing ON clause', () => {
    expect(axisOf(' {[A].[x]}')).toBeNull();
    expect(axisOf(' DIMENSION PROPERTIES [A].[x]')).toBeNull();
  });
});

describe('splitTopLevelCommas', () => {
  it('splits a property list but keeps bracketed commas intact', () => {
    expect(splitTopLevelCommas('[A].[x], [B].[Berlin, Mitte]'))
      .toEqual(['[A].[x]', ' [B].[Berlin, Mitte]']);
  });

  it('is lossless when joined back', () => {
    const text = '[A].[A].[x],\n    [B].[B].[y]';
    expect(splitTopLevelCommas(text).join(',')).toBe(text);
  });
});

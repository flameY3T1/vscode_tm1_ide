import { describe, it, expect } from 'vitest';
import {
  memberRef,
  dimSet,
  crossjoinAll,
  selectStatement,
} from '../webviewClient/cubeViewerMonaco/mdxParts';

describe('memberRef', () => {
  it('builds [dim].[dim].[elem]', () => {
    expect(memberRef('Sales', 'Jan')).toBe('[Sales].[Sales].[Jan]');
  });

  it('doubles a closing bracket in dim and element names', () => {
    expect(memberRef('A]B', 'C]D')).toBe('[A]]B].[A]]B].[C]]D]');
  });
});

describe('dimSet', () => {
  it('falls back to TM1SUBSETALL when names is undefined', () => {
    expect(dimSet('A', undefined)).toBe('{ TM1SUBSETALL( [A].[A] ) }');
  });

  it('falls back to TM1SUBSETALL when names is an empty list', () => {
    expect(dimSet('A', [])).toBe('{ TM1SUBSETALL( [A].[A] ) }');
  });

  it('lists explicit member refs when names is non-empty', () => {
    expect(dimSet('A', ['a1', 'a2'])).toBe('{ [A].[A].[a1], [A].[A].[a2] }');
  });

  it('doubles a closing bracket in the dimension name of the TM1SUBSETALL form', () => {
    expect(dimSet('A]B', undefined)).toBe('{ TM1SUBSETALL( [A]]B].[A]]B] ) }');
  });
});

describe('crossjoinAll', () => {
  it('returns {} for an empty axis (no dimensions)', () => {
    expect(crossjoinAll([])).toBe('{}');
  });

  it('returns the set itself, unwrapped, for a single dimension', () => {
    expect(crossjoinAll(['{ [A].[A].[a1] }'])).toBe('{ [A].[A].[a1] }');
  });

  it('left-folds a CROSSJOIN over two sets', () => {
    expect(crossjoinAll(['{S1}', '{S2}'])).toBe('CROSSJOIN({S1}, {S2})');
  });

  it('left-folds a CROSSJOIN over three or more sets (nested, not flat)', () => {
    expect(crossjoinAll(['{S1}', '{S2}', '{S3}'])).toBe(
      'CROSSJOIN(CROSSJOIN({S1}, {S2}), {S3})',
    );
  });
});

describe('selectStatement', () => {
  const base = {
    cube: 'Sales',
    rowSet: '{ROW}',
    colSet: '{COL}',
    titleMembers: [] as string[],
    suppressRows: false,
    suppressCols: false,
  };

  it('builds the SELECT/FROM skeleton without a WHERE when titleMembers is empty', () => {
    const mdx = selectStatement(base);
    expect(mdx).toBe('SELECT\n  {COL} ON COLUMNS,\n  {ROW} ON ROWS\nFROM [Sales]');
    expect(mdx).not.toContain('WHERE');
  });

  it('appends a WHERE slicer built from the given title member refs', () => {
    const mdx = selectStatement({
      ...base,
      titleMembers: ['[D1].[D1].[d1]', '[D2].[D2].[d2]'],
    });
    expect(mdx).toBe(
      'SELECT\n  {COL} ON COLUMNS,\n  {ROW} ON ROWS\nFROM [Sales]\nWHERE ( [D1].[D1].[d1], [D2].[D2].[d2] )',
    );
  });

  it('prefixes ON COLUMNS/ON ROWS with NON EMPTY per suppress flag, independently', () => {
    const colsOnly = selectStatement({ ...base, suppressCols: true });
    expect(colsOnly).toContain('  NON EMPTY {COL} ON COLUMNS,');
    expect(colsOnly).not.toContain('NON EMPTY {ROW}');

    const rowsOnly = selectStatement({ ...base, suppressRows: true });
    expect(rowsOnly).toContain('  NON EMPTY {ROW} ON ROWS');
    expect(rowsOnly).not.toContain('NON EMPTY {COL}');

    const both = selectStatement({ ...base, suppressRows: true, suppressCols: true });
    expect(both.match(/NON EMPTY/g)?.length).toBe(2);
  });

  it('doubles a closing bracket in the cube name', () => {
    const mdx = selectStatement({ ...base, cube: 'C]ube' });
    expect(mdx).toContain('FROM [C]]ube]');
  });
});

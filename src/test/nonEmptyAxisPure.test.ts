import { describe, it, expect } from 'vitest';
import { detectNonEmptyAxes, setNonEmptyAxis } from '../mdx/nonEmptyAxisPure';

describe('detectNonEmptyAxes', () => {
  it('detects NON EMPTY on both axes', () => {
    const mdx = 'SELECT NON EMPTY {[d1].Members} ON COLUMNS, NON EMPTY {[d2].Members} ON ROWS FROM [Sales]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: true, cols: true });
  });

  it('detects NON EMPTY on columns only', () => {
    const mdx = 'SELECT NON EMPTY {[d1].Members} ON COLUMNS, {[d2].Members} ON ROWS FROM [Sales]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: false, cols: true });
  });

  it('detects NON EMPTY on rows only', () => {
    const mdx = 'SELECT {[d1].Members} ON COLUMNS, NON EMPTY {[d2].Members} ON ROWS FROM [Sales]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: true, cols: false });
  });

  it('returns false for neither', () => {
    const mdx = 'SELECT {[d1].Members} ON COLUMNS, {[d2].Members} ON ROWS FROM [Sales]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: false, cols: false });
  });

  it('handles ON 0 / ON 1 axis ids', () => {
    const mdx = 'SELECT NON EMPTY {a} ON 0, NON EMPTY {b} ON 1 FROM [c]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: true, cols: true });
  });

  it('handles multi-line MDX (FROM on its own line, lowercase)', () => {
    const mdx = 'SELECT\n  NON EMPTY {col} ON COLUMNS,\n  {row} ON ROWS\nfrom [Sales]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: false, cols: true });
  });

  it('is not fooled by NON EMPTY inside a nested set (different depth)', () => {
    const mdx = 'SELECT {FILTER([d1].Members, 1)} ON COLUMNS, {[d2].Members} ON ROWS FROM [Sales]';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: false, cols: false });
  });

  it('ignores a FROM keyword that appears inside a sub-select on an axis', () => {
    const mdx = 'SELECT NON EMPTY {[d1].Members} ON COLUMNS FROM (SELECT {x} ON 0 FROM [Inner])';
    expect(detectNonEmptyAxes(mdx)).toEqual({ rows: false, cols: true });
  });

  it('returns false for non-MDX input', () => {
    expect(detectNonEmptyAxes('not an mdx')).toEqual({ rows: false, cols: false });
  });
});

describe('setNonEmptyAxis', () => {
  it('adds NON EMPTY to a bare axis', () => {
    const mdx = 'SELECT {col} ON COLUMNS, {row} ON ROWS FROM [Sales]';
    expect(setNonEmptyAxis(mdx, 'cols', true))
      .toBe('SELECT NON EMPTY {col} ON COLUMNS, {row} ON ROWS FROM [Sales]');
  });

  it('removes NON EMPTY from an axis', () => {
    const mdx = 'SELECT NON EMPTY {col} ON COLUMNS, NON EMPTY {row} ON ROWS FROM [Sales]';
    expect(setNonEmptyAxis(mdx, 'rows', false))
      .toBe('SELECT NON EMPTY {col} ON COLUMNS, {row} ON ROWS FROM [Sales]');
  });

  it('is a no-op when already in the desired state', () => {
    const mdx = 'SELECT NON EMPTY {col} ON COLUMNS, {row} ON ROWS FROM [Sales]';
    expect(setNonEmptyAxis(mdx, 'cols', true)).toBe(mdx);
    expect(setNonEmptyAxis(mdx, 'rows', false)).toBe(mdx);
  });

  it('only touches the targeted axis', () => {
    const mdx = 'SELECT {col} ON COLUMNS, {row} ON ROWS FROM [Sales]';
    const out = setNonEmptyAxis(mdx, 'rows', true);
    expect(out).toBe('SELECT {col} ON COLUMNS, NON EMPTY {row} ON ROWS FROM [Sales]');
    expect(detectNonEmptyAxes(out)).toEqual({ rows: true, cols: false });
  });

  it('round-trips add then remove back to the original', () => {
    const mdx = 'SELECT {col} ON COLUMNS, {row} ON ROWS FROM [Sales]';
    const added = setNonEmptyAxis(mdx, 'cols', true);
    expect(setNonEmptyAxis(added, 'cols', false)).toBe(mdx);
  });

  it('preserves multi-line formatting and WHERE clause', () => {
    const mdx = 'SELECT\n  {col} ON COLUMNS,\n  {row} ON ROWS\nFROM [Sales]\nWHERE ([Time].[2026])';
    const out = setNonEmptyAxis(mdx, 'cols', true);
    expect(out).toBe('SELECT\n  NON EMPTY {col} ON COLUMNS,\n  {row} ON ROWS\nFROM [Sales]\nWHERE ([Time].[2026])');
    expect(setNonEmptyAxis(out, 'cols', false)).toBe(mdx);
  });

  it('returns input unchanged for non-MDX', () => {
    expect(setNonEmptyAxis('garbage', 'rows', true)).toBe('garbage');
  });
});

// src/test/dimBrowserAttrColumns.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  attrColumns, setAttrColumns, columnWidth, setColumnWidth,
  DEFAULT_COL_PX, _resetAttrColumnsForTest,
} from '../webviewClient/dimensionBrowser/attrColumns';

beforeEach(() => { _resetAttrColumnsForTest(); });

describe('attrColumns — the chosen columns', () => {
  it('starts empty', () => {
    expect(attrColumns()).toEqual([]);
  });

  it('keeps the SELECTION ORDER, not the alphabetical one', () => {
    // The order of the columns IS the selection order — there is no
    // moving, so nothing may sort here.
    setAttrColumns(['Zeta', 'Alpha']);
    expect(attrColumns()).toEqual(['Zeta', 'Alpha']);
  });

  it('deduplicates and throws away empty ones', () => {
    setAttrColumns(['A', 'A', '', 'B']);
    expect(attrColumns()).toEqual(['A', 'B']);
  });

  it('hands out a COPY, not a grip into the state', () => {
    setAttrColumns(['A']);
    (attrColumns() as string[]).push('B');
    expect(attrColumns()).toEqual(['A']);
  });
});

describe('columnWidth — the widths', () => {
  it('an unknown column gets the default', () => {
    expect(columnWidth('neu')).toBe(DEFAULT_COL_PX);
  });

  it('a set width holds', () => {
    setColumnWidth('A', 240);
    expect(columnWidth('A')).toBe(240);
  });

  it('clamps downwards, so that a column does not become invisible', () => {
    setColumnWidth('A', 2);
    expect(columnWidth('A')).toBe(40);
  });

  it('rounds to whole pixels — the drag handle delivers fractional values', () => {
    setColumnWidth('A', 160.4);
    expect(columnWidth('A')).toBe(160);
  });

  it('a width survives a new selection that keeps the column', () => {
    setColumnWidth('A', 200);
    setAttrColumns(['A', 'B']);
    expect(columnWidth('A')).toBe(200);
  });
});

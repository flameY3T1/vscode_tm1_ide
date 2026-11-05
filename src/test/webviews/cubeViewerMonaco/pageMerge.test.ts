import { describe, it, expect } from 'vitest';
import {
  mergeRowPage,
  nextLoadedRowMax,
  CELL_PAGE_ROWS_CLIENT,
} from '../../../webviewClient/cubeViewerMonaco/pageMerge';

describe('nextLoadedRowMax', () => {
  it('advances by the actual number of rows delivered (full page)', () => {
    // Regression C1: a 10k-row page at startRow 10000 must reach 20000 — NOT 10300.
    expect(nextLoadedRowMax(10000, 10000, new Array(CELL_PAGE_ROWS_CLIENT).fill('x'), CELL_PAGE_ROWS_CLIENT))
      .toBe(20000);
  });
  it('advances exactly on a short final page', () => {
    expect(nextLoadedRowMax(20000, 20000, new Array(137).fill('x'), CELL_PAGE_ROWS_CLIENT))
      .toBe(20137);
  });
  it('falls back to the page size when rowElements is missing', () => {
    expect(nextLoadedRowMax(0, 0, undefined, CELL_PAGE_ROWS_CLIENT)).toBe(CELL_PAGE_ROWS_CLIENT);
  });
  it('never moves the watermark backwards', () => {
    expect(nextLoadedRowMax(50000, 0, ['a', 'b'], CELL_PAGE_ROWS_CLIENT)).toBe(50000);
  });
  it('CELL_PAGE_ROWS_CLIENT is 10000 (host CELL_PAGE_ROWS mirror)', () => {
    expect(CELL_PAGE_ROWS_CLIENT).toBe(10000);
  });
});

describe('mergeRowPage', () => {
  it('writes row headers at the absolute startRow offset', () => {
    const m: any = { rowElements: ['a', 'b'], rowTuples: [['a'], ['b']], rowLevels: [[0], [0]] };
    mergeRowPage(m, 2, {
      rowElements: ['c', 'd'], rowTuples: [['c'], ['d']], rowLevels: [[1], [1]],
    });
    expect(m.rowElements).toEqual(['a', 'b', 'c', 'd']);
    expect(m.rowTuples).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(m.rowLevels).toEqual([[0], [0], [1], [1]]);
  });

  it('ignores absent header fields (values-only page)', () => {
    const m: any = { rowElements: ['a'] };
    mergeRowPage(m, 1, {});
    expect(m.rowElements).toEqual(['a']);
  });
});

import { describe, it, expect } from 'vitest';
import {
  rowsForCellBudget,
  CELL_PAGE_BUDGET,
  CELL_PAGE_ROWS,
} from '../commands/cubeViewer/cellBudgetPure';

describe('rowsForCellBudget', () => {
  it('keeps the row cap for narrow views', () => {
    // 1 column would allow 50k rows by budget; the row cap still wins.
    expect(rowsForCellBudget(1)).toBe(CELL_PAGE_ROWS);
    expect(rowsForCellBudget(5)).toBe(CELL_PAGE_ROWS);
  });

  it('shrinks the page as the view gets wider', () => {
    expect(rowsForCellBudget(200)).toBe(CELL_PAGE_BUDGET / 200);
    expect(rowsForCellBudget(1000)).toBe(CELL_PAGE_BUDGET / 1000);
  });

  it('never exceeds the cell budget', () => {
    for (const numCols of [1, 7, 13, 200, 999, 1000, 5000, 20000]) {
      expect(rowsForCellBudget(numCols) * numCols).toBeLessThanOrEqual(CELL_PAGE_BUDGET);
    }
  });

  it('still returns at least one row for absurdly wide views', () => {
    // 100k columns exceed the whole budget in a single row — page anyway,
    // otherwise scrolling can never make progress.
    expect(rowsForCellBudget(100000)).toBe(1);
  });

  it('treats a zero or negative column count as one column', () => {
    expect(rowsForCellBudget(0)).toBe(CELL_PAGE_ROWS);
    expect(rowsForCellBudget(-3)).toBe(CELL_PAGE_ROWS);
  });

  it('returns whole rows only', () => {
    for (const numCols of [3, 7, 13, 300, 777]) {
      expect(Number.isInteger(rowsForCellBudget(numCols))).toBe(true);
    }
  });

  it('caps the pathological case from the review at a sane cell count', () => {
    // 10000 rows x 200 cols = 2M cells before; now bounded by the budget.
    expect(rowsForCellBudget(200) * 200).toBeLessThanOrEqual(CELL_PAGE_BUDGET);
    expect(rowsForCellBudget(1000) * 1000).toBeLessThanOrEqual(CELL_PAGE_BUDGET);
  });
});

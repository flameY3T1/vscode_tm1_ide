import { describe, it, expect } from 'vitest';
import { computeZoneMoveAt, computeInsertIndex, computeAxisSwap, resolveMovedDimElements, consumePendingRefresh } from '../webviewClient/cubeViewerMonaco/pivotPure';

describe('resolveMovedDimElements', () => {
  it('trusts the matrix when the dim is on an axis the matrix also knows', () => {
    expect(resolveMovedDimElements('A', {
      stateRowDims: ['A'], stateColDims: ['B'], matrixRowDims: ['A'], matrixColDims: ['B'],
    })).toBe('onAxisInMatrix');
  });

  it('flags a freshly-moved dim: on a state axis but not yet in the matrix', () => {
    expect(resolveMovedDimElements('C', {
      stateRowDims: ['A', 'C'], stateColDims: ['B'], matrixRowDims: ['A'], matrixColDims: ['B'],
    })).toBe('movedFresh');
  });

  it('reports notOnAxis when the dim is on neither state axis', () => {
    expect(resolveMovedDimElements('C', {
      stateRowDims: ['A'], stateColDims: ['B'], matrixRowDims: ['A'], matrixColDims: ['B'],
    })).toBe('notOnAxis');
  });
});

describe('consumePendingRefresh', () => {
  it('returns true and removes the mark when present', () => {
    const p = new Set(['A']);
    expect(consumePendingRefresh(p, 'A')).toBe(true);
    expect(p.has('A')).toBe(false);
  });
  it('returns false when absent', () => {
    expect(consumePendingRefresh(new Set(['A']), 'B')).toBe(false);
  });
});

describe('reorder within axis', () => {
  it('computeInsertIndex returns position of reference dim', () => {
    expect(computeInsertIndex(['A', 'B', 'D'], 'B')).toBe(1);
  });
  it('computeInsertIndex appends when reference is null', () => {
    expect(computeInsertIndex(['A', 'B'], null)).toBe(2);
  });
  it('reorders C to the front of rows [A,B,C]', () => {
    const axes = { rowDims: ['A', 'B', 'C'], colDims: [], titleDims: [] };
    const r = computeZoneMoveAt('C', 'rows', 0, axes);
    expect(r.changed).toBe(true);
    expect(r.axes.rowDims).toEqual(['C', 'A', 'B']);
  });
  it('is a no-op when the dim lands in its current position', () => {
    const axes = { rowDims: ['A', 'B', 'C'], colDims: [], titleDims: [] };
    // remove B -> [A,C]; insert at index 1 -> [A,B,C] (unchanged)
    const r = computeZoneMoveAt('B', 'rows', 1, axes);
    expect(r.changed).toBe(false);
    expect(r.axes.rowDims).toEqual(['A', 'B', 'C']);
  });
});

describe('computeAxisSwap', () => {
  it('swaps rows and columns', () => {
    const { axes, changed } = computeAxisSwap({ rowDims: ['Jahr'], colDims: ['Monat'], titleDims: [] });
    expect(axes.rowDims).toEqual(['Monat']);
    expect(axes.colDims).toEqual(['Jahr']);
    expect(changed).toBe(true);
  });

  it('keeps the order within each axis — swapping is not reversing', () => {
    const { axes } = computeAxisSwap({ rowDims: ['Jahr', 'Version'], colDims: ['Monat', 'Konto'], titleDims: [] });
    expect(axes.rowDims).toEqual(['Monat', 'Konto']);
    expect(axes.colDims).toEqual(['Jahr', 'Version']);
  });

  it('leaves the title dims alone', () => {
    const { axes } = computeAxisSwap({ rowDims: ['A'], colDims: ['B'], titleDims: ['Region', 'Waehrung'] });
    expect(axes.titleDims).toEqual(['Region', 'Waehrung']);
  });

  it('swaps even when one axis is empty — that is a real layout change', () => {
    const { axes, changed } = computeAxisSwap({ rowDims: ['A', 'B'], colDims: [], titleDims: [] });
    expect(axes.rowDims).toEqual([]);
    expect(axes.colDims).toEqual(['A', 'B']);
    expect(changed).toBe(true);
  });

  it('reports no change when both axes are empty', () => {
    expect(computeAxisSwap({ rowDims: [], colDims: [], titleDims: [] }).changed).toBe(false);
  });

  it('reports no change when both axes hold the same dims in the same order', () => {
    // Cannot happen with real dims (a dim sits on one axis only), but the
    // caller uses `changed` to decide whether to leave saved-view mode.
    expect(computeAxisSwap({ rowDims: ['A'], colDims: ['A'], titleDims: [] }).changed).toBe(false);
  });

  it('returns fresh arrays — the caller keeps the old layout for the local pivot', () => {
    const before = { rowDims: ['A'], colDims: ['B'], titleDims: [] };
    const { axes } = computeAxisSwap(before);
    axes.rowDims.push('X');
    expect(before.colDims).toEqual(['B']);
  });
});

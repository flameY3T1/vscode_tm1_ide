import { describe, it, expect } from 'vitest';
import { computeDropIndex, resolveDropPlacement, type DropRect } from '../webviewClient/cubeViewerMonaco/dropIndicatorPure';

/** Two chips side by side in one row (y 0..20). */
const ONE_ROW: DropRect[] = [
  { left: 0, right: 100, top: 0, bottom: 20 },
  { left: 110, right: 200, top: 0, bottom: 20 },
];

/** Three chips, the third wraps into a second row (y 24..44). */
const TWO_ROWS: DropRect[] = [
  { left: 0, right: 100, top: 0, bottom: 20 },
  { left: 110, right: 200, top: 0, bottom: 20 },
  { left: 0, right: 100, top: 24, bottom: 44 },
];

describe('computeDropIndex', () => {
  it('returns 0 for an empty zone', () => {
    expect(computeDropIndex([], { x: 50, y: 10 })).toBe(0);
  });

  it('the left half of a chip means before it', () => {
    expect(computeDropIndex(ONE_ROW, { x: 20, y: 10 })).toBe(0);
  });

  it('the right half of a chip means after it', () => {
    expect(computeDropIndex(ONE_ROW, { x: 80, y: 10 })).toBe(1);
  });

  it('the right half of the last chip means at the end', () => {
    expect(computeDropIndex(ONE_ROW, { x: 190, y: 10 })).toBe(2);
  });

  it('left of the first chip means at the start', () => {
    expect(computeDropIndex(ONE_ROW, { x: -5, y: 10 })).toBe(0);
  });

  it('hits the second row and does not fall back to the first', () => {
    expect(computeDropIndex(TWO_ROWS, { x: 20, y: 30 })).toBe(2);
    expect(computeDropIndex(TWO_ROWS, { x: 80, y: 30 })).toBe(3);
  });

  it('below all rows means at the end', () => {
    expect(computeDropIndex(TWO_ROWS, { x: 5, y: 80 })).toBe(3);
  });

  it('above all rows means at the start', () => {
    expect(computeDropIndex(TWO_ROWS, { x: 190, y: -5 })).toBe(0);
  });

  it('in the vertical gap between two rows the lower row counts', () => {
    expect(computeDropIndex(TWO_ROWS, { x: 20, y: 22 })).toBe(2);
  });
});

describe('resolveDropPlacement', () => {
  it('recognizes the rest position: the same place the dimension already has', () => {
    expect(resolveDropPlacement(['A', 'B', 'C'], 'B', 1))
      .toEqual({ beforeDim: 'C', resting: true });
  });

  it('reports no rest position for a real change of position', () => {
    expect(resolveDropPlacement(['A', 'B', 'C'], 'B', 0))
      .toEqual({ beforeDim: 'A', resting: false });
  });

  it('returns null for appending at the end', () => {
    expect(resolveDropPlacement(['A', 'B', 'C'], 'B', 2))
      .toEqual({ beforeDim: null, resting: false });
    expect(resolveDropPlacement(['A', 'B'], 'B', 1))
      .toEqual({ beforeDim: null, resting: true });
  });

  it('skips the dragged dimension when resolving beforeDim', () => {
    expect(resolveDropPlacement(['A', 'B', 'C'], 'A', 1))
      .toEqual({ beforeDim: 'C', resting: false });
  });

  it('never knows a rest position for a move from a foreign zone', () => {
    expect(resolveDropPlacement(['A', 'B'], 'X', 1))
      .toEqual({ beforeDim: 'B', resting: false });
    expect(resolveDropPlacement([], 'X', 0))
      .toEqual({ beforeDim: null, resting: false });
  });

  it('clamps an index that is too large to the end', () => {
    expect(resolveDropPlacement(['A', 'B'], 'A', 99))
      .toEqual({ beforeDim: null, resting: false });
  });
});

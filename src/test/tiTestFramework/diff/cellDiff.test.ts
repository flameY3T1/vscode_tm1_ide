import { describe, it, expect } from 'vitest';
import { diffCells } from '../../../tiTestFramework/diff/cellDiff';
import { type AggregatedCell } from '../../../tiTestFramework/log/logAggregator';
import { cellKey } from '../../../tiTestFramework/log/logSchema';

const cell = (
  cube: string,
  coord: string[],
  value: number | string,
  lastOp: AggregatedCell['lastOp'] = 'CellPutN',
): AggregatedCell => ({ cube, coord, value, hasIncrement: false, lastOp });

const map = (cells: AggregatedCell[]): Map<string, AggregatedCell> => {
  const m = new Map<string, AggregatedCell>();
  for (const c of cells) m.set(cellKey(c.cube, c.coord), c);
  return m;
};

describe('diffCells', () => {
  it('reports equal for same value', () => {
    const r = diffCells(map([cell('P', ['A'], 100)]), map([cell('P', ['A'], 100)]));
    expect(r.equal).toHaveLength(1);
    expect(r.valueDiff).toHaveLength(0);
    expect(r.missing).toHaveLength(0);
    expect(r.extra).toHaveLength(0);
  });

  it('reports valueDiff for different value', () => {
    const r = diffCells(map([cell('P', ['A'], 100)]), map([cell('P', ['A'], 200)]));
    expect(r.valueDiff).toHaveLength(1);
    expect(r.valueDiff[0].expected).toBe(100);
    expect(r.valueDiff[0].actual).toBe(200);
  });

  it('reports missing when expected has, actual lacks', () => {
    const r = diffCells(map([cell('P', ['A'], 100)]), map([]));
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].expected).toBe(100);
    expect(r.missing[0].actual).toBeUndefined();
  });

  it('reports extra when actual has, expected lacks', () => {
    const r = diffCells(map([]), map([cell('P', ['A'], 100)]));
    expect(r.extra).toHaveLength(1);
    expect(r.extra[0].actual).toBe(100);
  });

  it('honors float tolerance', () => {
    const r = diffCells(
      map([cell('P', ['A'], 1.0)]),
      map([cell('P', ['A'], 1.0 + 1e-12)]),
      { floatTolerance: 1e-9 },
    );
    expect(r.equal).toHaveLength(1);
    expect(r.valueDiff).toHaveLength(0);
  });

  it('strict tolerance rejects tiny diffs', () => {
    const r = diffCells(
      map([cell('P', ['A'], 1.0)]),
      map([cell('P', ['A'], 1.0 + 1e-6)]),
      { floatTolerance: 1e-9 },
    );
    expect(r.valueDiff).toHaveLength(1);
  });

  it('treats type mismatch as valueDiff', () => {
    const r = diffCells(
      map([cell('P', ['A'], 100, 'CellPutN')]),
      map([cell('P', ['A'], '100', 'CellPutS')]),
    );
    expect(r.valueDiff).toHaveLength(1);
  });

  it('different cubes stay separate (one missing, one extra)', () => {
    const r = diffCells(map([cell('P', ['A'], 1)]), map([cell('F', ['A'], 1)]));
    expect(r.missing).toHaveLength(1);
    expect(r.extra).toHaveLength(1);
  });

  it('combined diff with all four classes', () => {
    const e = map([cell('P', ['A'], 1), cell('P', ['B'], 2), cell('P', ['C'], 3)]);
    const a = map([cell('P', ['A'], 1), cell('P', ['B'], 99), cell('P', ['D'], 4)]);
    const r = diffCells(e, a);
    expect(r.equal.map((c) => c.coord[0])).toEqual(['A']);
    expect(r.valueDiff.map((c) => c.coord[0])).toEqual(['B']);
    expect(r.missing.map((c) => c.coord[0])).toEqual(['C']);
    expect(r.extra.map((c) => c.coord[0])).toEqual(['D']);
  });

  it('output is sorted deterministically', () => {
    const e = map([cell('P', ['Z'], 1), cell('P', ['A'], 2), cell('P', ['M'], 3)]);
    const a = map([cell('P', ['Z'], 1), cell('P', ['A'], 2), cell('P', ['M'], 3)]);
    const r = diffCells(e, a);
    expect(r.equal.map((c) => c.coord[0])).toEqual(['A', 'M', 'Z']);
  });
});

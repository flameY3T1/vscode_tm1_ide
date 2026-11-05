/**
 * Compare two aggregated cell-maps and classify each (cube,coord) into
 * equal / value-diff / missing / extra. Numeric values use a configurable
 * float tolerance (default 1e-9). Strings compare with strict equality.
 */

import { type AggregatedCell } from '../log/logAggregator';
import { cellKey } from '../log/logSchema';

export type CellDiffEntry = {
  cube: string;
  coord: string[];
  expected: number | string | undefined;
  actual: number | string | undefined;
};

export type CellDiffResult = {
  equal: CellDiffEntry[];
  valueDiff: CellDiffEntry[];
  missing: CellDiffEntry[];
  extra: CellDiffEntry[];
  /** Entries dropped by `capDiffResult`, per kind. */
  hidden?: HiddenCounts;
};

export type HiddenCounts = { equal: number; valueDiff: number; missing: number; extra: number };

export type CellDiffOptions = {
  floatTolerance?: number;
};

const DEFAULT_TOLERANCE = 1e-9;

function valuesEqual(a: number | string, b: number | string, tol: number): boolean {
  if (typeof a !== typeof b) return false;
  if (typeof a === 'string') return a === b;
  return Math.abs((a as number) - (b as number)) <= tol;
}

export function diffCells(
  expected: Map<string, AggregatedCell>,
  actual: Map<string, AggregatedCell>,
  opts: CellDiffOptions = {},
): CellDiffResult {
  const tol = opts.floatTolerance ?? DEFAULT_TOLERANCE;

  const equal: CellDiffEntry[] = [];
  const valueDiff: CellDiffEntry[] = [];
  const missing: CellDiffEntry[] = [];
  const extra: CellDiffEntry[] = [];

  for (const [key, eCell] of expected) {
    const aCell = actual.get(key);
    if (!aCell) {
      missing.push({ cube: eCell.cube, coord: eCell.coord, expected: eCell.value, actual: undefined });
      continue;
    }
    if (valuesEqual(eCell.value, aCell.value, tol)) {
      equal.push({ cube: eCell.cube, coord: eCell.coord, expected: eCell.value, actual: aCell.value });
    } else {
      valueDiff.push({ cube: eCell.cube, coord: eCell.coord, expected: eCell.value, actual: aCell.value });
    }
  }

  for (const [key, aCell] of actual) {
    if (!expected.has(key)) {
      extra.push({ cube: aCell.cube, coord: aCell.coord, expected: undefined, actual: aCell.value });
    }
  }

  const sortFn = (a: CellDiffEntry, b: CellDiffEntry) => {
    const ka = cellKey(a.cube, a.coord);
    const kb = cellKey(b.cube, b.coord);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  equal.sort(sortFn);
  valueDiff.sort(sortFn);
  missing.sort(sortFn);
  extra.sort(sortFn);

  return { equal, valueDiff, missing, extra };
}

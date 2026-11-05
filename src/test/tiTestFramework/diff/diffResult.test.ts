import { describe, it, expect } from 'vitest';
import { summarize, type DiffResult } from '../../../tiTestFramework/diff/diffResult';

const emptyDiff = <T>() => ({
  equal: [] as { key: string; expected: T | undefined; actual: T | undefined }[],
  valueDiff: [] as { key: string; expected: T | undefined; actual: T | undefined }[],
  missing: [] as { key: string; expected: T | undefined; actual: T | undefined }[],
  extra: [] as { key: string; expected: T | undefined; actual: T | undefined }[],
});

const baseResult = (): DiffResult => ({
  cell: { equal: [], valueDiff: [], missing: [], extra: [] },
  dim: emptyDiff(),
  attr: emptyDiff(),
  subset: emptyDiff(),
  view: emptyDiff(),
  cube: emptyDiff(),
  tran: emptyDiff(),
  meta: emptyDiff(),
  status: {
    equal: true,
    statusMatch: true,
    errorLogMatch: true,
    expected: { status: 'success', errorLogContent: '' },
    actual: { status: 'success', errorLogContent: '' },
  },
});

describe('summarize', () => {
  it('pass=true when all sections empty + status equal', () => {
    const s = summarize(baseResult());
    expect(s.pass).toBe(true);
    expect(s.totalDiffs).toBe(0);
  });

  it('counts cell valueDiff', () => {
    const r = baseResult();
    r.cell.valueDiff.push({ cube: 'P', coord: ['A'], expected: 1, actual: 2 });
    const s = summarize(r);
    expect(s.cellDiffs).toBe(1);
    expect(s.totalDiffs).toBe(1);
    expect(s.pass).toBe(false);
  });

  it('counts cell missing + extra', () => {
    const r = baseResult();
    r.cell.missing.push({ cube: 'P', coord: ['A'], expected: 1, actual: undefined });
    r.cell.extra.push({ cube: 'P', coord: ['B'], expected: undefined, actual: 2 });
    const s = summarize(r);
    expect(s.cellDiffs).toBe(2);
    expect(s.totalDiffs).toBe(2);
  });

  it('counts dim/attr/subset/view/cube diffs', () => {
    const r = baseResult();
    r.dim.valueDiff.push({ key: 'k', expected: undefined, actual: undefined });
    r.attr.missing.push({ key: 'k', expected: undefined, actual: undefined });
    r.subset.extra.push({ key: 'k', expected: undefined, actual: undefined });
    r.view.valueDiff.push({ key: 'k', expected: undefined, actual: undefined });
    r.cube.missing.push({ key: 'k', expected: undefined, actual: undefined });
    const s = summarize(r);
    expect(s.dimDiffs).toBe(1);
    expect(s.attrDiffs).toBe(1);
    expect(s.subsetDiffs).toBe(1);
    expect(s.viewDiffs).toBe(1);
    expect(s.cubeDiffs).toBe(1);
    expect(s.totalDiffs).toBe(5);
  });

  it('flags status diff', () => {
    const r = baseResult();
    r.status.equal = false;
    const s = summarize(r);
    expect(s.statusDiff).toBe(true);
    expect(s.totalDiffs).toBe(1);
    expect(s.pass).toBe(false);
  });
});

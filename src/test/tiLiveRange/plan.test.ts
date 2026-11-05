import { describe, it, expect } from 'vitest';
import { planSplit } from '../../tiLiveRange/plan';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(prolog: string): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text: prolog }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

describe('planSplit', () => {
  it('range-scoped rename: only the chosen def + its reads change', () => {
    const plan = planSplit(proc("f = 'a';\nu(f);\nf = 'b';\nu(f);"), 'f', 1, 'g');
    expect(plan.skipped).toEqual([]);
    expect(plan.edits[0].changedSections.prolog).toBe("f = 'a';\nu(f);\ng = 'b';\nu(g);");
  });
  it('read+write line: RHS read renamed, the write of the OTHER def stays', () => {
    const plan = planSplit(proc("f = 'a';\nf = f | 'b';\nu(f);"), 'f', 0, 'g');
    expect(plan.edits[0].changedSections.prolog).toBe("g = 'a';\nf = g | 'b';\nu(f);");
  });
  it('refuses a merge def with a reason, no edits', () => {
    const plan = planSplit(proc("IF(x=1);\nf = 'a';\nELSE;\nf = 'b';\nENDIF;\nu(f);"), 'f', 0, 'g');
    expect(plan.edits).toEqual([]);
    expect(plan.skipped[0].reason).toBe('merge');
  });
  it('collision-guard: target already an existing identifier → skipped', () => {
    const plan = planSplit(proc("f = 'a';\nu(f);\nf = 'b';\ng = 5;\nu(f);"), 'f', 1, 'g');
    expect(plan.edits).toEqual([]);
    expect(plan.skipped[0].reason).toBe('collision');
  });
  it('refuses a split on a multi-statement physical line (ambiguous), no edits', () => {
    const plan = planSplit(proc("sX = 'a'; nY = LONG(sX); sX = 'b'; sProc = sX;"), 'sx', 0, 'valA');
    expect(plan.edits).toEqual([]);
    expect(plan.skipped[0].reason).toBe('ambiguous');
  });
  it('refuses splitting a reserved/system variable (defense-in-depth)', () => {
    const plan = planSplit(proc("DatasourceQuery = 'a';\nu(DatasourceQuery);\nDatasourceQuery = 'b';"), 'datasourcequery', 0, 'x');
    expect(plan.skipped[0].reason).toBe('reserved');
  });
  it('refuses a split when the def line also holds a single-= comparison of the same var (malformed-input hardening)', () => {
    const plan = planSplit(proc("sX = 'a'; u(sX); IF(sX = 'z'); ENDIF; sX = 'b'; u(sX);"), 'sx', 1, 'valB');
    expect(plan.edits).toEqual([]);
    expect(plan.skipped[0].reason).toBe('ambiguous');
  });
  it('still allows a clean single-assignment-per-line split (no false refusal)', () => {
    const plan = planSplit(proc("sX = 'a';\nu(sX);\nsX = 'b';\nu(sX);"), 'sx', 1, 'valB');
    expect(plan.skipped).toEqual([]);
    expect(plan.edits[0].changedSections.prolog).toBe("sX = 'a';\nu(sX);\nvalB = 'b';\nu(valB);");
  });
});

import { describe, it, expect } from 'vitest';
import { analyzeVariable } from '../../tiLiveRange/defsAndReads';
import { computeReaching } from '../../tiLiveRange/reachingDefs';

function reach(code: string, v = 'f') {
  const a = analyzeVariable(code, [], v)!;
  return { a, rr: computeReaching(a.ast, v, a.defs, a.reads) };
}

describe('computeReaching', () => {
  it('linear: each read reached only by the nearest preceding def', () => {
    const { rr } = reach("f = 'a';\nu(f);\nf = 'b';\nu(f);");
    expect(rr.find(r => r.occ.line === 2)!.reachedBy).toEqual([0]);
    expect(rr.find(r => r.occ.line === 4)!.reachedBy).toEqual([1]);
  });
  it('branch merge: read after ENDIF reached by both branch defs', () => {
    const { rr } = reach("IF(x=1);\nf = 'a';\nELSE;\nf = 'b';\nENDIF;\nu(f);");
    expect(rr.find(r => r.occ.line === 6)!.reachedBy.sort()).toEqual([0, 1]);
  });
  it('no-else: read after ENDIF reached by the then-def AND the pre-IF def', () => {
    const { rr } = reach("f = 'a';\nIF(x=1);\nf = 'b';\nENDIF;\nu(f);");
    expect(rr.find(r => r.occ.line === 5)!.reachedBy.sort()).toEqual([0, 1]);
  });
  it('read inside a branch reached only by the pre-IF def', () => {
    const { rr } = reach("f = 'a';\nIF(x=1);\nu(f);\nf = 'b';\nENDIF;");
    expect(rr.find(r => r.occ.line === 3)!.reachedBy).toEqual([0]);
  });
  it('loop-carried: RHS read in a while body reached by pre-loop AND loop-back def', () => {
    const { rr } = reach("f = 'a';\nWHILE(x=1);\nu(f);\nf = f | 'b';\nEND;");
    expect(rr.find(r => r.occ.line === 3)!.reachedBy.sort()).toEqual([0, 1]);
  });
  it('read+write line: RHS read reached by the previous def, not its own write', () => {
    const { rr } = reach("f = 'a';\nf = f | 'b';\nu(f);");
    expect(rr.find(r => r.occ.line === 2)!.reachedBy).toEqual([0]);
    expect(rr.find(r => r.occ.line === 3)!.reachedBy).toEqual([1]);
  });
});

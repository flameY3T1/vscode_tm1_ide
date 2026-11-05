import { describe, it, expect } from 'vitest';
import { analyzeVariable } from '../../tiLiveRange/defsAndReads';
import { computeReaching } from '../../tiLiveRange/reachingDefs';
import { liveRangeOf } from '../../tiLiveRange/liveRange';

function lr(code: string, defId: number, v = 'f') {
  const a = analyzeVariable(code, [], v)!;
  return liveRangeOf(a.defs, computeReaching(a.ast, v, a.defs, a.reads), defId);
}

describe('liveRangeOf', () => {
  it('clean linear split: def 1 range = LHS + the read it alone reaches', () => {
    const r = lr("f = 'a';\nu(f);\nf = 'b';\nu(f);", 1);
    expect(r.refused).toBeUndefined();
    expect(r.positions.map(p => p.line).sort()).toEqual([3, 4]);
  });
  it('refuses a branch-merge def', () => {
    expect(lr("IF(x=1);\nf = 'a';\nELSE;\nf = 'b';\nENDIF;\nu(f);", 0).refused).toBe('merge');
  });
  it('refuses a loop-carried def', () => {
    expect(lr("f = 'a';\nWHILE(x=1);\nu(f);\nf = f | 'b';\nEND;", 0).refused).toBe('merge');
  });
  it('clean def with no reads returns just its LHS', () => {
    const r = lr("f = 'a';\nf = 'b';\nu(f);", 0);
    expect(r.refused).toBeUndefined();
    expect(r.positions).toEqual([{ line: 1, column: 1 }]);
  });
});

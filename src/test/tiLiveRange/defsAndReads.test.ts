import { describe, it, expect } from 'vitest';
import { analyzeVariable } from '../../tiLiveRange/defsAndReads';

describe('analyzeVariable', () => {
  it('collects two literal defs and classifies values', () => {
    const a = analyzeVariable("f = 'lalala';\nCellPutS(f, c);\nf = 'xoxoxo';\nCellPutS(f, c);", [], 'f')!;
    expect(a.defs.map(d => [d.line, d.isLiteralString, d.value])).toEqual([[1, true, 'lalala'], [3, true, 'xoxoxo']]);
    expect(a.defs[0].lhs).toEqual({ line: 1, column: 1 });
  });

  it('records reads separately from LHS writes', () => {
    const a = analyzeVariable("f = 'a';\nCellPutS(f, c);", [], 'f')!;
    expect(a.reads).toHaveLength(1);
    expect(a.reads[0].line).toBe(2);
  });

  it('a read+write line yields one def (dynamic) and one RHS read', () => {
    const a = analyzeVariable("f = 'a';\nf = f | 'b';", [], 'f')!;
    expect(a.defs.map(d => d.line)).toEqual([1, 2]);
    expect(a.defs[1].isLiteralString).toBe(false);
    expect(a.reads.some(r => r.line === 2)).toBe(true);
  });

  it('returns null on unparseable code', () => {
    expect(analyzeVariable("IF(1=1);\n", [], 'f')).toBeNull();
  });
});

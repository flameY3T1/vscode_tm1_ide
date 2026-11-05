import { describe, it, expect } from 'vitest';
import { detectRulesFoldRanges } from '../tiLogicVisualizer/rulesFoldRanges';

describe('detectRulesFoldRanges', () => {
  it('folds the SKIPCHECK→FEEDERS calc region', () => {
    const src = [
      `SKIPCHECK;`,      // 1
      `['a'] = N: 1;`,   // 2
      `['b'] = N: 2;`,   // 3
      `FEEDERS;`,        // 4
      `['a'] => ['b'];`, // 5
    ].join('\n');
    const r = detectRulesFoldRanges(src);
    expect(r).toContainEqual({ startLine: 1, endLine: 3, kind: 'region' });
  });

  it('folds the FEEDERS→end region', () => {
    const src = [
      `SKIPCHECK;`,      // 1
      `['a'] = N: 1;`,   // 2
      `FEEDERS;`,        // 3
      `['a'] => ['b'];`, // 4
      `['c'] => ['d'];`, // 5
    ].join('\n');
    const r = detectRulesFoldRanges(src);
    expect(r).toContainEqual({ startLine: 3, endLine: 5, kind: 'region' });
  });

  it('folds a block of consecutive comment lines', () => {
    const src = [
      `# header line 1`, // 1
      `# header line 2`, // 2
      `# header line 3`, // 3
      `['a'] = N: 1;`,   // 4
    ].join('\n');
    const r = detectRulesFoldRanges(src);
    expect(r).toContainEqual({ startLine: 1, endLine: 3, kind: 'comment' });
  });

  it('ignores a single comment line (nothing to fold)', () => {
    const r = detectRulesFoldRanges(`# solo\n['a'] = N: 1;`);
    expect(r.filter(x => x.kind === 'comment')).toEqual([]);
  });

  it('does not treat SKIPCHECK inside a comment as a marker', () => {
    const r = detectRulesFoldRanges(`# SKIPCHECK;\n['a'] = N: 1;\nFEEDERS;\n['a'] => ['b'];`);
    expect(r.some(x => x.startLine === 1 && x.kind === 'region')).toBe(false);
  });

  it('reuses IF/ENDIF block folding when present', () => {
    const src = `IF(1=1);\n['a'] = N: 1;\nENDIF;`;
    const r = detectRulesFoldRanges(src);
    expect(r).toContainEqual({ startLine: 1, endLine: 3, kind: 'if' });
  });

  it('returns nothing for inline IF() function calls in rules', () => {
    const r = detectRulesFoldRanges(`['a'] = N: IF(['b'] > 0, 1, 0);`);
    expect(r).toEqual([]);
  });

  it('drops ranges that span a single line', () => {
    const r = detectRulesFoldRanges(`SKIPCHECK;\nFEEDERS;`);
    expect(r.every(x => x.endLine > x.startLine)).toBe(true);
  });

  it('folds a #Region…#EndRegion block', () => {
    const src = [
      `SKIPCHECK;`,      // 1
      `#Region MyCalc`,  // 2
      `['a'] = N: 1;`,   // 3
      `['b'] = N: 2;`,   // 4
      `#EndRegion`,      // 5
      `FEEDERS;`,        // 6
      `['a'] => ['b'];`, // 7
    ].join('\n');
    const r = detectRulesFoldRanges(src);
    expect(r).toContainEqual({ startLine: 2, endLine: 5, kind: 'region' });
  });

  it('does not treat #Region/#EndRegion inside a comment as markers', () => {
    const src = [
      `# #Region foo`,   // 1
      `['a'] = N: 1;`,   // 2
      `# #EndRegion`,    // 3
      `['b'] = N: 2;`,   // 4
    ].join('\n');
    const r = detectRulesFoldRanges(src);
    expect(r.filter(x => x.kind === 'region')).toEqual([]);
  });

  it('breaks a comment run on #Region marker', () => {
    const src = [
      `# header line 1`, // 1
      `# header line 2`, // 2
      `#Region MyCalc`,  // 3
      `['a'] = N: 1;`,   // 4
    ].join('\n');
    const r = detectRulesFoldRanges(src);
    const comments = r.filter(x => x.kind === 'comment');
    expect(comments).toContainEqual({ startLine: 1, endLine: 2, kind: 'comment' });
    expect(comments).not.toContainEqual({ startLine: 1, endLine: 3, kind: 'comment' });
  });
});

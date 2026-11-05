import { describe, it, expect } from 'vitest';
import { detectFoldRanges } from '../tiLogicVisualizer/blockRanges';

describe('detectFoldRanges', () => {
  it('detects a plain IF block', () => {
    const code = `IF(x=1);\n  y = 1;\nENDIF;`;
    expect(detectFoldRanges(code)).toEqual([
      { kind: 'IF', startLine: 1, endLine: 3 },
    ]);
  });

  it('detects a plain WHILE block', () => {
    const code = `WHILE(i<10);\n  i = i + 1;\nEND;`;
    expect(detectFoldRanges(code)).toEqual([
      { kind: 'WHILE', startLine: 1, endLine: 3 },
    ]);
  });

  it('detects nested IF inside WHILE', () => {
    const code = [
      'WHILE(i<10);',     // 1
      '  IF(x=1);',       // 2
      '    y = 1;',       // 3
      '  ENDIF;',         // 4
      '  i = i + 1;',     // 5
      'END;',             // 6
    ].join('\n');
    const ranges = detectFoldRanges(code);
    expect(ranges).toContainEqual({ kind: 'IF', startLine: 2, endLine: 4 });
    expect(ranges).toContainEqual({ kind: 'WHILE', startLine: 1, endLine: 6 });
    expect(ranges.length).toBe(2);
  });

  it('treats IF/ELSEIF/ELSE/ENDIF as a single range', () => {
    const code = [
      'IF(x=1);',     // 1
      '  a = 1;',     // 2
      'ELSEIF(x=2);', // 3
      '  a = 2;',     // 4
      'ELSE;',        // 5
      '  a = 3;',     // 6
      'ENDIF;',       // 7
    ].join('\n');
    expect(detectFoldRanges(code)).toEqual([
      { kind: 'IF', startLine: 1, endLine: 7 },
    ]);
  });

  it('ignores IF keyword inside a string literal', () => {
    const code = [
      "x = 'IF is a keyword';", // 1
      'y = 1;',                  // 2
    ].join('\n');
    expect(detectFoldRanges(code)).toEqual([]);
  });

  it('ignores keywords in comments', () => {
    const code = [
      '# IF we had WHILE loops here', // 1
      'y = 1;',                        // 2
    ].join('\n');
    expect(detectFoldRanges(code)).toEqual([]);
  });

  it('handles multi-line IF condition', () => {
    const code = [
      'IF(',          // 1
      '  x = 1',      // 2
      ');',           // 3
      '  y = 1;',     // 4
      'ENDIF;',       // 5
    ].join('\n');
    // The IF keyword is on line 1, ENDIF on line 5 — we still produce one range.
    expect(detectFoldRanges(code)).toEqual([
      { kind: 'IF', startLine: 1, endLine: 5 },
    ]);
  });

  it('drops single-line blocks (nothing to fold)', () => {
    const code = `IF(x=1); y=1; ENDIF;`;
    expect(detectFoldRanges(code)).toEqual([]);
  });

  it('silently drops unclosed blocks', () => {
    const code = `IF(x=1);\n  y = 1;`;
    expect(detectFoldRanges(code)).toEqual([]);
  });

  it('detects two sibling IF blocks', () => {
    const code = [
      'IF(a=1);',  // 1
      '  x = 1;',  // 2
      'ENDIF;',    // 3
      'IF(b=2);',  // 4
      '  y = 2;',  // 5
      'ENDIF;',    // 6
    ].join('\n');
    const ranges = detectFoldRanges(code);
    expect(ranges).toContainEqual({ kind: 'IF', startLine: 1, endLine: 3 });
    expect(ranges).toContainEqual({ kind: 'IF', startLine: 4, endLine: 6 });
    expect(ranges.length).toBe(2);
  });

  it('ignores inline IF(a,b,c) in expressions (not control-flow)', () => {
    // The inline IF on line 3 is a 3-arg function, not a block-opener.
    // Without the statement-start filter the stack got confused and the
    // outer IF range pointed to the wrong lines.
    const code = [
      'IF(y=1);',                                    // 1  control-flow IF
      '',                                            // 2
      "    x = IF(pParam01 @='1', 'x', 'y');",       // 3  inline IF — ignore
      "    IF(c@= 'x');",                            // 4  control-flow IF
      '        gfh  = 1;',                           // 5
      '    ELSE;',                                   // 6
      '        gfh  = 2;',                           // 7
      '    ENDIF;',                                  // 8  closes line 4
      'ENDIF;',                                      // 9  closes line 1
    ].join('\n');
    const ranges = detectFoldRanges(code);
    expect(ranges).toContainEqual({ kind: 'IF', startLine: 1, endLine: 9 });
    expect(ranges).toContainEqual({ kind: 'IF', startLine: 4, endLine: 8 });
    expect(ranges.length).toBe(2);
  });
});

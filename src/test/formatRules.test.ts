import { describe, it, expect } from 'vitest';
import { commentStart, codeMask, DEFAULT_FORMAT_CONFIG, collapseSpaces, spaceAfterComma, noSpaceBeforeSemicolon, stripTrailing, parenSpacing, operatorSpacing, keywordCasing, splitStatements, spaceAfterCommentHash, collapseBlankLines, splitTopLevelArgs, wrapLongCalls } from '../tiLogicVisualizer/formatRules';

describe('commentStart', () => {
  it('finds unquoted #', () => {
    expect(commentStart("x = 1; # note")).toBe(7);
  });
  it('ignores # inside a string', () => {
    expect(commentStart("s = '#notacomment';")).toBe(-1);
  });
  it('returns -1 when no comment', () => {
    expect(commentStart("x = 1;")).toBe(-1);
  });
});

describe('codeMask', () => {
  it('marks string interior false, code true', () => {
    const m = codeMask("a='b'");
    expect(m[0]).toBe(true);   // a
    expect(m[1]).toBe(true);   // =
    expect(m[2]).toBe(false);  // '
    expect(m[3]).toBe(false);  // b
    expect(m[4]).toBe(false);  // '
  });
  it('masks comment region as code=false', () => {
    const m = codeMask('a # b');
    expect(m[0]).toBe(true);   // a
    expect(m[2]).toBe(false);  // #
    expect(m[4]).toBe(false);  // b inside comment
  });
});

describe('DEFAULT_FORMAT_CONFIG', () => {
  it('has operator-spacing off and everything else on', () => {
    expect(DEFAULT_FORMAT_CONFIG.enabled['operator-spacing']).toBe(false);
    expect(DEFAULT_FORMAT_CONFIG.enabled['keyword-case']).toBe(true);
    expect(DEFAULT_FORMAT_CONFIG.enabled['block-indent']).toBe(true);
    expect(DEFAULT_FORMAT_CONFIG.keywordCase).toBe('upper');
    expect(DEFAULT_FORMAT_CONFIG.parenStyle).toBe('tight');
    expect(DEFAULT_FORMAT_CONFIG.indentUnit).toBe('    ');
  });
  it('has wrap-long-calls off by default and wrapColumn 120', () => {
    expect(DEFAULT_FORMAT_CONFIG.enabled['wrap-long-calls']).toBe(false);
    expect(DEFAULT_FORMAT_CONFIG.wrapColumn).toBe(120);
  });
});

describe('splitTopLevelArgs', () => {
  it('splits at top-level commas only', () => {
    expect(splitTopLevelArgs("'P', 'pX', SUBST(s, 1, 2), 'pY', 3")).toEqual(
      ["'P'", "'pX'", 'SUBST(s, 1, 2)', "'pY'", '3'],
    );
  });
  it('keeps commas and parens inside strings as one arg', () => {
    expect(splitTopLevelArgs("'pX', 'a,b(c)'")).toEqual(["'pX'", "'a,b(c)'"]);
  });
  it('returns [] for blank input', () => {
    expect(splitTopLevelArgs('   ')).toEqual([]);
  });
});

describe('wrapLongCalls', () => {
  const I = '    ';
  it('wraps a long ExecuteProcess call into name + one pair per line', () => {
    const line = "nRet = ExecuteProcess('P', 'pA', 1, 'pB', 2);";
    expect(wrapLongCalls([line], I, 20)).toEqual([
      "nRet = ExecuteProcess('P',",
      `${I}'pA', 1,`,
      `${I}'pB', 2);`,
    ]);
  });
  it('re-indents continuation lines of an already wrapped call instead of re-wrapping', () => {
    const lines = ["x = ExecuteProcess('P',", "'pA', 1,", "'pB', 2);"];
    expect(wrapLongCalls(lines, I, 20)).toEqual([
      "x = ExecuteProcess('P',",
      `${I}'pA', 1,`,
      `${I}'pB', 2);`,
    ]);
  });
  it('leaves non-matching long lines alone', () => {
    const line = "CellPutN(1, 'Cube', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6');";
    expect(wrapLongCalls([line], I, 20)).toEqual([line]);
  });
});

describe('collapseSpaces', () => {
  it('collapses runs after the indent', () => {
    expect(collapseSpaces('    x  =   1')).toBe('    x = 1');
  });
  it('leaves spaces inside strings', () => {
    expect(collapseSpaces("s = 'a    b'")).toBe("s = 'a    b'");
  });
  it('does not collapse spaces inside a comment', () => {
    expect(collapseSpaces('x = 1  # a    b')).toBe('x = 1 # a    b');
  });
});

describe('spaceAfterComma', () => {
  it('forces exactly one space after comma', () => {
    expect(spaceAfterComma('f(a,b ,  c)')).toBe('f(a, b , c)');
  });
  it('ignores commas inside strings', () => {
    expect(spaceAfterComma("x = 'a,b'")).toBe("x = 'a,b'");
  });
});

describe('noSpaceBeforeSemicolon', () => {
  it('removes space before ;', () => {
    expect(noSpaceBeforeSemicolon('x = 1 ;')).toBe('x = 1;');
  });
});

describe('stripTrailing', () => {
  it('removes trailing spaces/tabs', () => {
    expect(stripTrailing('x = 1;   ')).toBe('x = 1;');
  });
});

describe('parenSpacing', () => {
  it('tight removes inner spaces', () => {
    expect(parenSpacing('f( a, b )', 'tight')).toBe('f(a, b)');
  });
  it('spaced forces exactly one inner space', () => {
    expect(parenSpacing('f(a, b)', 'spaced')).toBe('f( a, b )');
  });
  it('does not touch empty parens', () => {
    expect(parenSpacing('f()', 'spaced')).toBe('f()');
    expect(parenSpacing('f( )', 'tight')).toBe('f()');
  });
  it('ignores parens inside strings', () => {
    expect(parenSpacing("x = '( a )'", 'tight')).toBe("x = '( a )'");
  });
});

describe('operatorSpacing', () => {
  it('spaces around =', () => {
    expect(operatorSpacing('x=1')).toBe('x = 1');
  });
  it('keeps multi-char operators intact', () => {
    expect(operatorSpacing('x<>1')).toBe('x <> 1');
    expect(operatorSpacing('x>=1')).toBe('x >= 1');
  });
  it('does not split <= into < =', () => {
    expect(operatorSpacing('a<=b')).toBe('a <= b');
  });
  it('ignores operators inside strings', () => {
    expect(operatorSpacing("s='a=b'")).toBe("s = 'a=b'");
  });
  it('leaves +/- untouched (v1 limitation)', () => {
    expect(operatorSpacing('x=a-b')).toBe('x = a-b');
  });
});

describe('keywordCasing', () => {
  it('uppercases control-flow keywords', () => {
    expect(keywordCasing('if(x);', 'upper')).toBe('IF(x);');
    expect(keywordCasing('Endif;', 'upper')).toBe('ENDIF;');
  });
  it('lowercases control-flow keywords', () => {
    expect(keywordCasing('IF(x);', 'lower')).toBe('if(x);');
  });
  it('camel-cases control-flow keywords', () => {
    expect(keywordCasing('ELSEIF(x);', 'camel')).toBe('ElseIf(x);');
  });
  it('normalizes a known function name to canonical case regardless of keywordCase', () => {
    expect(keywordCasing('cellputn(1,c,e);', 'upper')).toBe('CellPutN(1,c,e);');
  });
  it('leaves unknown identifiers alone', () => {
    expect(keywordCasing('myVar = 1;', 'upper')).toBe('myVar = 1;');
  });
  it('ignores keywords inside strings', () => {
    expect(keywordCasing("s = 'if then';", 'upper')).toBe("s = 'if then';");
  });
});

describe('splitStatements', () => {
  it('splits multiple statements', () => {
    expect(splitStatements('IF(x); foo; ENDIF;')).toEqual(['IF(x);', 'foo;', 'ENDIF;']);
  });
  it('keeps a single statement intact', () => {
    expect(splitStatements('x = 1;')).toEqual(['x = 1;']);
  });
  it('does not split semicolons inside strings', () => {
    expect(splitStatements("s = 'a;b';")).toEqual(["s = 'a;b';"]);
  });
  it('attaches a trailing comment to the last statement', () => {
    expect(splitStatements('a; b; # note')).toEqual(['a;', 'b; # note']);
  });
  it('passes through a line with no code semicolon', () => {
    expect(splitStatements('# just a comment')).toEqual(['# just a comment']);
  });
});

describe('operatorSpacing TM1 string operators', () => {
  it('keeps @<> atomic', () => {
    expect(operatorSpacing('a@<>b')).toBe('a @<> b');
  });
  it('does not split an already-spaced @<>', () => {
    expect(operatorSpacing('a @<> b')).toBe('a @<> b');
  });
  it('handles @= @< @> @>= @<=', () => {
    expect(operatorSpacing('a@=b')).toBe('a @= b');
    expect(operatorSpacing('a@<b')).toBe('a @< b');
    expect(operatorSpacing('a@>b')).toBe('a @> b');
    expect(operatorSpacing('a@>=b')).toBe('a @>= b');
    expect(operatorSpacing('a@<=b')).toBe('a @<= b');
  });
  it('still spaces a bare <> not preceded by @', () => {
    expect(operatorSpacing('a<>b')).toBe('a <> b');
  });
});

describe('operatorSpacing string concat |', () => {
  it('spaces around |', () => {
    expect(operatorSpacing('s = a|b;')).toBe('s = a | b;');
  });
  it('does not touch | inside strings', () => {
    expect(operatorSpacing("s = 'a|b';")).toBe("s = 'a|b';");
  });
  it('does not double-space an already-spaced |', () => {
    expect(operatorSpacing('s = a | b;')).toBe('s = a | b;');
  });
});

describe('spaceAfterCommentHash', () => {
  it('inserts a space after #', () => {
    expect(spaceAfterCommentHash('#foo')).toBe('# foo');
  });
  it('leaves an already-spaced comment unchanged', () => {
    expect(spaceAfterCommentHash('# foo')).toBe('# foo');
  });
  it('leaves multi-# separators unchanged', () => {
    expect(spaceAfterCommentHash('##foo')).toBe('##foo');
    expect(spaceAfterCommentHash('####')).toBe('####');
    expect(spaceAfterCommentHash('####section####')).toBe('####section####');
  });
  it('handles trailing comment after code', () => {
    expect(spaceAfterCommentHash('x = 1; #bar')).toBe('x = 1; # bar');
  });
  it('ignores # inside strings', () => {
    expect(spaceAfterCommentHash("s = '#nostring';")).toBe("s = '#nostring';");
  });
  it('leaves a bare # unchanged', () => {
    expect(spaceAfterCommentHash('#')).toBe('#');
  });
});

describe('collapseBlankLines', () => {
  it('collapses 3+ blank lines to exactly 2', () => {
    expect(collapseBlankLines(['a;', '', '', '', '', 'b;'])).toEqual(['a;', '', '', 'b;']);
  });
  it('keeps 2 blank lines as 2', () => {
    expect(collapseBlankLines(['a;', '', '', 'b;'])).toEqual(['a;', '', '', 'b;']);
  });
  it('treats whitespace-only lines as blank', () => {
    expect(collapseBlankLines(['a;', '  ', '\t', '   ', 'b;'])).toEqual(['a;', '  ', '\t', 'b;']);
  });
});

describe('bracket-aware masking', () => {
  it('commentStart ignores # inside [...]', () => {
    expect(commentStart('x = [GL#Account];')).toBe(-1);
    expect(commentStart('x = [GL#Account]; # real')).toBe(18);
  });
  it('codeMask marks [...] interior as non-code', () => {
    const m = codeMask('a[b;c]');
    expect(m[0]).toBe(true);   // a
    expect(m[1]).toBe(false);  // [
    expect(m[2]).toBe(false);  // b
    expect(m[3]).toBe(false);  // ; inside brackets
    expect(m[4]).toBe(false);  // c
    expect(m[5]).toBe(false);  // ]
  });
  it('splitStatements does not split ; inside [...]', () => {
    expect(splitStatements('x = [a;b]; foo;')).toEqual(['x = [a;b];', 'foo;']);
  });
  it('splitStatements keeps a single bracketed element ref intact', () => {
    expect(splitStatements("x = [a;b];")).toEqual(["x = [a;b];"]);
  });
});

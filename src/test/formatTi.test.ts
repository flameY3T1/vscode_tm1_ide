import { describe, it, expect } from 'vitest';
import { formatTi } from '../tiLogicVisualizer/formatTi';
import { DEFAULT_FORMAT_CONFIG, type TiFormatConfig } from '../tiLogicVisualizer/formatRules';

const I = '    '; // 4 spaces

const INDENT_ONLY: TiFormatConfig = {
  ...DEFAULT_FORMAT_CONFIG,
  enabled: { 'keyword-case': false, 'operator-spacing': false, 'space-after-comma': false, 'no-space-before-semicolon': false, 'collapse-spaces': false, 'no-trailing-space': false, 'space-after-comment': false, 'block-indent': true, 'one-statement-per-line': false, 'max-blank-lines': false, 'wrap-long-calls': false, 'normalize-identifier-case': false },
};

describe('formatTi', () => {
  it('flat code unchanged content but stripped indent', () => {
    const src = `   x = 1;\ny = 2;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`x = 1;\ny = 2;`);
  });

  it('IF/ENDIF block indents body', () => {
    const src = `IF(a=1);\nx = 1;\nENDIF;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`IF(a=1);\n${I}x = 1;\nENDIF;`);
  });

  it('nested IF inside WHILE', () => {
    const src = `WHILE(i<10);\nIF(x=1);\ny = 1;\nENDIF;\nEND;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(
      `WHILE(i<10);\n${I}IF(x=1);\n${I}${I}y = 1;\n${I}ENDIF;\nEND;`,
    );
  });

  it('ELSE/ELSEIF on opener level, body inside', () => {
    const src = `IF(a=1);\nx = 1;\nELSEIF(a=2);\ny = 2;\nELSE;\nz = 3;\nENDIF;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(
      `IF(a=1);\n${I}x = 1;\nELSEIF(a=2);\n${I}y = 2;\nELSE;\n${I}z = 3;\nENDIF;`,
    );
  });

  it('inline-IF function call (e.g. value = IF(a, b, c)) stays flat', () => {
    const src = `value = IF(a=1, 1, 0);\ny = 2;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(src);
  });

  it('statement-start inline IF(cond, t, f) does not cascade indent', () => {
    // 3-arg IF is the inline function (no ENDIF); each line must stay at depth 0.
    const src = `IF(x=1, y=4, z=1);\nIF(x=1, y=4, z=1);\nIF(x=1, y=4, z=1);`;
    expect(formatTi(src, INDENT_ONLY)).toBe(src);
  });

  it('keywords inside strings are ignored', () => {
    const src = `s = 'IF this is a string ENDIF';\nx = 1;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(src);
  });

  it('keywords inside comments are ignored', () => {
    const src = `# IF dummy comment\nx = 1;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(src);
  });

  it('blank lines stay blank (no trailing spaces)', () => {
    const src = `IF(a=1);\n\nx = 1;\nENDIF;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`IF(a=1);\n\n${I}x = 1;\nENDIF;`);
  });

  it('IF and ENDIF on same line — net depth zero', () => {
    const src = `IF(a=1); x=1; ENDIF;\ny = 2;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`IF(a=1); x=1; ENDIF;\ny = 2;`);
  });

  it('over-indented ENDIF gets fixed to opener level', () => {
    const src = `IF(a=1);\n${I}${I}${I}x = 1;\n${I}${I}ENDIF;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`IF(a=1);\n${I}x = 1;\nENDIF;`);
  });

  it('depth never goes negative on stray ENDIF', () => {
    const src = `ENDIF;\nx = 1;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`ENDIF;\nx = 1;`);
  });

  it('respects custom indent unit', () => {
    const src = `IF(a=1);\nx = 1;\nENDIF;`;
    expect(formatTi(src, { ...INDENT_ONLY, indentUnit: '  ' })).toBe(`IF(a=1);\n  x = 1;\nENDIF;`);
  });

  it('preserves line content (only leading whitespace changes)', () => {
    const src = `   IF(a=1);\n      x  = 1 ;  \nENDIF;`;
    expect(formatTi(src, INDENT_ONLY)).toBe(`IF(a=1);\n${I}x  = 1 ;  \nENDIF;`);
  });
});

const ALL_OFF: TiFormatConfig = {
  ...DEFAULT_FORMAT_CONFIG,
  enabled: {
    'keyword-case': false, 'operator-spacing': false, 'space-after-comma': false, 'no-space-before-semicolon': false, 'collapse-spaces': false,
    'no-trailing-space': false, 'space-after-comment': false, 'block-indent': false, 'one-statement-per-line': false, 'max-blank-lines': false, 'wrap-long-calls': false,
    'normalize-identifier-case': false,
  },
  parenStyle: 'off',
};

describe('formatTi space-after-comment (space after comment #)', () => {
  const cfg: TiFormatConfig = { ...ALL_OFF, enabled: { ...ALL_OFF.enabled, 'space-after-comment': true } };
  it('inserts a space after # on comment lines', () => {
    expect(formatTi('#foo\nx = 1; #bar', cfg)).toBe('# foo\nx = 1; # bar');
  });
  it('leaves multi-# separators and strings unchanged', () => {
    const src = "####section####\n##foo\ns = '#nostring';";
    expect(formatTi(src, cfg)).toBe(src);
  });
  it('disabled → byte-identical', () => {
    const src = '#foo\n##bar\nx = 1; #baz';
    expect(formatTi(src, ALL_OFF)).toBe(src);
  });
});

describe('formatTi max-blank-lines (blank line collapse)', () => {
  const cfg: TiFormatConfig = { ...ALL_OFF, enabled: { ...ALL_OFF.enabled, 'max-blank-lines': true } };
  it('collapses 3+ blank lines to exactly 2', () => {
    expect(formatTi('a;\n\n\n\n\nb;', cfg)).toBe('a;\n\n\nb;');
    expect(formatTi('a;\n\n\n\nb;', cfg)).toBe('a;\n\n\nb;');
  });
  it('keeps 2 blank lines as 2', () => {
    expect(formatTi('a;\n\n\nb;', cfg)).toBe('a;\n\n\nb;');
  });
  it('disabled → byte-identical', () => {
    const src = 'a;\n\n\n\n\nb;';
    expect(formatTi(src, ALL_OFF)).toBe(src);
  });
});

describe('formatTi wrap-long-calls (long ExecuteProcess/RunProcess wrapping)', () => {
  const I2 = I; // continuation indent = indentUnit
  const cfg: TiFormatConfig = { ...ALL_OFF, enabled: { ...ALL_OFF.enabled, 'wrap-long-calls': true }, wrapColumn: 60 };
  const LONG = "nRet = ExecuteProcess('Bedrock.Cube.Clear', 'pCube', sCube, 'pView', sView, 'pLogOutput', 1);";
  const WRAPPED =
    "nRet = ExecuteProcess('Bedrock.Cube.Clear',\n" +
    `${I2}'pCube', sCube,\n` +
    `${I2}'pView', sView,\n` +
    `${I2}'pLogOutput', 1);`;

  it('wraps a call over wrapColumn with >= 2 pairs', () => {
    expect(formatTi(LONG, cfg)).toBe(WRAPPED);
  });

  it('leaves lines at or below wrapColumn unchanged', () => {
    expect(formatTi(LONG, { ...cfg, wrapColumn: 200 })).toBe(LONG);
  });

  it('leaves calls with < 2 param pairs unchanged', () => {
    const src = "nRet = ExecuteProcess('Some.Very.Long.Process.Name.Aaaaaaaa', 'pOnly', vValue);";
    expect(formatTi(src, cfg)).toBe(src);
  });

  it('is idempotent (format twice == format once)', () => {
    const once = formatTi(LONG, cfg);
    expect(formatTi(once, cfg)).toBe(once);
  });

  it('is idempotent with the full default pipeline + wrap-long-calls', () => {
    const full: TiFormatConfig = { ...DEFAULT_FORMAT_CONFIG, enabled: { ...DEFAULT_FORMAT_CONFIG.enabled, 'wrap-long-calls': true }, wrapColumn: 60 };
    const once = formatTi(LONG, full);
    expect(formatTi(once, full)).toBe(once);
  });

  it('treats strings with commas/parens as one arg', () => {
    const src = "x = ExecuteProcess('Proc', 'pX', 'a,b(c)', 'pY', 2);";
    expect(formatTi(src, { ...cfg, wrapColumn: 40 })).toBe(
      "x = ExecuteProcess('Proc',\n" +
      `${I2}'pX', 'a,b(c)',\n` +
      `${I2}'pY', 2);`,
    );
  });

  it('wraps RunProcess analogously', () => {
    const src = "RunProcess('Some.Process', 'pCube', sCube, 'pView', sView, 'pLogOutput', 1);";
    expect(formatTi(src, cfg)).toBe(
      "RunProcess('Some.Process',\n" +
      `${I2}'pCube', sCube,\n` +
      `${I2}'pView', sView,\n` +
      `${I2}'pLogOutput', 1);`,
    );
  });

  it('does not wrap other long calls (CellPutN)', () => {
    const src = "CellPutN(nValueWithVeryLongName, 'SomeCubeName', sElement1, sElement2, sElement3, sElement4);";
    expect(formatTi(src, cfg)).toBe(src);
  });

  it('appends an odd leftover arg to the last pair', () => {
    const src = "nRet = ExecuteProcess('Bedrock.Cube.Clear', 'pCube', sCube, 'pView', sView, vExtra);";
    expect(formatTi(src, cfg)).toBe(
      "nRet = ExecuteProcess('Bedrock.Cube.Clear',\n" +
      `${I2}'pCube', sCube,\n` +
      `${I2}'pView', sView, vExtra);`,
    );
  });

  it('exempts lines with a trailing comment', () => {
    const src = LONG + ' # clear the cube first';
    expect(formatTi(src, cfg)).toBe(src);
  });

  it('ignores ExecuteProcess inside strings and comments', () => {
    const src = "sMsg = 'this string mentions ExecuteProcess(a, b, c, d, e) but is not a call at all';";
    expect(formatTi(src, cfg)).toBe(src);
  });

  it('disabled → byte-identical', () => {
    expect(formatTi(LONG, { ...ALL_OFF, wrapColumn: 60 })).toBe(LONG);
  });

  it('block-indent interplay: wrapped call inside IF block gets block indent + one unit', () => {
    const cfg310: TiFormatConfig = { ...ALL_OFF, enabled: { ...ALL_OFF.enabled, 'block-indent': true, 'wrap-long-calls': true }, wrapColumn: 60 };
    const src = `IF(a=1);\n${LONG}\nENDIF;`;
    const expected =
      'IF(a=1);\n' +
      `${I}nRet = ExecuteProcess('Bedrock.Cube.Clear',\n` +
      `${I}${I2}'pCube', sCube,\n` +
      `${I}${I2}'pView', sView,\n` +
      `${I}${I2}'pLogOutput', 1);\n` +
      'ENDIF;';
    const once = formatTi(src, cfg310);
    expect(once).toBe(expected);
    expect(formatTi(once, cfg310)).toBe(once); // block-indent flattens, wrap-long-calls restores — stable
  });
});

describe('formatTi pipeline (default config)', () => {
  it('applies casing, comma, semicolon, indent together', () => {
    const input = 'if(x);\nfoo( 1,2 ) ;\nendif;';
    const out = formatTi(input); // default config
    expect(out).toBe('IF(x);\n    foo(1, 2);\nENDIF;');
  });
  it('splits multiple statements then indents', () => {
    const input = 'if(x); foo; endif;';
    const out = formatTi(input);
    expect(out).toBe('IF(x);\n    foo;\nENDIF;');
  });
  it('is idempotent', () => {
    const input = 'if(x);foo( 1,2 );endif;';
    expect(formatTi(formatTi(input))).toBe(formatTi(input));
  });
  it('does not break @<> with operator-spacing enabled', () => {
    const cfg = { ...DEFAULT_FORMAT_CONFIG, enabled: { ...DEFAULT_FORMAT_CONFIG.enabled, 'operator-spacing': true } };
    const out = formatTi("IF ( TRIM( vParent ) @<> '' );", cfg);
    expect(out).toContain('@<>');
    expect(out).not.toContain('@ <>');
  });
});

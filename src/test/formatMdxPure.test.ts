import { describe, it, expect } from 'vitest';
import { formatMdx, tokenizeMdx } from '../mdx/formatMdxPure';
import { parseCheck, parseCellName } from '../notebook/notebookPure';

const GENERATED = "SELECT {[Period].[Period].[Jan],[Period].[Period].[Feb]} ON COLUMNS, {TM1SUBSETALL([Account].[Account])} ON ROWS FROM [Sales] WHERE ([Version].[Version].[Actual],[Year].[Year].[2026])";

describe('formatMdx', () => {
  it('puts every clause and axis on its own line', () => {
    expect(formatMdx(GENERATED)).toBe([
      'SELECT',
      '  {[Period].[Period].[Jan], [Period].[Period].[Feb]} ON COLUMNS,',
      '  {TM1SUBSETALL([Account].[Account])} ON ROWS',
      'FROM [Sales]',
      'WHERE ([Version].[Version].[Actual], [Year].[Year].[2026])',
    ].join('\n'));
  });

  it('breaks a set that does not fit the width at its commas', () => {
    const out = formatMdx('SELECT {[D].[D].[A],[D].[D].[B]} ON 0 FROM [C]', { width: 20 });
    expect(out).toBe([
      'SELECT',
      '  {',
      '    [D].[D].[A],',
      '    [D].[D].[B]',
      '  } ON 0',
      'FROM [C]',
    ].join('\n'));
  });

  it('indents WITH definitions and upper-cases keywords only outside brackets', () => {
    const out = formatMdx("with member [Measures].[m] as '1+2' select {[Measures].[m]} on columns from [Cube]");
    expect(out).toBe([
      'WITH',
      "  MEMBER [Measures].[m] AS '1+2'",
      'SELECT',
      '  {[Measures].[m]} ON COLUMNS',
      'FROM [Cube]',
    ].join('\n'));
  });

  it('keeps bracket and string contents verbatim', () => {
    const out = formatMdx("SELECT {[Dim with select].[a]]b]} ON 0 FROM [C] WHERE ([x].[it's])");
    expect(out).toContain('[Dim with select].[a]]b]');
    expect(out).toContain("[x].[it's]");
  });

  it('is idempotent', () => {
    const once = formatMdx(GENERATED);
    expect(formatMdx(once)).toBe(once);
  });

  // Until 2026-09-19 this read `toContain('SOMETHINGWEIRD(1, 2)')` — the
  // formatter INVENTED the missing parenthesis, and the test pinned that down.
  // A parenthesis the user did not type changes the meaning of the expression;
  // with an open string it also grew with every click.
  it('leaves unparseable input as written instead of inventing a closer', () => {
    const src = 'SELECT {[a]} ON 0 FROM [C] SOMETHINGWEIRD(1, 2';
    const out = formatMdx(src);
    expect(out).toContain('SOMETHINGWEIRD(1, 2');
    expect(out).not.toContain('SOMETHINGWEIRD(1, 2)');
  });

  // A `--` comment swallows the rest of its line. A separating comma behind it
  // would be commented out — the button would have turned runnable text into
  // invalid text. What is checked is the token sequence, not the indentation.
  it('keeps the separating comma out of a trailing line comment (set)', () => {
    const out = formatMdx('SELECT {[D].[A] -- comment\n, [D].[B]} ON 0 FROM [C]', { width: 20 });
    expect(tokenizeMdx(out).filter(t => t.kind === 'comma')).toHaveLength(1);
    expect(formatMdx(out, { width: 20 })).toBe(out);
  });

  it('keeps the separating comma out of a trailing line comment (axes)', () => {
    const out = formatMdx('SELECT {[D].[A]} ON 0 -- comment\n, {[E].[X]} ON 1 FROM [C]');
    expect(tokenizeMdx(out).filter(t => t.kind === 'comma')).toHaveLength(1);
  });

  it('returns empty input untouched', () => {
    expect(formatMdx('   \n ')).toBe('');
  });
});

/**
 * The two properties that make the button safe: it does not change the
 * meaning, and the second click does nothing. Individual cases with a
 * whole-text comparison do not check that — until 2026-09-19 the formatter
 * APPENDED one character per click on unbalanced input (`'open)` → `'open))`
 * → `'open)))`), and all eight cases stayed green.
 *
 * What is compared is the token sequence, not the text: indentation, line
 * breaks and the upper-casing of keywords are exactly what the button IS
 * ALLOWED to change. The separating commas that are newly placed when breaking
 * lines count too — so a lost or invented comma stands out.
 */
describe('formatMdx — properties over all inputs', () => {
  const tokens = (s: string): string => tokenizeMdx(s).map(t => `${t.kind}:${t.text}`).join('|');

  const EINGABEN: Record<string, string> = {
    'erzeugtes Statement': GENERATED,
    'leer': '   \n ',
    'ohne WITH': 'select {[d].[d].[a]} on 0 from [c]',
    'WITH-Klausel': 'WITH MEMBER [Measures].[C] AS 1 SELECT {[Measures].[C]} ON 0 FROM [Cube]',
    'geschachtelt': 'SELECT {CROSSJOIN({[A].[A].[x]},{[B].[B].[y]})} ON 0 FROM [C]',
    'Zeilenkommentar': 'SELECT {[D].[A] -- comment\n, [D].[B]} ON 0 FROM [C]',
    'Blockkommentar': 'SELECT /* [Foo].[Bar] */ {[A].[A].[x]} ON 0 FROM [C]',
    'Zeichenkette': "SELECT {TM1FILTERBYPATTERN([A].[A].MEMBERS, '*x*')} ON 0 FROM [C]",
    'Escape im Namen': 'SELECT {[Dim].[Dim].[a]]b]} ON 0 FROM [C]',
    'Zahlen und Operatoren': 'SELECT {[A].[A].[x]} ON 0 FROM [C] WHERE ([M].[M].[v] > 1.5)',
    'offene Mengenklammer': 'SELECT {[A].[A].[x] ON 0 FROM [C]',
    'offene Rundklammer': 'SELECT {[A].[A].[x]} ON 0 FROM [C] WHERE ([V].[V].[a]',
    'offene Zeichenkette': "WHERE ([B].[B].['open)",
    'Schliesser ohne Oeffner': 'SELECT {[A].[A].[x]}} ON 0 FROM [C]',
    'Komma am Mengenende': 'SELECT {[Dimension].[Dimension].[AAA],[Dimension].[Dimension].[BBB],} ON 0 FROM [Cube]',
  };

  for (const [name, src] of Object.entries(EINGABEN)) {
    it(`${name}: keeps the token sequence`, () => {
      expect(tokens(formatMdx(src))).toBe(tokens(src));
    });

    it(`${name}: second call changes nothing`, () => {
      const einmal = formatMdx(src);
      expect(formatMdx(einmal)).toBe(einmal);
    });

    it(`${name}: narrow width keeps both`, () => {
      const einmal = formatMdx(src, { width: 20 });
      expect(tokens(einmal)).toBe(tokens(src));
      expect(formatMdx(einmal, { width: 20 })).toBe(einmal);
    });
  }
});

describe('formatMdx — notebook directive lines', () => {
  it('keeps `//` line comments intact, so check and name still parse', () => {
    const src = '// check: = source ± 0.01\n// name: source\nSELECT {[D].[A]} ON 0 FROM [C]';
    const out = formatMdx(src);
    expect(out.split('\n').slice(0, 2)).toEqual(['// check: = source ± 0.01', '// name: source']);
    expect(parseCheck(out)).toEqual({ kind: 'reconcile', ref: 'source', tol: 0.01 });
    expect(parseCellName(out)).toBe('source');
  });
});

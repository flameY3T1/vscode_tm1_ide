import { describe, it, expect } from 'vitest';
import { findMatches, applyReplacements, InvalidRegexError } from '../../findReplace/matchEngine';

const plain = { wholeWord: false, regex: false };
const word  = { wholeWord: true,  regex: false };
const rx    = { wholeWord: false, regex: true  };

describe('findMatches', () => {
  it('finds substring matches with 1-based line/column', () => {
    const m = findMatches('a Cube b\nCube', 'Cube', plain);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ line: 1, column: 3, length: 4, lineText: 'a Cube b' });
    expect(m[1]).toMatchObject({ line: 2, column: 1, length: 4 });
  });

  it('matches case-insensitively (reporting finds Reporting)', () => {
    const m = findMatches('Reporting rEPORTING reporting', 'reporting', plain);
    expect(m).toHaveLength(3);
    expect(m.map(x => x.column)).toEqual([1, 11, 21]);
  });

  it('whole-word is case-insensitive', () => {
    const m = findMatches('Cube CUBE cube', 'cube', word);
    expect(m).toHaveLength(3);
  });

  it('regex is case-insensitive and preserves matched-slice casing on literal replace', () => {
    const m = findMatches('Sales SALES', 'sales', rx);
    expect(m).toHaveLength(2);
    const out = applyReplacements('Sales SALES', m, 'Rev', 'sales', rx);
    expect(out).toBe('Rev Rev');
  });

  it('finds multiple matches on one line', () => {
    const m = findMatches('xCubexCubex', 'Cube', plain);
    expect(m.map(x => x.column)).toEqual([2, 7]);
  });

  it('whole-word skips partial hits', () => {
    const m = findMatches('CubeX Cube CubeY', 'Cube', word);
    expect(m).toHaveLength(1);
    expect(m[0].column).toBe(7);
  });

  it('regex matches and captures via applyReplacements backrefs', () => {
    const m = findMatches('Sales_2021 Sales_2022', 'Sales_(\\d+)', rx);
    expect(m).toHaveLength(2);
    const out = applyReplacements('Sales_2021 Sales_2022', m, 'Y$1', 'Sales_(\\d+)', rx);
    expect(out).toBe('Y2021 Y2022');
  });

  it('guards against zero-length regex matches (no infinite loop)', () => {
    const m = findMatches('abc', 'x*', rx);
    expect(Array.isArray(m)).toBe(true);
  });

  it('throws InvalidRegexError on bad pattern', () => {
    expect(() => findMatches('abc', '(', rx)).toThrow(InvalidRegexError);
  });
});

describe('applyReplacements', () => {
  it('replaces only the passed matches, right-to-left safe', () => {
    const all = findMatches('Cube and Cube', 'Cube', plain);
    const out = applyReplacements('Cube and Cube', [all[1]], 'X', 'Cube', plain);
    expect(out).toBe('Cube and X');
  });

  it('literal replacement in whole-word mode', () => {
    const m = findMatches('old Cube', 'Cube', word);
    expect(applyReplacements('old Cube', m, 'New', 'Cube', word)).toBe('old New');
  });

  it('regex lookahead replaces via stored groups, not a re-match of the slice (Bug #3)', () => {
    // 'foo' matches only before 'bar'. The old code re-ran /foo(?=bar)/ against the
    // isolated slice "foo" (lookahead sees end-of-string) → no substitution → silent no-op.
    const text = 'foobar foobaz';
    const m = findMatches(text, 'foo(?=bar)', rx);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ column: 1, length: 3 });
    expect(applyReplacements(text, m, 'X', 'foo(?=bar)', rx)).toBe('Xbar foobaz');
  });

  it('regex lookbehind + capture group replace via stored groups (Bug #3)', () => {
    const text = 'a=1 b=2';
    const m = findMatches(text, '(?<=b=)(\\d)', rx);
    expect(m).toHaveLength(1);
    expect(applyReplacements(text, m, '[$1]', '(?<=b=)(\\d)', rx)).toBe('a=1 b=[2]');
  });
});

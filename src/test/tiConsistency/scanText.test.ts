import { describe, it, expect } from 'vitest';
import { occurrencesOf, renameIdentifier } from '../../tiConsistency/scanText';

describe('occurrencesOf', () => {
  it('finds whole-word case-insensitive occurrences in code', () => {
    const t = 'sDim = 1;\nnX = SDIM + Sdim;';
    const occ = occurrencesOf(t, 'sdim');
    expect(occ.map(o => o.spelling)).toEqual(['sDim', 'SDIM', 'Sdim']);
    expect(occ[0]).toMatchObject({ line: 1, column: 1, length: 4 });
  });
  it('ignores substrings (whole-word only)', () => {
    expect(occurrencesOf('sDimExtra = 1;', 'sdim')).toEqual([]);
  });
  it('ignores occurrences inside string literals', () => {
    expect(occurrencesOf("x = 'sDim';", 'sdim')).toEqual([]);
  });
  it('ignores occurrences inside comments', () => {
    expect(occurrencesOf('# sDim here\nsDim = 1;', 'sdim').map(o => o.line)).toEqual([2]);
  });
  it('ignores occurrences inside a string literal that spans multiple physical lines', () => {
    const t = "sVar = 'first line has sDim\n and second line sDim too';";
    expect(occurrencesOf(t, 'sdim')).toEqual([]);
  });
  it('finds a real code occurrence after a multi-line string closes', () => {
    const t = 'sVar = \'multi\n line\' | sDim;';
    const occ = occurrencesOf(t, 'sdim');
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ line: 2, spelling: 'sDim' });
  });
  it("treats doubled '' as an escaped apostrophe that stays inside the string", () => {
    const t = "x = 'it''s sDim here';";
    expect(occurrencesOf(t, 'sdim')).toEqual([]);
  });
});

describe('renameIdentifier', () => {
  it('rewrites every spelling to target, code-only', () => {
    const t = "sDim = 1;\nnX = SDIM;\ns = 'sDim';";
    expect(renameIdentifier(t, 'sdim', 'sDim')).toBe("sDim = 1;\nnX = sDim;\ns = 'sDim';");
  });
  it('leaves substrings untouched', () => {
    expect(renameIdentifier('sDimExtra = 1;', 'sdim', 'sDim')).toBe('sDimExtra = 1;');
  });
  it('leaves content inside a multi-line string literal untouched', () => {
    const t = "sVar = 'first line has sDim\n and second line sDim too';";
    expect(renameIdentifier(t, 'sdim', 'X')).toBe(t);
  });
});

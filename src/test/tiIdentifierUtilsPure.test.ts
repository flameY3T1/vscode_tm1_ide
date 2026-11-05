import { describe, it, expect } from 'vitest';
import { findAllOccurrencesPure } from '../providers/tiIdentifierUtils';
import { escapeRegex } from '../utils/escapeRegexPure';
import { buildSkipMask } from '../providers/tiIdentifierUtilsPure';

describe('findAllOccurrencesPure', () => {
  it('finds plain word occurrences', () => {
    const text = 'vTotal = 5;\nvTotal = vTotal + 1;';
    const r = findAllOccurrencesPure(text, 'vTotal');
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ line: 0, startCol: 0, endCol: 6 });
    expect(r[1]).toEqual({ line: 1, startCol: 0, endCol: 6 });
    expect(r[2]).toEqual({ line: 1, startCol: 9, endCol: 15 });
  });

  it('skips occurrences inside string literals', () => {
    const text = "sLogOutput('INFO', 'vTotal not used');\nx = vTotal;";
    const r = findAllOccurrencesPure(text, 'vTotal');
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ line: 1, startCol: 4, endCol: 10 });
  });

  it('skips occurrences in line comments', () => {
    const text = '# comment about vTotal\nvTotal = 1;';
    const r = findAllOccurrencesPure(text, 'vTotal');
    expect(r).toHaveLength(1);
    expect(r[0].line).toBe(1);
  });

  it('is case-insensitive', () => {
    const text = 'vTotal = 1;\nVTOTAL = 2;\nvtotal = 3;';
    const r = findAllOccurrencesPure(text, 'vTotal');
    expect(r).toHaveLength(3);
  });

  it('matches whole words only', () => {
    const text = 'vTotal = 1;\nvTotalMax = 2;';
    const r = findAllOccurrencesPure(text, 'vTotal');
    expect(r).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(findAllOccurrencesPure('', 'x')).toEqual([]);
  });

  it('returns empty when word not found', () => {
    expect(findAllOccurrencesPure('a = 1;', 'xyz')).toEqual([]);
  });
});

describe('buildSkipMask', () => {
  it('marks string-literal chars as skipped', () => {
    const m = buildSkipMask("a = 'hello'; b = 1;");
    expect(m[0]).toBe(false);
    expect(m[4]).toBe(true);
    expect(m[5]).toBe(true);
    expect(m[10]).toBe(true);
    expect(m[11]).toBe(false);
  });

  it('marks line-comment chars as skipped', () => {
    const m = buildSkipMask('a = 1; # rest comment');
    expect(m[0]).toBe(false);
    expect(m[7]).toBe(true);
    expect(m[20]).toBe(true);
  });
});

describe('escapeRegex', () => {
  it('escapes regex meta-chars', () => {
    expect(escapeRegex('a.b')).toBe('a\\.b');
    expect(escapeRegex('a+b')).toBe('a\\+b');
  });
});

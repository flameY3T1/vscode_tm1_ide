import { describe, it, expect } from 'vitest';
import { matchesPattern, matchesLayer } from '../webviewClient/dimensionBrowser/filterPredicate';

/**
 * The expectations do NOT come from intuition, but from a measurement
 * on 11.8 (spec block F, dimension `aa`). Whoever changes something here must
 * repeat the measurement — not reason about what would be "logical".
 */
describe('matchesPattern matches TM1FILTERBYPATTERN', () => {
  it('without wildcards it is a full comparison, not a substring', () => {
    expect(matchesPattern('a', 'a')).toBe(true);
    // `sum` contains `u`, but is not matched by TM1.
    expect(matchesPattern('sum', 'u')).toBe(false);
    // `x` matches neither `xx` nor `xxx`.
    expect(matchesPattern('xx', 'x')).toBe(false);
    expect(matchesPattern('xxx', 'x')).toBe(false);
  });

  it('compares case-insensitively', () => {
    expect(matchesPattern('a', 'A')).toBe(true);
    expect(matchesPattern('sum', 'SUM')).toBe(true);
    expect(matchesPattern('sum', '*U*')).toBe(true);
  });

  it('`*` stands for any sequence, including the empty one', () => {
    expect(matchesPattern('sum', '*u*')).toBe(true);
    expect(matchesPattern('sum', '*um')).toBe(true);
    expect(matchesPattern('sum', 's*m')).toBe(true);
    expect(matchesPattern('sum', '***')).toBe(true);
    expect(matchesPattern('xxx', '*x')).toBe(true);
  });

  it('is anchored — the decisive difference from _compileWildcard', () => {
    // Unanchored, `sum` would be a hit. TM1 says: no (measured).
    expect(matchesPattern('sum', 'um*')).toBe(false);
    expect(matchesPattern('sum', 'um')).toBe(false);
  });

  it('`?` stands for exactly one character', () => {
    expect(matchesPattern('a', '?')).toBe(true);
    expect(matchesPattern('xx', '?')).toBe(false);
    expect(matchesPattern('xx', '??')).toBe(true);
    expect(matchesPattern('sum', '?um')).toBe(true);
    expect(matchesPattern('sum', 's??')).toBe(true);
  });

  it('the empty pattern matches nothing — not everything', () => {
    expect(matchesPattern('a', '')).toBe(false);
    expect(matchesPattern('', '')).toBe(false);
  });

  it('all other special characters are literal', () => {
    // Square brackets are NOT a character class (measured: `[a]` matches nothing).
    expect(matchesPattern('a', '[a]')).toBe(false);
    expect(matchesPattern('[a]', '[a]')).toBe(true);
    expect(matchesPattern('a.b', 'a.b')).toBe(true);
    // The dot is literal, so it does not match an arbitrary character.
    expect(matchesPattern('axb', 'a.b')).toBe(false);
    expect(matchesPattern('a+b', 'a+b')).toBe(true);
    expect(matchesPattern('a$b', 'a$b')).toBe(true);
  });
});

describe('matchesLayer', () => {
  const kand = (name: string, type: 'N' | 'C' | 'S', level: number) => ({ name, type, level });

  it('the pattern layer asks only for the name', () => {
    expect(matchesLayer(kand('sum', 'C', 1), { kind: 'pattern', pattern: '*u*' })).toBe(true);
    expect(matchesLayer(kand('a', 'N', 0), { kind: 'pattern', pattern: '*u*' })).toBe(false);
  });

  it('the type layer matches every named type (OR, not AND)', () => {
    const nurNC: import('../webviewClient/dimensionBrowser/filterPredicate').FilterLayer =
      { kind: 'type', types: ['N', 'C'] };
    expect(matchesLayer(kand('a', 'N', 0), nurNC)).toBe(true);
    expect(matchesLayer(kand('sum', 'C', 1), nurNC)).toBe(true);
    expect(matchesLayer(kand('txt', 'S', 0), nurNC)).toBe(false);
  });

  it('an empty type list matches nothing — it is not the absence of the layer', () => {
    // Whoever does not want a layer does not create one. A layer without a type is a
    // programming error and should visibly come up empty, not silently let everything through.
    expect(matchesLayer(kand('a', 'N', 0), { kind: 'type', types: [] })).toBe(false);
  });

  it('the level layer compares for equality', () => {
    expect(matchesLayer(kand('a', 'N', 0), { kind: 'level', levels: [0] })).toBe(true);
    expect(matchesLayer(kand('sum', 'C', 1), { kind: 'level', levels: [0] })).toBe(false);
  });
});

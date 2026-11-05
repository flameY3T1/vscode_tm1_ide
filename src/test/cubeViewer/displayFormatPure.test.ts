import { describe, it, expect } from 'vitest';
import {
  resolveDisplayFormat, withDisplayFormat, sanitizeDisplayFormats, hasDisplayFormats, type DisplayFormats,
} from '../../cubeViewer/displayFormatPure';

// Priority as measured for the element attribute `Format` on 11.8 (2026-09-27):
// columns before rows before titles, innermost dimension of a tuple first.
const f: DisplayFormats = {
  A: { a1: 'fmtA' },
  B: { b1: 'fmtB' },
  C: { c1: 'fmtC' },
};
const ctx = (colDims: string[], colTuple: string[], rowDims: string[], rowTuple: string[], titles: Record<string, string> = {}) =>
  ({ colDims, colTuple, rowDims, rowTuple, titles });

describe('resolveDisplayFormat', () => {
  it('column beats row', () => {
    expect(resolveDisplayFormat(f, ctx(['B'], ['b1'], ['A'], ['a1']))).toBe('fmtB');
    expect(resolveDisplayFormat(f, ctx(['A'], ['a1'], ['B'], ['b1']))).toBe('fmtA');
  });
  it('row beats title', () => {
    expect(resolveDisplayFormat(f, ctx(['B'], ['b2'], ['A'], ['a1'], { C: 'c1' }))).toBe('fmtA');
    expect(resolveDisplayFormat(f, ctx(['B'], ['b2'], ['A'], ['a2'], { C: 'c1' }))).toBe('fmtC');
  });
  it('innermost dimension of a tuple wins', () => {
    expect(resolveDisplayFormat(f, ctx(['A', 'B'], ['a1', 'b1'], [], []))).toBe('fmtB');
    expect(resolveDisplayFormat(f, ctx(['B', 'A'], ['b1', 'a1'], [], []))).toBe('fmtA');
    expect(resolveDisplayFormat(f, ctx(['A', 'B'], ['a1', 'b2'], [], []))).toBe('fmtA');
  });
  it('nothing set → undefined', () => {
    expect(resolveDisplayFormat({}, ctx(['A'], ['a1'], [], []))).toBeUndefined();
  });
});

describe('withDisplayFormat / sanitize', () => {
  it('sets and clears; an empty dimension disappears', () => {
    const one = withDisplayFormat({}, 'A', 'a1', '#,##0');
    expect(one).toEqual({ A: { a1: '#,##0' } });
    expect(hasDisplayFormats(one)).toBe(true);
    const none = withDisplayFormat(one, 'A', 'a1', '');
    expect(none).toEqual({});
    expect(hasDisplayFormats(none)).toBe(false);
  });
  it('drops malformed restored entries', () => {
    expect(sanitizeDisplayFormats({ A: { a1: '0.0', a2: 3, a3: '' }, B: 'x', C: null })).toEqual({ A: { a1: '0.0' } });
    expect(sanitizeDisplayFormats('nope')).toEqual({});
  });
});

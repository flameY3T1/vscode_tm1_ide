import { describe, it, expect } from 'vitest';
import { normalizeExcludes, compileExcludes, applyExclusions } from '../../tiValueNaming/excludeFilter';

describe('normalizeExcludes', () => {
  it('trims, drops empties, dedupes case-insensitively preserving first spelling', () => {
    expect(normalizeExcludes([' sDim ', 'sdim', '', '  ', 'nX'])).toEqual(['sDim', 'nX']);
  });
});

describe('compileExcludes', () => {
  it('plain entry matches exactly, case-insensitively; not as substring', () => {
    const ex = compileExcludes(['sdim']);
    expect(ex('sdim')).toBe(true);
    expect(ex('lalasdim')).toBe(false);
    expect(ex('sdimname')).toBe(false);
  });
  it('prefix / suffix / contains wildcards', () => {
    expect(compileExcludes(['sdim*'])('sdimname')).toBe(true);
    expect(compileExcludes(['*sdim'])('lalasdim')).toBe(true);
    expect(compileExcludes(['*dim*'])('lalasdimxyz')).toBe(true);
    expect(compileExcludes(['sdim*'])('xsdim')).toBe(false);
  });
  it('handles a pathological glob without catastrophic backtracking (ReDoS guard)', () => {
    // The old regex compiler (`a*a*…*b` -> `^a.*a.*…b$`) backtracks
    // catastrophically here and would freeze the extension host. The linear
    // matcher returns instantly; if this ever hangs, the regex regressed.
    const ex = compileExcludes([('a*').repeat(40) + 'b']);
    expect(ex('a'.repeat(60))).toBe(false);
  });
  it('star still matches a real run in a glob-heavy pattern', () => {
    expect(compileExcludes(['a*b*c'])('axxbyyc')).toBe(true);
    expect(compileExcludes(['a*b*c'])('axxbyy')).toBe(false);
  });

  it('empty / whitespace list never excludes', () => {
    expect(compileExcludes([])('anything')).toBe(false);
    expect(compileExcludes(['  '])('anything')).toBe(false);
  });
  it('escapes regex metacharacters (dot is literal, not any-char)', () => {
    expect(compileExcludes(['s.dim'])('sxdim')).toBe(false);
    expect(compileExcludes(['s.dim'])('s.dim')).toBe(true);
  });
});

describe('applyExclusions', () => {
  const nm = (name: string, count: number) => ({ name, count, occurrences: [] });
  const g = (valueKey: string, names: ReturnType<typeof nm>[]) =>
    ({ valueKey, valueSample: valueKey, canonicalSuggestion: names[0].name, names });

  it('removes excluded names and drops groups left with < 2 names', () => {
    const groups = [g('v', [nm('sDim', 5), nm('sDimension', 2)])] as any;
    const { groups: out } = applyExclusions(groups, [], compileExcludes(['sdimension']));
    expect(out).toEqual([]);
  });
  it('recomputes canonicalSuggestion to the top remaining name', () => {
    const groups = [g('v', [nm('sTop', 9), nm('sMid', 4), nm('sLow', 1)])] as any;
    const { groups: out } = applyExclusions(groups, [], compileExcludes(['sTop']));
    expect(out).toHaveLength(1);
    expect(out[0].names.map((n: any) => n.name)).toEqual(['sMid', 'sLow']);
    expect(out[0].canonicalSuggestion).toBe('sMid');
  });
  it('drops multi-value vars whose varLc matches', () => {
    const mv = [
      { process: 'P', varName: 'sDim', varLc: 'sdim', defs: [] },
      { process: 'P', varName: 'sKeep', varLc: 'skeep', defs: [] },
    ] as any;
    const { multiValue: out } = applyExclusions([], mv, compileExcludes(['sdim']));
    expect(out.map((m: any) => m.varName)).toEqual(['sKeep']);
  });
});

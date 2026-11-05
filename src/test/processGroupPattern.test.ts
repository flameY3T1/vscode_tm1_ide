import { describe, it, expect } from 'vitest';
import {
  compileProcessGroupPattern,
  extractPatternKey,
} from '../providers/processGroupPatternPure';
import {
  groupProcesses,
  groupProcessesByPattern,
  isProcessGroupingMode,
} from '../providers/processGroupingPure';
import { resolveProcessGroupConfig } from '../providers/tm1TreeDataProviderPure';

function keyOf(name: string, pattern: string, anchor: 'start' | 'end'): string | null {
  const c = compileProcessGroupPattern(pattern, anchor);
  if (!c.ok) { throw new Error(`pattern did not compile: ${c.code}`); }
  return extractPatternKey(name, c.regex);
}

describe('compileProcessGroupPattern', () => {
  it('treats everything outside braces as literal — including #', () => {
    expect(keyOf('####_Load_01', '####_', 'start')).toBe('####_');
    expect(keyOf('Uebersicht####', '####', 'end')).toBe('####');
    // `#` must not act as a digit wildcard
    expect(keyOf('0000_Load', '####_', 'start')).toBeNull();
  });

  it('escapes regex metacharacters in literal parts', () => {
    expect(keyOf('a.b_01', 'a.b_', 'start')).toBe('a.b_');
    expect(keyOf('axb_01', 'a.b_', 'start')).toBeNull();
    expect(keyOf('p(1)_x', 'p(1)_', 'start')).toBe('p(1)_');
  });

  it('{n} matches one or more digits', () => {
    expect(keyOf('s001_kopieren', 's{n}_', 'start')).toBe('s001_');
    expect(keyOf('s7_kopieren', 's{n}_', 'start')).toBe('s7_');
    expect(keyOf('sxx_kopieren', 's{n}_', 'start')).toBeNull();
  });

  it('{n:3} matches exactly three digits', () => {
    expect(keyOf('s001_x', 's{n:3}_', 'start')).toBe('s001_');
    expect(keyOf('s01_x', 's{n:3}_', 'start')).toBeNull();
    expect(keyOf('s0001_x', 's{n:3}_', 'start')).toBeNull();
  });

  it('{a} matches letters and digits, {*} anything', () => {
    expect(keyOf('AB12_x', '{a}_', 'start')).toBe('AB12_');
    expect(keyOf('_x', '{a}_', 'start')).toBeNull();
    expect(keyOf('a b_01', '{*}_', 'start')).toBe('a b_');
  });

  it('{{ is a literal brace', () => {
    expect(keyOf('{grp}_x', '{{grp}_', 'start')).toBe('{grp}_');
  });

  it('anchors at the end for postfix patterns', () => {
    expect(keyOf('Laden_s001', '_s{n}', 'end')).toBe('_s001');
    expect(keyOf('s001_Laden', '_s{n}', 'end')).toBeNull();
    expect(keyOf('ABC_010', '_{n:3}', 'end')).toBe('_010');
  });

  it('reports errors instead of throwing', () => {
    expect(compileProcessGroupPattern('s{n_', 'start')).toEqual({ ok: false, code: 'unclosed' });
    expect(compileProcessGroupPattern('s{}_', 'start')).toEqual({ ok: false, code: 'empty' });
    expect(compileProcessGroupPattern('s{z}_', 'start'))
      .toEqual({ ok: false, code: 'unknownPlaceholder', arg: 'z' });
    expect(compileProcessGroupPattern('s{*:2}_', 'start'))
      .toEqual({ ok: false, code: 'unknownPlaceholder', arg: '*:2' });
  });
});

describe('groupProcessesByPattern', () => {
  const names = [
    's001_Laden_01', 's001_Pruefen_02',
    's002_Laden_01',
    'Hilfsprozess',
  ];

  it('groups a number range by the matched text', () => {
    const groups = groupProcessesByPattern(names, 's{n}_', 'start');
    expect(groups.map(g => g.marker)).toEqual(['s001_', 's002_', null]);
    expect(groups[0].children).toEqual(['s001_Laden_01', 's001_Pruefen_02']);
    expect(groups[1].children).toEqual(['s002_Laden_01']);
    expect(groups[2].children).toEqual(['Hilfsprozess']);
  });

  it('groups by a postfix pattern', () => {
    const post = ['Laden_s001', 'Kopieren_s001', 'Laden_s002', 'Rest'];
    const groups = groupProcessesByPattern(post, '_s{n}', 'end');
    expect(groups.map(g => g.marker)).toEqual(['_s001', '_s002', null]);
    expect(groups[0].children).toEqual(['Kopieren_s001', 'Laden_s001']);
  });

  it('does not include the group key as a child', () => {
    const groups = groupProcessesByPattern(names, 's{n}_', 'start');
    expect(groups[0].children).not.toContain('s001_');
  });

  it('degrades to a single ungrouped bucket for empty or invalid patterns', () => {
    for (const p of ['', 's{n_']) {
      const groups = groupProcessesByPattern(names, p, 'start');
      expect(groups).toHaveLength(1);
      expect(groups[0].marker).toBeNull();
      expect(groups[0].children).toHaveLength(names.length);
    }
  });

  it('returns [] for an empty name list', () => {
    expect(groupProcessesByPattern([], 's{n}_', 'start')).toEqual([]);
  });
});

describe('groupProcesses dispatch', () => {
  const names = ['s001_a', 's002_b', 'zzz#####', 'yyy'];

  it('routes pattern modes to the pattern grouper', () => {
    expect(groupProcesses(names, 's{n}_', 'patternPrefix').map(g => g.marker))
      .toEqual(['s001_', 's002_', null]);
    expect(groupProcesses(names, '_{a}', 'patternSuffix').map(g => g.marker))
      .toEqual(['_a', '_b', null]);
  });

  it('keeps the literal marker behaviour for suffix/prefix', () => {
    // marker process opens the bucket and stays a child of it
    const groups = groupProcesses(names, '#####', 'suffix');
    const marked = groups.find(g => g.marker === 'zzz#####');
    expect(marked?.children).toContain('zzz#####');
  });
});

describe('resolveProcessGroupConfig with pattern modes', () => {
  it('keeps a stored pattern mode and falls back for junk', () => {
    const tok = { s1: 's{n}_' };
    expect(resolveProcessGroupConfig('s1', tok, { s1: 'patternPrefix' }, 'suffix'))
      .toEqual({ token: 's{n}_', mode: 'patternPrefix' });
    expect(resolveProcessGroupConfig('s1', tok, { s1: 'patternSuffix' }, 'suffix').mode)
      .toBe('patternSuffix');
    expect(resolveProcessGroupConfig('s1', tok, { s1: 'nonsense' }, 'suffix').mode)
      .toBe('suffix');
  });
});

describe('isProcessGroupingMode', () => {
  it('accepts the four modes and rejects anything else', () => {
    for (const m of ['suffix', 'prefix', 'patternSuffix', 'patternPrefix']) {
      expect(isProcessGroupingMode(m)).toBe(true);
    }
    expect(isProcessGroupingMode('pattern')).toBe(false);
    expect(isProcessGroupingMode('')).toBe(false);
  });
});

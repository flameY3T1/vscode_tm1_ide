import { describe, it, expect } from 'vitest';
import { qualifyElements, type CubeIndex } from '../../elementQualifier/qualifyElements';

function makeIndex(dimOrder: string[], map: Record<string, string[]>): CubeIndex {
  const elemToDims = new Map<string, string[]>();
  for (const [elem, dims] of Object.entries(map)) {
    elemToDims.set(elem.toLowerCase(), dims);
  }
  return { cube: 'TestCube', dimOrder, elemToDims };
}

describe('qualifyElements — basic', () => {
  it('returns text unchanged when there are no brackets', () => {
    const idx = makeIndex(['D1'], { Elem: ['D1'] });
    const out = qualifyElements(`a = b * c;`, idx);
    expect(out.text).toBe(`a = b * c;`);
    expect(out.warnings).toEqual([]);
  });

  it('qualifies a single bare element', () => {
    const idx = makeIndex(['Account', 'Period'], { Bestellerentgelt: ['Account'] });
    const out = qualifyElements(`['Bestellerentgelt'] = 1;`, idx);
    expect(out.text).toBe(`['Account':'Bestellerentgelt'] = 1;`);
    expect(out.warnings).toEqual([]);
  });

  it('resolves whitespace-insensitively (index key has no spaces)', () => {
    const idx = makeIndex(['Period'], { jan2024: ['Period'] });
    const out = qualifyElements(`['Jan 2024'] = 1;`, idx);
    expect(out.text).toBe(`['Period':'Jan 2024'] = 1;`);
    expect(out.warnings).toEqual([]);
  });

  it('preserves already-qualified entries', () => {
    const idx = makeIndex(['Account', 'Period'], { X: ['Account'] });
    const out = qualifyElements(`['Account':'X'] = 1;`, idx);
    expect(out.text).toBe(`['Account':'X'] = 1;`);
    expect(out.warnings).toEqual([]);
  });

  it('preserves !vars', () => {
    const idx = makeIndex(['Account'], { X: ['Account'] });
    const out = qualifyElements(`['Account':'X', !period] = 1;`, idx);
    expect(out.text).toBe(`['Account':'X', !period] = 1;`);
    expect(out.warnings).toEqual([]);
  });

  it('qualifies and reorders multi-bare entries by cube dim order', () => {
    const idx = makeIndex(['Day', 'Account'], {
      Ist_Zkm: ['Account'],
      Sa: ['Day'],
    });
    const out = qualifyElements(`['Ist_Zkm', 'Sa'] = 1;`, idx);
    expect(out.text).toBe(`['Day':'Sa', 'Account':'Ist_Zkm'] = 1;`);
    expect(out.warnings).toEqual([]);
  });

  it('reorders mixed bare + qualified entries by cube dim order', () => {
    const idx = makeIndex(['D1', 'D2', 'D3'], {
      Bare1: ['D1'],
    });
    const out = qualifyElements(`['D2':'X', 'Bare1', 'D3':'Y'] = 1;`, idx);
    expect(out.text).toBe(`['D1':'Bare1', 'D2':'X', 'D3':'Y'] = 1;`);
  });
});

describe('qualifyElements — sets', () => {
  it('qualifies a bare set when all members share a dim', () => {
    const idx = makeIndex(['Account'], { A: ['Account'], B: ['Account'] });
    const out = qualifyElements(`[{'A','B'}] = 1;`, idx);
    expect(out.text).toBe(`['Account':{'A', 'B'}] = 1;`);
    expect(out.warnings).toEqual([]);
  });

  it('warns and leaves bare set when members are in different dims', () => {
    const idx = makeIndex(['D1', 'D2'], { A: ['D1'], B: ['D2'] });
    const out = qualifyElements(`[{'A','B'}] = 1;`, idx);
    expect(out.text).toBe(`[{'A','B'}] = 1;`);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].reason).toBe('set-mixed-dims');
  });

  it('warns when a set member is unknown', () => {
    const idx = makeIndex(['D1'], { A: ['D1'] });
    const out = qualifyElements(`[{'A','Missing'}] = 1;`, idx);
    expect(out.warnings.some(w => w.reason === 'set-member-not-found')).toBe(true);
  });
});

describe('qualifyElements — same-dim merge (dim may appear only once)', () => {
  it('merges a bare element into an existing dim as a set', () => {
    const idx = makeIndex(['Measure_Capacity', 'Time_Month'], {
      AvailableDays: ['Measure_Capacity'],
      '2026_01': ['Time_Month'],
      '2026_02': ['Time_Month'],
    });
    const out = qualifyElements(
      `['Measure_Capacity':'AvailableDays', 'Time_Month':'2026_01', '2026_02'] = 1;`,
      idx,
    );
    expect(out.text).toBe(
      `['Measure_Capacity':'AvailableDays', 'Time_Month':{'2026_01', '2026_02'}] = 1;`,
    );
    expect(out.warnings).toEqual([]);
  });

  it('merges two already-qualified entries of the same dim into one set', () => {
    const idx = makeIndex(['Time_Month'], { '2026_01': ['Time_Month'], '2026_02': ['Time_Month'] });
    const out = qualifyElements(`['Time_Month':'2026_01', 'Time_Month':'2026_02'] = 1;`, idx);
    expect(out.text).toBe(`['Time_Month':{'2026_01', '2026_02'}] = 1;`);
  });

  it('merges a bare element across a line break into the existing dim set', () => {
    const idx = makeIndex(['Measure_Capacity', 'Time_Month'], {
      AvailableDays: ['Measure_Capacity'],
      '2026_01': ['Time_Month'],
      '2026_02': ['Time_Month'],
    });
    const code = `['Measure_Capacity':'AvailableDays',\n'Time_Month':'2026_01', '2026_02'] = N: 1;`;
    const out = qualifyElements(code, idx);
    expect(out.text).toBe(
      `['Measure_Capacity':'AvailableDays', 'Time_Month':{'2026_01', '2026_02'}] = N: 1;`,
    );
  });
});

describe('qualifyElements — warnings', () => {
  it('warns when an element is not found in any dim', () => {
    const idx = makeIndex(['D1'], {});
    const out = qualifyElements(`['Unknown'] = 1;`, idx);
    expect(out.text).toBe(`['Unknown'] = 1;`);
    expect(out.warnings).toEqual([
      { line: 1, entry: `'Unknown'`, reason: 'not-found' },
    ]);
  });

  it('warns when an element is in multiple dims (ambiguous)', () => {
    const idx = makeIndex(['D1', 'D2'], { Common: ['D1', 'D2'] });
    const out = qualifyElements(`['Common'] = 1;`, idx);
    expect(out.text).toBe(`['Common'] = 1;`);
    expect(out.warnings).toEqual([
      { line: 1, entry: `'Common'`, reason: 'ambiguous', detail: 'D1, D2' },
    ]);
  });

  it('reports correct line numbers for warnings on later lines', () => {
    const idx = makeIndex(['D1'], {});
    const text = `# header\n# header2\n['Missing'] = 1;`;
    const out = qualifyElements(text, idx);
    expect(out.warnings[0].line).toBe(3);
  });
});

describe('qualifyElements — integration with rule structure', () => {
  it('handles N: prefix on RHS without touching it', () => {
    const idx = makeIndex(['Account'], { Bestellerentgelt: ['Account'] });
    const out = qualifyElements(
      `['Bestellerentgelt'] = N: DB('Cube', !x, 'literal');`,
      idx,
    );
    expect(out.text).toBe(
      `['Account':'Bestellerentgelt'] = N: DB('Cube', !x, 'literal');`,
    );
  });

  it('handles multiple bracket blocks on different lines', () => {
    const idx = makeIndex(['D1'], { A: ['D1'], B: ['D1'] });
    const out = qualifyElements(`['A'] = ['B'];`, idx);
    expect(out.text).toBe(`['D1':'A'] = ['D1':'B'];`);
  });

  it('does not touch DB() args (they are not in [...] blocks)', () => {
    const idx = makeIndex(['Account'], { Bestellerentgelt: ['Account'] });
    const original = `['Bestellerentgelt'] = DB('OtherCube', !v, 'lit');`;
    const out = qualifyElements(original, idx);
    expect(out.text).toBe(`['Account':'Bestellerentgelt'] = DB('OtherCube', !v, 'lit');`);
  });

  it('does not mutate when nothing is bare', () => {
    const idx = makeIndex(['D1'], { X: ['D1'] });
    const original = `['D1':'X'] = 1;`;
    const out = qualifyElements(original, idx);
    expect(out.text).toBe(original);
  });
});

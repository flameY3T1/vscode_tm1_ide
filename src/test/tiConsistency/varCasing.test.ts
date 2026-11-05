import { describe, it, expect } from 'vitest';
import { varCasingRule, paramCasingRule, datasourceCasingRule } from '../../tiConsistency/rules/varCasing';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(
  prolog: string,
  params: ConsistencyProcess['params'] = [],
  datasourceVars: ConsistencyProcess['datasourceVars'] = [],
): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text: prolog }], params, datasourceVars, rawParams: [], rawVariables: [] };
}

describe('varCasingRule.scan (locals only)', () => {
  it('emits findings for each local var spelling with occurrences', () => {
    const f = varCasingRule.scan(proc('sDim = 1;\nnX = SDIM;'));
    const byKey = f.filter(x => x.key === 'sdim');
    expect(byKey.map(x => x.spelling).sort()).toEqual(['SDIM', 'sDim']);
    expect(byKey.every(x => x.kind === 'local')).toBe(true);
    expect(byKey[0].occurrences[0]).toMatchObject({ process: 'P', unit: 'prolog' });
  });
  it('does NOT report a declared parameter (owned by paramCasingRule)', () => {
    const f = varCasingRule.scan(proc('nX = pMonth;', [{ name: 'pMonth', type: 'String' }]));
    expect(f.find(x => x.key === 'pmonth')).toBeUndefined();
  });
  it('local rule does not touch declarations', () => {
    expect(varCasingRule.touchesDeclarations).toBe(false);
    expect(varCasingRule.minVariantsToReport).toBe(2);
  });
  it('does not treat a function-named identifier as a var-casing finding', () => {
    // `Round` collides with the TI function ROUND; occurrencesOf is syntax-blind,
    // so without the reserved-name guard the ROUND(...) call would pollute a
    // casing group and surface a "function" that Function Casing never reports.
    const f = varCasingRule.scan(proc('Round = 1;\nnX = ROUND(Round, 0);'));
    expect(f.find(x => x.key === 'round')).toBeUndefined();
  });
  it('does not treat a TI SYSTEM datasource-config var as a var-casing finding', () => {
    // DatasourceASCIIThousandSeparator is a TI SYSTEM pseudo-var (Prolog datasource
    // config) — renaming it breaks the process. Must never surface as a casing finding,
    // even when referenced with differing casing elsewhere in the process.
    const f = varCasingRule.scan(proc("DatasourceASCIIThousandSeparator = ',';\nnX = DATASOURCEASCIITHOUSANDSEPARATOR;"));
    expect(f.find(x => x.key === 'datasourceasciithousandseparator')).toBeUndefined();
  });
});

describe('paramCasingRule.scan', () => {
  it('reports a parameter used with differing casing, kind=param', () => {
    const f = paramCasingRule.scan(proc('nX = pMonth + PMONTH;', [{ name: 'pMonth', type: 'String' }]));
    const byKey = f.filter(x => x.key === 'pmonth');
    expect(byKey.map(x => x.spelling).sort()).toEqual(['PMONTH', 'pMonth']);
    expect(byKey.every(x => x.kind === 'param')).toBe(true);
  });
  it('touches declarations (patches Parameters on apply)', () => {
    expect(paramCasingRule.touchesDeclarations).toBe(true);
  });
  it('excludes a parameter whose name is a reserved TI function', () => {
    const f = paramCasingRule.scan(proc('nX = ROUND;', [{ name: 'ROUND', type: 'Numeric' }]));
    expect(f.find(x => x.key === 'round')).toBeUndefined();
  });
});

describe('datasourceCasingRule.scan', () => {
  it('reports a datasource variable used with differing casing, kind=datasource', () => {
    const f = datasourceCasingRule.scan(proc('nX = vSrc + VSRC;', [], [{ name: 'vSrc', type: 'String' }]));
    const byKey = f.filter(x => x.key === 'vsrc');
    expect(byKey.map(x => x.spelling).sort()).toEqual(['VSRC', 'vSrc']);
    expect(byKey.every(x => x.kind === 'datasource')).toBe(true);
  });
  it('touches declarations (patches Variables on apply)', () => {
    expect(datasourceCasingRule.touchesDeclarations).toBe(true);
  });
});

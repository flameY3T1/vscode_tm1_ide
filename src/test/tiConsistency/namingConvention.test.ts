import { describe, it, expect } from 'vitest';
import {
  variableNamingRule, paramNamingRule, datasourceNamingRule, deriveConventionTarget,
} from '../../tiConsistency/rules/namingConvention';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(
  prolog: string,
  params: ConsistencyProcess['params'] = [],
  datasourceVars: ConsistencyProcess['datasourceVars'] = [],
): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text: prolog }], params, datasourceVars, rawParams: [], rawVariables: [] };
}

describe('deriveConventionTarget', () => {
  it('prepends prefix and capitalizes remainder', () => {
    expect(deriveConventionTarget('Dim', 's')).toBe('sDim');
    expect(deriveConventionTarget('month', 'n')).toBe('nMonth');
  });
});

describe('variableNamingRule.scan', () => {
  it('flags a string local missing the s prefix', () => {
    const rf = variableNamingRule.scan(proc("Dim = 'Region';")).find(x => x.key === 'dim');
    expect(rf?.target).toBe('sDim');
    expect(rf?.kind).toBe('local');
  });
  it('flags a numeric local missing the n prefix', () => {
    const rf = variableNamingRule.scan(proc('Count = 5;')).find(x => x.key === 'count');
    expect(rf?.target).toBe('nCount');
  });
  it('does not flag a correctly-prefixed local', () => {
    expect(variableNamingRule.scan(proc("sDim = 'Region';")).find(x => x.key === 'sdim')).toBeUndefined();
  });
  it('does not report params or datasource vars (owned by their own rules)', () => {
    const f = variableNamingRule.scan(proc('nX = Month;', [{ name: 'Month', type: 'String' }]));
    expect(f.find(x => x.key === 'month')).toBeUndefined();
  });
  it('honors a configured numeric prefix from opts', () => {
    const rf = variableNamingRule.scan(proc('Count = 5;'), { namingPrefixes: { numeric: 'i' } }).find(x => x.key === 'count');
    expect(rf?.target).toBe('iCount');
  });
  it('empty configured prefix disables the rule for that type', () => {
    expect(variableNamingRule.scan(proc('Count = 5;'), { namingPrefixes: { numeric: '' } }).find(x => x.key === 'count')).toBeUndefined();
  });
  it('does not touch declarations', () => {
    expect(variableNamingRule.touchesDeclarations).toBe(false);
  });
  it('does not flag a TI SYSTEM datasource-config var missing the s prefix', () => {
    // DatasourceASCIIThousandSeparator is a TI SYSTEM pseudo-var assigned in the Prolog
    // to configure the datasource — it is NOT a renameable local, even though its bare
    // spelling would otherwise look like an unprefixed string local.
    const rf = variableNamingRule.scan(proc("datasourceASCIIThousandSeparator = ',';")).find(x => x.key === 'datasourceasciithousandseparator');
    expect(rf).toBeUndefined();
  });
});

describe('paramNamingRule.scan', () => {
  it('flags a param missing the p prefix, kind=param', () => {
    // NB: uses 'Region' rather than 'Month' — MONTH is a real TI built-in function
    // (in KNOWN_SIGNATURES), so a param literally named 'Month' is now correctly
    // excluded as reserved (see 'excludes a reserved-name param' below).
    const rf = paramNamingRule.scan(proc('nX = Region;', [{ name: 'Region', type: 'String' }])).find(x => x.key === 'region');
    expect(rf?.target).toBe('pRegion');
    expect(rf?.kind).toBe('param');
  });
  it('honors a configured param prefix', () => {
    const rf = paramNamingRule.scan(proc('nX = 1;', [{ name: 'Region', type: 'String' }]), { namingPrefixes: { param: 'arg' } }).find(x => x.key === 'region');
    expect(rf?.target).toBe('argRegion');
  });
  it('excludes a param whose name collides with a TI built-in function (reserved)', () => {
    const rf = paramNamingRule.scan(proc('nX = Month;', [{ name: 'Month', type: 'String' }])).find(x => x.key === 'month');
    expect(rf).toBeUndefined();
  });
  it('touches declarations', () => {
    expect(paramNamingRule.touchesDeclarations).toBe(true);
  });
});

describe('datasourceNamingRule.scan', () => {
  it('flags a datasource var missing the v prefix, kind=datasource', () => {
    const rf = datasourceNamingRule.scan(proc('nX = 1;', [], [{ name: 'Region', type: 'String' }])).find(x => x.key === 'region');
    expect(rf?.target).toBe('vRegion');
    expect(rf?.kind).toBe('datasource');
  });
  it('touches declarations', () => {
    expect(datasourceNamingRule.touchesDeclarations).toBe(true);
  });
});

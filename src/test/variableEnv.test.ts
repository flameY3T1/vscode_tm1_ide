import { describe, it, expect } from 'vitest';
import { buildProcessEnv, resolveExpression } from '../references/variableEnv';

describe('buildProcessEnv — literals', () => {
  it('classifies single string literal assignment as literal', () => {
    const env = buildProcessEnv("sX = 'UK';", []);
    expect(env.vars.get('sx')).toEqual({ kind: 'literal', value: 'UK' });
  });

  it('classifies single numeric assignment as literal', () => {
    const env = buildProcessEnv('nYear = 2026;', []);
    expect(env.vars.get('nyear')).toEqual({ kind: 'literal', value: '2026' });
  });

  it('classifies single negative numeric as literal', () => {
    const env = buildProcessEnv('nDelta = -15;', []);
    expect(env.vars.get('ndelta')).toEqual({ kind: 'literal', value: '-15' });
  });

  it('preserves original casing of param names when looked up', () => {
    const env = buildProcessEnv('sCopy = pRegion;', ['pRegion']);
    expect(env.vars.get('scopy')).toEqual({ kind: 'param', paramName: 'pRegion' });
  });
});

describe('buildProcessEnv — param refs and chaining', () => {
  it('classifies bare param ref as param', () => {
    const env = buildProcessEnv('sCopy = pRegion;', ['pRegion']);
    expect(env.vars.get('scopy')).toEqual({ kind: 'param', paramName: 'pRegion' });
  });

  it('chains local vars: sA = pRegion; sB = sA; → sB is param ref to pRegion', () => {
    const env = buildProcessEnv("sA = pRegion;\nsB = sA;", ['pRegion']);
    expect(env.vars.get('sb')).toEqual({ kind: 'param', paramName: 'pRegion' });
  });

  it('chains literals: sA = \'UK\'; sB = sA; → sB = \'UK\'', () => {
    const env = buildProcessEnv("sA = 'UK';\nsB = sA;", []);
    expect(env.vars.get('sb')).toEqual({ kind: 'literal', value: 'UK' });
  });
});

describe('buildProcessEnv — dynamic and multi-assignment', () => {
  it('marks function call result as dynamic', () => {
    const env = buildProcessEnv("sX = CellGetS('C', 'a', 'b');", []);
    expect(env.vars.get('sx')).toEqual({ kind: 'dynamic' });
  });

  it('marks string concatenation as dynamic', () => {
    const env = buildProcessEnv("sX = 'prefix_' | sMonth;", []);
    expect(env.vars.get('sx')).toEqual({ kind: 'dynamic' });
  });

  it('multi-assignment with different values → dynamic', () => {
    const env = buildProcessEnv("sX = 'A';\nsX = 'B';", []);
    expect(env.vars.get('sx')).toEqual({ kind: 'dynamic' });
  });

  it('multi-assignment with same literal keeps literal', () => {
    const env = buildProcessEnv("sX = 'A';\nsX = 'A';", []);
    expect(env.vars.get('sx')).toEqual({ kind: 'literal', value: 'A' });
  });

  it('ignores comparison lines (== pattern)', () => {
    const env = buildProcessEnv("IF (nCount == 0);", []);
    expect(env.vars.size).toBe(0);
  });

  it('does not shadow a param with a local var of same name', () => {
    const env = buildProcessEnv("pRegion = 'X';", ['pRegion']);
    expect(env.vars.has('pregion')).toBe(false);
  });
});

describe('resolveExpression', () => {
  const env = buildProcessEnv("sLit = 'UK';", ['pYear']);

  it('literal string', () => {
    expect(resolveExpression("'abc'", env)).toEqual({ kind: 'literal', value: 'abc' });
  });

  it('numeric', () => {
    expect(resolveExpression('42', env)).toEqual({ kind: 'literal', value: '42' });
  });

  it('param ref', () => {
    expect(resolveExpression('pYear', env)).toEqual({ kind: 'param', paramName: 'pYear' });
  });

  it('resolved local var', () => {
    expect(resolveExpression('sLit', env)).toEqual({ kind: 'literal', value: 'UK' });
  });

  it('unknown identifier → dynamic', () => {
    expect(resolveExpression('sUnknown', env)).toEqual({ kind: 'dynamic' });
  });

  it('arithmetic/other expression → dynamic', () => {
    expect(resolveExpression("nA + nB", env)).toEqual({ kind: 'dynamic' });
  });
});

describe('resolveExpression — static string concatenation', () => {
  it('two literals concatenate', () => {
    const env = buildProcessEnv('', []);
    expect(resolveExpression("'a' | 'b'", env)).toEqual({ kind: 'literal', value: 'ab' });
  });

  it('literal | local-literal-var resolves', () => {
    const env = buildProcessEnv("sBase = 'Load_';", []);
    expect(resolveExpression("sBase | 'GGG'", env)).toEqual({ kind: 'literal', value: 'Load_GGG' });
  });

  it('chained assignment through concat: sBase=lit; x = sBase | lit → literal', () => {
    const env = buildProcessEnv("sBase = 'Load_';\nsX = sBase | 'GGG';", []);
    expect(env.vars.get('sx')).toEqual({ kind: 'literal', value: 'Load_GGG' });
  });

  it('concat with a param stays dynamic (runtime value)', () => {
    const env = buildProcessEnv('', ['pYear']);
    expect(resolveExpression("'p_' | pYear", env)).toEqual({ kind: 'dynamic' });
  });

  it('concat with an unknown identifier stays dynamic', () => {
    const env = buildProcessEnv('', []);
    expect(resolveExpression("'prefix_' | sMonth", env)).toEqual({ kind: 'dynamic' });
  });

  it('pipe inside a string literal is not a separator', () => {
    const env = buildProcessEnv('', []);
    expect(resolveExpression("'x|y' | 'z'", env)).toEqual({ kind: 'literal', value: 'x|yz' });
  });

  it('double-pipe || also concatenates', () => {
    const env = buildProcessEnv('', []);
    expect(resolveExpression("'a' || 'b'", env)).toEqual({ kind: 'literal', value: 'ab' });
  });

  it('three-way concat of literals', () => {
    const env = buildProcessEnv("sMid = 'M';", []);
    expect(resolveExpression("'A' | sMid | 'Z'", env)).toEqual({ kind: 'literal', value: 'AMZ' });
  });

  // TI escaped apostrophe `''` → `'`. `'d'''` is the TI string `d'`.
  it('resolves operands containing an escaped apostrophe', () => {
    const env = buildProcessEnv('', []);
    expect(resolveExpression("'d'''", env)).toEqual({ kind: 'literal', value: "d'" });
    expect(resolveExpression("'d''' | 'GG'", env)).toEqual({ kind: 'literal', value: "d'GG" });
    expect(resolveExpression("'O''Brien'", env)).toEqual({ kind: 'literal', value: "O'Brien" });
    expect(resolveExpression("''", env)).toEqual({ kind: 'literal', value: '' });
  });
});

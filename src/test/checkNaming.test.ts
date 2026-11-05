import { describe, it, expect } from 'vitest';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';

function diagsOf(code: string, section: any = 'prolog', options?: any) {
  const result = parseTiCode(code);
  const ast = result.ok ? result.ast : [];
  return lintTiAst(ast, undefined, code, undefined, section, options);
}

describe('var-naming-prefix', () => {
  it('flags a numeric local var without n prefix', () => {
    const d = diagsOf("total = 5;", 'prolog');
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(true);
  });
  it('accepts an n-prefixed numeric var', () => {
    const d = diagsOf("nTotal = 5;", 'prolog');
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(false);
  });
  it('flags a string local var without s prefix', () => {
    const d = diagsOf("name = 'x';", 'prolog');
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(true);
  });
  it('accepts an s-prefixed string var', () => {
    const d = diagsOf("sName = 'x';", 'prolog');
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(false);
  });
  it('skips parameters', () => {
    const d = diagsOf("pVal = 5;", 'prolog', { paramNames: ['pVal'] });
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(false);
  });
});

describe('param-naming-prefix', () => {
  it('flags a param without p prefix', () => {
    const d = diagsOf("x = 1;", 'prolog', { paramNames: ['Region'] });
    expect(d.some(x => x.ruleId === 'param-naming-prefix')).toBe(true);
  });
  it('accepts a p-prefixed param', () => {
    const d = diagsOf("x = 1;", 'prolog', { paramNames: ['pRegion'] });
    expect(d.some(x => x.ruleId === 'param-naming-prefix')).toBe(false);
  });
});

describe('datasource-var-naming', () => {
  it('flags a datasource var without v prefix', () => {
    const d = diagsOf("x = 1;", 'prolog', { datasourceVars: ['Col1'] });
    expect(d.some(x => x.ruleId === 'datasource-var-naming')).toBe(true);
  });
});

describe('configurable naming prefixes', () => {
  it('var: custom numeric prefix', () => {
    const d = diagsOf("iCount = 5;", 'prolog', { namingPrefixes: { numeric: 'i' } });
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(false);
    const d2 = diagsOf("nCount = 5;", 'prolog', { namingPrefixes: { numeric: 'i' } });
    expect(d2.some(x => x.ruleId === 'var-naming-prefix')).toBe(true);
  });
  it('var: empty prefix disables the check', () => {
    const d = diagsOf("total = 5;", 'prolog', { namingPrefixes: { numeric: '' } });
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(false);
  });
  it('param: custom prefix', () => {
    const d = diagsOf("x = 1;", 'prolog', { paramNames: ['arg1'], namingPrefixes: { param: 'arg' } });
    expect(d.some(x => x.ruleId === 'param-naming-prefix')).toBe(false);
  });
  it('datasource: custom prefix', () => {
    const d = diagsOf("x = 1;", 'prolog', { datasourceVars: ['col1'], namingPrefixes: { datasource: 'col' } });
    expect(d.some(x => x.ruleId === 'datasource-var-naming')).toBe(false);
  });
  it('defaults unchanged when no namingPrefixes given', () => {
    const d = diagsOf("total = 5;", 'prolog');
    expect(d.some(x => x.ruleId === 'var-naming-prefix')).toBe(true);
  });
});

describe('missing-docstring', () => {
  it('flags prolog with no leading comment', () => {
    const d = diagsOf("x = 1;", 'prolog');
    expect(d.some(x => x.ruleId === 'missing-docstring')).toBe(true);
  });
  it('accepts prolog starting with a comment', () => {
    const d = diagsOf("# Beschreibung\nx = 1;", 'prolog');
    expect(d.some(x => x.ruleId === 'missing-docstring')).toBe(false);
  });
  it('does not check non-prolog sections', () => {
    const d = diagsOf("x = 1;", 'epilog');
    expect(d.some(x => x.ruleId === 'missing-docstring')).toBe(false);
  });
});

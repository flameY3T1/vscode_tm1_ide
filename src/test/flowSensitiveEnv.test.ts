import { describe, it, expect } from 'vitest';
import { evaluateCondition, buildProcessEnvFlow } from '../references/flowSensitiveEnv';
import type { ProcessEnv, VarBinding } from '../references/variableEnv';

function emptyEnv(extra: Partial<ProcessEnv> = {}): ProcessEnv {
  return {
    paramsLc:       new Set(),
    paramOriginal:  new Map(),
    paramTypes:     new Map(),
    datasourceVars: new Map(),
    vars:           new Map(),
    ...extra,
  };
}

function envWithVars(pairs: Record<string, VarBinding>): ProcessEnv {
  const env = emptyEnv();
  for (const [k, v] of Object.entries(pairs)) {
    env.vars.set(k.toLowerCase(), v);
  }
  return env;
}

describe('evaluateCondition', () => {
  it('literal = literal (numeric true)', () => {
    expect(evaluateCondition("1 = 1", emptyEnv())).toBe('true');
  });
  it('literal = literal (numeric false)', () => {
    expect(evaluateCondition("1 = 2", emptyEnv())).toBe('false');
  });
  it('string @= (true)', () => {
    expect(evaluateCondition("'a' @= 'a'", emptyEnv())).toBe('true');
  });
  it('string @<> (true)', () => {
    expect(evaluateCondition("'a' @<> 'b'", emptyEnv())).toBe('true');
  });
  it('var = literal via env (true)', () => {
    const env = envWithVars({ x: { kind: 'literal', value: '1' } });
    expect(evaluateCondition("x = 1", env)).toBe('true');
  });
  it('var @= string via env (true)', () => {
    const env = envWithVars({ c: { kind: 'literal', value: 'x' } });
    expect(evaluateCondition("c @= 'x'", env)).toBe('true');
  });
  it('var @= string via env (false)', () => {
    const env = envWithVars({ c: { kind: 'literal', value: 'y' } });
    expect(evaluateCondition("c @= 'x'", env)).toBe('false');
  });
  it('unresolved var → unknown', () => {
    expect(evaluateCondition("foo = 1", emptyEnv())).toBe('unknown');
  });
  it('param comparison → unknown (symbolic)', () => {
    const env = emptyEnv();
    env.paramsLc.add('p');
    env.paramOriginal.set('p', 'p');
    expect(evaluateCondition("p = 1", env)).toBe('unknown');
  });
  it('AND short-circuit with false', () => {
    expect(evaluateCondition("1 = 2 & foo = 1", emptyEnv())).toBe('false');
  });
  it('OR short-circuit with true', () => {
    expect(evaluateCondition("1 = 1 | foo = 1", emptyEnv())).toBe('true');
  });
  it('NOT of true', () => {
    expect(evaluateCondition("NOT(1 = 1)", emptyEnv())).toBe('false');
  });
  it('parens respected', () => {
    expect(evaluateCondition("(1 = 1 | 1 = 2) & 1 = 1", emptyEnv())).toBe('true');
  });
  it('function call on RHS → unknown', () => {
    expect(evaluateCondition("x = CellGetN('c', 'a', 'b')", emptyEnv())).toBe('unknown');
  });
  it('truthy check: literal 1 → true', () => {
    expect(evaluateCondition("1", emptyEnv())).toBe('true');
  });
  it('truthy check: literal 0 → false', () => {
    expect(evaluateCondition("0", emptyEnv())).toBe('false');
  });
});

describe('buildProcessEnvFlow', () => {
  it('parses simple top-down code like flow-insensitive version', () => {
    const text = `x = '1';\ny = '2';\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('x')).toMatchObject({ kind: 'literal', value: '1' });
    expect(env.vars.get('y')).toMatchObject({ kind: 'literal', value: '2' });
  });

  it('resolves static string concatenation in an assignment (matches call-graph)', () => {
    const text = `sBase = 'GGG_';\nsProc = sBase | 'Load';\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('sproc')).toMatchObject({ kind: 'literal', value: 'GGG_Load' });
  });

  it('leaves concat with a param operand dynamic', () => {
    const text = `sProc = 'P_' | pParam;\n`;
    const env = buildProcessEnvFlow(text, ['pParam']);
    expect(env.vars.get('sproc')).toEqual({ kind: 'dynamic' });
  });

  it('IF(true) takes only the then-branch', () => {
    const text = `c = 'x';\nIF(c @= 'x');\n  gfh = '1';\nELSE;\n  gfh = '2';\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'literal', value: '1' });
  });

  it('IF(false) takes only the else-branch', () => {
    const text = `c = 'y';\nIF(c @= 'x');\n  gfh = '1';\nELSE;\n  gfh = '2';\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'literal', value: '2' });
  });

  it('IF(unknown) merges branches — same value kept', () => {
    const text = `IF(pParam = 1);\n  gfh = '1';\nELSE;\n  gfh = '1';\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, ['pParam']);
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'literal', value: '1' });
  });

  it('IF(unknown) merges branches — differing values become dynamic', () => {
    const text = `IF(pParam = 1);\n  gfh = '1';\nELSE;\n  gfh = '2';\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, ['pParam']);
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'dynamic' });
  });

  it('IF(unknown) without ELSE: one-sided write becomes dynamic (maybe-assigned)', () => {
    const text = `gfh = '0';\nIF(pParam = 1);\n  gfh = '1';\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, ['pParam']);
    // Either '0' or '1' → dynamic
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'dynamic' });
  });

  it('user-case: nested IFs with all conditions known-true', () => {
    const text = `y = 1;\nc = 'x';\ngfh = 0;\nIF(y = 1);\n  IF(c @= 'x');\n    gfh = 1;\n  ELSE;\n    gfh = 2;\n  ENDIF;\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'literal', value: '1' });
  });

  it('ELSEIF chain: first true wins', () => {
    const text = `x = 2;\nIF(x = 1);\n  r = 'a';\nELSEIF(x = 2);\n  r = 'b';\nELSE;\n  r = 'c';\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('r')).toMatchObject({ kind: 'literal', value: 'b' });
  });

  it('stopAtLine inside the then-branch navigates directly', () => {
    //   line 1: c = 'x';
    //   line 2: IF(c @= 'x');
    //   line 3:   gfh = 1;
    //   line 4:   # cursor here → stopAtLine=4 (0-based exclusive) → show the env BEFORE line 4 (1-based) → so lines 1,2,3 executed
    //   line 5: ENDIF;
    const text = `c = 'x';\nIF(c @= 'x');\n  gfh = 1;\n\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, [], { stopAtLine: 4 });
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'literal', value: '1' });
  });

  it('stopAtLine inside else-branch navigates directly without merge', () => {
    //   line 1: c = 'y';
    //   line 2: IF(c @= 'x');
    //   line 3:   gfh = 1;
    //   line 4: ELSE;
    //   line 5:   gfh = 2;
    //   line 6:   # cursor here → stopAtLine=6 → env after lines 1,2,5
    //   line 7: ENDIF;
    const text = `c = 'y';\nIF(c @= 'x');\n  gfh = 1;\nELSE;\n  gfh = 2;\n\nENDIF;\n`;
    const env = buildProcessEnvFlow(text, [], { stopAtLine: 6 });
    expect(env.vars.get('gfh')).toMatchObject({ kind: 'literal', value: '2' });
  });

  it('parse error → falls back to flow-insensitive (lastAssignmentWins)', () => {
    // Missing ENDIF → parse error → the fallback should still deliver the last assignment
    const text = `x = '1';\nIF(1 = 1);\n  x = '2';\n`;
    const env = buildProcessEnvFlow(text, []);
    expect(env.vars.get('x')).toMatchObject({ kind: 'literal', value: '2' });
  });

  it('param gets its type carried through the env', () => {
    const text = `IF(pMonth @= '01');\n  sOut = pMonth;\nENDIF;\n`;
    const paramTypes = new Map<string, 'Numeric' | 'String'>([['pmonth', 'String']]);
    const env = buildProcessEnvFlow(text, ['pMonth'], { paramTypes });
    // pMonth vs. '01' → unknown (param is symbolic) → merge; sOut only in then-branch → dynamic
    expect(env.vars.get('sout')).toMatchObject({ kind: 'dynamic' });
  });
});

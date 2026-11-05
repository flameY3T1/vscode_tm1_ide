import { describe, it, expect } from 'vitest';
import { checkProcessReturnLiterals } from '../tiLogicVisualizer/tiLinter/rules/check-process-return-literal';
import type { LintDiagnose } from '../tiLogicVisualizer/lintTypes';

function run(code: string): LintDiagnose[] {
  const out: LintDiagnose[] = [];
  checkProcessReturnLiterals(code, out);
  return out;
}

/**
 * Measured 2026-10-29 (live probe v12ExitSemanticsProbe.js): ProcessExitSeriousError is 11
 * on TM1 11.8 and 12 on PA as a Service 12.6.4; everything from there on is shifted by one.
 * 0, 5, 7, 8, 9 are the same on both.
 */
describe('process-return-code-literal', () => {
  it('flags a variable from ExecuteProcess compared against a shifted code', () => {
    const d = run("nRet = ExecuteProcess('child', 'p', 'x');\nIF(nRet = 11);\nENDIF;");
    expect(d).toHaveLength(1);
    expect(d[0].line).toBe(2);
    expect(d[0].messageArgs).toEqual(['11', 'ProcessExitSeriousError()', 'no ProcessExit code']);
  });

  it('flags the call compared directly, with either operand order', () => {
    expect(run("IF(ExecuteProcess('c', 'p', Trim('x')) <> 12);")).toHaveLength(1);
    expect(run("IF(21 = ExecuteProcess('c'));")).toHaveLength(1);
  });

  it('leaves codes alone that mean the same on both versions', () => {
    expect(run("nRet = ExecuteProcess('c');\nIF(nRet <> 0);\nELSEIF(nRet = 9);\nENDIF;")).toEqual([]);
  });

  it('ignores other variables, assignments, strings and comments', () => {
    expect(run("nRet = ExecuteProcess('c');\nIF(nOther = 11);\nnRet = 11;\n# IF(nRet = 11);\nIF(s @= 'nRet = 11');")).toEqual([]);
  });
});

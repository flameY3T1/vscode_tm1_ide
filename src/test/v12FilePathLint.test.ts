import { describe, it, expect } from 'vitest';
import { checkV12FilePaths } from '../tiLogicVisualizer/tiLinter/rules/check-v12-file-path';
import type { LintDiagnose } from '../tiLogicVisualizer/lintTypes';

/** Runs the rule with V12 mode on and returns the diagnostics. */
function run(code: string, v12Mode = true): LintDiagnose[] {
  const out: LintDiagnose[] = [];
  checkV12FilePaths(code, { v12Mode }, out);
  return out;
}

/**
 * Measured on the v12 test server 2026-08-09, AsciiOutput in the prolog:
 *   'zz.csv'         → CompletedSuccessfully
 *   'C:\temp\zz.csv' → Aborted
 *   '../zz.csv'      → Aborted
 *   '/tmp/zz.csv'    → CompletedSuccessfully
 * The rule flags what aborts and nothing else — the leading slash runs, so it stays quiet.
 */
describe('v12 file path lint', () => {
  it('flags a drive letter and a UNC share', () => {
    // Both abort on v12. hardcoded-path also sees them, but argues portability; the v12
    // message is the stronger statement, so this rule takes the line (see supersede test).
    expect(run("AsciiOutput('C:\\temp\\out.csv', v1);")).toHaveLength(1);
    expect(run("AsciiOutput('\\\\host\\share\\out.csv', v1);")).toHaveLength(1);
  });

  it('flags a parent traversal', () => {
    expect(run("TextOutput('../out.csv', v1);")).toHaveLength(1);
    expect(run("TextOutput('sub/../../out.csv', v1);")).toHaveLength(1);
  });

  it('is silent outside V12 mode — the path is legal on 11.x', () => {
    expect(run("TextOutput('../out.csv', v1);", false)).toEqual([]);
  });

  it('leaves a relative path alone', () => {
    expect(run("AsciiOutput('out.csv', v1);")).toEqual([]);
    expect(run("AsciiOutput('sub/out.csv', v1);")).toEqual([]);
  });

  it('leaves a leading slash alone — it still runs on v12', () => {
    expect(run("AsciiOutput('/tmp/out.csv', v1);")).toEqual([]);
  });

  it('does not mistake a directory named "..something" for a traversal', () => {
    expect(run("AsciiOutput('..hidden/out.csv', v1);")).toEqual([]);
  });

  it('covers every file function IBM restricted', () => {
    for (const fn of ['AsciiDelete', 'AsciiOutput', 'AsciiOutputOpen', 'FileExists',
      'SetOutputEscapeDoubleQuote', 'TextOutput', 'WildcardFileSearch']) {
      expect(run(`${fn}('../x.csv');`), fn).toHaveLength(1);
    }
  });

  it('ignores commented-out code and reports the right line', () => {
    const r = run("v = 1;\n# AsciiOutput('../x.csv', v);\nTextOutput('../y.csv', v);");
    expect(r).toHaveLength(1);
    expect(r[0].line).toBe(3);
  });
});

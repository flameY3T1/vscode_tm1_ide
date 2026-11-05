import { TiStatement } from '../../types';
import { LintDiagnose } from '../../lintTypes';
import { LintOptions } from '../types';
import { collectFunctionCalls, tiTokensMatch } from '../helpers/calls';
import { isNumericLiteral } from '../helpers/expressions';

/**
 * L3 — `cube-logging-not-restored`: `CubeSetLogChanges(<cube>, 0)` without a
 * later `CubeSetLogChanges(<cube>, 1)` in the process → warning on the
 * disable line.
 *
 * - Cube matching: string literal (case-insensitive) or identical variable token.
 * - Only fires when the flag is the literal constant `0`; a non-literal flag
 *   on the disable call keeps the rule silent (cannot be statically decided).
 * - A later call on the same cube with a non-literal flag also counts as a
 *   potential restore (conservative — no false positive).
 * - Cross-section: disable in Prolog + restore in Epilog is the standard
 *   pattern — later sections are searched via `options.futureAsts`.
 */
export function checkCubeLogging(
  ast: TiStatement[],
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  const isLog = (name: string) => name.toLowerCase() === 'cubesetlogchanges';
  const calls = collectFunctionCalls(ast).filter(c => isLog(c.name));
  if (calls.length === 0) { return; }
  const futureCalls = (options?.futureAsts ?? [])
    .flatMap(sectionAst => collectFunctionCalls(sectionAst))
    .filter(c => isLog(c.name));

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const cube = call.args[0]?.trim();
    const flag = call.args[1]?.trim();
    // Only a literal 0 is a definite disable; non-literal flag → rule is silent.
    if (!cube || flag === undefined || !isNumericLiteral(flag) || Number(flag) !== 0) { continue; }

    const later = [...calls.slice(i + 1), ...futureCalls];
    const restored = later.some(r => {
      const rCube = r.args[0]?.trim();
      const rFlag = r.args[1]?.trim();
      if (!rCube || rFlag === undefined || !tiTokensMatch(cube, rCube)) { return false; }
      // Literal 0 again is another disable; literal non-0 OR non-literal → (potential) restore.
      return !(isNumericLiteral(rFlag) && Number(rFlag) === 0);
    });

    if (!restored) {
      diagnostics.push({
        line: call.line,
        severity: 'warning',
        ruleId: 'cube-logging-not-restored',
        messageKey: `CubeSetLogChanges({0}, 0) without a matching restore — logging stays off after the process ends.`,
        messageArgs: [cube],
      });
    }
  }
}

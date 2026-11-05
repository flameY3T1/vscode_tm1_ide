import { TiStatement } from '../../types';
import { LintDiagnose } from '../../lintTypes';
import { LintOptions } from '../types';
import { collectFunctionCalls, tiTokensMatch } from '../helpers/calls';

/**
 * `ascii-output-overwrite`: `ASCIIOutput`/`TextOutput` writes a file that an
 * earlier procedure of the same process already wrote. TM1 keeps an output
 * file open only until the procedure ends; the next procedure that writes to
 * it opens it again and empties it, so the earlier lines (typically a header
 * written in the Prolog) are lost.
 *
 * Live-measured on TM1 11.8 (2026-11-04, `scripts/live/asciiOutputOverwriteProbe.js`):
 * Prolog HEADER + Epilog EPILOG left only EPILOG; Prolog HEADER + Data rows
 * left only the rows; two writes in the same Prolog kept both lines.
 *
 * Matching is by file-name token (`tiTokensMatch`): the same literal, or the
 * same variable name. A file opened with `AsciiOutputOpen` anywhere in the
 * process is skipped, because its opening mode may append.
 */
const WRITERS = new Set(['asciioutput', 'textoutput']);

export function checkAsciiOutputOverwrite(
  ast: TiStatement[],
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  const earlier = (options?.previousAsts ?? []).flatMap(a => collectFunctionCalls(a));
  if (earlier.length === 0) { return; }
  const current = collectFunctionCalls(ast);
  const all = [...earlier, ...current, ...(options?.futureAsts ?? []).flatMap(a => collectFunctionCalls(a))];
  const opened = all.filter(c => c.name.toLowerCase() === 'asciioutputopen' && c.args[0] !== undefined)
    .map(c => c.args[0]);
  const writtenBefore = earlier.filter(c => WRITERS.has(c.name.toLowerCase()) && c.args[0] !== undefined)
    .map(c => c.args[0]);

  const reported: string[] = [];
  for (const call of current) {
    if (!WRITERS.has(call.name.toLowerCase())) { continue; }
    const file = call.args[0];
    if (file === undefined) { continue; }
    if (!writtenBefore.some(f => tiTokensMatch(f, file))) { continue; }
    if (opened.some(f => tiTokensMatch(f, file))) { continue; }
    // One warning per file and procedure: the first write is the one that empties it.
    if (reported.some(f => tiTokensMatch(f, file))) { continue; }
    reported.push(file);
    diagnostics.push({
      line: call.line,
      severity: 'warning',
      ruleId: 'ascii-output-overwrite',
      messageKey: '{0} is already written in an earlier procedure. TM1 empties the file when the next procedure writes to it, so the earlier lines are lost. Write the file from one procedure.',
      messageArgs: [file.trim()],
    });
  }
}

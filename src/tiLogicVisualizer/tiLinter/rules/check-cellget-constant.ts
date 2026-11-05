import { TraverseContext } from '../types';
import { isStringLiteral } from '../helpers/expressions';

/**
 * L8 — `cellget-in-loop-constant`: CellGetN/CellGetS whose arguments are ALL
 * string literals, when (a) inside a WHILE body or (b) in the Data/Metadata
 * section (runs per record) → hint: the value never changes per iteration,
 * cache it in a Prolog variable instead.
 *
 * Called from visitAssignment (via `cellGetInfo`) and from visitFunctionCall
 * (bare call statements). Max. 1 diagnostic per line
 * (ctx.cellGetConstWarnedLines).
 */
export function checkCellGetConstant(
  fnName: string,
  args: readonly string[],
  line: number,
  ctx: TraverseContext,
): void {
  const lower = fnName.toLowerCase();
  if (lower !== 'cellgetn' && lower !== 'cellgets') { return; }

  const inLoop = ctx.whileDepth > 0;
  const perRecordSection = ctx.section === 'data' || ctx.section === 'metadata';
  if (!inLoop && !perRecordSection) { return; }

  if (args.length === 0 || !args.every(a => isStringLiteral(a.trim()))) { return; }

  if (ctx.cellGetConstWarnedLines?.has(line)) { return; }
  (ctx.cellGetConstWarnedLines ??= new Set()).add(line);

  ctx.diagnostics.push({
    line,
    severity: 'hint',
    ruleId: 'cellget-in-loop-constant',
    messageKey: `{0} with exclusively constant arguments — the value does not change per iteration, better cache it in a variable in the Prolog.`,
    messageArgs: [fnName],
  });
}

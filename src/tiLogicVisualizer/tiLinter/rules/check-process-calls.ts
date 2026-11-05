import { TiFunctionCall } from '../../types';
import { TraverseContext } from '../types';
import { isStringLiteral } from '../helpers/expressions';
import { stringLiteralInner } from '../helpers/calls';

/**
 * L5 — `executeprocess-return-ignored` + L7 — `recursive-process-call`
 * for bare ExecuteProcess/RunProcess statements.
 *
 * L5: a function-call STATEMENT node is by construction a bare call (return
 * value neither assigned nor used in a condition/expression — those stay
 * inside expression strings of assignment/if nodes). Only ExecuteProcess is
 * flagged: RunProcess is async, its return value is just an ID.
 *
 * L7: ExecuteProcess/RunProcess with a string-literal first argument equal to
 * the process' own name (case-insensitive). Without `options.processName` the
 * rule is silent.
 */
export function checkProcessCallStatement(stmt: TiFunctionCall, ctx: TraverseContext): void {
  const name = stmt.name.toLowerCase();

  if (name === 'executeprocess') {
    ctx.diagnostics.push({
      line: stmt.line,
      severity: 'hint',
      ruleId: 'executeprocess-return-ignored',
      messageKey: `The return value of ExecuteProcess is ignored — errors in sub-processes go unnoticed (check ProcessExitByQuit etc.).`,
    });
  }

  if (name === 'executeprocess' || name === 'runprocess') {
    const own = ctx.options?.processName;
    const first = stmt.args[0]?.trim();
    if (own && first !== undefined && isStringLiteral(first)
        && stringLiteralInner(first).toLowerCase() === own.toLowerCase()) {
      pushRecursive(stmt.line, ctx);
    }
  }
}

/**
 * L7 inside an assignment RHS: `nRet = ExecuteProcess('<eigenerName>', …)` is
 * the most common recursion form — the call is not a statement node there, so
 * the expression string is scanned directly.
 */
const PROC_CALL_RE = /\b(executeprocess|runprocess)\s*\(\s*'((?:[^']|'')*)'/gi;

export function checkRecursiveCallInExpression(expression: string, line: number, ctx: TraverseContext): void {
  const own = ctx.options?.processName;
  if (!own) { return; }
  PROC_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PROC_CALL_RE.exec(expression)) !== null) {
    if (m[2].replace(/''/g, "'").toLowerCase() === own.toLowerCase()) {
      pushRecursive(line, ctx);
      return;
    }
  }
}

function pushRecursive(line: number, ctx: TraverseContext): void {
  ctx.diagnostics.push({
    line,
    severity: 'warning',
    ruleId: 'recursive-process-call',
    messageKey: `Process calls itself — possible infinite recursion without a termination condition.`,
  });
}

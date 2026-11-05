import { TiStatement, TiWhileBlock } from '../../types';
import { TraverseContext } from '../types';
import { extractIdentifiers } from '../helpers/parse';
import { clearReadsFromExpression, collectAssignedVariables } from '../helpers/reads';
import { checkOperatorTypeMismatch } from './check-operator-type';
import { hasCommentAbove } from '../helpers/conditions';
import { checkUnknownCallsInExpression } from './check-unknown-call-in-expression';

type TraverseFn = (statements: TiStatement[], ctx: TraverseContext, enclosingCondition?: string) => void;

/**
 * Visit a WHILE block. Emits `empty-while`, `endless-loop` and the
 * operator-type-mismatch rules in the condition.
 */
export function visitWhileBlock(stmt: TiWhileBlock, ctx: TraverseContext, traverse: TraverseFn): void {
  const { diagnostics, variableTypes, lastUnreadAssignment } = ctx;

  // Rule 'empty-while': WHILE with empty body
  if (stmt.body.length === 0) {
    diagnostics.push({
      line: stmt.line,
      severity: 'hint',
      ruleId: 'empty-while',
      messageKey: `Empty WHILE block with no statements.`,
    });
  }

  // Rule 'comment-before-while': WHILE should be preceded by a `#` comment (opt-in).
  if (!hasCommentAbove(ctx.sourceLines, stmt.line)) {
    diagnostics.push({
      line: stmt.line,
      severity: 'info',
      ruleId: 'comment-before-while',
      messageKey: `A WHILE condition should be preceded by an explanatory # comment.`,
    });
  }

  clearReadsFromExpression(stmt.condition, lastUnreadAssignment);
  checkUnknownCallsInExpression(stmt.condition, stmt.line, ctx);

  // Rule 'endless-loop': check if any condition variable is modified in the body
  const conditionVars = extractIdentifiers(stmt.condition);
  if (conditionVars.size > 0) {
    const bodyAssignedVars = collectAssignedVariables(stmt.body);
    const anyModified = [...conditionVars].some(v => bodyAssignedVars.has(v));
    if (!anyModified) {
      diagnostics.push({
        line: stmt.line,
        // Warning, not error: the check is a heuristic (a condition such as
        // ElementParent(...) or CellGetN(...) can change through side effects
        // of calls in the body), TM1 compiles the code, and an error would
        // block saving. Matches LINT_RULE_DEFAULTS.
        severity: 'warning',
        ruleId: 'endless-loop',
        messageKey: `Potential endless loop: condition '{0}' — none of the referenced variables are modified in the loop body.`,
        messageArgs: [stmt.condition],
      });
    }
  }

  checkOperatorTypeMismatch(stmt.condition, stmt.line, diagnostics, variableTypes);

  ctx.conditionalDepth++;
  ctx.whileDepth++;
  traverse(stmt.body, ctx, undefined);
  ctx.whileDepth--;
  ctx.conditionalDepth--;
}

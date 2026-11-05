import { TiIfBlock, TiStatement } from '../../types';
import { TraverseContext } from '../types';
import { clearReadsFromExpression } from '../helpers/reads';
import { evaluateConstantCondition, findTm1ErrorCodes, isDebugToggle, hasCommentAbove } from '../helpers/conditions';
import { checkOperatorTypeMismatch } from './check-operator-type';
import { checkUnknownCallsInExpression } from './check-unknown-call-in-expression';

type TraverseFn = (statements: TiStatement[], ctx: TraverseContext, enclosingCondition?: string) => void;

/**
 * Visit an IF/ELSEIF/ELSE block. Emits `empty-if`, `dead-code-condition`,
 * `tm1-error-code`, and the operator-type-mismatch rules in conditions.
 */
export function visitIfBlock(stmt: TiIfBlock, ctx: TraverseContext, traverse: TraverseFn): void {
  const { diagnostics, variableTypes, lastUnreadAssignment } = ctx;

  // Rule 'empty-if': IF with empty thenBody, no elseIfClauses, and empty elseBody
  if (stmt.thenBody.length === 0 && stmt.elseIfClauses.length === 0 && stmt.elseBody.length === 0) {
    diagnostics.push({
      line: stmt.line,
      severity: 'hint',
      ruleId: 'empty-if',
      messageKey: `Empty IF block with no statements.`,
    });
  }

  // Rule 'comment-before-if': IF should be preceded by a `#` comment (opt-in).
  if (!hasCommentAbove(ctx.sourceLines, stmt.line)) {
    diagnostics.push({
      line: stmt.line,
      severity: 'info',
      ruleId: 'comment-before-if',
      messageKey: `An IF condition should be preceded by an explanatory # comment.`,
    });
  }

  clearReadsFromExpression(stmt.condition, lastUnreadAssignment);
  checkOperatorTypeMismatch(stmt.condition, stmt.line, diagnostics, variableTypes);
  checkUnknownCallsInExpression(stmt.condition, stmt.line, ctx);

  // Rule 'dead-code-condition': `1=0` / `0=1` are intentional bedrock debug toggles — skip.
  const deadMain = evaluateConstantCondition(stmt.condition);
  if (deadMain === 'always-false' && !isDebugToggle(stmt.condition)) {
    diagnostics.push({
      line: stmt.line,
      severity: 'warning',
      ruleId: 'dead-code-condition',
      messageKey: `Condition '{0}' is always false — this IF branch is never executed.`,
      messageArgs: [stmt.condition],
    });
  } else if (deadMain === 'always-true' && (stmt.elseIfClauses.length > 0 || stmt.elseBody.length > 0)) {
    diagnostics.push({
      line: stmt.line,
      severity: 'warning',
      ruleId: 'dead-code-condition',
      messageKey: `Condition '{0}' is always true — ELSE/ELSEIF branches are unreachable.`,
      messageArgs: [stmt.condition],
    });
  }

  for (const { code, description } of findTm1ErrorCodes(stmt.condition)) {
    diagnostics.push({
      line: stmt.line,
      severity: 'hint',
      ruleId: 'tm1-error-code',
      messageKey: `{0} = {1}`,
      messageArgs: [code, description],
    });
  }

  // Recurse into then-body — pass condition so nested CellPut guard check can use it
  ctx.conditionalDepth++;
  traverse(stmt.thenBody, ctx, stmt.condition);
  ctx.conditionalDepth--;

  // Recurse into elseif clauses
  for (const clause of stmt.elseIfClauses) {
    clearReadsFromExpression(clause.condition, lastUnreadAssignment);
    // Operator checks in elseif condition — report on the ELSEIF line, not the IF line
    checkOperatorTypeMismatch(clause.condition, clause.line, diagnostics, variableTypes);
    checkUnknownCallsInExpression(clause.condition, clause.line, ctx);
    const deadElseIf = evaluateConstantCondition(clause.condition);
    if (deadElseIf === 'always-false' && !isDebugToggle(clause.condition)) {
      diagnostics.push({
        line: clause.line,
        severity: 'warning',
        ruleId: 'dead-code-condition',
        messageKey: `ELSEIF condition '{0}' is always false — this branch is never executed.`,
        messageArgs: [clause.condition],
      });
    }
    for (const { code, description } of findTm1ErrorCodes(clause.condition)) {
      diagnostics.push({
        line: clause.line,
        severity: 'hint',
        ruleId: 'tm1-error-code',
        messageKey: `{0} = {1}`,
        messageArgs: [code, description],
      });
    }
    ctx.conditionalDepth++;
    traverse(clause.body, ctx, clause.condition);
    ctx.conditionalDepth--;
  }

  // Recurse into else-body (no guard condition to pass from the else branch)
  ctx.conditionalDepth++;
  traverse(stmt.elseBody, ctx, undefined);
  ctx.conditionalDepth--;
}

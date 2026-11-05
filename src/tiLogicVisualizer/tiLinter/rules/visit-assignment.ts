import { TiAssignment } from '../../types';
import { TraverseContext } from '../types';
import { inferExpressionType } from '../helpers/expressions';
import { clearReadsFromExpression } from '../helpers/reads';
import { checkOperatorTypeMismatch } from './check-operator-type';
import { checkUnknownCallsInExpression } from './check-unknown-call-in-expression';
import { checkReadonlyWrite } from './check-security';
import { checkVarNaming } from './check-naming';
import { checkRecursiveCallInExpression } from './check-process-calls';
import { checkCellGetConstant } from './check-cellget-constant';
import { PROLOG_ONLY_ASSIGN } from '../constants';

/**
 * Visit an assignment statement. Emits `type-mismatch-assignment`,
 * `dead-store`, `string-compare-without-at` and `numeric-compare-with-at`
 * diagnostics. Updates `variableTypes`, `lastUnreadAssignment`,
 * `assignedVariables` for downstream rules.
 */
export function visitAssignment(stmt: TiAssignment, ctx: TraverseContext): void {
  // var-naming-prefix — must run BEFORE assignedVariables is mutated (fires on first assignment only)
  checkVarNaming(stmt, ctx);

  const { diagnostics, variableTypes, lastUnreadAssignment, assignedVariables, options } = ctx;
  const varLower = stmt.variable.toLowerCase();

  // Clear reads from the expression (RHS) — variables read here are no longer "unread"
  clearReadsFromExpression(stmt.expression, lastUnreadAssignment);

  // Infer expression type
  const exprType = inferExpressionType(stmt.expression, variableTypes);

  // Track variable type (first assignment wins)
  if (exprType) {
    const existing = variableTypes.get(varLower);
    if (!existing) {
      variableTypes.set(varLower, { type: exprType, firstAssignmentLine: stmt.line });
    } else {
      if (existing.type !== exprType) {
        diagnostics.push({
          line: stmt.line,
          severity: 'error',
          ruleId: 'type-mismatch-assignment',
          messageKey: `Variable '{0}' is of type '{1}', but the assigned value is of type '{2}'.`,
          messageArgs: [stmt.variable, existing.type, exprType],
        });
      }
    }
  }

  // Rule 'dead-store': previous unread assignment for this variable exists
  // and was not the very first assignment (init is never a dead store).
  // Only emit when BOTH the prior and current assignments are at top level (depth 0):
  // reassignments inside conditional branches are intentional guard-default patterns.
  const prevLine = lastUnreadAssignment.get(varLower);
  const firstAssignInfo = assignedVariables.get(varLower);
  const prevDepth = ctx.assignmentDepth.get(varLower) ?? 0;
  if (prevLine !== undefined && firstAssignInfo !== undefined && prevLine !== firstAssignInfo.line
      && !options?.bedrockMode && prevDepth === 0 && ctx.conditionalDepth === 0) {
    diagnostics.push({
      line: prevLine,
      severity: 'hint',
      ruleId: 'dead-store',
      messageKey: `Variable '{0}' is overwritten without being read first.`,
      messageArgs: [stmt.variable],
    });
  }

  // Track for unused-variable analysis
  if (!assignedVariables.has(varLower)) {
    assignedVariables.set(varLower, { line: stmt.line, originalName: stmt.variable });
  }

  // Record this assignment as the last unread assignment for the variable
  lastUnreadAssignment.set(varLower, stmt.line);
  ctx.assignmentDepth.set(varLower, ctx.conditionalDepth);

  // Operator-type checks on RHS expression
  checkOperatorTypeMismatch(stmt.expression, stmt.line, diagnostics, variableTypes);
  checkUnknownCallsInExpression(stmt.expression, stmt.line, ctx);

  // readonly-param-write
  checkReadonlyWrite(stmt, ctx);

  // L7 — recursive-process-call in assignment RHS (nRet = ExecuteProcess('<self>'))
  checkRecursiveCallInExpression(stmt.expression, stmt.line, ctx);

  // L8 — cellget-in-loop-constant: RHS contains CellGetN/S with all-literal args
  if (stmt.cellGetInfo) {
    checkCellGetConstant(stmt.cellGetInfo.fn, stmt.cellGetInfo.params, stmt.line, ctx);
  }

  // 'wrong-section' — Datasource overrides / MinorErrorLogMax only take effect
  // when set in the Prolog (the data source is opened after the Prolog runs).
  if (ctx.section && ctx.section !== 'prolog' && PROLOG_ONLY_ASSIGN.has(varLower)) {
    diagnostics.push({
      line: stmt.line,
      severity: 'warning',
      ruleId: 'wrong-section',
      messageKey: `'{0}' only takes effect in the Prolog — the assignment in the {1} section has no effect.`,
      messageArgs: [stmt.variable, ctx.section],
    });
  }
}

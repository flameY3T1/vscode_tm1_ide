import { TiFunctionCall, TiStatement } from '../../types';
import { KNOWN_SIGNATURES } from '../../tiSignatures';
import { TraverseContext } from '../types';
import { BARE_KEYWORDS, RECORD_LOOP_ONLY, METADATA_UPDATE_FUNCS, DATA_PERF_ONLY, PROLOG_RECOMMENDED } from '../constants';
import { clearReadsFromExpression } from '../helpers/reads';
import { isNumericLiteral, isStringLiteral } from '../helpers/expressions';
import { checkSecurityCall } from './check-security';
import { checkCellPutGuard } from './check-cellput-guard';
import { checkProcessCallStatement } from './check-process-calls';
import { checkCellGetConstant } from './check-cellget-constant';
import { checkObjectName } from './check-object-name';
import { checkArgValue } from './check-arg-value';
import { checkUnknownCallsInExpression } from './check-unknown-call-in-expression';

/**
 * Visit a function-call statement. Emits `wrong-arg-count`, `wrong-param-type`,
 * `unknown-function`, `wrong-section`, `performance-hint`.
 *
 * `enclosingCondition` carries the surrounding IF condition for the
 * CellPut-guard check (`cellput-no-error-handling`).
 */
export function visitFunctionCall(
  stmt: TiFunctionCall,
  indexInBlock: number,
  blockStatements: TiStatement[],
  ctx: TraverseContext,
  enclosingCondition?: string,
): void {
  const { diagnostics, variableTypes, lastUnreadAssignment, section } = ctx;

  // Clear reads from function arguments
  for (const arg of stmt.args) {
    clearReadsFromExpression(arg, lastUnreadAssignment);
  }

  const nameLower = stmt.name.toLowerCase();
  const sig = KNOWN_SIGNATURES.get(nameLower);

  // Rule 'wrong-arg-count': check argument count against known signature
  if (sig) {
    const argCount = stmt.args.length;
    if (argCount < sig.minParams || argCount > sig.maxParams) {
      let expected: string;
      if (sig.minParams === sig.maxParams) {
        expected = `${sig.minParams}`;
      } else if (sig.maxParams === Infinity) {
        expected = `at least ${sig.minParams}`;
      } else {
        expected = `${sig.minParams}–${sig.maxParams}`;
      }
      diagnostics.push({
        line: stmt.line,
        severity: 'error',
        ruleId: 'wrong-arg-count',
        messageKey: `Function '{0}' expects {1} argument(s), but received {2}.`,
        messageArgs: [sig.name, expected, argCount],
      });
    }
  }
  // Rule 'wrong-param-type': check each argument against expected param type.
  // Variadic functions (maxParams === Infinity, e.g. TextOutput/ASCIIOutput whose
  // last param `ValueN:string` repeats) must check EVERY arg — not just the first
  // `params.length` — against that trailing param type, or a numeric passed to a
  // string-typed variadic slot slips through unflagged.
  if (sig) {
    const lastIdx = sig.params.length - 1;
    const variadic = !Number.isFinite(sig.maxParams);
    const paramCount = variadic ? stmt.args.length : Math.min(stmt.args.length, sig.params.length);
    for (let i = 0; i < paramCount; i++) {
      const expectedType = sig.params[Math.min(i, lastIdx)].type;
      if (expectedType === 'any') continue;

      const arg = stmt.args[i].trim();
      let actualType: 'string' | 'numeric' | undefined;

      if (expectedType === 'string') {
        if (isNumericLiteral(arg)) {
          actualType = 'numeric';
        } else if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*$/.test(arg)) {
          const varInfo = variableTypes.get(arg.toLowerCase());
          if (varInfo && varInfo.type === 'numeric') {
            actualType = 'numeric';
          }
        }
      } else if (expectedType === 'numeric') {
        if (isStringLiteral(arg)) {
          actualType = 'string';
        } else if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*$/.test(arg)) {
          const varInfo = variableTypes.get(arg.toLowerCase());
          if (varInfo && varInfo.type === 'string') {
            actualType = 'string';
          }
        }
      }

      if (actualType) {
        diagnostics.push({
          line: stmt.line,
          severity: 'error',
          ruleId: 'wrong-param-type',
          messageKey: `Function '{0}': parameter {1} expects type '{2}', but received '{3}'.`,
          messageArgs: [sig.name, i + 1, expectedType, actualType],
        });
      }
    }
  }
  for (const arg of stmt.args) { checkUnknownCallsInExpression(arg, stmt.line, ctx); }
  // Rule 'unknown-function': function name not in KNOWN_SIGNATURES and not a bare keyword → hint
  // Skip TI control-flow keywords that surface as function-call AST nodes when used
  // in expression form (e.g. ternary `IF(cond, a, b);`).
  if (!sig && !BARE_KEYWORDS.has(nameLower) && nameLower !== 'if' && nameLower !== 'while') {
    diagnostics.push({
      line: stmt.line,
      severity: 'hint',
      ruleId: 'unknown-function',
      messageKey: `Unknown function '{0}'.`,
      messageArgs: [stmt.name],
    });
  }
  // Rule 'wrong-section': functions used in wrong section
  if (section) {
    if (section !== 'metadata' && section !== 'data' && RECORD_LOOP_ONLY.has(nameLower)) {
      diagnostics.push({
        line: stmt.line,
        severity: 'error',
        ruleId: 'wrong-section',
        messageKey: `'{0}' is only allowed in the Metadata or Data section (current section: {1}).`,
        messageArgs: [stmt.name, section],
      });
    }
    if ((section === 'data' || section === 'epilog') && METADATA_UPDATE_FUNCS.has(nameLower)) {
      const messageKey = section === 'data'
        ? `'{0}' in the Data section runs for every record — better placed in Prolog or Metadata.`
        : `'{0}' is a metadata update and only takes effect after the Metadata section — belongs in Prolog/Metadata, not in the Epilog.`;
      diagnostics.push({
        line: stmt.line,
        severity: 'hint',
        ruleId: 'wrong-section',
        messageKey,
        messageArgs: [stmt.name],
      });
    }
    if (section === 'data' && DATA_PERF_ONLY.has(nameLower)) {
      diagnostics.push({
        line: stmt.line,
        severity: 'hint',
        ruleId: 'wrong-section',
        messageKey: `'{0}' in the Data section fires per record — belongs in the Epilog.`,
        messageArgs: [stmt.name],
      });
    }
    // Rule 'performance-hint': function recommended only in a specific section
    if (section && PROLOG_RECOMMENDED.has(nameLower) && section !== 'prolog') {
      const note = sig?.performanceNote;
      const reason = note?.reason ?? `'${stmt.name}' should only be called in the Prolog (one-time initialization).`;
      diagnostics.push({
        line: stmt.line,
        severity: 'hint',
        ruleId: 'performance-hint',
        messageKey: `{0}`,
        messageArgs: [reason],
      });
    }
  }
  // Rule 'invalid-object-name': object-name literal contains a TM1-illegal char.
  checkObjectName(stmt, ctx);

  // Rule 'invalid-arg-value': string-literal args against a param's allowedValues.
  if (sig) { checkArgValue(stmt, sig, ctx); }

  checkSecurityCall(stmt, indexInBlock, blockStatements, ctx);
  checkCellPutGuard(stmt, indexInBlock, blockStatements, ctx, enclosingCondition);
  // L5 executeprocess-return-ignored + L7 recursive-process-call (bare statements)
  checkProcessCallStatement(stmt, ctx);
  // L8 cellget-in-loop-constant (bare CellGetN/S call statement)
  checkCellGetConstant(stmt.name, stmt.args, stmt.line, ctx);
}

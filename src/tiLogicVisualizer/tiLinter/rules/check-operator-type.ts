import { LintDiagnose, VariableTypeMap } from '../../lintTypes';
import { extractOperandLeft, extractOperandRight, maskStringsAndComments } from '../helpers/parse';
import { inferSideType } from '../helpers/expressions';

/**
 * Check a condition or expression string for operator/type mismatches:
 * - String operand on a numeric operator → string-compare-without-at
 * - Numeric operand on an @-operator → numeric-compare-with-at
 *
 * Handles conditions with AND/OR by splitting into sub-conditions.
 */
export function checkOperatorTypeMismatch(
  expression: string,
  line: number,
  diagnostics: LintDiagnose[],
  variableTypes: VariableTypeMap,
): void {
  // Mask strings/comments so operators inside them aren't picked up, but keep
  // column positions so we can still slice operands out of the ORIGINAL expr.
  const masked = maskStringsAndComments(expression);
  // Scan every comparison operator occurrence — not just the first per AND/OR
  // subexpression — so comparisons nested inside IF()/function calls still get
  // a diagnostic (e.g. `x = IF(pParam01@=1, 'x', 'y')`).
  const scanRe = /(@>=|@<=|@<>|@>|@<|@=|(?<!@)>=|(?<!@)<=|(?<!@)<>|(?<!@)>|(?<!@)<|(?<!@)=)/g;

  const reported = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = scanRe.exec(masked)) !== null) {
    const op = m[1];
    const opIdx = m.index;

    const lhs = extractOperandLeft(expression, opIdx);
    const rhs = extractOperandRight(expression, opIdx + op.length);
    const lhsType = inferSideType(lhs, variableTypes);
    const rhsType = inferSideType(rhs, variableTypes);

    if (op.startsWith('@')) {
      if (lhsType === 'numeric' || rhsType === 'numeric') {
        const baseOp = op.substring(1);
        const key = `numeric-compare-with-at:${opIdx}:${op}`;
        if (reported.has(key)) { continue; }
        reported.add(key);
        diagnostics.push({
          line,
          severity: 'error',
          ruleId: 'numeric-compare-with-at',
          messageKey: `Numeric comparison using string operator '{0}' — use '{1}' instead.`,
          messageArgs: [op, baseOp],
        });
      }
    } else {
      if (lhsType === 'string' || rhsType === 'string') {
        const key = `string-compare-without-at:${opIdx}:${op}`;
        if (reported.has(key)) { continue; }
        reported.add(key);
        diagnostics.push({
          line,
          severity: 'warning',
          ruleId: 'string-compare-without-at',
          messageKey: `String comparison using numeric operator '{0}' — use '@{0}' instead.`,
          messageArgs: [op],
        });
      }
    }
  }
}

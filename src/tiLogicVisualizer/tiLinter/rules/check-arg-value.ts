import { TiFunctionCall } from '../../types';
import { TiKnownSignature } from '../../tiSignatures';
import { TraverseContext } from '../types';
import { isStringLiteral } from '../helpers/expressions';

/**
 * Rule 'invalid-arg-value': any signature param carrying allowedValues must,
 * when given a string literal, receive a member of that set (case-insensitive).
 * Variables/expressions are skipped (value unknown at lint time).
 */
export function checkArgValue(
  stmt: TiFunctionCall,
  sig: TiKnownSignature,
  ctx: TraverseContext,
): void {
  for (let i = 0; i < stmt.args.length; i++) {
    const param = sig.params[i];
    if (!param?.allowedValues || param.allowedValues.length === 0) { continue; }
    const raw = stmt.args[i].trim();
    if (!isStringLiteral(raw)) { continue; }
    const value = raw.slice(1, -1).trim();
    const allowedUpper = param.allowedValues.map(v => v.toUpperCase());
    if (!allowedUpper.includes(value.toUpperCase())) {
      ctx.diagnostics.push({
        line: stmt.line,
        severity: 'warning',
        ruleId: 'invalid-arg-value',
        messageKey: `Argument '{0}' for '{1}' is invalid — allowed: {2}.`,
        messageArgs: [value, sig.name, param.allowedValues.join(', ')],
      });
    }
  }
}

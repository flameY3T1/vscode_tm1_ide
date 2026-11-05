import { KNOWN_SIGNATURES } from '../../tiSignatures';
import { TraverseContext } from '../types';
import { BARE_KEYWORDS } from '../constants';
import { stripStringLiterals } from '../helpers/parse';

/** `Name(` — an identifier directly in front of an opening parenthesis. */
const CALL_RE = /(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * `unknown-function` for calls nested in an expression string: assignment RHS,
 * IF/ELSEIF/WHILE conditions and the arguments of a call statement. The parser
 * keeps those as text, so the statement-level check in visit-function-call
 * never sees them (`nX = CubeGetN(...)` went unreported).
 */
export function checkUnknownCallsInExpression(expression: string, line: number, ctx: TraverseContext): void {
  const code = stripStringLiterals(expression);
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(code)) !== null) {
    const lower = m[1].toLowerCase();
    if (KNOWN_SIGNATURES.has(lower) || BARE_KEYWORDS.has(lower) || lower === 'if' || lower === 'while') { continue; }
    ctx.diagnostics.push({
      line,
      severity: 'hint',
      ruleId: 'unknown-function',
      messageKey: `Unknown function '{0}'.`,
      messageArgs: [m[1]],
    });
  }
}

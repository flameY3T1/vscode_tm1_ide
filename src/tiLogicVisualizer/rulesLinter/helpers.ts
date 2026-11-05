/**
 * Stateless line-level helpers.
 *
 * Extracted from `rulesLinter.ts` in Post-H17 #6 split.
 */

import { neutralizeLine } from '../../utils/tiLineText';

export { neutralizeLine };

export function endsSemicolon(trimmed: string): boolean {
  // Neutralize strings BEFORE stripping comments so a `#` or `;` inside a
  // string literal is not mistaken for a comment start / statement terminator.
  return neutralizeLine(trimmed).trimEnd().endsWith(';');
}

export function bracketDepthChange(trimmed: string): number {
  const stripped = neutralizeLine(trimmed);
  let delta = 0;
  for (const ch of stripped) {
    if (ch === '[')      { delta++; }
    else if (ch === ']') { delta--; }
  }
  return delta;
}

export function parenDepthChange(trimmed: string): number {
  const stripped = neutralizeLine(trimmed);
  let delta = 0;
  for (const ch of stripped) {
    if (ch === '(')      { delta++; }
    else if (ch === ')') { delta--; }
  }
  return delta;
}

export function endsWithRuleTypeMarker(trimmed: string): boolean {
  const stripped = neutralizeLine(trimmed);
  if (/[CNS]\s*:\s*$/i.test(stripped)) { return true; }
  if (/(^|[^=])=\s*$/.test(stripped)) { return true; }
  return false;
}

export function endsWithBackslashContinuation(trimmed: string): boolean {
  const stripped = trimmed.replace(/#.*$/, '').replace(/\s+$/, '');
  return stripped.endsWith('\\');
}

export function endsWithContinuingOperator(trimmed: string): boolean {
  const stripped = neutralizeLine(trimmed).replace(/\s+$/, '');
  return /[|+\-*/\\&,]$/.test(stripped);
}

export function startsWithContinuingOperator(trimmed: string): boolean {
  return /^[*/\\+\-|&,]/.test(trimmed);
}

/**
 * True when the line opens with the statement terminator — a `;` that TM1
 * reads as the end of the PREVIOUS statement. Rule authors park it on its own
 * line to comment single statements in and out without touching them.
 */
export function startsWithStatementEnd(trimmed: string): boolean {
  return /^\s*;/.test(trimmed);
}

export function isValidRulesLineHead(trimmed: string): boolean {
  const head = trimmed.replace(/^\s+/, '');
  if (head === '') { return true; }
  if (head.startsWith('[')) { return true; }
  if (/^[CNS]\s*:/i.test(head)) { return true; }
  return false;
}

export function isValidFeedersLineHead(trimmed: string): boolean {
  const head = trimmed.replace(/^\s+/, '');
  if (head === '') { return true; }
  if (head.startsWith('[')) { return true; }
  return /^[A-Za-z_]\w*\s*\(/.test(head);
}

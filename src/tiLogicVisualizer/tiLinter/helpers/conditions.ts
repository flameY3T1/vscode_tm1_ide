import { TiStatement } from '../../types';
import { TM1_CONDITION_CODES } from '../../tm1ErrorCodes';
import { COMPARISON_RE, EARLY_EXIT_FUNCTIONS } from '../constants';
import { isNumericLiteral, isStringLiteral } from './expressions';

/**
 * True if the next non-empty line above `line` (1-based) is a
 * `#` comment. Blank lines are skipped. Without source text (undefined)
 * → true (rule not applicable, no false positive). Nothing above → false.
 */
export function hasCommentAbove(sourceLines: string[] | undefined, line: number): boolean {
  if (!sourceLines) { return true; }
  for (let i = line - 2; i >= 0; i--) {
    const t = (sourceLines[i] ?? '').trim();
    if (t === '') { continue; }
    return t.startsWith('#');
  }
  return false;
}

/**
 * Detects the bedrock debug toggle pattern `If(1=0); ... EndIf;` or `0=1`.
 * Deliberate dev switches — `dead-code-condition` must not fire here.
 */
export function isDebugToggle(condition: string): boolean {
  return /^\s*(?:1\s*=\s*0|0\s*=\s*1)\s*$/.test(condition);
}

/** Condition text that qualifies as a CellPutN/CellPutS guard. */
export function isGuardCondition(cond: string): boolean {
  const c = cond.toLowerCase();
  return c.includes('cellisupdateable')
      || c.includes('dimix')
      || c.includes('dimensionelementexists')
      || c.includes('elementexists')
      || c.includes('hierarchyelementexists');
}

/**
 * Returns true if a preceding IF block acts as a guard by containing an early-exit
 * call (ItemSkip, ItemReject, ProcessBreak, …) in its then-body.
 */
export function ifBodyHasEarlyExit(stmt: TiStatement): boolean {
  if (stmt.type !== 'if') { return false; }
  for (const s of stmt.thenBody) {
    if (s.type === 'functionCall' && EARLY_EXIT_FUNCTIONS.has(s.name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates whether a simple condition (no AND/OR) consisting of two literal operands
 * is always true or always false. Returns null if the condition contains variables
 * or cannot be statically evaluated.
 */
export function evaluateConstantCondition(condition: string): 'always-true' | 'always-false' | null {
  const trimmed = condition.trim();

  if (isNumericLiteral(trimmed)) {
    return parseFloat(trimmed) === 0 ? 'always-false' : 'always-true';
  }

  const match = trimmed.match(COMPARISON_RE);
  if (!match) { return null; }

  const op = match[1];
  const opIdx = match.index!;
  const lhs = trimmed.substring(0, opIdx).trim();
  const rhs = trimmed.substring(opIdx + op.length).trim();

  if (isNumericLiteral(lhs) && isNumericLiteral(rhs)) {
    const l = parseFloat(lhs);
    const r = parseFloat(rhs);
    let result: boolean;
    switch (op) {
      case '=':  result = l === r; break;
      case '<>': result = l !== r; break;
      case '>':  result = l > r;   break;
      case '<':  result = l < r;   break;
      case '>=': result = l >= r;  break;
      case '<=': result = l <= r;  break;
      default:   return null;
    }
    return result ? 'always-true' : 'always-false';
  }

  if (isStringLiteral(lhs) && isStringLiteral(rhs)) {
    const l = lhs.slice(1, -1).toLowerCase();
    const r = rhs.slice(1, -1).toLowerCase();
    let result: boolean;
    switch (op) {
      case '@=':  result = l === r; break;
      case '@<>': result = l !== r; break;
      case '@>':  result = l > r;   break;
      case '@<':  result = l < r;   break;
      case '@>=': result = l >= r;  break;
      case '@<=': result = l <= r;  break;
      default:    return null;
    }
    return result ? 'always-true' : 'always-false';
  }

  return null;
}

/**
 * Scans a condition string for numeric literals that match known TM1 status/error codes.
 * Returns an array of { code, description } for each match found.
 * Only TM1_CONDITION_CODES are checked; PROCESS_RETURN_CODES (0–3) are excluded
 * because those values appear constantly in general TI conditions.
 */
export function findTm1ErrorCodes(condition: string): Array<{ code: string; description: string }> {
  const results: Array<{ code: string; description: string }> = [];
  const numRe = /\b(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(condition)) !== null) {
    const code = m[1];
    if (TM1_CONDITION_CODES[code]) {
      results.push({ code, description: TM1_CONDITION_CODES[code] });
    }
  }
  return results;
}

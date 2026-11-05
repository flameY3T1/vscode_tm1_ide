/**
 * Line continuation joining + multi-statement unfolding.
 *
 * Extracted from `tiParser.ts` in Post-H17 #6 split.
 */

import { splitStatementsAtDepthZero } from './helpers';

export {};

// TM1 binary operators that continue a statement across lines. NOTE: division
// is `\` (backslash) as well as `/` — `\` yields 0 on divide-by-zero instead of
// erroring — and `-` is subtraction; both were previously missing, so a
// statement continued by `\` or `-` was wrongly split into per-line errors.
/** True if `content` ends with an operator that continues the statement onto the next line. */
function endsWithContinuingOp(content: string): boolean {
  const noComment = content.replace(/#.*$/, '').trim();
  return /(?:^|[^=<>!])=\s*$/.test(noComment) || /[|+*/&,\\-]\s*$/.test(noComment);
}

/** True if the next non-blank, non-comment line begins with a continuation operator. */
function nextLineStartsWithOp(lines: string[], fromIdx: number): boolean {
  for (let j = fromIdx + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t === '' || t.startsWith('#')) { continue; }
    return /^[|+*/&\\-]/.test(t);
  }
  return false;
}

export function joinContinuationLines(lines: string[]): string[] {
  const result = [...lines];
  let depth = 0;
  let inStr = false;
  let pendingIdx = -1;
  let pendingContent = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (inStr) {
      if (pendingIdx === -1) {
        pendingIdx = i;
        pendingContent = raw;
      } else {
        pendingContent += ' ' + raw.replace(/\r$/, '');
        result[i] = '';
      }
      for (const ch of raw) {
        if (ch === "'") { inStr = !inStr; }
        else if (!inStr && ch === '(') { depth++; }
        else if (!inStr && ch === ')') { depth = Math.max(0, depth - 1); }
      }
      // A multi-line string can be one segment of a concatenation expression
      // (`'…' | var | '…'`). When the string closes at depth 0, only finalize
      // if the statement isn't continued by a concat operator on this line's
      // tail or at the start of the next non-blank line — otherwise the trailing
      // `| var | '…'` segments would be orphaned into broken statements.
      if (!inStr && depth === 0 &&
          !endsWithContinuingOp(raw) && !nextLineStartsWithOp(lines, i)) {
        result[pendingIdx] = pendingContent;
        pendingIdx = -1;
        pendingContent = '';
      }
      continue;
    }

    if (trimmed === '' || trimmed.startsWith('#')) {
      if (pendingIdx !== -1) {
        result[i] = '';
      }
      continue;
    }

    if (pendingIdx === -1) {
      pendingIdx = i;
      pendingContent = trimmed;
    } else {
      pendingContent += ' ' + trimmed;
      result[i] = '';
    }

    for (const ch of trimmed) {
      if (ch === "'") { inStr = !inStr; }
      else if (!inStr && ch === '(') { depth++; }
      else if (!inStr && ch === ')') { depth = Math.max(0, depth - 1); }
    }

    if (!inStr && depth === 0 &&
        !endsWithContinuingOp(trimmed) && !nextLineStartsWithOp(lines, i)) {
      result[pendingIdx] = pendingContent;
      pendingIdx = -1;
      pendingContent = '';
    }
  }

  if (pendingIdx !== -1) {
    result[pendingIdx] = pendingContent;
  }

  return result;
}

export function unfoldMultiStatementLines(joined: string[]): { lines: string[]; lineNums: number[] } {
  const out: string[] = [];
  const nums: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const orig = joined[i];
    const trimmed = orig.trim();
    const origLineNum = i + 1;

    if (trimmed === '' || trimmed.startsWith('#')) {
      out.push(orig);
      nums.push(origLineNum);
      continue;
    }

    if (trimmed.includes(';;')) {
      out.push(orig);
      nums.push(origLineNum);
      continue;
    }

    const parts = splitStatementsAtDepthZero(trimmed);
    if (parts.length <= 1) {
      out.push(orig);
      nums.push(origLineNum);
      continue;
    }

    for (const p of parts) {
      const stmt = p.trim();
      if (!stmt) { continue; }
      out.push(stmt.endsWith(';') ? stmt : stmt + ';');
      nums.push(origLineNum);
    }
  }
  return { lines: out, lineNums: nums };
}

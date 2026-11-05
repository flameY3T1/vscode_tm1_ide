/**
 * Detects foldable IF- and WHILE-block ranges in TI source code.
 *
 * An IF range spans from the line containing `IF(...)` to its matching `ENDIF`.
 * A WHILE range spans from `WHILE(...)` to the matching `END`.
 * ELSE/ELSEIF are NOT returned as separate ranges — the whole IF cascade is one fold.
 *
 * Lines and keywords inside strings (`'...'`) or comments (`#...`) are ignored.
 * Blocks that never close (no matching ENDIF/END) are dropped silently.
 */
export type FoldKind = 'IF' | 'WHILE' | 'region';

export interface FoldRange {
  startLine: number; // 1-based
  endLine: number;   // 1-based (the line containing ENDIF or END)
  kind: FoldKind;
}

/** Strips single-quoted string literals and `#` line-comments from a line. */
function stripStringsAndComments(line: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "'") { inStr = false; }
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === '#') { break; } // rest of line is a comment
    out += c;
  }
  return out;
}

/** Returns true if `IF`/`WHILE` at `idx` in `line` is at the start of a
 *  statement — i.e. nothing but whitespace precedes it on the line. That
 *  filters out inline-IF function calls like `x = IF(a, b, c);` which must
 *  not be treated as control-flow IF-blocks. */
function isStatementStartIf(line: string, idx: number): boolean {
  for (let j = 0; j < idx; j++) {
    if (!/\s/.test(line[j])) { return false; }
  }
  return true;
}

export function detectFoldRanges(code: string): FoldRange[] {
  const lines = code.split('\n');
  const stack: Array<{ kind: FoldKind; startLine: number }> = [];
  const ranges: FoldRange[] = [];

  for (let i = 0; i < lines.length; i++) {
    const clean = stripStringsAndComments(lines[i]);
    // Match keywords as whole words; case-insensitive. Multiple keywords per line are rare,
    // but possible (e.g. `IF(x=1); y=1; ENDIF;`) — iterate them in order.
    const re = /\b(IF|WHILE|ENDIF|END)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      const kw = m[1].toUpperCase();
      if (kw === 'IF') {
        // Skip inline-IF-function calls (e.g. `x = IF(a, b, c);`) — only count
        // IF when it opens a statement.
        if (!isStatementStartIf(clean, m.index)) { continue; }
        stack.push({ kind: 'IF', startLine: i + 1 });
      } else if (kw === 'WHILE') {
        // Same rule as IF — be defensive even though there's no inline-WHILE in TI.
        if (!isStatementStartIf(clean, m.index)) { continue; }
        stack.push({ kind: 'WHILE', startLine: i + 1 });
      } else if (kw === 'ENDIF') {
        // Pop until we find an IF (tolerate malformed nesting by dropping mismatches).
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].kind === 'IF') {
            ranges.push({ kind: 'IF', startLine: stack[k].startLine, endLine: i + 1 });
            stack.splice(k, 1);
            break;
          }
        }
      } else if (kw === 'END') {
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].kind === 'WHILE') {
            ranges.push({ kind: 'WHILE', startLine: stack[k].startLine, endLine: i + 1 });
            stack.splice(k, 1);
            break;
          }
        }
      }
    }
  }

  // Only keep ranges that span at least 2 lines (1-line blocks have nothing to fold).
  return ranges.filter(r => r.endLine > r.startLine);
}

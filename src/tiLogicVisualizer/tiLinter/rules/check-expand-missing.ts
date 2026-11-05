import { LintDiagnose } from '../../lintTypes';

/** `%var%` interpolation pattern inside a string literal. */
const INTERP_RE = /%([A-Za-z_][A-Za-z0-9_]*)%/g;

/**
 * Post-traversal check: emit `expand-missing` for string literals that contain
 * a `%var%` interpolation pattern referencing a declared variable (local
 * variable, parameter or datasource variable) but are NOT passed through
 * `Expand(...)`. Without Expand the `%var%` text ends up verbatim in the
 * output — the most common TI beginner mistake.
 *
 * Precision guards:
 * - only fires when the identifier between the `%` is a declared variable
 *   (case-insensitive) — `'50%'` or `'%nonexistent%'` never fire,
 * - literals anywhere inside the parentheses of an `Expand(` call are safe
 *   (paren depth is tracked, so `Expand('a' | sX | '%y%')` is fully covered),
 * - `#`-comments are skipped,
 * - at most one diagnostic per line.
 */
export function checkExpandMissing(
  rawCode: string | undefined,
  declaredVars: ReadonlySet<string>,
  diagnostics: LintDiagnose[],
): void {
  if (!rawCode || declaredVars.size === 0) { return; }
  const lines = rawCode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const name = findUnexpandedInterp(lines[i], declaredVars);
    if (name !== null) {
      diagnostics.push({
        line: i + 1,
        severity: 'warning',
        ruleId: 'expand-missing',
        messageKey: `String contains '%{0}%' but is not interpolated through Expand().`,
        messageArgs: [name],
      });
    }
  }
}

/**
 * Scan one line. Returns the first declared `%var%` name found inside a string
 * literal that is not within the parentheses of an `Expand(` call, else null.
 */
function findUnexpandedInterp(line: string, declaredVars: ReadonlySet<string>): string | null {
  let inStr = false;
  let cur = '';
  let curSafe = false;
  let depth = 0;
  const expandDepths: number[] = []; // paren depths at which an Expand( opened
  let ident = ''; // identifier accumulated directly before a potential '('

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "'") {
        if (line[i + 1] === "'") { cur += "'"; i++; continue; } // escaped ''
        inStr = false;
        if (!curSafe) {
          const name = firstDeclaredInterp(cur, declaredVars);
          if (name !== null) { return name; }
        }
        continue;
      }
      cur += c;
      continue;
    }
    if (c === '#') { break; } // unquoted comment — rest of line is dead
    if (c === "'") {
      inStr = true;
      cur = '';
      curSafe = expandDepths.length > 0;
      ident = '';
      continue;
    }
    if (/[A-Za-z0-9_]/.test(c)) { ident += c; continue; }
    if (c === '(') {
      depth++;
      if (ident.toLowerCase() === 'expand') { expandDepths.push(depth); }
      ident = '';
      continue;
    }
    if (c === ')') {
      if (expandDepths.length > 0 && expandDepths[expandDepths.length - 1] === depth) {
        expandDepths.pop();
      }
      depth--;
      ident = '';
      continue;
    }
    if (c !== ' ' && c !== '\t') { ident = ''; } // whitespace keeps `Expand (` working
  }

  // Unterminated literal at EOL (TI statements are single-line) — still check it.
  if (inStr && !curSafe) {
    return firstDeclaredInterp(cur, declaredVars);
  }
  return null;
}

/** First `%var%` in the literal whose identifier is a declared variable (lowercase set). */
function firstDeclaredInterp(literal: string, declaredVars: ReadonlySet<string>): string | null {
  INTERP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INTERP_RE.exec(literal)) !== null) {
    if (declaredVars.has(m[1].toLowerCase())) { return m[1]; }
    // Re-scan from the closing '%' — it may double as the opening '%' of the
    // next pattern ('x%a%b%' → after %a% also try %b%).
    INTERP_RE.lastIndex = m.index + m[0].length - 1;
  }
  return null;
}

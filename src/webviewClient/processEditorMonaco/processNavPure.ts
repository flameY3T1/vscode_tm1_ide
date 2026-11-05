/**
 * Pure detection for Ctrl+click "go to called process".
 *
 * Given a single line of TI code and a 1-based column (Monaco convention),
 * returns the target process name when the column sits inside the first
 * string-literal argument of an `ExecuteProcess(...)` / `RunProcess(...)`
 * call — i.e. the name of the process being called. Returns `null` otherwise
 * (no call on the line, column outside the name literal, or the process name
 * is passed dynamically via a variable instead of a literal).
 *
 * TM1 string literals are single-quoted; an embedded quote is escaped by
 * doubling it (`''`). Process names never legitimately contain a quote, but we
 * unescape defensively so the returned name matches the real object name.
 */

/** Matches the call head up to (and including) the opening quote of arg 1. */
import { escapeRegex } from '../../utils/escapeRegexPure';
const CALL_HEAD_RE = /\b(?:ExecuteProcess|RunProcess)\s*\(\s*'/gi;

export interface ProcessCallTarget {
  /** Unescaped process name (the object to open). */
  name: string;
  /** 1-based column of the first char inside the opening quote. */
  literalStart: number;
  /** 1-based column of the closing quote. */
  literalEnd: number;
}

/**
 * Find every `ExecuteProcess/RunProcess('<name>'` call on the line and return
 * its literal span. Malformed calls (unterminated string) are skipped.
 */
export function findProcessCallTargets(lineText: string): ProcessCallTarget[] {
  const out: ProcessCallTarget[] = [];
  CALL_HEAD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_HEAD_RE.exec(lineText)) !== null) {
    // 0-based index of the first name char (right after the opening quote).
    const contentStart0 = m.index + m[0].length;
    // Walk to the closing quote, honouring '' escapes.
    let i = contentStart0;
    let name = '';
    let closed = false;
    while (i < lineText.length) {
      const ch = lineText[i];
      if (ch === "'") {
        if (lineText[i + 1] === "'") { name += "'"; i += 2; continue; } // escaped quote
        closed = true;
        break;
      }
      name += ch;
      i++;
    }
    if (!closed) { continue; } // unterminated literal — ignore
    out.push({
      name,
      literalStart: contentStart0 + 1, // → 1-based
      literalEnd: i + 1,               // 1-based column of closing quote
    });
    // Continue scanning after the closing quote for further calls on the line.
    CALL_HEAD_RE.lastIndex = i + 1;
  }
  return out;
}

/**
 * Return the called process name if `column` (1-based) is inside the name
 * literal of an ExecuteProcess/RunProcess call on `lineText`, else null.
 * The span is forgiving: it includes both surrounding quotes, so a click on
 * the quote itself still resolves.
 */
export function processCallTargetAt(lineText: string, column: number): string | null {
  for (const t of findProcessCallTargets(lineText)) {
    // Include the opening quote (literalStart-1) and closing quote (literalEnd).
    if (column >= t.literalStart - 1 && column <= t.literalEnd && t.name.length > 0) {
      return t.name;
    }
  }
  return null;
}

// ─── Variable-name calls: ExecuteProcess(sProcess, …) ────────────────────────

/** Matches an ExecuteProcess/RunProcess call whose first arg is a bare identifier. */
const CALL_VAR_RE = /\b(?:ExecuteProcess|RunProcess)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,)]/gi;

export interface ProcessCallVarTarget {
  /** The identifier passed as the process-name argument. */
  varName: string;
  /** 1-based column of the identifier's first char. */
  start: number;
  /** 1-based column of the identifier's last char. */
  end: number;
}

/**
 * Find every `ExecuteProcess/RunProcess(<identifier>` call on the line where the
 * process name is passed via a variable (not a string literal).
 */
export function findProcessCallVarTargets(lineText: string): ProcessCallVarTarget[] {
  const out: ProcessCallVarTarget[] = [];
  CALL_VAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_VAR_RE.exec(lineText)) !== null) {
    const varName = m[1];
    const openParen = m[0].indexOf('(');
    const idOffsetInArgs = m[0].slice(openParen + 1).search(/[A-Za-z_]/);
    const idStart0 = m.index + openParen + 1 + idOffsetInArgs;
    out.push({ varName, start: idStart0 + 1, end: idStart0 + varName.length });
    // Continue after the identifier (the trailing ,/) may start the next scan).
    CALL_VAR_RE.lastIndex = idStart0 + varName.length;
  }
  return out;
}

/**
 * If `column` (1-based) sits on the variable passed as the process name of an
 * ExecuteProcess/RunProcess call, return that variable's name, else null.
 */
export function firstArgIdentifierAt(lineText: string, column: number): string | null {
  for (const t of findProcessCallVarTargets(lineText)) {
    if (column >= t.start && column <= t.end) { return t.varName; }
  }
  return null;
}


/**
 * Resolve `varName` to a process name by scanning `lines` (source lines, in
 * execution order, up to and including the use site) for the LAST assignment of
 * a single string literal: `<varName> = '<name>';`. TM1 identifiers are
 * case-insensitive. Concatenations / expressions are intentionally not resolved
 * (only a pure literal RHS counts). Returns the literal (with `''` unescaped) or
 * null when no such assignment exists.
 */
export function resolveVarLiteral(varName: string, lines: readonly string[]): string | null {
  const re = new RegExp(`^\\s*${escapeRegex(varName)}\\s*=\\s*'((?:[^']|'')*)'\\s*;?\\s*$`, 'i');
  let value: string | null = null;
  for (const line of lines) {
    const mm = re.exec(line);
    if (mm) { value = mm[1].replace(/''/g, "'"); }
  }
  return value && value.length > 0 ? value : null;
}

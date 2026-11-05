import { escapeRegex } from '../utils/escapeRegexPure';

/**
 * Blank string-literal and comment content to spaces, preserving overall length,
 * newlines, and every code character's column. Single pass over the whole text so
 * string state carries across physical lines (TI concat continuations produce
 * strings that span lines). TI rules:
 *  - String literals are single-quoted; a doubled '' inside a string is an escaped
 *    apostrophe (stays in the string, does NOT close it).
 *  - A '#' outside a string starts a comment that ends at the next newline.
 *  - Newlines are always preserved (never blanked).
 */
export function maskCode(text: string): string {
  const out: string[] = [];
  let inStr = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') { inComment = false; out.push('\n'); continue; }
    if (inComment) { out.push(' '); continue; }
    if (inStr) {
      if (ch === "'") {
        if (text[i + 1] === "'") { out.push(' ', ' '); i++; continue; } // escaped '' → stay in string
        inStr = false; out.push(' '); continue;                          // closing quote
      }
      out.push(' '); continue;                                           // string content
    }
    if (ch === "'") { inStr = true; out.push(' '); continue; }           // opening quote
    if (ch === '#') { inComment = true; out.push(' '); continue; }       // comment start
    out.push(ch);                                                        // code char
  }
  return out.join('');
}

/** Whole-text mask, split into lines (same length + newline positions as the real text). */
function maskedLines(text: string): string[] {
  return maskCode(text).split('\n');
}

/** Whole-word, case-insensitive occurrences of `nameLc` outside strings/comments. 1-based line/column. */
export function occurrencesOf(
  text: string,
  nameLc: string,
): { line: number; column: number; length: number; spelling: string }[] {
  const realLines = text.split('\n');
  const masked = maskedLines(text);
  const re = new RegExp(`(?<![A-Za-z0-9_])(${escapeRegex(nameLc)})(?![A-Za-z0-9_])`, 'gi');
  const out: { line: number; column: number; length: number; spelling: string }[] = [];
  for (let i = 0; i < masked.length; i++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked[i])) !== null) {
      const col = m.index;
      const spelling = realLines[i].substr(col, nameLc.length);
      out.push({ line: i + 1, column: col + 1, length: nameLc.length, spelling });
    }
  }
  return out;
}

/** Replace every whole-word case-insensitive occurrence (code-only) with `target`. */
export function renameIdentifier(text: string, nameLc: string, target: string): string {
  const realLines = text.split('\n');
  const masked = maskedLines(text);
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(nameLc)}(?![A-Za-z0-9_])`, 'gi');
  for (let i = 0; i < realLines.length; i++) {
    const spans: { start: number; end: number }[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked[i])) !== null) {
      spans.push({ start: m.index, end: m.index + nameLc.length });
    }
    if (spans.length === 0) { continue; }
    let line = realLines[i];
    for (let k = spans.length - 1; k >= 0; k--) {
      line = line.slice(0, spans[k].start) + target + line.slice(spans[k].end);
    }
    realLines[i] = line;
  }
  return realLines.join('\n');
}

/** Whole-word identifier tokens present in already-joined code (strings/comments masked). */
export function codeKeysOf(combined: string): Set<string> {
  const masked = maskCode(combined);
  const keys = new Set<string>();
  for (const m of masked.matchAll(/(?<![A-Za-z0-9_])([A-Za-z_]\w*)(?![A-Za-z0-9_])/g)) {
    keys.add(m[1].toLowerCase());
  }
  return keys;
}

/**
 * Rewrite exactly the whole-word identifier tokens at the given 1-based
 * (line, column) positions to `target`. Occurrence-precise (NOT whole-line):
 * two same-named tokens on one line can be renamed independently — used by the
 * live-range split, where a def line like `f = f | 'x'` has its RHS read renamed
 * but its LHS write left as-is. Positions off an identifier boundary are ignored.
 */
export function renameOccurrences(
  text: string,
  positions: { line: number; column: number }[],
  target: string,
): string {
  const lines = text.split('\n');
  const byLine = new Map<number, number[]>();
  for (const p of positions) {
    const arr = byLine.get(p.line);
    if (arr) { arr.push(p.column); } else { byLine.set(p.line, [p.column]); }
  }
  for (const [ln, cols] of byLine) {
    const idx = ln - 1;
    if (idx < 0 || idx >= lines.length) { continue; }
    let line = lines[idx];
    for (const col of cols.sort((a, b) => b - a)) { // right-to-left
      const start = col - 1;
      const m = /^[A-Za-z_]\w*/.exec(line.slice(start));
      if (!m) { continue; }
      const before = start > 0 ? line[start - 1] : '';
      if (before && /[A-Za-z0-9_]/.test(before)) { continue; } // not a whole-word start
      line = line.slice(0, start) + target + line.slice(start + m[0].length);
    }
    lines[idx] = line;
  }
  return lines.join('\n');
}

/**
 * Per physical line, count occurrences of `nameLc` that are immediately
 * followed (skipping spaces) by a SINGLE '=' (i.e. `name =` but not `name ==`,
 * `name >=`, `name <=`, `name @=`). >1 on a line means an assignment-vs-comparison
 * or double-assignment ambiguity the line-based live-range model cannot resolve
 * safely, so the split of any def on that line must be refused.
 */
export function eqAssignCandidateLines(text: string, nameLc: string): Map<number, number> {
  const masked = maskedLines(text);
  const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(nameLc)}(?![A-Za-z0-9_])`, 'gi');
  const out = new Map<number, number>();
  for (let i = 0; i < masked.length; i++) {
    const maskedLine = masked[i];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(maskedLine)) !== null) {
      const rest = maskedLine.slice(m.index + nameLc.length).replace(/^\s*/, '');
      if (rest.startsWith('=') && !rest.startsWith('==')) { count++; }
    }
    if (count > 0) { out.set(i + 1, count); }
  }
  return out;
}

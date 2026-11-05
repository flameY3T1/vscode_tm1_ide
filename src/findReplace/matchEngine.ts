import { escapeRegex } from '../utils/escapeRegexPure';
export interface MatchOpts { wholeWord: boolean; regex: boolean; }
export interface Match {
  line: number;
  column: number;
  length: number;
  lineText: string;
  /** Full exec result for this match: groups[0] = whole match, groups[1..] = captures.
   *  Carried so replacement can expand capture groups without re-matching the isolated
   *  slice — a re-match fails for lookaround queries (e.g. `foo(?=bar)`). */
  groups?: string[];
}

export class InvalidRegexError extends Error {
  constructor(pattern: string, cause: string) {
    super(`Invalid regex: ${pattern} (${cause})`);
    this.name = 'InvalidRegexError';
  }
}

const WORD = /\w/;
function isWordBounded(text: string, start: number, len: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = start + len < text.length ? text[start + len] : '';
  return !WORD.test(before) && !WORD.test(after);
}

/** Compile a query to a case-insensitive global regex; plain/word queries are escaped. */
function compile(query: string, opts: MatchOpts): RegExp {
  if (opts.regex) {
    try { return new RegExp(query, 'gi'); }
    catch (e) { throw new InvalidRegexError(query, (e as Error).message); }
  }
  const esc = escapeRegex(query);
  return new RegExp(esc, 'gi');
}

/** line-start offset table for the text. */
function lineTable(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) { if (text[i] === '\n') { starts.push(i + 1); } }
  return starts;
}
function locate(starts: number[], lines: string[], offset: number) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) { lo = mid; } else { hi = mid - 1; } }
  return { line: lo + 1, column: offset - starts[lo] + 1, lineText: lines[lo] };
}

export function findMatches(text: string, query: string, opts: MatchOpts): Match[] {
  if (query === '') { return []; }
  const re = compile(query, opts);
  const starts = lineTable(text);
  const lines = text.split('\n');
  const out: Match[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const len = m[0].length;
    if (len === 0) { re.lastIndex++; continue; }         // zero-length guard
    if (opts.wholeWord && !isWordBounded(text, m.index, len)) { continue; }
    const loc = locate(starts, lines, m.index);
    out.push({ line: loc.line, column: loc.column, length: len, lineText: loc.lineText, groups: Array.from(m, g => g ?? '') });
  }
  return out;
}

/** offset of a 1-based (line,column) inside text. */
function offsetOf(starts: number[], line: number, column: number): number {
  return starts[line - 1] + (column - 1);
}

/**
 * Expand a replacement template against the capture groups already produced by
 * `findMatches` (`groups[0]` = whole match). Supports `$$`, `$&`, and numbered
 * `$1`..`$99` back-references — the same semantics `String.replace` gives, but
 * without re-matching the query (which silently no-ops for lookaround queries).
 */
function expandReplacement(template: string, groups: string[]): string {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '$') { out += template[i]; continue; }
    const next = template[i + 1];
    if (next === '$') { out += '$'; i++; continue; }
    if (next === '&') { out += groups[0] ?? ''; i++; continue; }
    const two = template.slice(i + 1, i + 3);
    if (/^\d\d$/.test(two) && Number(two) < groups.length) {
      out += groups[Number(two)] ?? ''; i += 2; continue;
    }
    const one = template[i + 1];
    if (one >= '1' && one <= '9' && Number(one) < groups.length) {
      out += groups[Number(one)] ?? ''; i += 1; continue;
    }
    out += '$';
  }
  return out;
}

export function applyReplacements(
  text: string,
  matches: Match[],
  replacement: string,
  query: string,
  opts: MatchOpts,
): string {
  if (matches.length === 0) { return text; }
  const starts = lineTable(text);
  // apply right-to-left so earlier offsets stay valid
  const ordered = [...matches].sort((a, b) => b.line - a.line || b.column - a.column);
  let out = text;
  for (const mt of ordered) {
    const off = offsetOf(starts, mt.line, mt.column);
    // Substitute using the capture groups produced at match time — NOT a re-match
    // of the isolated slice, which fails for lookaround queries (`foo(?=bar)` →
    // slice "foo" no longer matches → silent no-op counted as applied).
    let repl: string;
    if (!opts.regex) {
      repl = replacement;
    } else if (mt.groups) {
      repl = expandReplacement(replacement, mt.groups);
    } else {
      const slice = out.slice(off, off + mt.length);
      repl = slice.replace(new RegExp(query, 'i'), replacement);
    }
    out = out.slice(0, off) + repl + out.slice(off + mt.length);
  }
  return out;
}

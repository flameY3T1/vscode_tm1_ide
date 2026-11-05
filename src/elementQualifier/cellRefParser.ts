/**
 * Pure parser for TM1 rule cell-references `[...]`.
 *
 * Used by the Element-Qualifier to find bare element references and rewrite
 * them as qualified `'Dim':'Elem'` references.
 *
 * No vscode dependency.
 */

export interface BracketBlock {
  /** Offset of the opening `[` in the source text. */
  start: number;
  /** Offset of the closing `]` (inclusive) in the source text. */
  end: number;
  /** The content between `[` and `]` (exclusive). */
  content: string;
}

/**
 * Strips line comments (`#...` to end-of-line) from text while preserving
 * string-literal content. Returns text of the same length with comment chars
 * replaced by spaces (so positions are preserved).
 */
function neutralizeForScan(text: string): string {
  const out: string[] = [];
  let inString = false;
  let inComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inComment) {
      if (ch === '\n') { inComment = false; out.push(ch); }
      else { out.push(' '); }
      continue;
    }
    if (inString) {
      if (ch === "'") { inString = false; out.push(ch); }
      else { out.push(' '); }
      continue;
    }
    if (ch === "'") { inString = true; out.push(ch); continue; }
    if (ch === '#') { inComment = true; out.push(' '); continue; }
    out.push(ch);
  }
  return out.join('');
}

/**
 * Finds all top-level `[...]` blocks in the given text.
 * Comments and string-literal content are skipped for bracket detection.
 */
export function findBracketBlocks(text: string): BracketBlock[] {
  const scan = neutralizeForScan(text);
  const result: BracketBlock[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < scan.length; i++) {
    const ch = scan[i];
    if (ch === '[') {
      if (depth === 0) { start = i; }
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        result.push({ start, end: i, content: text.slice(start + 1, i) });
        start = -1;
      } else if (depth < 0) {
        depth = 0; // ignore stray ']'
      }
    }
  }
  return result;
}

// ─── Entry parsing ────────────────────────────────────────────────────────────

export type CellRefEntry =
  | { kind: 'qualified'; dim: string; elem: string; raw: string }
  | { kind: 'qualifiedSet'; dim: string; elems: string[]; raw: string }
  | { kind: 'bare'; elem: string; raw: string }
  | { kind: 'bareSet'; elems: string[]; raw: string }
  | { kind: 'var'; name: string; raw: string }
  | { kind: 'unknown'; raw: string };

/**
 * Splits the content of a `[...]` block into entries by top-level commas.
 * Commas inside `{...}` sets or `'...'` strings are not split-points.
 */
export function splitEntries(content: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let inString = false;
  let buf = '';
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      buf += ch;
      if (ch === "'") { inString = false; }
      continue;
    }
    if (ch === "'") { inString = true; buf += ch; continue; }
    if (ch === '{') { depth++; buf += ch; continue; }
    if (ch === '}') { depth--; buf += ch; continue; }
    if (ch === ',' && depth === 0) {
      const t = buf.trim();
      if (t !== '') { entries.push(t); }
      buf = '';
      continue;
    }
    buf += ch;
  }
  const t = buf.trim();
  if (t !== '') { entries.push(t); }
  return entries;
}

const RE_VAR        = /^!\s*[A-Za-z_][A-Za-z0-9_]*$/;
const RE_BARE       = /^'([^']*)'$/;
const RE_QUALIFIED  = /^'([^']*)'\s*:\s*'([^']*)'$/;
const RE_QUAL_SET   = /^'([^']*)'\s*:\s*\{\s*('[^']*'(?:\s*,\s*'[^']*')*)\s*\}$/;
const RE_BARE_SET   = /^\{\s*('[^']*'(?:\s*,\s*'[^']*')*)\s*\}$/;

function extractStringList(inner: string): string[] {
  return [...inner.matchAll(/'([^']*)'/g)].map(m => m[1]);
}

/** Classifies a single entry token. */
export function classifyEntry(raw: string): CellRefEntry {
  const trimmed = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = trimmed.match(RE_QUALIFIED))) {
    return { kind: 'qualified', dim: m[1], elem: m[2], raw: trimmed };
  }
  if ((m = trimmed.match(RE_QUAL_SET))) {
    return { kind: 'qualifiedSet', dim: m[1], elems: extractStringList(m[2]), raw: trimmed };
  }
  if ((m = trimmed.match(RE_BARE_SET))) {
    return { kind: 'bareSet', elems: extractStringList(m[1]), raw: trimmed };
  }
  if ((m = trimmed.match(RE_BARE))) {
    return { kind: 'bare', elem: m[1], raw: trimmed };
  }
  if (RE_VAR.test(trimmed)) {
    return { kind: 'var', name: trimmed, raw: trimmed };
  }
  return { kind: 'unknown', raw: trimmed };
}

/** Parses the content of a `[...]` block into classified entries. */
export function parseBracketContent(content: string): CellRefEntry[] {
  return splitEntries(content).map(classifyEntry);
}

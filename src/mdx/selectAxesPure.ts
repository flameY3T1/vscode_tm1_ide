// Pure, vscode-free parser for the axis structure of an MDX SELECT. Shared by
// every helper that has to rewrite a single axis without disturbing the rest of
// the statement (`nonEmptyAxisPure`, `dimensionPropertiesPure`).
//
// The scanner is bracket-, escape- and string-aware: it splits on top-level
// commas only and stops at the top-level FROM keyword, so nested sets, member
// names containing commas, sub-selects (`FROM (SELECT … )`) and string literals
// don't trip it up.

export interface ParsedSelect {
  /** Text up to and including the `SELECT` keyword. */
  pre: string;
  /** Top-level comma-split axis segments (commas not included). */
  segments: string[];
  /** Text from the top-level `FROM` keyword onward (or '' if none). */
  post: string;
}

export interface AxisRef {
  /**
   * `rows` / `cols` for the two axes the cube viewer can address, `null` for
   * anything beyond them (`ON 2`, `ON 3`, …) — a view may have more axes than
   * the viewer renders.
   */
  kind: 'rows' | 'cols' | null;
  /** Numeric axis ordinal: COLUMNS = 0, ROWS = 1, `ON <n>` = n. */
  index: number;
}

function _isFromAt(mdx: string, i: number): boolean {
  if (mdx.substr(i, 4).toUpperCase() !== 'FROM') { return false; }
  const prev = i > 0 ? mdx[i - 1] : ' ';
  const next = i + 4 < mdx.length ? mdx[i + 4] : ' ';
  return !/[A-Za-z0-9_]/.test(prev) && !/[A-Za-z0-9_]/.test(next);
}

/**
 * Split on `sep` at bracket depth 0; `end` is where the scan stopped.
 *
 * `sep` is a single character because the two separators this scanner has to
 * know about are both one — `,` between axis segments and `*` between the
 * crossjoin factors of one axis (`axisFactorsPure`).
 */
function _scan(text: string, start: number, stopAtFrom: boolean, sep = ','): { segments: string[]; end: number } {
  const segments: string[] = [];
  let depth = 0, cur = '', inStr = false, i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { cur += c; if (c === '"') { inStr = false; } continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    // `]]` is MDX's escape for a literal `]` inside a bracketed name. Counting
    // it as two closers would push the depth negative and hide every top-level
    // comma and the FROM keyword behind it — brackets never nest, so a doubled
    // `]` is always an escape.
    if (c === ']' && text[i + 1] === ']') { cur += ']]'; i++; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; cur += c; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; cur += c; continue; }
    if (depth === 0) {
      if (c === sep) { segments.push(cur); cur = ''; continue; }
      if (stopAtFrom && (c === 'F' || c === 'f') && _isFromAt(text, i)) { break; }
    }
    cur += c;
  }
  segments.push(cur);
  return { segments, end: i };
}

/** Split an MDX statement into `SELECT` head, axis segments and `FROM` tail. */
export function parseSelect(mdx: string): ParsedSelect | null {
  const selectIdx = mdx.toUpperCase().indexOf('SELECT');
  if (selectIdx < 0) { return null; }
  const start = selectIdx + 6;
  const { segments, end } = _scan(mdx, start, true);
  return { pre: mdx.substring(0, start), segments, post: mdx.substring(end) };
}

/**
 * Split an MDX fragment on its top-level commas — `join(',')` on the result
 * reproduces the input verbatim.
 */
export function splitTopLevelCommas(text: string): string[] {
  return _scan(text, 0, false).segments;
}

/**
 * Split an MDX fragment on its top-level `*` — the infix crossjoin. Same
 * bracket/escape/string awareness as the comma split, so a `*` inside an
 * element name or a string literal stays put.
 */
export function splitTopLevelStars(text: string): string[] {
  return _scan(text, 0, false, '*').segments;
}

/** Which axis a segment targets, or null if it carries no trailing `ON …`. */
export function axisOf(segment: string): AxisRef | null {
  const m = segment.trim().match(/\bON\s+(ROWS|COLUMNS|\d+)\s*$/i);
  if (!m) { return null; }
  const id = m[1].toUpperCase();
  if (id === 'ROWS') { return { kind: 'rows', index: 1 }; }
  if (id === 'COLUMNS') { return { kind: 'cols', index: 0 }; }
  const index = Number(id);
  if (index === 0) { return { kind: 'cols', index }; }
  if (index === 1) { return { kind: 'rows', index }; }
  return { kind: null, index };
}

// Pure, vscode-free: extracts the set expression of ONE dimension from an MDX
// statement.
//
// Why: the axis of a view is a cross product — `{Accounts set} *
// {Measures set}`. Whoever clicks the filter chip of one of these dimensions
// means its factor, not the product. Until 2026-08-20 the Cube Viewer passed on
// only the NAMES of the rows just drawn at this point; the
// Dimension Browser therefore opened at zero (roots only) and showed a
// name list, although the axis carried a collapse state as a DRILL*MEMBER chain.
//
// The splitter is deliberately purely syntactic: it splits at the top-level
// asterisks, resolves `CROSSJOIN(a, b)` and assigns every factor to the
// dimension its first element chain begins with. What it cannot assign
// unambiguously it returns as `null` — the caller then falls back to the
// previous behaviour instead of claiming a foreign axis.

import { parseSelect, axisOf, splitTopLevelStars } from './selectAxesPure';
import { splitHierKey } from '../utils/hierKeyPure';

const ON_AXIS_TAIL = /\bON\s+(?:ROWS|COLUMNS|\d+)\s*$/i;
const DIM_PROPS_TAIL = /\bDIMENSION\s+PROPERTIES\b[\s\S]*$/i;
const NON_EMPTY_HEAD = /^\s*NON\s+EMPTY\s+/i;

/**
 * The factors of an axis expression, in axis order.
 *
 * Both spellings of the cross product are resolved: the infix asterisk and
 * the function form. TM1 writes the one, our own axis builder
 * (`axisMdxPure`) the other.
 */
export function splitCrossjoinFactors(setExpr: string): string[] {
  const out: string[] = [];
  for (const part of splitTopLevelStars(setExpr)) {
    const t = part.trim();
    if (!t) { continue; }
    const inner = _crossjoinArgs(t);
    if (inner) { out.push(..._flatten(inner)); continue; }
    out.push(t);
  }
  return out;
}

function _flatten(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) { out.push(...splitCrossjoinFactors(a)); }
  return out;
}

/**
 * If the expression is a single `CROSSJOIN(...)` call, its arguments —
 * otherwise `null`. The parenthesis must span the WHOLE expression; `{CROSSJOIN(a,b)}
 * * {c}` has already been split by the asterisk splitter beforehand.
 */
function _crossjoinArgs(expr: string): string[] | null {
  const m = expr.match(/^CROSSJOIN\s*\(/i);
  if (!m) { return null; }
  const open = m[0].length - 1;
  const close = _matchingParen(expr, open);
  if (close !== expr.length - 1) { return null; }
  return _splitArgs(expr.substring(open + 1, close));
}

/** Index of the closing parenthesis for `open`, or -1. Aware of parentheses and strings. */
function _matchingParen(text: string, open: number): number {
  let depth = 0, inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '"') { inStr = false; } continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === ']' && text[i + 1] === ']') { i++; continue; }
    if (c === '(' || c === '{' || c === '[') { depth++; continue; }
    if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) { return i; } }
  }
  return -1;
}

/** Arguments of a function parenthesis, split at the top-level commas. */
function _splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { cur += c; if (c === '"') { inStr = false; } continue; }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === ']' && text[i + 1] === ']') { cur += ']]'; i++; continue; }
    if (c === '(' || c === '{' || c === '[') { depth++; cur += c; continue; }
    if (c === ')' || c === '}' || c === ']') { depth--; cur += c; continue; }
    if (depth === 0 && c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * All dimensions that OPEN an element chain in the expression, without duplicates.
 *
 * Chain start means: the bracket does not follow a dot. In
 * `[B].[B].MEMBERS` only the first one opens; the second is the hierarchy, the
 * third would be the element.
 */
export function dimsOfSetExpr(setExpr: string): string[] {
  const out: string[] = [];
  const seen: Record<string, boolean> = {};
  let inStr = false;
  for (let i = 0; i < setExpr.length; i++) {
    const c = setExpr[i];
    if (inStr) { if (c === '"') { inStr = false; } continue; }
    if (c === '"') { inStr = true; continue; }
    if (c !== '[') { continue; }
    const end = _closingBracket(setExpr, i);
    if (end < 0) { break; }
    let j = i - 1;
    while (j >= 0 && /\s/.test(setExpr[j])) { j--; }
    const isChainHead = j < 0 || setExpr[j] !== '.';
    if (isChainHead) {
      const name = setExpr.substring(i + 1, end).replace(/\]\]/g, ']');
      if (!seen[name]) { seen[name] = true; out.push(name); }
    }
    i = end;
  }
  return out;
}

/** Index of the closing `]` from `open` on, `]]` as escaping. */
function _closingBracket(text: string, open: number): number {
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] !== ']') { continue; }
    if (text[i + 1] === ']') { i++; continue; }
    return i;
  }
  return -1;
}

/** The dimension the expression begins with, or `null`. */
export function dimOfSetExpr(setExpr: string): string | null {
  return dimsOfSetExpr(setExpr)[0] ?? null;
}

/**
 * Names of the first bracket chain in `setExpr` (`[D].[H].[E]` → D, H, E).
 */
function _firstChain(setExpr: string): string[] {
  const out: string[] = [];
  let inStr = false;
  for (let i = 0; i < setExpr.length; i++) {
    const c = setExpr[i];
    if (inStr) { if (c === '"') { inStr = false; } continue; }
    if (c === '"') { inStr = true; continue; }
    if (c !== '[') { if (out.length && !/[\s.]/.test(c)) { break; } continue; }
    const end = _closingBracket(setExpr, i);
    if (end < 0) { break; }
    out.push(setExpr.substring(i + 1, end).replace(/\]\]/g, ']'));
    i = end;
  }
  return out;
}

/**
 * Whether factor `setExpr` belongs to viewer key `key` (`dim` or `dim:hier`,
 * utils/hierKeyPure): it opens with the dimension, and its first chain names
 * the key's hierarchy. A two-part `[D].[X]` is `D`'s default hierarchy unless X
 * is one of `altHiers` (the viewer writes `TM1SUBSETALL([D].[Alt])`); without
 * that list it counts as the default hierarchy. Two hierarchies of one
 * dimension on the axes thus stay two distinct factors (Codex review
 * 2026-09-28, F4).
 */
export function factorMatchesKey(setExpr: string, key: string, altHiers: readonly string[] = []): boolean {
  const { dim, hier } = splitHierKey(key);
  if (dimOfSetExpr(setExpr) !== dim) { return false; }
  const chain = _firstChain(setExpr);
  const second = chain[0] === dim ? chain[1] : undefined;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  let factorHier = dim;
  if (second !== undefined && (chain.length >= 3 || altHiers.some((h) => same(h, second)))) {
    factorHier = second;
  }
  return same(factorHier, hier);
}

/**
 * The set expression of ONE dimension from an MDX statement, or `null`.
 *
 * `null` in three cases, which all mean the same ("the expression does NOT
 * describe this dimension's set unambiguously"):
 *  • the dimension is on no axis (e.g. only in the `WHERE`),
 *  • no factor begins with it,
 *  • several factors do (the same dimension twice on one axis).
 */
export function axisFactorForDim(mdx: string, dim: string, altHiers: readonly string[] = []): string | null {
  const parsed = parseSelect(mdx);
  if (!parsed) { return null; }
  const hits: string[] = [];
  for (const seg of parsed.segments) {
    if (!axisOf(seg)) { continue; }
    const setExpr = seg
      .replace(ON_AXIS_TAIL, '')
      .replace(DIM_PROPS_TAIL, '')
      .replace(NON_EMPTY_HEAD, '');
    for (const factor of splitCrossjoinFactors(setExpr)) {
      if (factorMatchesKey(factor, dim, altHiers)) { hits.push(factor); }
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Write back the factor of ONE dimension in the existing MDX — the rest verbatim.
 *
 * Counterpart to `axisFactorForDim`: that READS the factor, this WRITES it
 * back. Same uniqueness rule, so also the same three `null` cases.
 *
 * Occasion (finding 2026-08-23): the first attempt to express the collapse state
 * went through `buildCurrentMdx` — and that builds the axis from the matrix tuples
 * ANEW. The existing expression (`DRILLDOWNMEMBER(…MEMBERS…)`, `TM1FILTERBYLEVEL`)
 * was gone before the collapsing came up, the axis boiled down to a flat
 * tuple list, and the names in it came from the DISPLAY — with an alias
 * set, therefore not from the dimension at all. The server path does it
 * right: it WRAPS what is already there. That is exactly what this
 * function does for the local path, which saves the server round trip.
 *
 * Verbatim means verbatim: separators, bracketing, `NON EMPTY`, the
 * `DIMENSION PROPERTIES` and `ON …` tails and every other axis stay
 * character for character. Only the one factor is replaced by `wrap(factor)`.
 */
export function mapAxisFactorForDim(
  mdx: string,
  dim: string,
  wrap: (factor: string) => string,
  altHiers: readonly string[] = [],
): string | null {
  const parsed = parseSelect(mdx);
  if (!parsed) { return null; }

  // Count first, then write: same rule as when reading. Two factors
  // of the same dimension mean "not unambiguous" — then better touch nothing
  // at all than the wrong thing.
  let hits = 0;
  for (const seg of parsed.segments) {
    if (!axisOf(seg)) { continue; }
    hits += _countFactors(_axisBodyOf(seg).body, dim, altHiers);
  }
  if (hits !== 1) { return null; }

  const segments = parsed.segments.map((seg) => {
    if (!axisOf(seg)) { return seg; }
    const { head, body, tail } = _axisBodyOf(seg);
    return head + _mapFactors(body, dim, wrap, altHiers) + tail;
  });
  return parsed.pre + segments.join(',') + parsed.post;
}

/** Split an axis segment into `NON EMPTY` head, set expression and tail. */
function _axisBodyOf(segment: string): { head: string; body: string; tail: string } {
  const headMatch = segment.match(NON_EMPTY_HEAD);
  const head = headMatch ? headMatch[0] : '';
  const rest = segment.substring(head.length);
  const propsAt = rest.search(/\bDIMENSION\s+PROPERTIES\b/i);
  const onAt = rest.search(ON_AXIS_TAIL);
  const cuts = [propsAt, onAt].filter((i) => i >= 0);
  const cut = cuts.length ? Math.min(...cuts) : rest.length;
  return { head, body: rest.substring(0, cut), tail: rest.substring(cut) };
}

/** Wie viele Faktoren des Mengenausdrucks mit `dim` beginnen. */
function _countFactors(body: string, dim: string, altHiers: readonly string[]): number {
  return splitCrossjoinFactors(body).filter((f) => factorMatchesKey(f, dim, altHiers)).length;
}

/**
 * Apply `wrap` to the factor of `dim`, staying within the text structure.
 *
 * `splitCrossjoinFactors` flattens the function form in as well — that is not
 * suitable for writing back, because it loses the parentheses. Hence the same path
 * once more here, but layer by layer and with reassembly.
 */
function _mapFactors(
  body: string, dim: string, wrap: (factor: string) => string, altHiers: readonly string[],
): string {
  const parts = splitTopLevelStars(body);
  if (parts.length > 1) {
    return parts.map((p) => _mapFactors(p, dim, wrap, altHiers)).join('*');
  }

  const lead = body.match(/^\s*/)?.[0] ?? '';
  const trail = body.match(/\s*$/)?.[0] ?? '';
  const core = body.substring(lead.length, body.length - trail.length);
  if (!core) { return body; }

  const cj = core.match(/^CROSSJOIN\s*\(/i);
  if (cj) {
    const open = cj[0].length - 1;
    const close = _matchingParen(core, open);
    if (close === core.length - 1) {
      const args = _splitArgs(core.substring(open + 1, close));
      const mapped = args.map((a) => _mapFactors(a, dim, wrap, altHiers)).join(',');
      return `${lead}${cj[0]}${mapped})${trail}`;
    }
  }

  if (!factorMatchesKey(core, dim, altHiers)) { return body; }
  return lead + wrap(core) + trail;
}

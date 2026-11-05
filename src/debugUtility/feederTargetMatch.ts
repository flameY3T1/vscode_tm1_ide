// src/debugUtility/feederTargetMatch.ts
//
// Which FEEDERS statement can have fed this cell?
//
// TM1 has no reverse lookup. Measured on a cell that was provably overfed:
// `tm1.CheckFeeders` and `tm1.TraceFeeders` both answer empty, because they
// answer the OPPOSITE direction ("what does this cell feed onward?"), and
// `DebugUtility(100, …)` only prints the target coordinate, without the source
// field, regardless of arguments 2 and 3.
//
// That leaves the rule text. A feeder statement has the form
//
//     [source area] => [target area];
//
// and this module answers: does the target area cover this coordinate?
// That is a SUSPICION, not proof — several statements can hit the same
// cell, and that is the normal case, not the exception.
//
// No `vscode`, no network calls. Element trees come in as a callback.

/** One term of an area expression. */
export interface AreaTerm {
  /** Dimension name, if the statement names it. */
  dimension?: string;
  /** Allowed elements. More than one for set braces `{'A','B'}`. */
  elements: string[];
}

/** An area expression `['a', 'D':'b', 'D':{'c','d'}]`. */
export interface Area {
  terms: AreaTerm[];
  /** Raw text between the brackets — for display and debugging. */
  text: string;
}

/** A feeder statement from the FEEDERS section. */
export interface FeederStatement {
  /** 0-based line number where the statement starts in the rule text. */
  line: number;
  source: Area;
  target: Area;
  /** The statement as written (without the trailing semicolon). */
  text: string;
}

/** Result of matching against ONE statement. */
export interface FeederMatch {
  statement: FeederStatement;
  /**
   * `true` = the coordinate lies in the target area. `undefined` = not
   * decidable, because a term could not be interpreted (expression,
   * attribute access, variable). Not decidable is explicitly NOT the
   * same as "does not match" — it must not silently drop out.
   */
  hits: boolean | undefined;
  /** Language-neutral reason why the match is not decidable. */
  reason?: MatchReason;
}

export type MatchReason =
  | { kind: 'termNichtDeutbar'; value: string }
  | { kind: 'elementOhneDimension'; value: string }
  | { kind: 'dimensionNichtImCube'; value: string };

/**
 * Assigns a dimension and resolves consolidations.
 *
 * `dimensionOf(element)` returns the name of the dimension an unqualified
 * element belongs to (`['Value']` instead of `['Measures':'Value']`).
 * `contains(dimension, consolidation, element)` answers whether the element
 * sits under the consolidation — equality included.
 */
export interface ModelKnowledge {
  dimensionOf(element: string): string | undefined;
  contains(dimension: string, consolidation: string, element: string): boolean;
}

/**
 * TM1 compares object names WITHOUT regard to upper/lower case.
 *
 * This is not a detail: the first version of this module compared strictly, and
 * against the real rule text NOT A SINGLE statement could be matched — the rule
 * writes `'RULE'`, the element is called `Rule`. Three out of three statements
 * came out as "not decidable". Only the run against the server found this,
 * not the test table.
 *
 * A `ModelKnowledge` must therefore look names up case-insensitively too.
 */
export function normName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Name equality by TM1 rules. */
export function sameName(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

/** Strip comments: `#` to end of line, outside single quotes. */
function withoutComment(line: string): string {
  let inText = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") { inText = !inText; continue; }
    if (c === '#' && !inText) { return line.slice(0, i); }
  }
  return line;
}

/**
 * Splits the FEEDERS section into statements.
 *
 * A statement may span several lines and ends at the semicolon; the reported
 * line is the one where it BEGINS — that is where a jump into the rule editor
 * belongs.
 */
export function parseFeederStatements(ruleText: string): FeederStatement[] {
  const lines = ruleText.split(/\r?\n/);
  const start = lines.findIndex((z) => /^\s*feeders\s*;/i.test(withoutComment(z)));
  if (start < 0) { return []; }

  const statements: FeederStatement[] = [];
  let buffer = '';
  let startLine = -1;
  for (let i = start + 1; i < lines.length; i++) {
    const clean = withoutComment(lines[i]);
    if (!clean.trim()) { continue; }
    if (startLine < 0) { startLine = i; }
    buffer += (buffer ? ' ' : '') + clean.trim();
    if (!buffer.includes(';')) { continue; }
    // Several statements on one line are allowed.
    for (const piece of buffer.split(';')) {
      const t = piece.trim();
      if (!t) { continue; }
      const a = parseStatement(t, startLine);
      if (a) { statements.push(a); }
    }
    buffer = '';
    startLine = -1;
  }
  return statements;
}

/** A single `[…] => […]` statement. */
function parseStatement(text: string, line: number): FeederStatement | undefined {
  const arrow = text.indexOf('=>');
  if (arrow < 0) { return undefined; }
  const source = parseArea(text.slice(0, arrow));
  const target = parseArea(text.slice(arrow + 2));
  if (!source || !target) { return undefined; }
  return { line, source, target, text };
}

/**
 * Interprets an area expression `[ … ]`.
 *
 * Splits at commas on the TOP level only — a comma inside set braces belongs
 * to the set, not to the term list. Without this distinction
 * `'D':{'A','B'}` falls apart into two terms and the match shifts by one
 * position.
 */
export function parseArea(raw: string): Area | undefined {
  const open = raw.indexOf('[');
  const close = raw.lastIndexOf(']');
  if (open < 0 || close < open) { return undefined; }
  const inner = raw.slice(open + 1, close);

  const pieces: string[] = [];
  let depth = 0;
  let inText = false;
  let current = '';
  for (const c of inner) {
    if (c === "'") { inText = !inText; current += c; continue; }
    if (!inText && c === '{') { depth++; current += c; continue; }
    if (!inText && c === '}') { depth--; current += c; continue; }
    if (!inText && c === ',' && depth === 0) { pieces.push(current); current = ''; continue; }
    current += c;
  }
  if (current.trim()) { pieces.push(current); }

  const terms: AreaTerm[] = [];
  for (const s of pieces) {
    const t = parseTerm(s.trim());
    if (t) { terms.push(t); }
  }
  return { terms, text: inner.trim() };
}

/**
 * One term. Four notations occur in real rules:
 *
 *   `'El'`               unqualified
 *   `'Dim':'El'`         qualified
 *   `'Dim':{'A','B'}`    qualified set
 *   `{'Dim':'A','B','C'}` set that carries the dimension name INSIDE
 *
 * The last form was not in the plan and came from the run against a real
 * customer cube (`{'Dim': 'A-B', 'B-A', …}`). Without it,
 * two out of three statements dropped out as "not interpretable".
 */
function parseTerm(s: string): AreaTerm | undefined {
  if (!s) { return undefined; }
  const colon = separatorOutside(s, ':');
  const leftSide = colon >= 0 ? s.slice(0, colon).trim() : '';
  const rightSide = colon >= 0 ? s.slice(colon + 1).trim() : s;

  if (colon >= 0) {
    const dimension = literal(leftSide);
    // A named dimension whose name is not a literal (variable, expression)
    // would be a guess — the term then passes without elements and makes the
    // match undecidable, instead of matching wrongly.
    if (dimension === undefined) { return { elements: [] }; }
    return { dimension, elements: elementsFrom(rightSide) };
  }

  const t = s.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    const inner = t.slice(1, -1);
    const innerColon = separatorOutside(inner, ':');
    if (innerColon >= 0) {
      // `{'Dim': 'A', 'B'}` — the name before the colon is the dimension,
      // everything after it belongs to the set.
      const dimension = literal(inner.slice(0, innerColon));
      if (dimension === undefined) { return { elements: [] }; }
      return { dimension, elements: literals(inner.slice(innerColon + 1)) };
    }
  }
  return { dimension: undefined, elements: elementsFrom(t) };
}

/** First occurrence of `char` outside single quotes and braces. */
function separatorOutside(s: string, char: string): number {
  let inText = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { inText = !inText; continue; }
    if (inText) { continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (c === char && depth === 0) { return i; }
  }
  return -1;
}

/** The content of a single-quoted literal, or `undefined` if it is not one. */
function literal(s: string): string | undefined {
  const m = /^'((?:[^']|'')*)'$/.exec(s.trim());
  return m ? m[1].replace(/''/g, "'") : undefined;
}

/** All element literals of one side of a term; empty if nothing interpretable is there. */
function elementsFrom(s: string): string[] {
  const t = s.trim();
  const single = literal(t);
  if (single !== undefined) { return [single]; }
  if (t.startsWith('{') && t.endsWith('}')) { return literals(t.slice(1, -1)); }
  return [];
}

/**
 * The literals of an enumeration. If anything else stands between them
 * (expression, function call), the list counts as not interpreted and comes
 * back empty — better undecidable than too narrow.
 */
function literals(inner: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) { out.push(m[1].replace(/''/g, "'")); }
  return inner.replace(re, '').replace(/[\s,]/g, '') === '' ? out : [];
}

/**
 * Does the statement cover this cell coordinate?
 *
 * Model: the target area defines which dimensions the fed cell carries
 * DIFFERENTLY from the source cell. Everything it does not name, the fed cell
 * takes over unchanged from the source — so there the coordinate must satisfy
 * the SOURCE area. If neither names the dimension, it is free. Exactly this
 * chain makes the difference between "a few plausible lines" and "the lines
 * that can really hit this cell".
 */
export function hitsCell(
  statement: FeederStatement,
  dimensions: readonly string[],
  coordinates: readonly string[],
  model: ModelKnowledge,
): FeederMatch {
  const targetTerms = assign(statement.target, dimensions, model);
  const sourceTerms = assign(statement.source, dimensions, model);
  if (targetTerms.unclear) { return { statement, hits: undefined, reason: targetTerms.unclear }; }
  if (sourceTerms.unclear) { return { statement, hits: undefined, reason: sourceTerms.unclear }; }

  for (let i = 0; i < dimensions.length; i++) {
    const allowed = targetTerms.proDim.get(dimensions[i]) ?? sourceTerms.proDim.get(dimensions[i]);
    if (!allowed) { continue; }
    const element = coordinates[i];
    // Equality OR below a named consolidation — a target area
    // on `Total` also feeds its leaves.
    const fits = allowed.some((e) => sameName(e, element) || model.contains(dimensions[i], e, element));
    if (!fits) { return { statement, hits: false }; }
  }
  return { statement, hits: true };
}

/**
 * Maps the term list onto dimensions. Unqualified terms are assigned to a
 * dimension via the model knowledge; if that fails, the whole area is
 * undecidable.
 */
function assign(
  area: Area, dimensions: readonly string[], model: ModelKnowledge,
): { proDim: Map<string, string[]>; unclear?: MatchReason } {
  const proDim = new Map<string, string[]>();
  for (const term of area.terms) {
    if (term.elements.length === 0) {
      return { proDim, unclear: { kind: 'termNichtDeutbar', value: area.text } };
    }
    let dim = term.dimension;
    if (!dim) {
      dim = model.dimensionOf(term.elements[0]);
      if (!dim) {
        return { proDim, unclear: { kind: 'elementOhneDimension', value: term.elements[0] } };
      }
    }
    const imCube = dimensions.find((d) => sameName(d, dim));
    if (!imCube) {
      // A feeder may point into a DIFFERENT cube; then this statement says
      // nothing about our cell. That is not an error, just not a match.
      return { proDim, unclear: { kind: 'dimensionNichtImCube', value: dim } };
    }
    proDim.set(imCube, term.elements);
  }
  return { proDim };
}

/** All statements that can hit this cell — matches first. */
export function matchesFor(
  statements: readonly FeederStatement[],
  dimensions: readonly string[],
  coordinates: readonly string[],
  model: ModelKnowledge,
): FeederMatch[] {
  return statements
    .map((a) => hitsCell(a, dimensions, coordinates, model))
    .filter((z) => z.hits !== false);
}

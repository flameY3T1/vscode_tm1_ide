/**
 * MDX pretty printer for the MDX runner and the cube-viewer MDX popup.
 *
 * Token based, no grammar: a real MDX parser would have to know every TM1
 * function to be useful, and the generated statements we deal with are flat
 * enough that bracket nesting plus clause keywords carry the whole layout.
 * Unknown input is reproduced verbatim-ish (only whitespace and keyword case
 * change), so a statement the printer does not understand still runs.
 *
 * Pure module — no `vscode`, used from the webview bundles.
 */

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'WITH', 'AS',
  'ON', 'COLUMNS', 'ROWS', 'PAGES', 'CHAPTERS', 'SECTIONS', 'AXIS',
  'NON', 'EMPTY', 'NOT', 'AND', 'OR', 'XOR',
  'MEMBERS', 'CHILDREN', 'DESCENDANTS', 'ANCESTORS', 'ANCESTOR', 'PARENT',
  'HIERARCHIZE', 'ORDER', 'FILTER', 'DISTINCT', 'GENERATE',
  'CROSSJOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'EXISTS', 'LEAVES',
  'HEAD', 'TAIL', 'SUBSET', 'ITEM',
  'BOTTOMCOUNT', 'BOTTOMPERCENT', 'BOTTOMSUM',
  'TOPCOUNT', 'TOPPERCENT', 'TOPSUM',
  'DRILLDOWNLEVEL', 'DRILLUPMEMBER', 'DRILLDOWNMEMBER',
  'TM1SUBSETALL', 'TM1FILTERBYLEVEL', 'TM1FILTERBYPATTERN',
  'TM1SUBSETTOSET', 'TM1DRILLDOWNMEMBER', 'TM1SORT', 'TM1TOGGLEDRILLSTATE',
  'ELEMENT', 'ROLLUP',
  'SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'MEDIAN', 'AGGREGATE',
  'YTD', 'QTD', 'MTD', 'WTD', 'PARALLELPERIOD', 'LAG', 'LEAD',
  'PERIODSTODATE', 'CLOSINGPERIOD', 'OPENINGPERIOD',
  'IIF', 'IS', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'PROPERTIES', 'CURRENTMEMBER', 'DEFAULTMEMBER',
  'DIMENSION', 'HIERARCHY', 'LEVEL', 'LEVELS',
  'SET', 'MEMBER', 'SOLVE_ORDER', 'FORMAT_STRING',
];
const KEYWORD_SET = new Set(KEYWORDS);

/** Clause keywords that always start a new line at indent 0. */
const CLAUSE = new Set(['WITH', 'SELECT', 'FROM', 'WHERE']);
/** Inside WITH: each definition starts a new line. */
const DEFINITION = new Set(['MEMBER', 'SET']);
/** Keywords after which a `(` keeps a blank — `WHERE (…)`, not `WHERE(…)`. */
const SPACE_BEFORE_PAREN = new Set(['WHERE', 'NOT', 'AND', 'OR', 'XOR', 'IS', 'THEN', 'ELSE', 'RETURN', 'IN']);

type Kind = 'comment' | 'lineComment' | 'string' | 'bracket' | 'number' | 'word' | 'op' | 'comma' | 'close' | 'open';
export interface Token {
  kind: Kind;
  /** Keywords come back upper-cased; everything else is the source slice. */
  text: string;
  /** Offset of the token's first character in the source. */
  start: number;
}
interface Group { open: string; close?: string; children: Node[] }
type Node = Token | Group;

function isGroup(n: Node): n is Group {
  return (n as Group).children !== undefined;
}

export function tokenizeMdx(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  // Every branch below pushes BEFORE it advances `i`, so `i` is the token start.
  const push = (kind: Kind, text: string): void => { out.push({ kind, text, start: i }); };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      push('comment', src.slice(i, stop));
      i = stop;
      continue;
    }
    // `//` is an MDX line comment too — and carries the notebook's `// check:` / `// name:` lines.
    if ((c === '-' && src[i + 1] === '-') || (c === '/' && src[i + 1] === '/')) {
      let end = src.indexOf('\n', i);
      if (end === -1) { end = src.length; }
      push('lineComment', src.slice(i, end).trimEnd());
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === c) {
          if (src[j + 1] === c) { j += 2; continue; }  // doubled quote = escape
          j++;
          break;
        }
        j++;
      }
      push('string', src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '[') {
      // `]]` is the MDX escape for a literal `]`, so scan past doubled ones.
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === ']') {
          if (src[j + 1] === ']') { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      push('bracket', src.slice(i, j));
      i = j;
      continue;
    }
    if (c >= '0' && c <= '9') {
      const m = /^\d+(?:\.\d+)?/.exec(src.slice(i))!;
      push('number', m[0]);
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const upper = m[0].toUpperCase();
      push('word', KEYWORD_SET.has(upper) ? upper : m[0]);
      i += m[0].length;
      continue;
    }
    if (c === ',') { push('comma', ','); i++; continue; }
    if (c === '(' || c === '{') { push('open', c); i++; continue; }
    if (c === ')' || c === '}') { push('close', c); i++; continue; }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') { push('op', two); i += 2; continue; }
    push('op', c);
    i++;
  }
  return out;
}

function build(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  const opens: Group[] = [];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t.kind === 'open') {
      // `close` stays undefined until the source actually closes the group. An
      // invented closer would change what the statement means — and a second
      // click would invent another one (`'open)` → `'open))` → `'open)))`).
      const g: Group = { open: t.text, children: [] };
      top.push(g);
      opens.push(g);
      stack.push(g.children);
      continue;
    }
    if (t.kind === 'close') {
      if (stack.length > 1) {
        // Keep whatever the source actually wrote — unbalanced input stays readable.
        opens.pop()!.close = t.text;
        stack.pop();
      } else {
        top.push(t);
      }
      continue;
    }
    top.push(t);
  }
  return root;
}

/** No blank between `nodes[i-1]` and `nodes[i]`? */
function glued(nodes: Node[], i: number): boolean {
  const a = nodes[i - 1];
  const b = nodes[i];
  const at = isGroup(a) ? (a.close ?? '') : a.text;
  const ak: Kind | 'group' = isGroup(a) ? 'group' : a.kind;
  const bk: Kind | 'group' = isGroup(b) ? 'group' : b.kind;
  const bt = isGroup(b) ? b.open : b.text;
  if (bk === 'comma') { return true; }
  if (ak === 'op' && (at === '.' || at === ':')) { return true; }
  if (bk === 'op' && (bt === '.' || bt === ':')) { return true; }
  if (ak === 'op' && (at === '-' || at === '+')) {
    // Sign, not subtraction: nothing to subtract from before it.
    const before = i >= 2 ? nodes[i - 2] : undefined;
    return before === undefined || (!isGroup(before) && (before.kind === 'op' || before.kind === 'comma'));
  }
  if (bk === 'group' && bt === '(') {
    // `FUNC(...)` glued, `WHERE (...)` not.
    if (ak === 'word') { return !SPACE_BEFORE_PAREN.has(at.toUpperCase()); }
    return ak !== 'comma' && ak !== 'group';
  }
  return false;
}

function hasLineComment(nodes: Node[]): boolean {
  return nodes.some(n => isGroup(n) ? hasLineComment(n.children) : n.kind === 'lineComment');
}

function flat(nodes: Node[]): string {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const text = isGroup(n) ? n.open + flat(n.children) + (n.close ?? '') : n.text;
    if (i > 0 && !glued(nodes, i)) { out += ' '; }
    out += text;
  }
  return out;
}

/** Split on commas that sit directly in this node list. */
function splitCommas(nodes: Node[]): Node[][] {
  const parts: Node[][] = [[]];
  for (const n of nodes) {
    if (!isGroup(n) && n.kind === 'comma') { parts.push([]); continue; }
    parts[parts.length - 1].push(n);
  }
  // Empty parts stay: each one carries a comma of the source. Filtering them
  // away loses the comma at the end of the set when wrapping
  // (`{[a],[b],}` → `{[a], [b]}`) — the button would have changed the text.
  return parts;
}

/**
 * A `--` comment eats the rest of its line, so a separator appended to a part
 * that ends in one would be commented out and lost from the statement.
 */
function endsInLineComment(nodes: Node[]): boolean {
  const last = nodes[nodes.length - 1];
  return last !== undefined && !isGroup(last) && last.kind === 'lineComment';
}

interface Opts { indent: string; width: number }

function renderGroup(g: Group, level: number, o: Opts): string {
  const oneLine = g.open + flat(g.children) + (g.close ?? '');
  if (!hasLineComment(g.children) && o.indent.length * level + oneLine.length <= o.width) { return oneLine; }
  const parts = splitCommas(g.children);
  const pad = o.indent.repeat(level + 1);
  const body = parts.map((p, i) => pad + renderNodes(p, level + 1, o)
    + (i < parts.length - 1 ? (endsInLineComment(p) ? `\n${pad},` : ',') : '')).join('\n');
  const tail = g.close === undefined ? '' : `\n${o.indent.repeat(level)}${g.close}`;
  return `${g.open}\n${body}${tail}`;
}

function renderNodes(nodes: Node[], level: number, o: Opts): string {
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const text = isGroup(n) ? renderGroup(n, level, o) : n.text;
    // After a line comment the line is already broken; no blank before the next token.
    if (i > 0 && !glued(nodes, i) && !endsInLineComment(nodes.slice(i - 1, i))) { out += ' '; }
    out += text;
    // A line comment eats the rest of its line — everything after it must wrap.
    if (!isGroup(n) && n.kind === 'lineComment' && i < nodes.length - 1) { out += '\n' + o.indent.repeat(level); }
  }
  return out;
}

/** Indices of top-level tokens that open a new clause / definition. */
function breakIndices(nodes: Node[]): number[] {
  const idx: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (isGroup(n) || n.kind !== 'word') { continue; }
    if (CLAUSE.has(n.text) || DEFINITION.has(n.text)) { idx.push(i); }
  }
  return idx;
}

export interface FormatMdxOptions {
  /** One indent step. Default two blanks. */
  indent?: string;
  /**
   * How wide a GROUP may be before it is broken over lines. Default 100.
   *
   * Measured from the group's own indent, NOT from the column it starts in:
   * whatever sits to its left on the same line (`FILTER(`, a trailing
   * `ON COLUMNS`) is not counted. A line built from function name, group and
   * axis therefore exceeds this number regularly. Stated here rather than
   * fixed — threading the real column through every level would change how
   * every statement wraps, and the button's job is to be predictable.
   */
  width?: number;
}

/**
 * Lay out an MDX statement: one line per clause, axis specs and long sets
 * broken at their commas, keywords upper-cased. Returns the input unchanged
 * when it holds nothing but whitespace.
 */
export function formatMdx(src: string, opts: FormatMdxOptions = {}): string {
  const o: Opts = { indent: opts.indent ?? '  ', width: opts.width ?? 100 };
  const tokens = tokenizeMdx(src);
  if (tokens.length === 0) { return src.trim(); }
  const nodes = build(tokens);

  const breaks = breakIndices(nodes);
  const lines: string[] = [];
  const starts = breaks.length > 0 && breaks[0] === 0 ? breaks : [0, ...breaks];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : nodes.length;
    const chunk = nodes.slice(from, to);
    const head = chunk[0];
    const isDefinition = !isGroup(head) && head.kind === 'word' && DEFINITION.has(head.text);
    // Inside SELECT the axis specs are comma separated at top level: one per line.
    const isSelect = !isGroup(head) && head.kind === 'word' && head.text === 'SELECT';
    const level = isDefinition ? 1 : 0;
    if (isSelect) {
      const parts = splitCommas(chunk.slice(1));
      lines.push('SELECT');
      parts.forEach((p, i) => {
        const sep = i < parts.length - 1 ? (endsInLineComment(p) ? `\n${o.indent},` : ',') : '';
        lines.push(o.indent + renderNodes(p, 1, o) + sep);
      });
      continue;
    }
    lines.push(o.indent.repeat(level) + renderNodes(chunk, level, o));
  }
  return lines.join('\n');
}

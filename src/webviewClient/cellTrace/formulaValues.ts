// src/webviewClient/cellTrace/formulaValues.ts
//
// Puts the traced operand values into a rule's formula:
//
//   ['GM'] \ ['Sales']        →   1,234 \ 5,678
//
// The trace returns the statement as text and the operands as separate
// components, with no link between them. The link is rebuilt here: every cell
// reference on the right-hand side is resolved to a tuple and matched against
// the components by cube and tuple. Matching by POSITION would be wrong —
// components come in evaluation order, and an IF only evaluates one branch.
//
// A reference that cannot be resolved safely stays as written: a set in braces,
// an argument that is an expression (`'VD' | !Jahre`, `Subst(...)`), or a match
// that is ambiguous. Showing the reference is honest; guessing a number is not.
//
// Pure: no DOM, no vscode — shared by the webview and a node test.

/** The part of a trace node this module needs. */
export interface Operand {
  cube?: string;
  tuple: string[];
  value: number | string | null;
}

/** Cell whose rule is shown: its cube, that cube's dimensions and its tuple. */
export interface RuleCell {
  cube: string;
  dims: string[];
  tuple: string[];
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Index after the bracket/paren that closes the one at `open`, ignoring quoted text. */
function closeOf(s: string, open: number): number {
  const pairs: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
  const stack: string[] = [];
  let inText = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { inText = !inText; continue; }
    if (inText) { continue; }
    if (pairs[c]) { stack.push(pairs[c]); continue; }
    if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) { return i + 1; }
    }
  }
  return -1;
}

/** Split at commas on the top level, outside quotes and brackets. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inText = false;
  let cur = '';
  for (const c of s) {
    if (c === "'") { inText = !inText; }
    else if (!inText && '([{'.includes(c)) { depth++; }
    else if (!inText && ')]}'.includes(c)) { depth--; }
    if (c === ',' && !inText && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}

/** Content of a quoted literal, or undefined if `s` is anything else. */
function literal(s: string): string | undefined {
  const m = /^'((?:[^']|'')*)'$/.exec(s.trim());
  return m ? m[1].replace(/''/g, "'") : undefined;
}

/** `['D':'e', 'f']` on the cell's own cube → constraints, or undefined if not resolvable. */
function areaMatcher(inner: string, cell: RuleCell): ((o: Operand) => boolean) | undefined {
  const fixed = new Map<number, string>();
  const loose: string[] = [];
  for (const term of splitTop(inner)) {
    const colon = term.indexOf(':');
    if (colon >= 0 && literal(term.slice(0, colon)) !== undefined) {
      const dim = literal(term.slice(0, colon))!;
      const el = literal(term.slice(colon + 1));
      const pos = cell.dims.findIndex(d => eq(d, dim));
      if (el === undefined || pos < 0) { return undefined; }
      fixed.set(pos, el);
    } else {
      const el = literal(term);
      if (el === undefined) { return undefined; }
      loose.push(el);
    }
  }
  return (o) => {
    if (o.cube && !eq(o.cube, cell.cube)) { return false; }
    if (o.tuple.length !== cell.tuple.length) { return false; }
    const left = [...loose];
    for (let i = 0; i < o.tuple.length; i++) {
      const want = fixed.get(i);
      if (want !== undefined) {
        if (!eq(o.tuple[i], want)) { return false; }
        continue;
      }
      if (eq(o.tuple[i], cell.tuple[i])) { continue; }
      const k = left.findIndex(e => eq(e, o.tuple[i]));
      if (k < 0) { return false; }
      left.splice(k, 1);
    }
    return true;
  };
}

type Matcher = ((o: Operand) => boolean) & { exact?: boolean };

/**
 * `DB('Cube', !Dim, 'lit', <expr>)` → constraints; an expression argument
 * matches anything. `exact` = every argument resolved, so the reference names
 * one cell.
 */
function dbMatcher(args: string, cell: RuleCell): Matcher | undefined {
  const parts = splitTop(args);
  const cube = literal(parts[0] ?? '');
  if (cube === undefined) { return undefined; }
  const want = parts.slice(1).map((a): string | null => {
    const bang = /^!\s*(.+)$/.exec(a);
    if (bang) {
      const pos = cell.dims.findIndex(d => eq(d, bang[1]));
      return pos >= 0 ? cell.tuple[pos] ?? null : null;
    }
    return literal(a) ?? null;
  });
  const m: Matcher = (o) => !!o.cube && eq(o.cube, cube) && o.tuple.length === want.length
    && want.every((w, i) => w === null || eq(w, o.tuple[i]));
  m.exact = want.every(w => w !== null);
  return m;
}

/** Right-hand side of `[area] = N: <rhs>;` — whitespace collapsed, `;` dropped. */
function rightHandSide(statement: string): string | undefined {
  const s = statement.trim();
  if (!s.startsWith('[')) { return undefined; }
  const end = closeOf(s, 0);
  if (end < 0) { return undefined; }
  const m = /^\s*=\s*(?:[NCS]\s*:)?([\s\S]*)$/i.exec(s.slice(end));
  if (!m) { return undefined; }
  return m[1].replace(/;\s*$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * The right-hand side of `statement` with every resolvable cell reference
 * replaced by its value, or undefined when not a single reference resolved —
 * then there is nothing to add to the statement that is already shown.
 */
export function formulaWithValues(
  statement: string,
  cell: RuleCell,
  operands: readonly Operand[],
  fmt: (v: number | string | null) => string,
): string | undefined {
  const rhs = rightHandSide(statement);
  if (rhs === undefined) { return undefined; }
  const refs = references(rhs, cell);
  // An operand that a fully written reference names is that reference's
  // cell. A reference with an unresolved argument only gets an operand no
  // other reference could name: in `IF(…, DB('S', 'A' | !V), DB('S', 'B' | !V))`
  // only one branch ran, and its value says nothing about the other.
  let out = '';
  let hits = 0;
  let at = 0;
  for (const ref of refs) {
    const { start, end, matcher } = ref;
    out += rhs.slice(at, start);
    const pool = matcher?.exact ? operands
      : operands.filter(o => !refs.some(r => r !== ref && r.matcher?.(o)));
    const values = new Set(matcher ? pool.filter(matcher).map(o => fmt(o.value)) : []);
    if (values.size === 1) {
      out += [...values][0];
      hits++;
    } else {
      out += rhs.slice(start, end);
    }
    at = end;
  }
  out += rhs.slice(at);
  return hits ? out : undefined;
}

/** Cell references in `rhs` (area `[...]` and `DB(...)`), skipping quoted strings. */
function references(rhs: string, cell: RuleCell): Array<{ start: number; end: number; matcher: Matcher | undefined }> {
  const refs: Array<{ start: number; end: number; matcher: Matcher | undefined }> = [];
  let i = 0;
  while (i < rhs.length) {
    const c = rhs[i];
    if (c === "'") {
      const end = rhs.indexOf("'", i + 1);
      i = end < 0 ? rhs.length : end + 1;
      continue;
    }
    let matcher: Matcher | undefined;
    let end = -1;
    if (c === '[') {
      end = closeOf(rhs, i);
      if (end > 0) { matcher = areaMatcher(rhs.slice(i + 1, end - 1), cell); }
    } else if (/^DB\s*\(/i.test(rhs.slice(i)) && !/[\w.]/.test(rhs[i - 1] ?? '')) {
      const open = rhs.indexOf('(', i);
      end = closeOf(rhs, open);
      if (end > 0) { matcher = dbMatcher(rhs.slice(open + 1, end - 1), cell); }
    }
    if (end < 0) { i++; continue; }
    refs.push({ start: i, end, matcher });
    i = end;
  }
  return refs;
}

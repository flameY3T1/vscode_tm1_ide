// Consolidation compare: effective weight of every leaf under a root, compared
// against a reference root. Pure — runs in the extension host and is bundled
// into the webview client.

export interface Edge { parent: string; child: string; weight: number }

export type Change =
  | { action: 'add'; parent: string; child: string; weight: number }
  | { action: 'remove'; parent: string; child: string }
  | { action: 'weight'; parent: string; child: string; weight: number };

export type CellClass = 'ok' | 'missing' | 'double' | 'extra' | 'wrongWeight';

export const CELL_CLASSES: readonly CellClass[] = ['ok', 'missing', 'double', 'extra', 'wrongWeight'];

const EPS = 1e-9;

/** Paths per cell are capped; a lattice of shared nodes can multiply them. */
export const MAX_PATHS = 50;

export class CycleError extends Error {
  constructor(readonly node: string) {
    super(`cycle through ${node}`);
  }
}

const edgeKey = (parent: string, child: string): string => `${parent}\u0000${child}`;

export function isZero(w: number): boolean {
  return Math.abs(w) < EPS;
}

/** Base edges with the draft applied, in base order; added edges go to the end. */
export function applyChanges(base: readonly Edge[], changes: readonly Change[]): Edge[] {
  const m = new Map<string, Edge>(base.map(e => [edgeKey(e.parent, e.child), { ...e }]));
  for (const c of changes) {
    const k = edgeKey(c.parent, c.child);
    if (c.action === 'add') { m.set(k, { parent: c.parent, child: c.child, weight: c.weight }); }
    else if (c.action === 'remove') { m.delete(k); }
    else { const e = m.get(k); if (e) { e.weight = c.weight; } }
  }
  return [...m.values()];
}

export interface Model {
  readonly edges: readonly Edge[];
  /** Consolidations without a parent, in first-seen order. */
  readonly tops: string[];
  /** Every element with children, in first-seen order. */
  readonly consolidations: string[];
  has(name: string): boolean;
  children(name: string): readonly Edge[];
  parents(name: string): readonly string[];
  weight(parent: string, child: string): number | undefined;
  /** leaf → effective weight under `root`. Throws `CycleError`. */
  effectiveWeights(root: string): Map<string, number>;
  /** All paths root→leaf as edge lists, at most `MAX_PATHS`. */
  paths(root: string, leaf: string): Edge[][];
  /** Every node reachable from `root`, `root` included. */
  reach(root: string): Set<string>;
  /** Leaves under `root` in tree order, each once. */
  leafOrder(root: string): string[];
}

export function buildModel(edges: readonly Edge[]): Model {
  return growableModel(edges).model;
}

/**
 * A model that takes further edges in place. Adding edge by edge to a fresh
 * `buildModel` each time copies every edge per add — seconds for thousands of
 * adds on a large hierarchy.
 */
export function growableModel(edges: readonly Edge[]): { model: Model; add(e: Edge): void } {
  const list: Edge[] = [];
  const kids = new Map<string, Edge[]>();
  const parentsOf = new Map<string, string[]>();
  const weights = new Map<string, number>();
  const all = new Set<string>();
  let order: { tops: string[]; consolidations: string[] } | null = null;
  function add(e: Edge): void {
    list.push(e);
    order = null;
    memo.clear();
    let k = kids.get(e.parent);
    if (!k) { k = []; kids.set(e.parent, k); }
    k.push(e);
    let p = parentsOf.get(e.child);
    if (!p) { p = []; parentsOf.set(e.child, p); }
    p.push(e.parent);
    weights.set(edgeKey(e.parent, e.child), e.weight);
    all.add(e.parent); all.add(e.child);
  }

  // ponytail: one leaf map per node — memory ~ leaves × depth; fine for
  // planning dimensions, revisit if a 100k-leaf hierarchy shows up.
  const memo = new Map<string, Map<string, number>>();
  const onStack = new Set<string>();
  for (const e of edges) { add(e); }
  function eff(n: string): Map<string, number> {
    const hit = memo.get(n);
    if (hit) { return hit; }
    const ch = kids.get(n);
    if (!ch) { const m = new Map([[n, 1]]); memo.set(n, m); return m; }
    if (onStack.has(n)) { throw new CycleError(n); }
    onStack.add(n);
    const m = new Map<string, number>();
    try {
      for (const e of ch) {
        for (const [leaf, w] of eff(e.child)) { m.set(leaf, (m.get(leaf) ?? 0) + e.weight * w); }
      }
    } finally {
      onStack.delete(n);
    }
    memo.set(n, m);
    return m;
  }

  function reach(root: string): Set<string> {
    const seen = new Set<string>();
    const stack = [root];
    while (stack.length) {
      const n = stack.pop() as string;
      if (seen.has(n)) { continue; }
      seen.add(n);
      for (const e of kids.get(n) ?? []) { stack.push(e.child); }
    }
    return seen;
  }

  function paths(root: string, leaf: string): Edge[][] {
    const out: Edge[][] = [];
    const acc: Edge[] = [];
    const walk = (n: string): void => {
      if (out.length >= MAX_PATHS) { return; }
      if (n === leaf) { out.push(acc.slice()); return; }
      for (const e of kids.get(n) ?? []) {
        if (!eff(e.child).has(leaf)) { continue; }
        acc.push(e); walk(e.child); acc.pop();
      }
    };
    if (all.has(root) && all.has(leaf)) { walk(root); }
    return out;
  }

  function leafOrder(root: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (n: string): void => {
      if (seen.has(n)) { return; }
      seen.add(n);
      const ch = kids.get(n);
      if (!ch) { out.push(n); return; }
      for (const e of ch) { walk(e.child); }
    };
    walk(root);
    return out;
  }

  const sorted = (): { tops: string[]; consolidations: string[] } => {
    if (!order) {
      const consolidations = [...kids.keys()];
      order = { tops: consolidations.filter(n => !parentsOf.has(n)), consolidations };
    }
    return order;
  };
  const model: Model = {
    edges: list,
    get tops() { return sorted().tops; },
    get consolidations() { return sorted().consolidations; },
    has: n => all.has(n),
    children: n => kids.get(n) ?? [],
    parents: n => parentsOf.get(n) ?? [],
    weight: (p, c) => weights.get(edgeKey(p, c)),
    effectiveWeights: root => (kids.has(root) ? eff(root) : new Map()),
    paths,
    reach,
    leafOrder,
  };
  return { model, add };
}

export function classify(expected: number, actual: number): CellClass {
  if (isZero(expected - actual)) { return 'ok'; }
  if (isZero(actual)) { return 'missing'; }
  if (isZero(expected)) { return 'extra'; }
  if (Math.sign(expected) === Math.sign(actual) && Math.abs(actual) > Math.abs(expected)) { return 'double'; }
  return 'wrongWeight';
}

export type ClassCounts = Record<CellClass, number>;

export interface CompareResult {
  /** Leaves of the reference and every compared root, in tree order, each once. */
  leaves: string[];
  expected: Map<string, number>;
  /** column id → leaf → effective weight. */
  actual: Map<string, Map<string, number>>;
  /** column id → leaf → class. */
  cls: Map<string, Map<string, CellClass>>;
  /** column id → count per class. A leaf at zero in both does not count as ok. */
  counts: Map<string, ClassCounts>;
}

/** One compared column: a root inside a model (server edges, or an imported file). */
export interface Column { id: string; model: Model; root: string }

/**
 * Reference weights come from `refModel`, every column from its own model —
 * server roots and imported files side by side. Results are keyed by column id.
 * `scope` (an attribute filter) limits the leaves looked at; outside it nothing counts.
 * Throws `CycleError` when a draft introduced a cycle.
 */
export function compare(
  refModel: Model, ref: string, cols: readonly Column[], scope?: ReadonlySet<string>,
): CompareResult {
  const expected = refModel.effectiveWeights(ref);
  const actual = new Map<string, Map<string, number>>();
  for (const c of cols) { actual.set(c.id, c.model.effectiveWeights(c.root)); }

  const leaves: string[] = [];
  const seen = new Set<string>();
  const addLeaves = (list: string[]): void => {
    for (const l of list) { if (!seen.has(l) && (!scope || scope.has(l))) { seen.add(l); leaves.push(l); } }
  };
  addLeaves(refModel.leafOrder(ref));
  for (const c of cols) { addLeaves(c.model.leafOrder(c.root)); }

  const cls = new Map<string, Map<string, CellClass>>();
  const counts = new Map<string, ClassCounts>();
  for (const col of cols) {
    const perLeaf = new Map<string, CellClass>();
    const c: ClassCounts = { ok: 0, missing: 0, double: 0, extra: 0, wrongWeight: 0 };
    const w = actual.get(col.id) as Map<string, number>;
    for (const l of leaves) {
      const s = expected.get(l) ?? 0;
      const k = classify(s, w.get(l) ?? 0);
      perLeaf.set(l, k);
      if (!(k === 'ok' && isZero(s))) { c[k]++; }
    }
    cls.set(col.id, perLeaf);
    counts.set(col.id, c);
  }
  return { leaves, expected, actual, cls, counts };
}

/** Leaf count and weight sum under `root` — the "value probe" on each tile. */
export function probe(weights: Map<string, number>): { leaves: number; sum: number } {
  let leaves = 0;
  let sum = 0;
  for (const w of weights.values()) { if (!isZero(w)) { leaves++; sum += w; } }
  return { leaves, sum };
}

/** Top-level roots (other than `except`) whose subtree contains `node`. */
export function rootsUsing(model: Model, node: string, except?: string): string[] {
  return model.tops.filter(r => r !== except && model.reach(r).has(node));
}

/** True when adding parent→child would close a cycle. */
export function wouldCycle(model: Model, parent: string, child: string): boolean {
  return parent === child || model.reach(child).has(parent);
}

/**
 * Net effect of the draft against the base: add-then-remove cancels out,
 * add-then-weight is one add with the last weight. Write order on save is
 * remove, patch, add.
 */
export function netOps(base: readonly Edge[], changes: readonly Change[]): { remove: Edge[]; patch: Edge[]; add: Edge[] } {
  return edgeDiff(base, applyChanges(base, changes));
}

/** Writes that turn edge set `from` into `to`. */
export function edgeDiff(from: readonly Edge[], to: readonly Edge[]): { remove: Edge[]; patch: Edge[]; add: Edge[] } {
  const before = new Map(from.map(e => [edgeKey(e.parent, e.child), e]));
  const after = new Map(to.map(e => [edgeKey(e.parent, e.child), e]));
  const remove: Edge[] = [];
  const patch: Edge[] = [];
  const add: Edge[] = [];
  for (const [k, e] of before) { if (!after.has(k)) { remove.push(e); } }
  for (const [k, e] of after) {
    const b = before.get(k);
    if (!b) { add.push(e); }
    else if (!isZero(b.weight - e.weight)) { patch.push(e); }
  }
  return { remove, patch, add };
}

/** `Parent;Child;Weight` of the subtree under `root`, depth-first, each edge once. */
export function subtreeCsv(model: Model, root: string): string {
  const lines = ['Parent;Child;Weight'];
  const seen = new Set<string>();
  const walk = (n: string): void => {
    if (seen.has(n)) { return; }
    seen.add(n);
    for (const e of model.children(n)) { lines.push(csvLine([e.parent, e.child, e.weight])); walk(e.child); }
  };
  walk(root);
  return lines.join('\n');
}

/** `Action;Parent;Child;Weight`, one line per draft entry. */
export function changesCsv(changes: readonly Change[]): string {
  return ['Action;Parent;Child;Weight', ...changes.map(c =>
    csvLine([c.action, c.parent, c.child, c.action === 'remove' ? '' : c.weight]))].join('\n');
}

/** Same edge set, weights included (order ignored) — the save-time conflict check. */
export function sameEdges(a: readonly Edge[], b: readonly Edge[]): boolean {
  if (a.length !== b.length) { return false; }
  const m = new Map(a.map(e => [edgeKey(e.parent, e.child), e.weight]));
  return b.every(e => {
    const w = m.get(edgeKey(e.parent, e.child));
    return w !== undefined && isZero(w - e.weight);
  });
}

const HEADER_NAMES = new Set(['parent', 'parentname', 'child', 'component', 'componentname', 'element', 'weight']);
/**
 * Edges from pasted or loaded text: `Parent;Child;Weight` lines (`;`, tab or
 * `,` separated, Excel paste included), or the JSON of
 * `GET …/Edges?$select=ParentName,ComponentName,Weight`. A missing weight is 1;
 * only the first line may have a non-numeric weight (the header); fields may
 * be quoted. Throws on any other malformed line.
 */
export function parseEdgeText(text: string): Edge[] {
  const t = text.replace(/^\uFEFF/, '').trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t) as unknown;
    const arr = Array.isArray(j) ? j : (j as { value?: unknown }).value;
    if (!Array.isArray(arr)) { throw new Error('JSON without a "value" list'); }
    return arr.map((e: { ParentName?: unknown; ComponentName?: unknown; Weight?: unknown }) => ({
      parent: String(e.ParentName), child: String(e.ComponentName), weight: e.Weight == null ? 1 : Number(e.Weight),
    }));
  }
  const sep = t.includes('\t') ? '\t' : t.includes(';') ? ';' : ',';
  const out: Edge[] = [];
  let first = true;
  for (const [n, rec] of csvRecords(t, sep).entries()) {
    const f = rec.map(x => x.trim());
    if (f.every(x => !x)) { continue; }
    const header = first;
    first = false;
    if (f.length < 2 || !f[0] || !f[1]) { throw new Error(`Line ${n + 1}: needs parent and child`); }
    // A header without a weight column (or with an empty weight cell) is told by its names.
    if (header && HEADER_NAMES.has(f[0].toLowerCase()) && HEADER_NAMES.has(f[1].toLowerCase())) { continue; }
    const raw = f[2] ?? '';
    const weight = raw === '' ? 1 : Number(raw.replace(',', '.'));
    if (Number.isNaN(weight)) {
      // Only the first line may be a header; a bad weight further down is an error, not a skip.
      if (header) { continue; }
      throw new Error(`Line ${n + 1}: weight "${raw}" is not a number`);
    }
    out.push({ parent: f[0], child: f[1], weight });
  }
  return out;
}

/** Records of `sep`-separated text: quoted fields may hold `sep`, `""` and line breaks. */
function csvRecords(text: string, sep: string): string[][] {
  const recs: string[][] = [];
  let rec: string[] = [];
  let f = '';
  let quoted = false;
  let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') { quoted = false; }
      else { f += c; }
    } else if (c === '"' && atStart) { quoted = true; atStart = false; }
    else if (c === sep) { rec.push(f); f = ''; atStart = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') { i++; }
      rec.push(f); recs.push(rec); rec = []; f = ''; atStart = true;
    } else { f += c; if (c !== ' ') { atStart = false; } }
  }
  rec.push(f); recs.push(rec);
  return recs;
}

/** TM1 element-name identity: case and spaces do not count. */
export function nameKey(n: string): string {
  return n.replace(/\s+/g, '').toLowerCase();
}

/**
 * Rewrites imported names to the server's spelling. Names the dimension does
 * not know keep the file's spelling and are listed in `unknown` (file order).
 */
export function matchNames(edges: readonly Edge[], known: Iterable<string>): { edges: Edge[]; unknown: string[] } {
  const byKey = new Map<string, string>();
  for (const k of known) { byKey.set(nameKey(k), k); }
  const unknown: string[] = [];
  const map = (n: string): string => {
    const hit = byKey.get(nameKey(n));
    if (hit !== undefined) { return hit; }
    if (!unknown.includes(n)) { unknown.push(n); }
    return n;
  };
  return { edges: edges.map(e => ({ parent: map(e.parent), child: map(e.child), weight: e.weight })), unknown };
}

export interface ImportDraft {
  changes: Change[];
  /** Import edges left out: an element the dimension does not have, or a cycle. */
  skipped: Edge[];
  /** Changed parents that other top roots also reach — the change shows up there too. */
  shared: string[];
}

/**
 * Turns an imported list into draft changes under `target`. The import root
 * stands for `target`; every consolidation of the import gets exactly the
 * import's children. Nodes the import only names as a child (no children in
 * the list) are used as they are — their own edges stay untouched, so
 * detaching a shared node never empties it for other roots.
 */
export function draftFromImport(
  server: Model, target: string, imp: Model, impRoot: string, unknown: ReadonlySet<string>,
): ImportDraft {
  const map = (n: string): string => (n === impRoot ? target : n);
  const changes: Change[] = [];
  const skipped: Edge[] = [];
  const touched = new Set<string>();
  const parents = [...imp.reach(impRoot)].filter(n => imp.children(n).length);
  const adds: Edge[] = [];

  for (const p of parents) {
    const parent = map(p);
    if (unknown.has(parent)) { skipped.push(...imp.children(p)); continue; }
    const want = new Map<string, number>();
    for (const e of imp.children(p)) {
      const child = map(e.child);
      if (unknown.has(child)) { skipped.push(e); continue; }
      want.set(child, (want.get(child) ?? 0) + e.weight);
    }
    for (const e of server.children(parent)) {
      if (!want.has(e.child)) { changes.push({ action: 'remove', parent, child: e.child }); touched.add(parent); }
    }
    for (const [child, weight] of want) {
      const w = server.weight(parent, child);
      if (w === undefined) { adds.push({ parent, child, weight }); }
      else if (!isZero(w - weight)) { changes.push({ action: 'weight', parent, child, weight }); touched.add(parent); }
    }
  }
  // Adds last, each checked against the state with everything before it applied.
  const work = growableModel(applyChanges(server.edges, changes));
  for (const e of adds) {
    if (wouldCycle(work.model, e.parent, e.child)) { skipped.push(e); continue; }
    changes.push({ action: 'add', ...e });
    touched.add(e.parent);
    work.add(e);
  }
  const shared = [...touched].filter(n => rootsUsing(server, n, target).length);
  return { changes, skipped, shared };
}

/** Root id of the built-in reference "every leaf once": a name TM1 cannot hold. */
export const ALL_LEAVES = '\u0002all';

/** Reference model in which every given leaf hangs once, weight 1, under `ALL_LEAVES`. */
export function allLeavesModel(leaves: readonly string[]): Model {
  return buildModel(leaves.map(l => ({ parent: ALL_LEAVES, child: l, weight: 1 })));
}

export interface BulkFix {
  changes: Change[];
  /** Leaves no parent could be suggested for. */
  skipped: string[];
  /** Changed parents other top roots also reach. */
  shared: string[];
}

/**
 * Parent under `root` to attach `leaf` to: the reference's own parent when
 * `root` contains it, else the parent most of its reference siblings already
 * hang under within `root`.
 */
export function suggestParent(model: Model, root: string, refModel: Model, ref: string, leaf: string): string | undefined {
  const under = model.reach(root);
  const refParents = refModel.paths(ref, leaf).map(p => p[p.length - 1].parent);
  const same = refParents.find(p => p !== ref && under.has(p) && model.children(p).length);
  if (same) { return same; }
  const votes = new Map<string, number>();
  for (const rp of refParents) {
    // Under the all-leaves root every leaf is a sibling — no signal there.
    if (rp === ALL_LEAVES) { continue; }
    for (const sib of refModel.children(rp)) {
      if (sib.child === leaf) { continue; }
      for (const p of model.parents(sib.child)) {
        if (under.has(p)) { votes.set(p, (votes.get(p) ?? 0) + 1); }
      }
    }
  }
  let best: string | undefined;
  let n = 0;
  for (const [p, c] of votes) { if (c > n) { best = p; n = c; } }
  return best;
}

/**
 * Draft changes that fix one column at once: every "missing" leaf attached
 * under a suggested parent with the reference weight divided by that
 * parent's own factor under `root` (skipped when the factor is zero), every "extra" leaf
 * detached from all its parents under `root`. Double and wrong-weight cells
 * stay single cases — which path is wrong needs a person.
 */
export function bulkFix(
  model: Model, root: string, refModel: Model, ref: string, cls: ReadonlyMap<string, CellClass>,
  expected: ReadonlyMap<string, number>,
): BulkFix {
  const changes: Change[] = [];
  const skipped: string[] = [];
  const touched = new Set<string>();
  const under = model.reach(root);
  for (const [leaf, k] of cls) {
    if (k !== 'extra') { continue; }
    for (const p of model.parents(leaf)) {
      if (under.has(p)) { changes.push({ action: 'remove', parent: p, child: leaf }); touched.add(p); }
    }
  }
  const work = growableModel(applyChanges(model.edges, changes));
  const cur = work.model;
  for (const [leaf, k] of cls) {
    if (k !== 'missing') { continue; }
    const p = suggestParent(cur, root, refModel, ref, leaf);
    // The new edge's weight is scaled by every path from root to p.
    const f = p ? factorUnder(cur, root, p) : 0;
    if (!p || isZero(f) || cur.weight(p, leaf) !== undefined || wouldCycle(cur, p, leaf)) { skipped.push(leaf); continue; }
    const weight = (expected.get(leaf) ?? 1) / f;
    changes.push({ action: 'add', parent: p, child: leaf, weight });
    touched.add(p);
    work.add({ parent: p, child: leaf, weight });
  }
  return { changes, skipped, shared: [...touched].filter(n => rootsUsing(model, n, root).length) };
}

/** Sum over all paths root→node of the product of edge weights; 1 for root itself. */
export function factorUnder(model: Model, root: string, node: string): number {
  const under = model.reach(root);
  const memo = new Map<string, number>();
  const f = (n: string): number => {
    if (n === root) { return 1; }
    const hit = memo.get(n);
    if (hit !== undefined) { return hit; }
    let sum = 0;
    for (const q of model.parents(n)) { if (under.has(q)) { sum += f(q) * (model.weight(q, n) ?? 0); } }
    memo.set(n, sum);
    return sum;
  };
  return f(node);
}

/** Group key per leaf: its first direct parent in the reference ('' when not in it). */
export function groupByRefParent(refModel: Model, ref: string, leaves: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of leaves) {
    const p = refModel.paths(ref, l)[0];
    out.set(l, p ? p[p.length - 1].parent : '');
  }
  return out;
}

/** One CSV line, `;`-separated, quoted where needed. */
export function csvLine(fields: readonly (string | number)[]): string {
  return fields.map(f => {
    const v = String(f);
    return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(';');
}

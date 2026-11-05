/**
 * Model map: who calls what, and which cubes and dimensions a process reads or
 * writes. Nodes are chores, processes, cubes and dimensions; built from the
 * reference index.
 *
 * `focusGraph`, `layoutGraph` and `flowChain` are also bundled into the
 * lineage webview (focus and relayout happen client-side), so this module
 * must stay free of `vscode` and runtime imports from the extension host.
 */
import type { ReferenceIndex } from './referenceTypes';

/** `source`: an external data source of a process — an ODBC DSN or a file folder. */
export type MapNodeKind = 'chore' | 'process' | 'cube' | 'dimension' | 'source';
export type MapEdgeKind = 'calls' | 'reads' | 'writes';

/**
 * `title`: longer text for the tooltip, when the box shows a shortened name.
 * `parent`: set on a detail source (a table, a file pattern) — the id of its
 * system node (the DSN, the folder). The page shows one level or the other.
 */
export interface MapNode { id: string; kind: MapNodeKind; name: string; title?: string; parent?: string }
/** Direction follows the flow: caller → callee, cube/dimension → reading process, writing process → cube/dimension. */
export interface MapEdge { from: string; to: string; kind: MapEdgeKind }
export interface DependencyGraph { nodes: MapNode[]; edges: MapEdge[] }

/**
 * Which cube references are data flow. Writes change cube data; reads fetch
 * it — cell reads and the process data source (declared: no `funcName`;
 * assigned in code: `DataSourceNameForServer`). The rest that names a cube
 * (`ViewSubsetAssign`, `CubeExists`, `ViewExtractSkip*`, …) builds or checks
 * things and would put every view-building helper on the map as a reader —
 * on the 11.8 test server that was ~600 of ~2000 cube references.
 */
const WRITE_FUNC = /^(cellput|cellincrement|cubecleardata$|viewzeroout$)/i;
const READ_FUNC = /^(cellget|datasourcenameforserver$)/i;

/**
 * Dimension changes: structure and attributes. Every other function that names
 * a dimension (DIMIX, ELPAR, subset functions, the data source, …) counts as a
 * read — for dimensions that is what "who uses it" means, and they only show
 * up when a dimension is in focus (see `focusGraph`).
 */
const DIM_WRITE_FUNC = /^(dimension(element|deleteall|sortorder|create|destroy|topelement)|hierarchy(element|deleteall|sortorder|create|destroy|topelement)|(element)?attr(put|insert|delete))/i;

/**
 * Rule edges (`DB()` in a cube's rules) are left out on purpose: they would
 * run cube → cube inside the cube column. Processes without any edge are left
 * out too — they call nothing and nothing calls them, so they carry no line.
 */
export function buildDependencyGraph(idx: ReferenceIndex, includeSystem: boolean): DependencyGraph {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const keep = (name: string) => includeSystem || !name.startsWith('}');
  const node = (kind: MapNodeKind, name: string): string => {
    const id = `${kind}:${name.toLowerCase()}`;
    if (!nodes.has(id)) { nodes.set(id, { id, kind, name }); }
    return id;
  };
  const edge = (from: string, to: string, kind: MapEdgeKind) => {
    const key = `${from}>${to}>${kind}`;
    if (!edges.has(key)) { edges.set(key, { from, to, kind }); }
  };

  for (const [choreLc, tasks] of idx.choreTasks) {
    const choreName = idx.choreCasing.get(choreLc) ?? choreLc;
    if (!keep(choreName)) { continue; }
    const c = node('chore', choreName);
    for (const t of tasks) {
      if (keep(t.processName)) { edge(c, node('process', t.processName), 'calls'); }
    }
  }
  for (const r of idx.all) {
    if (r.sourceKind !== 'process' || !keep(r.sourceName) || !keep(r.targetName)) { continue; }
    if (r.targetKind === 'process') {
      edge(node('process', r.sourceName), node('process', r.targetName), 'calls');
    } else if (r.targetKind === 'dimension') {
      const p = node('process', r.sourceName);
      const dim = node('dimension', r.targetName);
      if (r.funcName && DIM_WRITE_FUNC.test(r.funcName)) { edge(p, dim, 'writes'); } else { edge(dim, p, 'reads'); }
    } else if (r.targetKind === 'cube') {
      const write = !!r.funcName && WRITE_FUNC.test(r.funcName);
      if (!write && r.funcName && !READ_FUNC.test(r.funcName)) { continue; }
      const p = node('process', r.sourceName);
      const cube = node('cube', r.targetName);
      if (write) { edge(p, cube, 'writes'); } else { edge(cube, p, 'reads'); }
    }
  }
  // External data sources: what a process loads from outside TM1. Cube and
  // dimension sources are already above (the data source counts as a read).
  // A file source is its FOLDER: the file name is usually built per run from
  // year and month, the folder stays (see `fileSourceDir`). ODBC is its DSN.
  // Each source comes in two levels: the system (folder, DSN) and its parts
  // (file pattern, table). Both go into the graph; the page picks one.
  const source = (id: string, name: string, title?: string, parent?: string): string => {
    if (!nodes.has(id)) { nodes.set(id, { id, kind: 'source', name, ...(title ? { title } : {}), ...(parent ? { parent } : {}) }); }
    return id;
  };
  for (const info of idx.processDataSources.values()) {
    const type = info.declared?.type?.toUpperCase();
    if (!keep(info.processName)) { continue; }
    const proc = () => node('process', info.processName);
    if (type === 'ASCII' && info.fileDir) {
      const d = info.fileDir;
      const sys = source(`source:${d.key}`, folderLabel(d.path, d.setBy), [d.path, d.setBy].filter(Boolean).join('\n'));
      edge(sys, proc(), 'reads');
      // No file name known: the folder stands in on the detail level too.
      const file = d.file ?? '*';
      const detail = source(`${sys}|${file.toLowerCase()}`, d.file ?? folderLabel(d.path, d.setBy),
        [(d.path ?? '') + (d.file ?? ''), d.setBy].filter(Boolean).join('\n'), sys);
      edge(detail, proc(), 'reads');
    } else if (type === 'ODBC' && info.declared?.nameForServer?.trim()) {
      const dsn = info.declared.nameForServer;
      const sys = source(`source:odbc:${dsn.toLowerCase()}`, `ODBC: ${dsn}`);
      edge(sys, proc(), 'reads');
      // No table found (query built entirely in code): the DSN stands in, so the
      // detail level does not lose the process's source.
      const tables = info.odbcTables?.length ? info.odbcTables : [];
      for (const t of tables) {
        edge(source(`${sys}|${t.toLowerCase()}`, t, `${dsn}: ${t}`, sys), proc(), 'reads');
      }
      if (!tables.length) { edge(source(`${sys}|*`, `ODBC: ${dsn}`, undefined, sys), proc(), 'reads'); }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** The last two folder levels, `02_Bewegungsdaten\\01_KSR` — a full path would not fit a box; the tooltip has it. */
function folderLabel(path: string | undefined, setBy: string | undefined): string {
  if (!path) { return setBy ?? '?'; }
  const parts = path.split(/[\\/]/).filter(Boolean);
  const sep = path.includes('/') && !path.includes('\\') ? '/' : '\\';
  // No leading ellipsis or trailing separator: boxes cut at 30 characters, and
  // those were the characters that pushed the folder name out.
  return parts.slice(-2).join(sep);
}

/**
 * The part of the map that belongs to one node:
 *  - everything it calls, transitively, and everything that calls it, up to the chores;
 *  - for every process in that chain, the cubes it reads and writes.
 * Cubes are dead ends — following "reads" onward from a cube would pull in
 * every other process that reads it, and the chain would become the whole map.
 * A focused cube is the exception: its readers and writers join, plus their callers.
 * Dimensions work like cubes, but join a chain only when a dimension is the
 * focus — every load process reads a handful, and the chain would drown in them.
 */
export function focusGraph(
  graph: { nodes: Array<{ id: string; kind: string }>; edges: Array<{ from: string; to: string; kind: string }> },
  focusId: string,
): { nodes: string[]; edges: number[] } {
  const kindOf = new Map(graph.nodes.map(n => [n.id, n.kind]));
  if (!kindOf.has(focusId)) { return { nodes: [], edges: [] }; }
  const callsOut = new Map<string, string[]>();
  const callsIn = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'calls') { continue; }
    (callsOut.get(e.from) ?? callsOut.set(e.from, []).get(e.from)!).push(e.to);
    (callsIn.get(e.to) ?? callsIn.set(e.to, []).get(e.to)!).push(e.from);
  }
  const walk = (starts: string[], next: Map<string, string[]>, into: Set<string>) => {
    const stack = [...starts];
    while (stack.length) {
      const id = stack.pop()!;
      if (into.has(id)) { continue; }
      into.add(id);
      for (const n of next.get(id) ?? []) { stack.push(n); }
    }
  };
  const chain = new Set<string>();
  const focusIsData = kindOf.get(focusId) === 'cube' || kindOf.get(focusId) === 'dimension' || kindOf.get(focusId) === 'source';
  if (focusIsData) {
    const touching = graph.edges
      .filter(e => e.kind !== 'calls' && (e.from === focusId || e.to === focusId))
      .map(e => (e.from === focusId ? e.to : e.from));
    walk(touching, callsIn, chain);
  } else {
    walk([focusId], callsOut, chain);
    chain.delete(focusId);
    walk([focusId], callsIn, chain);
  }
  const keep = new Set(chain);
  keep.add(focusId);
  const edges: number[] = [];
  graph.edges.forEach((e, i) => {
    if (e.kind === 'calls') {
      if (chain.has(e.from) && chain.has(e.to)) { edges.push(i); }
      return;
    }
    // A cube edge belongs to the focus when its process is in the chain — and,
    // for a focused cube, only the edges that touch that cube.
    const proc = e.kind === 'reads' ? e.to : e.from;
    const cube = e.kind === 'reads' ? e.from : e.to;
    if (!chain.has(proc)) { return; }
    if (focusIsData && cube !== focusId) { return; }
    if (!focusIsData && kindOf.get(cube) === 'dimension') { return; }
    keep.add(cube);
    edges.push(i);
  });
  return { nodes: [...keep], edges };
}

/**
 * Layered layout: chores left, cubes right, processes in between by call
 * depth (longest path from a caller; cycles are cut where first met). Rows
 * within a column are ordered by the mean row of their neighbours, a few
 * sweeps left↔right, which removes most crossings on graphs of this shape.
 */
export function layoutGraph(
  nodes: Array<{ id: string; kind: string; name: string }>,
  edges: Array<{ from: string; to: string; kind: string }>,
): Map<string, { col: number; row: number }> {
  const ids = new Set(nodes.map(n => n.id));
  const kind = new Map(nodes.map(n => [n.id, n.kind]));
  const calls = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === 'calls' && ids.has(e.from) && ids.has(e.to) && kind.get(e.to) === 'process') {
      (calls.get(e.from) ?? calls.set(e.from, []).get(e.from)!).push(e.to);
    }
  }
  // Depth of each process: 1 + deepest caller. DFS with an on-stack guard cuts cycles.
  const depth = new Map<string, number>();
  const onStack = new Set<string>();
  const visit = (id: string, d: number) => {
    if (onStack.has(id) || (depth.get(id) ?? -1) >= d) { return; }
    depth.set(id, d);
    onStack.add(id);
    for (const n of calls.get(id) ?? []) { visit(n, d + 1); }
    onStack.delete(id);
  };
  const called = new Set([...calls.values()].flat());
  for (const n of nodes) {
    if (n.kind === 'chore') { visit(n.id, 0); }
  }
  for (const n of nodes) {
    if (n.kind === 'process' && !called.has(n.id) && !depth.has(n.id)) { visit(n.id, 1); }
  }
  for (const n of nodes) {
    if (n.kind === 'process' && !depth.has(n.id)) { visit(n.id, 1); }   // pure cycles
  }
  let maxProc = 0;
  for (const n of nodes) { if (n.kind === 'process') { maxProc = Math.max(maxProc, depth.get(n.id) ?? 1); } }
  const colOf = (n: { id: string; kind: string }) =>
    n.kind === 'chore' ? 0 : n.kind === 'cube' || n.kind === 'dimension' || n.kind === 'source' ? maxProc + 1 : Math.max(1, depth.get(n.id) ?? 1);

  const cols: string[][] = [];
  for (const n of [...nodes].sort((a, b) => a.name.localeCompare(b.name))) {
    const c = colOf(n);
    (cols[c] ??= []).push(n.id);
  }
  const dense = cols.filter(c => c && c.length);
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) { continue; }
    (neighbours.get(e.from) ?? neighbours.set(e.from, []).get(e.from)!).push(e.to);
    (neighbours.get(e.to) ?? neighbours.set(e.to, []).get(e.to)!).push(e.from);
  }
  const rowOf = new Map<string, number>();
  const index = () => dense.forEach(col => col.forEach((id, r) => rowOf.set(id, r)));
  index();
  const sweep = (order: number[]) => {
    for (const ci of order) {
      const col = dense[ci];
      const key = new Map<string, number>();
      for (const id of col) {
        const ns = (neighbours.get(id) ?? []).filter(n => !col.includes(n));
        key.set(id, ns.length ? ns.reduce((s, n) => s + (rowOf.get(n) ?? 0), 0) / ns.length : (rowOf.get(id) ?? 0));
      }
      col.sort((a, b) => key.get(a)! - key.get(b)!);
      col.forEach((id, r) => rowOf.set(id, r));
    }
  };
  const fwd = dense.map((_, i) => i);
  for (let i = 0; i < 3; i++) { sweep(fwd.slice(1)); sweep(fwd.slice(0, -1).reverse()); }
  const out = new Map<string, { col: number; row: number }>();
  dense.forEach((col, c) => col.forEach((id, r) => out.set(id, { col: c, row: r })));
  return out;
}

/** One cube-to-cube data flow, with what carries it. */
export interface CubeFlowEdge {
  from: string;
  to: string;
  /** Processes that read `from` (a cube or an external source) and write `to`. */
  processes: string[];
  /** True when a rule or feeder links the two cubes. */
  rule: boolean;
}

/**
 * Cubes (and the external sources that load them), linked by data flow:
 *  - a process that reads cube A and writes cube B gives A → B;
 *  - a process that loads an ODBC or file source and writes cube B gives source → B;
 *  - a rule in cube A that pulls `DB('B', …)` gives B → A;
 *  - a feeder in cube A that feeds `DB('B', …)` gives A → B (same flow, other side).
 * A cube feeding itself is left out — it is no link between cubes.
 */
export function buildCubeFlow(idx: ReferenceIndex, includeSystem: boolean): { nodes: MapNode[]; edges: CubeFlowEdge[] } {
  const map = buildDependencyGraph(idx, includeSystem);
  const reads = new Map<string, string[]>();
  const writes = new Map<string, string[]>();
  for (const e of map.edges) {
    if (e.kind === 'reads' && (e.from.startsWith('cube:') || e.from.startsWith('source:'))) { (reads.get(e.to) ?? reads.set(e.to, []).get(e.to)!).push(e.from); }
    if (e.kind === 'writes' && e.to.startsWith('cube:')) { (writes.get(e.from) ?? writes.set(e.from, []).get(e.from)!).push(e.to); }
  }
  const names = new Map(map.nodes.map(n => [n.id, n.name]));
  const edges = new Map<string, CubeFlowEdge>();
  const nodes = new Map<string, MapNode>();
  const cube = (name: string): string => {
    const id = `cube:${name.toLowerCase()}`;
    if (!nodes.has(id)) { nodes.set(id, { id, kind: 'cube', name: names.get(id) ?? name }); }
    return id;
  };
  const byIdOrCube = (id: string): string => {
    if (!id.startsWith('source:')) { return cube(names.get(id) ?? id.slice(5)); }
    const src = map.nodes.find(n => n.id === id);
    if (!nodes.has(id)) { nodes.set(id, src ?? { id, kind: 'source', name: id }); }
    return id;
  };
  const edge = (from: string, to: string): CubeFlowEdge | undefined => {
    if (from === to) { return undefined; }
    const key = `${from}>${to}`;
    let e = edges.get(key);
    if (!e) { e = { from, to, processes: [], rule: false }; edges.set(key, e); }
    return e;
  };
  for (const [proc, ws] of writes) {
    for (const r of reads.get(proc) ?? []) {
      for (const w of ws) {
        const e = edge(byIdOrCube(r), cube(names.get(w) ?? w.slice(5)));
        const pName = names.get(proc) ?? proc;
        if (e && !e.processes.includes(pName)) { e.processes.push(pName); }
      }
    }
  }
  const keep = (name: string) => includeSystem || !name.startsWith('}');
  for (const r of idx.all) {
    if (r.sourceKind !== 'rule' || r.targetKind !== 'cube' || !keep(r.sourceName) || !keep(r.targetName)) { continue; }
    const owner = cube(r.sourceName);
    const other = cube(r.targetName);
    const e = r.section === 'feeders' ? edge(owner, other) : edge(other, owner);
    if (e) { e.rule = true; }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * Everything upstream and downstream of the start nodes, following edges in
 * their own direction only (a sibling that shares a source is not in the chain).
 */
export function flowChain(edges: Array<{ from: string; to: string }>, starts: string[]): { nodes: string[]; edges: number[] } {
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push(e.from);
  }
  const walk = (next: Map<string, string[]>): Set<string> => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) { continue; }
      seen.add(id);
      for (const n of next.get(id) ?? []) { stack.push(n); }
    }
    return seen;
  };
  const down = walk(out);
  const up = walk(inc);
  const keep = new Set([...down, ...up]);
  const idx: number[] = [];
  edges.forEach((e, i) => {
    // An edge belongs to the chain when it runs inside the downstream part or
    // inside the upstream part — not across from one side branch to another.
    if ((down.has(e.from) && down.has(e.to)) || (up.has(e.from) && up.has(e.to))) { idx.push(i); }
  });
  return { nodes: [...keep], edges: idx };
}

// src/webviewClient/lineage/index.ts
// Bundle of the lineage window. Until 10-04 it was an inline script in the
// host's template literal, with focusGraph/layoutGraph/flowChain injected via
// toString() — no type check, no lint, and a helper call inside one of them
// would have broken the page (review finding D3). Now they are imported.
import { flowChain, focusGraph, layoutGraph } from '../../references/lineagePure';
import type { CubeFlowEdge, DependencyGraph, MapEdge, MapNode } from '../../references/lineagePure';
import type { CubeFlowGraph, HostToWebview, LineageBootstrap, WebviewToHost } from './protocol';
import { escapeHtml as esc } from '../htmlUtils';
import { getVsCodeApi } from '../_shared/vscodeApi';

interface SavedState { lineageFocus?: string | null; lineageMode?: Mode; lineageSources?: SrcLevel }
const vscode = getVsCodeApi<WebviewToHost, SavedState>();

type Mode = 'obj' | 'cube';
type SrcLevel = 'off' | 'sys' | 'detail';
type Graph = { nodes: MapNode[]; edges: Array<{ from: string; to: string }> };
/** An edge as drawn: object edges keep their kind; data flow edges carry their source. */
interface DrawnEdge { from: string; to: string; kind: string; src?: CubeFlowEdge }

const boot = (window as unknown as { __lineage: LineageBootstrap }).__lineage;
const L = boot.texts;
const INITIAL_FOCUS = boot.initialFocus;
const INITIAL_NAME = boot.initialName;
const IN_TAB = boot.inTab;

let cubeGraph: CubeFlowGraph = { nodes: [], edges: [] };
// Without an object to start from (the server's own panel) the page opens on the
// data flow of the whole server. Dependencies need a center: all objects at
// once measured unreadable (246 objects, 438 edges on 11.8), while all
// cubes were 28 with 37 links.
let mode: Mode = (vscode.getState() || {}).lineageMode || (INITIAL_FOCUS ? 'obj' : 'cube');
const COL_W = 250, BOX_W = 200, ROW_H = 30, BOX_H = 22, TOP = 34, LEFT = 12;
let graph: DependencyGraph = { nodes: [], edges: [] };
let byId = new Map<string, MapNode>();
// Source level: none, systems (folder, DSN) or individual (file pattern, table).
let srcLevel: SrcLevel = (() => { const v = (vscode.getState() || {}).lineageSources; return v === 'off' || v === 'detail' ? v : 'sys'; })();
/** The graph at the chosen source level only; the other levels and their edges drop out. */
function atLevel<G extends Graph>(g: G): G {
  const drop = new Set(g.nodes.filter(n => n.kind === 'source' && (srcLevel === 'off' || (srcLevel === 'sys') === !!n.parent)).map(n => n.id));
  if (!drop.size) return g;
  return { nodes: g.nodes.filter(n => !drop.has(n.id)), edges: g.edges.filter(e => !drop.has(e.from) && !drop.has(e.to)) } as G;
}
let pendingHighlight: string | null = boot.highlightId;
const saved = vscode.getState() || {};
let focus: string | null = 'lineageFocus' in saved ? (saved.lineageFocus ?? null) : INITIAL_FOCUS;
const st = document.getElementById('status') as HTMLElement;
const wrap = document.getElementById('wrap') as HTMLElement;
const byIdEl = (id: string) => document.getElementById(id) as HTMLElement;

// Click marks a node's chain inside the current view and fades the rest —
// nothing moves, so a second click on the same spot is a real dblclick.
// Double-click makes that node the focus (new layout); Ctrl/Cmd+click opens it.
let shown: { nodes: MapNode[]; edges: DrawnEdge[] } = { nodes: [], edges: [] };

function draw(): void {
  const lg = atLevel(graph), lcg = atLevel(cubeGraph);
  const visible = new Set(lg.nodes.map(n => n.id).concat(lcg.nodes.map(n => n.id)));
  // A source of the other level as center: go to its system node, or back to the start.
  if (focus && !visible.has(focus)) { const p = byId.get(focus) && byId.get(focus)!.parent; focus = p && visible.has(p) ? p : INITIAL_FOCUS; }
  if (!focus) mode = 'cube';
  let nodes: MapNode[], edges: DrawnEdge[], layoutNodes: MapNode[], layoutEdges: Array<{ from: string; to: string; kind: string }>;
  const flowEdges = lcg.edges;
  if (mode === 'cube') {
    // Start from the focused cube, or from the cubes the focused object's chain
    // touches; without a focus, the whole server.
    let c: { nodes: string[]; edges: number[] };
    let starts: string[] = [];
    if (focus) {
      const f = focusGraph(lg, focus);
      starts = focus.startsWith('cube:') || focus.startsWith('source:') ? [focus] : f.nodes.filter(id => id.startsWith('cube:'));
      c = flowChain(flowEdges, starts);
    } else {
      c = { nodes: [...new Set(flowEdges.flatMap(e => [e.from, e.to]))], edges: flowEdges.map((_, i) => i) };
    }
    const keep = new Set(c.nodes.concat(starts));
    const byCube = new Map(lcg.nodes.map(n => [n.id, n]));
    nodes = [...keep].map(id => byCube.get(id) || byId.get(id)).filter((n): n is MapNode => Boolean(n));
    edges = c.edges.map(i => flowEdges[i]).map(e => ({ from: e.from, to: e.to, kind: e.processes.length ? 'flow' : 'rule', src: e }));
    // layoutGraph orders by call depth among processes — present the cubes that way.
    layoutNodes = nodes.map(n => ({ id: n.id, kind: 'process', name: n.name }));
    layoutEdges = edges.map(e => ({ from: e.from, to: e.to, kind: 'calls' }));
  } else {
    const f = focusGraph(lg, focus!);
    const keep = new Set(f.nodes);
    nodes = lg.nodes.filter(n => keep.has(n.id));
    edges = f.edges.map((i): MapEdge => lg.edges[i]);
    layoutNodes = nodes; layoutEdges = edges;
  }
  vscode.setState(Object.assign({}, vscode.getState() || {}, { lineageFocus: focus, lineageMode: mode, lineageSources: srcLevel }));
  document.querySelectorAll<HTMLElement>('[data-src]').forEach(b => b.classList.toggle('on', b.dataset.src === srcLevel));
  const depBtn = byIdEl('mode-obj') as HTMLButtonElement;
  depBtn.disabled = !focus;
  depBtn.title = focus ? '' : L.depNeedsFocus;
  // In an object's tab the button always leads to the server panel; in the
  // server panel it only makes sense once something is the center.
  byIdEl('overview').hidden = IN_TAB ? false : !(mode === 'cube' && focus);
  byIdEl('mode-obj').classList.toggle('on', mode !== 'cube');
  byIdEl('mode-cube').classList.toggle('on', mode === 'cube');
  byIdEl('legend-obj').hidden = mode === 'cube';
  byIdEl('legend-cube').hidden = mode !== 'cube';
  byIdEl('hint').textContent = mode !== 'cube' ? L.hint : focus ? L.hintCube : L.hintOverview;
  byIdEl('crumb').textContent = focus ? byId.get(focus)!.name : L.overview;
  const empty = mode === 'cube' ? !edges.length : nodes.length <= 1;
  st.textContent = empty ? (mode !== 'cube' ? L.empty : focus ? L.noCubeFlow : L.noFlowAtAll) : '';
  st.hidden = !empty; wrap.hidden = !nodes.length;
  shown = { nodes, edges };
  const pos = layoutGraph(layoutNodes, layoutEdges);
  let cols = 0, rows = 0;
  pos.forEach(p => { cols = Math.max(cols, p.col + 1); rows = Math.max(rows, p.row + 1); });
  const W = LEFT * 2 + cols * COL_W, H = TOP + rows * ROW_H + 10;
  const xy = (id: string) => { const p = pos.get(id)!; return { x: LEFT + p.col * COL_W, y: TOP + p.row * ROW_H }; };
  const heads: string[] = [];
  const kindsAtCol = new Map<number, Set<string>>();
  nodes.forEach(n => { const c = pos.get(n.id)!.col; (kindsAtCol.get(c) || kindsAtCol.set(c, new Set()).get(c)!).add(n.kind); });
  const KIND_LABEL: Record<string, string> = { chore: L.chores, process: L.processes, cube: L.cubes, dimension: L.dimensions, source: L.sources };
  if (mode !== 'cube') kindsAtCol.forEach((ks, c) => {
    const label = ['chore', 'process', 'cube', 'dimension', 'source'].filter(k => ks.has(k)).map(k => KIND_LABEL[k]).join(' / ');
    heads.push('<text class="colhead" x="' + (LEFT + c * COL_W) + '" y="18">' + esc(label) + '</text>');
  });
  const byName = (id: string): string => { const n = byId.get(id); return n ? n.name : id.slice(id.indexOf(':') + 1); };
  const paths = edges.map(e => {
    if (!pos.has(e.from) || !pos.has(e.to)) return '';
    const a = xy(e.from), b = xy(e.to);
    const forward = b.x > a.x;
    const x1 = forward ? a.x + BOX_W : a.x, y1 = a.y + BOX_H / 2;
    const x2 = forward ? b.x : b.x + BOX_W, y2 = b.y + BOX_H / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (forward ? 1 : -1);
    const tip = e.src ? '<title>' + esc(byName(e.from) + ' → ' + byName(e.to) + '\n'
      + (e.src.processes.length ? L.via + ': ' + e.src.processes.join(', ') : '') + (e.src.rule ? (e.src.processes.length ? '\n' : '') + L.rule : '')) + '</title>' : '';
    return '<path data-from="' + esc(e.from) + '" data-to="' + esc(e.to) + '" class="edge ' + e.kind + '" marker-end="url(#m-' + e.kind + ')" d="M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2 + '">' + tip + '</path>';
  }).join('');
  const boxes = nodes.map(n => {
    const p = xy(n.id);
    const label = n.name.length > 30 ? n.name.slice(0, 29) + '…' : n.name;
    return '<g class="node ' + n.kind + (n.id === focus ? ' focus' : '') + '" data-id="' + esc(n.id) + '"><title>' + esc(n.title || n.name) + '</title>'
      + '<rect x="' + p.x + '" y="' + p.y + '" width="' + BOX_W + '" height="' + BOX_H + '"/>'
      + '<text x="' + (p.x + 8) + '" y="' + (p.y + 15) + '">' + esc(label) + '</text></g>';
  }).join('');
  const marker = (k: string, c: string) => '<marker id="m-' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + c + '"/></marker>';
  wrap.innerHTML = '<svg width="' + W + '" height="' + H + '"><defs>'
    + marker('calls', 'var(--vscode-descriptionForeground)') + marker('reads', 'var(--vscode-charts-green, #89d185)') + marker('writes', 'var(--vscode-charts-orange, #d18616)')
    + marker('flow', 'var(--vscode-charts-orange, #d18616)') + marker('rule', 'var(--vscode-charts-purple, #b180d7)')
    + '</defs>' + heads.join('') + paths + boxes + '</svg>';
}

function highlight(id: string | null): void {
  const svg = wrap.querySelector('svg');
  if (!svg) return;
  svg.classList.toggle('hl', !!id);
  svg.querySelectorAll('.on, .picked').forEach(el => el.classList.remove('on', 'picked'));
  if (!id) return;
  // In the data flow a process or chore is no node — mark the cubes of its chain.
  const starts = mode === 'cube' && !id.startsWith('cube:') && !id.startsWith('source:') && byId.has(id)
    ? focusGraph(atLevel(graph), id).nodes.filter(n => n.startsWith('cube:')) : [id];
  const c = mode === 'cube' ? flowChain(shown.edges, starts) : focusGraph(shown, id);
  const keep = new Set(c.nodes.concat(starts));
  const keepEdges = new Set(c.edges.map(i => shown.edges[i]).map(e => e.from + '>' + e.to));
  svg.querySelectorAll<SVGElement>('.node').forEach(g => { if (keep.has(g.dataset.id!)) g.classList.add('on'); if (g.dataset.id === id) g.classList.add('picked'); });
  svg.querySelectorAll<SVGElement>('.edge').forEach(p => { if (keepEdges.has(p.dataset.from + '>' + p.dataset.to)) p.classList.add('on'); });
}
wrap.addEventListener('click', (ev) => {
  const g = (ev.target as Element).closest<SVGElement>('.node');
  if (g && (ev.ctrlKey || ev.metaKey) && !g.dataset.id!.startsWith('source:')) {
    vscode.postMessage({ type: 'mapOpen', id: g.dataset.id!, name: byId.get(g.dataset.id!)!.name });
    return;
  }
  highlight(g ? g.dataset.id! : null);
});
wrap.addEventListener('dblclick', (ev) => {
  const g = (ev.target as Element).closest<SVGElement>('.node');
  if (!g || g.dataset.id === focus) return;
  focus = g.dataset.id!; draw();
});
byIdEl('refresh').addEventListener('click', () => { st.textContent = L.loading; st.hidden = false; vscode.postMessage({ type: 'mapRefresh' }); });
byIdEl('mode-obj').addEventListener('click', () => { if (focus) { mode = 'obj'; draw(); } });
byIdEl('mode-cube').addEventListener('click', () => { mode = 'cube'; draw(); });
document.querySelectorAll<HTMLElement>('[data-src]').forEach(b => b.addEventListener('click', () => { srcLevel = b.dataset.src as SrcLevel; draw(); }));
byIdEl('overview').addEventListener('click', () => {
  if (IN_TAB) { vscode.postMessage({ type: 'lineageServer', id: focus }); return; }
  focus = null; draw();
});
const back = document.getElementById('back');
if (back) back.addEventListener('click', () => vscode.postMessage({ type: 'mapBack' }));

window.addEventListener('message', (ev: MessageEvent<HostToWebview | undefined>) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'lineageHighlight' && typeof msg.id === 'string') {
    // Came from an object's tab: show the whole server with that object marked.
    focus = null; mode = 'cube';
    if (byId.size) { draw(); highlight(msg.id); } else { pendingHighlight = msg.id; }
    return;
  }
  if (msg.type === 'mapError') { st.hidden = false; st.innerHTML = '<div class="err">' + esc(msg.message) + '</div>'; return; }
  if (msg.type === 'mapData') {
    graph = msg.graph || { nodes: [], edges: [] };
    // An object without any call or data edge is not in the graph. It is still
    // the object the user came from: show it alone instead of an unselected map.
    if (INITIAL_FOCUS && !graph.nodes.some(n => n.id === INITIAL_FOCUS)) {
      graph.nodes.push({ id: INITIAL_FOCUS, kind: INITIAL_FOCUS.split(':')[0] as MapNode['kind'], name: INITIAL_NAME });
    }
    cubeGraph = msg.cubeGraph || { nodes: [], edges: [] };
    // Cubes linked only by rules are not in the object graph; the name lookup needs them too.
    for (const n of cubeGraph.nodes) if (!graph.nodes.some(g => g.id === n.id)) graph.nodes.push(n);
    byId = new Map(graph.nodes.map(n => [n.id, n]));
    draw();
    if (pendingHighlight) { highlight(pendingHighlight); pendingHighlight = null; }
  }
});
vscode.postMessage({ type: 'mapReady' });

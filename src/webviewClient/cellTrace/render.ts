// src/webviewClient/cellTrace/render.ts
import type { CalcNodeDTO, FedCellDTO, FeederDTO } from './protocol';
import { getL10n, fmt } from '../_shared/l10n';
import { matchStatementLine } from './ruleLines';
import { formulaWithValues } from './formulaValues';
import { vscode } from './vscodeApi';

const L = getL10n();

/** Per-consolidation render cap; wide consolidations get a "show more" row. */
const CHILD_CAP = 500;

/** Context threaded through the tree so nested Rule nodes / feeder statements
 *  can render a clickable "Line N" link that opens the Rule Editor. */
export interface TraceCtx {
  rules?: string;
  cube?: string;
  /** Dimensions per cube, for resolving `!Dim` in a formula. Grows as children load. */
  dims?: Record<string, string[]>;
}

/** Nodes waiting for their children, by request id. */
const pending = new Map<number, (res: { node: CalcNodeDTO } | { error: string }) => void>();
let nextId = 0;

/** Host answer to an `expand` request — see `children`/`childrenError` in the protocol. */
export function deliverChildren(id: number, res: { node: CalcNodeDTO } | { error: string }): void {
  const done = pending.get(id);
  pending.delete(id);
  done?.(res);
}

/** Node handle used by the toolbar's expand/collapse-all buttons. */
type Expandable = HTMLElement & { _setOpen?: (open: boolean) => void };

function isZero(v: number | string | null): boolean {
  return v === 0 || v === '' || v === null || v === '0';
}

function fmtVal(v: number | string | null): string {
  if (typeof v === 'number') { return v.toLocaleString(); }
  return v == null ? '' : String(v);
}

function label(node: CalcNodeDTO): string {
  return node.tuple.length ? node.tuple.join(' | ') : '…';
}

function typeBadge(t: string): HTMLElement {
  const b = document.createElement('span');
  b.className = `trace-badge trace-badge-${t.toLowerCase()}`;
  b.textContent = t;
  return b;
}

/** Heading + count, the shape every section in this panel uses. */
function section(caption: string, count?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'trace-section';
  const h = document.createElement('h3');
  h.textContent = caption;
  wrap.appendChild(h);
  if (count) {
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = count;
    wrap.appendChild(c);
  }
  return wrap;
}

function note(cls: 'trace-hint' | 'trace-empty' | 'trace-ok', text: string): HTMLElement {
  const p = document.createElement('div');
  p.className = cls;
  p.textContent = text;
  return p;
}

/** Recursively build a <ul> tree; children rendered collapsed and lazily on expand. */
export function renderRuleTree(container: HTMLElement, root: CalcNodeDTO, opts: { hideZero: boolean }, ctx: TraceCtx = {}): void {
  container.textContent = '';
  // Plain leaf input cell (not rule/consolidation, no components) — nothing to trace.
  if (root.type === 'Simple' && root.components.length === 0) {
    container.appendChild(note('trace-hint', L.traceSimpleEmpty));
  }
  const shown = visibleChildren(root, opts.hideZero).length;
  container.appendChild(section(L.traceCalculation, fmt(L, 'traceComponentCount', String(shown))));
  const ul = document.createElement('ul');
  ul.className = 'trace-tree root';
  ul.appendChild(renderNode(root, opts, true, ctx, root.cube ?? ctx.cube));
  container.appendChild(ul);
}

/** Clickable "Line N" link that opens the cube's Rule Editor at that line. */
function lineLink(ctx: TraceCtx, line: number): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'trace-stmt-line';
  link.href = '#';
  link.textContent = fmt(L, 'traceLineLink', String(line));
  link.addEventListener('click', (e) => {
    e.preventDefault();
    if (ctx.cube) { vscode.postMessage({ type: 'openRule', cube: ctx.cube, line }); }
  });
  return link;
}

/** Labelled statement block (rule line(s) that populate this cell). Caption and
 *  line link now share one head row per statement, so the code below always
 *  starts at the same place no matter how many statements there are. */
function statementBlock(caption: string, statements: string[], ctx: TraceCtx, node?: CalcNodeDTO): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'trace-stmt-wrap';
  for (const stmt of statements) {
    const head = document.createElement('div');
    head.className = 'trace-stmt-head';
    const cap = document.createElement('span');
    cap.className = 'trace-stmt-label';
    cap.textContent = caption;
    head.appendChild(cap);
    const line = ctx.rules ? matchStatementLine(ctx.rules, stmt) : null;
    if (line != null) { head.appendChild(lineLink(ctx, line)); }
    wrap.appendChild(head);
    const pre = document.createElement('pre');
    pre.className = 'trace-stmt';
    pre.textContent = stmt;
    wrap.appendChild(pre);
    const withValues = node && valuesLine(stmt, node, ctx);
    if (withValues) {
      const vals = document.createElement('pre');
      vals.className = 'trace-stmt trace-stmt-values';
      vals.textContent = '= ' + withValues;
      wrap.appendChild(vals);
    }
  }
  return wrap;
}

/** The formula with the operand values put in, once the operands are loaded. */
function valuesLine(stmt: string, node: CalcNodeDTO, ctx: TraceCtx): string | undefined {
  const cube = node.cube ?? ctx.cube;
  const dims = cube ? ctx.dims?.[cube] : undefined;
  if (!node.childrenLoaded || !cube || !dims) { return undefined; }
  return formulaWithValues(stmt, { cube, dims, tuple: node.tuple }, node.components, fmtVal);
}

function visibleChildren(node: CalcNodeDTO, hideZero: boolean): CalcNodeDTO[] {
  return hideZero ? node.components.filter(c => c.status === 'Error' || !isZero(c.value)) : node.components;
}

/** A node whose children still have to be fetched — stored input cells have none. */
function canLoad(node: CalcNodeDTO): boolean {
  return !node.childrenLoaded && node.type !== 'Simple' && node.tuple.length > 0;
}

function renderNode(node: CalcNodeDTO, opts: { hideZero: boolean }, open: boolean, ctx: TraceCtx, parentCube?: string): HTMLElement {
  const li: Expandable = document.createElement('li');
  const kids = visibleChildren(node, opts.hideZero);
  const cube = node.cube ?? parentCube;

  const row = document.createElement('div');
  row.className = 'trace-row';
  const toggle = document.createElement('span');
  const expandable = kids.length > 0 || canLoad(node);
  toggle.className = expandable ? 'trace-toggle' : 'trace-toggle leaf';
  toggle.textContent = expandable ? (open && kids.length ? '▼' : '▶') : '·';
  row.appendChild(toggle);
  row.appendChild(typeBadge(node.type));
  const lbl = document.createElement('span');
  lbl.className = 'trace-label';
  // A cell in another cube (a `DB()` operand) names that cube in front.
  const text = cube && parentCube && cube !== parentCube ? `${cube}: ${label(node)}` : label(node);
  lbl.textContent = text;
  lbl.title = text;   // the column ellipsizes; keep the full tuple on hover
  row.appendChild(lbl);
  const val = document.createElement('span');
  val.className = isZero(node.value) ? 'trace-value zero' : 'trace-value';
  val.textContent = fmtVal(node.value);
  row.appendChild(val);
  if (node.status === 'Error') { row.appendChild(typeBadge('Error')); }
  li.appendChild(row);

  if (node.type === 'Rule' && node.statements.length) {
    li.appendChild(statementBlock(L.traceRuleLabel, node.statements, ctx, node));
  }

  if (!kids.length && canLoad(node)) {
    // One trace per level: the children are fetched on the first open, then the
    // node is rendered again, open, from the now complete data.
    let asked = false;
    let wait: HTMLElement | undefined;
    const load = () => {
      if (asked || !cube) { return; }
      asked = true;
      toggle.textContent = '▼';
      wait?.remove(); // the error note of a failed earlier attempt
      const box = document.createElement('ul');
      wait = box;
      box.className = 'trace-tree';
      box.appendChild(note('trace-hint', L.traceLoading));
      li.appendChild(box);
      const id = ++nextId;
      pending.set(id, (res) => {
        if ('error' in res) {
          box.textContent = '';
          box.appendChild(note('trace-empty', res.error));
          asked = false;
          toggle.textContent = '▶';
          return;
        }
        node.components = res.node.components;
        node.childrenLoaded = true;
        if (res.node.statements.length) { node.statements = res.node.statements; }
        if (li.isConnected) { li.replaceWith(renderNode(node, opts, true, ctx, parentCube)); }
      });
      vscode.postMessage({ type: 'expand', id, cube, coords: node.tuple });
    };
    li._setOpen = (o: boolean) => { if (o) { load(); } };
    toggle.addEventListener('click', load);
    if (open) { load(); }
    return li;
  }

  if (kids.length) {
    const childUl = document.createElement('ul');
    childUl.className = 'trace-tree';
    childUl.style.display = open ? '' : 'none';
    let built = false;
    const build = () => {
      if (built) { return; }
      built = true;
      const shown = kids.slice(0, CHILD_CAP);
      for (const c of shown) { childUl.appendChild(renderNode(c, opts, false, ctx, cube)); }
      if (kids.length > CHILD_CAP) {
        const more = document.createElement('li');
        more.className = 'trace-more';
        more.textContent = fmt(L, 'traceShowMore', kids.length - CHILD_CAP);
        childUl.appendChild(more);
      }
    };
    if (open) { build(); }
    li.appendChild(childUl);
    const setOpen = (o: boolean) => {
      if (o) { build(); childUl.style.display = ''; toggle.textContent = '▼'; }
      else { childUl.style.display = 'none'; toggle.textContent = '▶'; }
    };
    li._setOpen = setOpen;
    toggle.addEventListener('click', () => setOpen(childUl.style.display === 'none'));
  }
  return li;
}

/**
 * Toolbar action: open or close every node of the rendered tree. Expanding
 * builds lazily-rendered children on the way. Children that are not traced yet
 * are requested, but not waited for — so each click on "Expand all" goes one
 * level deeper instead of pulling a tree that can run to 150,000 nodes.
 */
export function setAllExpanded(container: HTMLElement, open: boolean): void {
  // Live list: expanding a node adds new <li>s, which the next pass picks up.
  for (let pass = 0; pass < (open ? 40 : 1); pass++) {
    const items = Array.from(container.querySelectorAll('li')) as Expandable[];
    const before = items.length;
    items.forEach((li, idx) => {
      // The root stays open — collapsing it would hide the traced cell itself.
      if (idx === 0 && !open) { return; }
      li._setOpen?.(open);
    });
    if (!open || container.querySelectorAll('li').length === before) { break; }
  }
}

export function renderFeeders(container: HTMLElement, f: FeederDTO, ctx: TraceCtx = {}): void {
  container.textContent = '';
  if (f.statements.length) {
    container.appendChild(section(L.traceFeederStatements, String(f.statements.length)));
    container.appendChild(statementBlock(L.traceFeederLabel, f.statements, ctx));
  }
  container.appendChild(section(L.traceFedCells, String(f.fedCells.length)));
  if (!f.fedCells.length) {
    container.appendChild(note('trace-empty', L.traceNoFeeders));
    return;
  }
  container.appendChild(cellTable(f.fedCells));
}

export function renderUnfed(container: HTMLElement, cells: FedCellDTO[]): void {
  container.textContent = '';
  if (!cells.length) {
    container.appendChild(note('trace-ok', L.traceAllFed));
    return;
  }
  container.appendChild(section(L.traceUnfed, String(cells.length)));
  container.appendChild(cellTable(cells));
}

/** Cell list with a real header row — the three columns were unlabelled before. */
function cellTable(cells: FedCellDTO[]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'trace-table';
  table.dataset.resizable = '';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const cols: ReadonlyArray<readonly [string, string]> = [
    [L.traceColCell, 'cell'], [L.traceColValue, 'num'], [L.traceColFed, 'mid'],
  ];
  for (const [text, cls] of cols) {
    const th = document.createElement('th');
    th.className = cls;
    th.textContent = text;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const c of cells) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'cell';
    td.textContent = c.tuple.join(' | ');
    tr.appendChild(td);
    const tdv = document.createElement('td');
    tdv.className = 'num trace-value';
    tdv.textContent = fmtVal(c.value);
    tr.appendChild(tdv);
    const tdf = document.createElement('td');
    tdf.className = c.fed ? 'mid fed-yes' : 'mid fed-no';
    tdf.textContent = c.fed ? '✓' : '✗';
    tdf.title = c.fed ? L.traceFedYes : L.traceFedNo;
    tr.appendChild(tdf);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/** Placeholder while a trace is in flight. The previous tab's result must not
 *  stay on screen under the newly activated tab, so the content is replaced
 *  rather than left standing until the answer arrives. */
export function renderLoading(container: HTMLElement): void {
  container.textContent = '';
  container.appendChild(note('trace-hint', L.traceLoading));
}

export function renderError(container: HTMLElement, msg: string): void {
  container.textContent = '';
  const div = document.createElement('div');
  div.className = 'trace-error';
  div.textContent = msg;
  container.appendChild(div);
}

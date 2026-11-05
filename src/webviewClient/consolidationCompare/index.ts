import { getL10n, fmt } from '../_shared/l10n';
import { attachTitleCombo } from '../_shared/filterCombo';
import {
  applyChanges, buildModel, compare, probe, rootsUsing, wouldCycle, isZero,
  subtreeCsv, changesCsv, CycleError, CELL_CLASSES, MAX_PATHS, parseEdgeText, matchNames, draftFromImport,
  ALL_LEAVES, allLeavesModel, bulkFix, groupByRefParent, csvLine, edgeDiff,
  type Change, type CellClass, type Edge, type Model, type CompareResult, type Column,
} from '../../consolidationCompare/comparePure';
import type { CompareView, ToClient, ToHost } from '../../consolidationCompare/protocol';
import { escapeHtml as esc } from '../htmlUtils';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscodeApi = getVsCodeApi<ToHost>();
const L = getL10n();

/** Rows drawn at most; a class filter shows the rest. */
const MAX_ROWS = 2000;

const CLS_LABEL: Record<CellClass, string> = {
  ok: L.clsOk, missing: L.clsMissing, double: L.clsDouble, extra: L.clsExtra, wrongWeight: L.clsWrongWeight,
};

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const fmtW = (w: number): string =>
  (isZero(w) ? '·' : String(Number.isInteger(w) ? w : +w.toFixed(4))).replace('-', '−');
const key = (a: string, b: string): string => `${a}\u0000${b}`;
/** Display name: the chosen alias when the element has one. */
const lbl = (n: string): string => (n === ALL_LEAVES ? L.allLeaves : S.alias[n] ?? n);
/** Option text carries both, so the filter box finds either. */
const optText = (n: string): string => (S.alias[n] ? `${S.alias[n]} (${n})` : n);
const options = (names: string[], selected: string): string =>
  names.map(o => `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(optText(o))}</option>`).join('');

/**
 * A read-only column source: an imported edge list, or a top consolidation of
 * another hierarchy of the same dimension (`kind: 'hier'`, `file` = hierarchy).
 * Never written; "Apply to draft" turns it into changes for this hierarchy.
 */
interface ImportCol {
  /** One group per added source (a hierarchy, a file, a paste); removed together. */
  id: string; group: number; kind: 'list' | 'hier'; file: string; root: string; model: Model;
  unknown: string[]; target: string; note: string;
}
/** Name of a source group in the bar. */
const groupName = (i: ImportCol): string => (i.kind === 'hier' ? i.file : fmt(L, 'importLabel', i.file));
const isImport = (id: string): boolean => id.startsWith('\u0001');
// Looked up for every option, chip and cell of a column, so through an index,
// rebuilt when the list changes (it is only appended to in place, or replaced).
let importIdx: { list: ImportCol[]; n: number; byId: Map<string, ImportCol> } | null = null;
const importOf = (id: string): ImportCol | undefined => {
  if (importIdx?.list !== S.imports || importIdx.n !== S.imports.length) {
    importIdx = { list: S.imports, n: S.imports.length, byId: new Map(S.imports.map(i => [i.id, i])) };
  }
  return importIdx.byId.get(id);
};
/** Column header / tile name: alias for server roots, "file · root (list)" for imports. */
const colLabel = (id: string): string => {
  const imp = importOf(id);
  if (!imp) { return lbl(id); }
  return imp.kind === 'hier' ? `${imp.file}:${lbl(imp.root)}` : fmt(L, 'importLabel', `${imp.file} · ${lbl(imp.root)}`);
};
let importSeq = 0;
let groupSeq = 0;

/**
 * A loaded other hierarchy. Its roots are only offered: a column is made when
 * one is picked — a large hierarchy has 150k consolidations, and a column for
 * each made loading it take seconds.
 */
interface HierSource {
  /** Hierarchy name, or for `server` the server's label — the name the source shows under. */
  hier: string; group: number; model: Model; unknown: string[];
  /** Set for the shown hierarchy read on another server; reloads ask the host for that server. */
  server?: string;
}
let hierSources: HierSource[] = [];
/** Picker value of a root offered by a hierarchy source. Not U+0000: HTML turns it into U+FFFD in an attribute. */
const offerKey = (hier: string, root: string): string => `\u0003${hier}\u0001${root}`;
/** A picker value as column id: an offered root becomes a column (once). */
function columnFor(value: string): string {
  if (!value.startsWith('\u0003')) { return value; }
  const [hier, root] = value.slice(1).split('\u0001');
  const old = S.imports.find(i => i.kind === 'hier' && i.file === hier && i.root === root);
  if (old) { return old.id; }
  const src = hierSources.find(h => h.hier === hier);
  if (!src?.model.children(root).length) { return ''; }
  return addSource(src.group, 'hier', hier, root, src.model, src.unknown, false, ownConsolidations());
}
/** A column id as picker value: a hierarchy column shows as its offered root. */
function pickerValue(id: string): string {
  const imp = importOf(id);
  return imp?.kind === 'hier' ? offerKey(imp.file, imp.root) : id;
}
const offerCache = new WeakMap<Model, { alias: Record<string, string>; html: string }>();
function offerHtml(src: HierSource): string {
  let c = offerCache.get(src.model);
  if (c?.alias !== S.alias) {
    const m = src.model;
    const roots = [...m.tops, ...m.consolidations.filter(r => !m.tops.includes(r))];
    c = { alias: S.alias, html: roots.map(r => `<option value="${esc(offerKey(src.hier, r))}">${esc(`${src.hier}:${lbl(r)}`)}</option>`).join('') };
    offerCache.set(m, c);
  }
  return c.html;
}

/** Searchable dropdown over a select that stays the value carrier (filterCombo.ts). */
function filterable(id: string, onOpen?: () => void): void {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel?.parentNode) { return; }
  const spot = sel.nextSibling;
  sel.parentNode.insertBefore(attachTitleCombo(sel, '', onOpen, { byLabel: true }), spot);
}

const S = {
  dim: '',
  hier: '',
  base: [] as Edge[],
  changes: [] as Change[],
  ref: '',
  cmp: [] as string[],
  onlyDiff: true,
  filter: null as { root: string; cls: CellClass } | null,
  cur: null as { leaf: string; root: string } | null,
  selEdge: null as string | null,
  treeRoot: '',
  message: '',
  saving: false,
  saveMsg: '',
  saveErr: false,
  aliasName: '',
  aliases: [] as string[],
  alias: {} as Record<string, string>,
  elements: [] as string[],
  imports: [] as ImportCol[],
  /** All hierarchies of the dimension (Leaves excluded), the shown one included. */
  hierarchies: [] as string[],
  addOpen: false,
  /** Leaf elements of the hierarchy, numeric and string, orphans included. */
  leaves: [] as string[],
  attributes: [] as string[],
  scopeAttr: '',
  scopeValue: '',
  scopeValues: {} as Record<string, string>,
  /** Attribute whose values `scopeValues` holds; '' while they load. */
  scopeFor: '',
  group: false,
  collapsed: new Set<string>(),
  search: '',
  bulkNote: {} as Record<string, string>,
};

/** The last comparison, so search and grouping redraw without recomputing. */
let last: { r: CompareResult; ref: { model: Model; root: string } } | null = null;

/**
 * The hierarchy as drafted. Cached because nearly every click renders, and a
 * rebuild costs ~0.4 s on 300k edges (measured); the draft is mutated in place,
 * so its text is the key, not its identity.
 */
let draftCache: { base: Edge[]; draft: string; model: Model } | null = null;
function drafted(): Model {
  const draft = JSON.stringify(S.changes);
  if (draftCache?.base !== S.base || draftCache.draft !== draft) {
    draftCache = { base: S.base, draft, model: buildModel(applyChanges(S.base, S.changes)) };
  }
  return draftCache.model;
}

/** Root pickers list every consolidation; with 150k of them, building the markup alone is noticeable. */
let orderCache: { model: Model; alias: Record<string, string>; order: string[]; html: string } | null = null;
function rootOrder(m: Model): { order: string[]; html: string } {
  if (orderCache?.model !== m || orderCache.alias !== S.alias) {
    const order = [...m.tops, ...m.consolidations.filter(c => !m.tops.includes(c))];
    orderCache = { model: m, alias: S.alias, order, html: options(order, '') };
  }
  return orderCache;
}

/** Replace a select's options only when they changed — parsing 150k options takes ~0.3 s each. */
const shownHtml = new WeakMap<HTMLSelectElement, string>();
function setOptions(id: string, html: string, value: string): HTMLSelectElement {
  const sel = $(id) as HTMLSelectElement;
  if (shownHtml.get(sel) !== html) { sel.innerHTML = html; shownHtml.set(sel, html); }
  sel.value = value;
  return sel;
}

/**
 * The root pickers list every consolidation, and every one of each loaded
 * hierarchy — 300k options, ~2 s to fill. They hold only their current choice
 * until first opened (`fillPicker`), then keep the full list while it stays
 * the same.
 */
const lazy = new Map<string, { head: string; full: () => string; hide: ReadonlySet<string> }>();
const filled = new WeakMap<HTMLSelectElement, string>();
function lazyPicker(id: string, head: string, full: () => string, value: string, hide: ReadonlySet<string> = new Set()): void {
  lazy.set(id, { head, full, hide });
  const sel = $(id) as HTMLSelectElement;
  const was = filled.get(sel);
  if (was !== undefined && was === head + full()) {
    sel.value = value;
    hideTaken(sel, hide);
    return;
  }
  filled.delete(sel);
  const own = value && !head.includes(`value="${esc(value)}"`) ? `<option value="${esc(value)}">${esc(pickerText(value))}</option>` : '';
  setOptions(id, head + own, value);
}
function fillPicker(id: string): void {
  const p = lazy.get(id);
  const sel = $(id) as HTMLSelectElement;
  if (!p || filled.has(sel)) { return; }
  const value = sel.value;
  const html = p.head + p.full();
  sel.innerHTML = html;
  filled.set(sel, html);
  shownHtml.delete(sel);
  hideTaken(sel, p.hide);
  sel.value = value;
}
function hideTaken(sel: HTMLSelectElement, hide: ReadonlySet<string>): void {
  for (const o of Array.from(sel.options)) {
    const h = hide.has(o.value);
    if (o.hidden !== h) { o.hidden = h; }
  }
}
/** Option text of a picker value, without the full list at hand. */
function pickerText(value: string): string {
  if (value.startsWith('\u0003')) { const [hier, root] = value.slice(1).split('\u0001'); return `${hier}:${lbl(root)}`; }
  return isImport(value) ? colLabel(value) : optText(value);
}

let leavesModel: { from: string[]; model: Model } | null = null;
function allLeaves(): Model {
  if (leavesModel?.from !== S.leaves) { leavesModel = { from: S.leaves, model: allLeavesModel(S.leaves) }; }
  return leavesModel.model;
}

/** Leaves inside the attribute scope; undefined when no scope is set. */
function scopeSet(): Set<string> | undefined {
  if (!S.scopeAttr || !S.scopeValue) { return undefined; }
  return new Set(Object.keys(S.scopeValues).filter(n => S.scopeValues[n] === S.scopeValue));
}

function view(): CompareView {
  return {
    ref: isImport(S.ref) ? '' : S.ref, cmp: S.cmp.filter(c => !isImport(c)), alias: S.aliasName,
    scopeAttr: S.scopeAttr, scopeValue: S.scopeValue, group: S.group, onlyDiff: S.onlyDiff,
  };
}
const remember = (): void => post({ type: 'saveView', view: view() });

/** Model and root behind a column or reference id. */
function source(id: string, own: Model): { model: Model; root: string } {
  if (id === ALL_LEAVES) { return { model: allLeaves(), root: ALL_LEAVES }; }
  const imp = importOf(id);
  return imp ? { model: imp.model, root: imp.root } : { model: own, root: id };
}

/**
 * Picked in the bar but not compared yet. `S.ref`/`S.cmp` hold what the last
 * "Compare" applied — nothing is computed until then, so a large dimension
 * opens with only the pickers.
 */
const P = { ref: '', cmp: [] as string[] };
/** Set by a hierarchy switch: the next `edges` restores that hierarchy's saved view. */
let switching = false;

function post(m: ToHost): void { vscodeApi.postMessage(m); }

function load(dim: string, hier: string, edges: Edge[]): void {
  S.dim = dim; S.hier = hier; S.base = edges; S.changes = [];
  S.filter = null; S.cur = null; S.selEdge = null; S.message = '';
  const m = buildModel(edges);
  // A reload keeps picked and compared roots that still exist.
  const ok = (n: string): boolean => n === ALL_LEAVES || (isImport(n) ? !!importOf(n) : m.consolidations.includes(n));
  if (!ok(P.ref)) { P.ref = ''; }
  P.cmp = P.cmp.filter(r => r !== P.ref && ok(r));
  if (!ok(S.ref)) { S.ref = ''; S.cmp = []; }
  S.cmp = S.cmp.filter(ok);
  if (!m.consolidations.includes(S.treeRoot)) { S.treeRoot = m.tops[0] ?? ''; }
}

/**
 * New base from the server, compared roots kept. The draft becomes what still
 * separates the server from the state the draft aimed at — replaying single
 * entries would turn "remove B, add B=2" into a removal once B=2 is written.
 */
function rebase(edges: Edge[]): void {
  const ops = edgeDiff(edges, applyChanges(S.base, S.changes));
  S.base = edges;
  S.changes = [
    ...ops.remove.map((e): Change => ({ action: 'remove', parent: e.parent, child: e.child })),
    ...ops.patch.map((e): Change => ({ action: 'weight', parent: e.parent, child: e.child, weight: e.weight })),
    ...ops.add.map((e): Change => ({ action: 'add', parent: e.parent, child: e.child, weight: e.weight })),
  ];
  S.selEdge = null; S.message = '';
}

function pushChange(c: Change): void {
  if (S.saving) { return; }
  const m = drafted();
  const exists = m.weight(c.parent, c.child) !== undefined;
  if (c.action === 'add') {
    if (exists) { S.message = fmt(L, 'edgeExists', c.parent, c.child); return render(); }
    if (wouldCycle(m, c.parent, c.child)) { S.message = fmt(L, 'wouldCycle', c.parent, c.child); return render(); }
  } else if (!exists) {
    return;
  }
  S.changes.push(c);
  S.selEdge = null;
  S.message = '';
  render();
}

// ── render ──────────────────────────────────────────────────────────────────

function render(): void {
  const m = drafted();
  $('status').hidden = true;

  // Pickers first: a flat hierarchy must still offer the switch to another one.
  renderPickers(m);
  if (!m.consolidations.length) {
    $('status').hidden = false;
    $('status').textContent = L.noConsolidations;
    $('tiles').innerHTML = '';
    $('main').hidden = true;
    return;
  }
  if (!S.ref || !S.cmp.length) {
    last = null;
    $('status').hidden = false;
    $('status').textContent = L.pickRoots;
    $('tiles').innerHTML = '';
    $('main').hidden = true;
    return;
  }

  // A scope value with its attribute values not there yet, or no longer among
  // them, would compare zero leaves and report "no differences".
  const scopeNote = !S.scopeAttr || !S.scopeValue ? ''
    : S.scopeFor !== S.scopeAttr ? L.loadingScope
      : !Object.values(S.scopeValues).includes(S.scopeValue) ? fmt(L, 'scopeGone', S.scopeValue) : '';
  if (scopeNote) {
    last = null;
    $('status').hidden = false;
    $('status').textContent = scopeNote;
    $('tiles').innerHTML = '';
    $('main').hidden = true;
    return;
  }

  let r: CompareResult;
  try {
    const ref = source(S.ref, m);
    r = compare(ref.model, ref.root, S.cmp.map((id): Column => ({ id, ...source(id, m) })), scopeSet());
    last = { r, ref };
  } catch (e) {
    if (!(e instanceof CycleError)) { throw e; }
    $('tiles').innerHTML = `<div class="err">${esc(fmt(L, 'cycle', e.node))}</div>`;
    $('main').hidden = false;
    $('matrix').innerHTML = '';
    renderChanges(m);
    return;
  }
  $('main').hidden = false;
  renderTiles(r);
  renderMatrix();
  renderDetail(m, r);
  renderChanges(m);
}

function renderPickers(m: Model): void {
  const rootsHtml = (): string => rootOrder(m).html;
  const srcHtml = (): string => S.imports.filter(i => i.kind !== 'hier')
    .map(i => `<option value="${esc(i.id)}">${esc(colLabel(i.id))}</option>`).join('') +
    hierSources.map(offerHtml).join('');
  lazyPicker('ref', `<option value="">${esc(L.selectPlaceholder)}</option><option value="${ALL_LEAVES}">${esc(L.allLeaves)}</option>`,
    () => rootsHtml() + srcHtml(), pickerValue(P.ref));
  $('addSrc').hidden = !S.addOpen;
  const loaded = new Set(hierSources.filter(h => !h.server).map(h => h.hier));
  const open = S.hierarchies.filter(h => h !== S.hier && !loaded.has(h));
  const hs = S.hierarchies.includes(S.hier) ? S.hierarchies : [S.hier, ...S.hierarchies];
  $('hier').innerHTML = hs.map(h => `<option value="${esc(h)}"${h === S.hier ? ' selected' : ''}>${esc(h)}</option>`).join('');
  // Switching drops the draft — refuse while there is one, instead of asking.
  const hierSel = $('hier') as HTMLSelectElement;
  hierSel.disabled = hs.length < 2 || S.changes.length > 0 || S.saving;
  for (const id of ['alias', 'scopeAttr', 'scopeValue']) { ($(id) as HTMLSelectElement).disabled = S.saving; }
  hierSel.title = S.changes.length ? L.draftBlocksSwitch : '';
  $('hierBtns').innerHTML = open.length
    ? open.map(h => `<button data-loadhier="${esc(h)}">${esc(h)}</button>`).join('')
    : `<span class="muted">${esc(L.noOtherHier)}</span>`;
  $('alias').innerHTML = `<option value="">${esc(L.noAlias)}</option>` + S.aliases
    .map(a => `<option value="${esc(a)}"${a === S.aliasName ? ' selected' : ''}>${esc(a)}</option>`).join('');
  // Only the picked roots show as chips; everything else sits in one searchable
  // picker — a dimension can have thousands of consolidations.
  const chips = P.cmp.map(id =>
    `<span class="pick on${isImport(id) ? ' src' : ''}"><span class="mono" title="${esc(isImport(id) ? colLabel(id) : id)}">${esc(colLabel(id))}</span>` +
    `<button class="srcx" data-uncmp="${esc(id)}" title="${esc(L.importRemove)}">×</button></span>`).join('');
  $('cmpChips').innerHTML = chips;
  $('srcGroups').innerHTML = renderSourceGroups();
  // Picked roots are hidden, not left out: the full list stays the same markup.
  lazyPicker('addRoot', `<option value="">${esc(L.addRoot)}</option>`, () => rootsHtml() + srcHtml(), '',
    new Set([P.ref, ...P.cmp].map(pickerValue)));
  ($('onlyDiff') as HTMLInputElement).checked = S.onlyDiff;
  ($('groupRows') as HTMLInputElement).checked = S.group;
  $('scopeAttr').innerHTML = `<option value="">${esc(L.scopeAll)}</option>` + S.attributes
    .map(a => `<option value="${esc(a)}"${a === S.scopeAttr ? ' selected' : ''}>${esc(a)}</option>`).join('');
  // Without attributes the only choice is "all elements" — no choice at all.
  $('scopeField').hidden = !S.attributes.length;
  const values = [...new Set(Object.values(S.scopeValues))].sort((a, b) => a.localeCompare(b));
  $('scopeValueBox').hidden = !S.scopeAttr;
  $('scopeValue').innerHTML = `<option value="">${esc(L.selectPlaceholder)}</option>` +
    values.map(v => `<option value="${esc(v)}"${v === S.scopeValue ? ' selected' : ''}>${esc(v)}</option>`).join('');
  lazyPicker('treeRoot', '', rootsHtml, S.treeRoot);
  const same = P.ref === S.ref && P.cmp.length === S.cmp.length && P.cmp.every(c => S.cmp.includes(c));
  ($('compare') as HTMLButtonElement).disabled = !P.ref || !P.cmp.length || same;
}

/** Pickers only — choosing roots must not recompute the matrix. */
function renderPickersOnly(): void {
  renderPickers(drafted());
}

function renderTiles(r: CompareResult): void {
  const p = (w: Map<string, number>): string => { const x = probe(w); return fmt(L, 'leavesSum', x.leaves, fmtW(x.sum)); };
  const refProbe = p(r.expected);
  $('tiles').innerHTML =
    `<div class="tile ref"><h3>${esc(L.reference)}</h3><div class="name mono" title="${esc(S.ref)}">${esc(colLabel(S.ref))}</div><div class="muted">${esc(refProbe)}</div></div>` +
    S.cmp.map(root => {
      const c = r.counts.get(root);
      const pr = p(r.actual.get(root) ?? new Map());
      const chips = CELL_CLASSES.map(k => {
        const n = c ? c[k] : 0;
        const sel = S.filter?.root === root && S.filter.cls === k;
        return `<button class="chip k-${k}${sel ? ' sel' : ''}" data-filter="${esc(root)}" data-cls="${k}"${n ? '' : ' disabled'}>${n} ${esc(CLS_LABEL[k])}</button>`;
      }).join('');
      return `<div class="tile${isImport(root) ? ' imp-tile' : ''}"><div class="name mono" title="${esc(root)}">${esc(colLabel(root))}</div><div class="muted">${esc(pr)}</div>` +
        (pr === refProbe ? '' : `<div class="warnText">${esc(L.probeDiffers)}</div>`) +
        `<div class="chipset">${chips}</div>` + applyRow(root) + bulkRow(root, c) + `</div>`;
    }).join('') +
    (S.cmp.length ? '' : `<div class="muted">${esc(L.noCompared)}</div>`);
  // Tiles are redrawn on every render: a target picker holds only its current
  // choice until opened, instead of every consolidation each time.
  for (const id of S.cmp) {
    const imp = importOf(id);
    if (!imp) { continue; }
    filterable(`target-${id}`, () => {
      const sel = $(`target-${id}`) as HTMLSelectElement;
      if (sel.options.length > 2) { return; }
      sel.innerHTML = `<option value="">${esc(L.selectPlaceholder)}</option>` + rootOrder(drafted()).html;
      sel.value = imp.target;
    });
  }
}

/** "Fix missing and extra" on a server column's tile. */
function bulkRow(id: string, c: { missing: number; extra: number } | undefined): string {
  if (isImport(id) || !c) { return ''; }
  const n = c.missing + c.extra;
  return `<div class="apply"><button data-bulk="${esc(id)}" title="${esc(L.bulkFixHint)}"${n ? '' : ' disabled'}>${esc(fmt(L, 'bulkFix', n))}</button></div>` +
    (S.bulkNote[id] ? `<div class="applyNote">${esc(S.bulkNote[id])}</div>` : '');
}

function applyBulk(id: string): void {
  if (!last || isImport(id) || S.saving) { return; }
  const m = drafted();
  const cls = last.r.cls.get(id);
  if (!cls) { return; }
  const fix = bulkFix(m, id, last.ref.model, last.ref.root, cls, last.r.expected);
  S.changes.push(...fix.changes);
  const parts = [fmt(L, 'bulkFixNote', fix.changes.length)];
  if (fix.skipped.length) {
    parts.push(fmt(L, 'bulkSkipped', fix.skipped.length, fix.skipped.slice(0, 10).map(lbl).join(', ') + (fix.skipped.length > 10 ? ', …' : '')));
  }
  if (fix.shared.length) { parts.push(fmt(L, 'importShared', fix.shared.map(lbl).join(', '))); }
  S.bulkNote[id] = parts.join(' ');
  S.selEdge = null; S.message = '';
  render();
}

/** "as [root] Apply to draft" on the tile of a source column. */
function applyRow(id: string): string {
  const imp = importOf(id);
  if (!imp) { return ''; }
  return `<div class="apply"><span>${esc(L.applyTo)}</span><select id="target-${esc(id)}" data-target="${esc(id)}">` +
    `<option value="">${esc(L.selectPlaceholder)}</option>${imp.target ? options([imp.target], imp.target) : ''}</select>` +
    `<button data-applyimport="${esc(id)}">${esc(L.applyImport)}</button></div>` +
    (imp.note ? `<div class="applyNote">${esc(imp.note)}</div>` : '');
}

/** One dashed tag per added source: name, unknown-name badge, remove button. Its roots are in the picker. */
function renderSourceGroups(): string {
  const groups = new Map<number, { name: string; unknown: string[] }>();
  for (const i of S.imports) { if (i.kind !== 'hier' && !groups.has(i.group)) { groups.set(i.group, { name: groupName(i), unknown: i.unknown }); } }
  for (const h of hierSources) { groups.set(h.group, { name: h.hier, unknown: h.unknown }); }
  return [...groups].sort((a, b) => a[0] - b[0]).map(([g, { name, unknown }]) => {
    const warn = unknown.length
      ? `<span class="srcwarn" title="${esc(fmt(L, 'importUnknown', unknown.length, unknown.slice(0, 30).join(', ') + (unknown.length > 30 ? ', …' : '')))}">⚠ ${esc(fmt(L, 'unknownBadge', unknown.length))}</span>`
      : '';
    return `<span class="srcgroup"><span class="srcname">${esc(name)}</span>${warn}` +
      `<button class="srcx" data-dropgroup="${g}" title="${esc(L.importRemove)}">×</button></span>`;
  }).join('');
}

/** Rows after class filter, "only differences" and search — what the matrix and the export show. */
function visibleRows(r: CompareResult): string[] {
  const off = (l: string): boolean => S.cmp.some(root => r.cls.get(root)?.get(l) !== 'ok');
  let rows = r.leaves;
  if (S.filter) { const f = S.filter; rows = rows.filter(l => r.cls.get(f.root)?.get(l) === f.cls); }
  else if (S.onlyDiff) { rows = rows.filter(off); }
  const q = S.search.trim().toLowerCase();
  if (q) { rows = rows.filter(l => l.toLowerCase().includes(q) || (S.alias[l] ?? '').toLowerCase().includes(q)); }
  return rows;
}

function renderMatrix(): void {
  if (!last) { return; }
  const { r, ref } = last;
  const rows = visibleRows(r);

  $('matrixTitle').textContent = fmt(L, 'matrixCount', rows.length, r.leaves.length);
  const note: string[] = [];
  if (S.filter) {
    note.push(`${esc(fmt(L, 'filterOn', CLS_LABEL[S.filter.cls], colLabel(S.filter.root)))} <button id="clearFilter">${esc(L.clearFilter)}</button>`);
  } else if (!rows.length && S.cmp.length && !S.search) {
    note.push(esc(L.allOk));
  }
  if (rows.length > MAX_ROWS) { note.push(esc(fmt(L, 'truncated', MAX_ROWS))); }
  $('filterNote').innerHTML = note.join(' · ');

  const row = (l: string): string => {
    const s = r.expected.get(l) ?? 0;
    return `<tr><td class="mono" title="${esc(l)}">${esc(lbl(l))}</td><td class="soll mono">${fmtW(s)}</td>` + S.cmp.map(root => {
      const i = r.actual.get(root)?.get(l) ?? 0;
      const k = r.cls.get(root)?.get(l) ?? 'ok';
      const cur = S.cur?.leaf === l && S.cur.root === root;
      const quiet = k === 'ok' && isZero(s);
      return `<td class="cell mono${cur ? ' cur' : ''}" data-leaf="${esc(l)}" data-root="${esc(root)}" title="${esc(CLS_LABEL[k])}"><span class="${quiet ? '' : 'k-' + k}">${fmtW(i)}</span></td>`;
    }).join('') + '</tr>';
  };

  let body = '';
  // Grouping by the reference's parent means nothing under the all-leaves root.
  if (S.group && ref.root !== ALL_LEAVES) {
    const g = groupByRefParent(ref.model, ref.root, rows);
    const order: string[] = [];
    const byGroup = new Map<string, string[]>();
    for (const l of rows) {
      const k = g.get(l) ?? '';
      if (!byGroup.has(k)) { byGroup.set(k, []); order.push(k); }
      (byGroup.get(k) as string[]).push(l);
    }
    let drawn = 0;
    for (const k of order) {
      const ls = byGroup.get(k) as string[];
      const closed = S.collapsed.has(k);
      body += `<tr class="grp" data-grp="${esc(k)}"><td colspan="${2 + S.cmp.length}">${closed ? '▸' : '▾'} ${esc(k ? lbl(k) : L.notInRef)}<span class="muted">${ls.length}</span></td></tr>`;
      if (closed) { continue; }
      for (const l of ls) { if (drawn++ < MAX_ROWS) { body += row(l); } }
    }
  } else {
    body = rows.slice(0, MAX_ROWS).map(row).join('');
  }
  $('matrix').innerHTML =
    `<thead><tr><th>${esc(L.element)}</th><th>${esc(L.expected)}</th>${S.cmp.map(c => `<th class="mono${isImport(c) ? ' imp-col' : ''}" title="${esc(isImport(c) ? colLabel(c) : c)}">${esc(colLabel(c))}</th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
}

/** The comparison as CSV: what the matrix shows (filter, search), without the row cap, paths for every non-ok cell. */
function resultCsv(): string {
  if (!last) { return ''; }
  const { r } = last;
  const m = drafted();
  const pathText = (ps: Edge[][]): string =>
    ps.map(p => [p[0].parent, ...p.map(e => e.child)].map(lbl).join(' > ') + ` (${p.reduce((a, e) => a * e.weight, 1)})`).join(' | ');
  const head = [L.element, ...(S.aliasName ? [S.aliasName] : []), `${L.expected} (${colLabel(S.ref)})`];
  for (const c of S.cmp) { head.push(fmt(L, 'csvValue', colLabel(c)), fmt(L, 'csvClass', colLabel(c)), fmt(L, 'csvPaths', colLabel(c))); }
  const lines = [csvLine(head)];
  for (const l of visibleRows(r)) {
    const f: (string | number)[] = [l, ...(S.aliasName ? [S.alias[l] ?? ''] : []), r.expected.get(l) ?? 0];
    for (const c of S.cmp) {
      const k = r.cls.get(c)?.get(l) ?? 'ok';
      const src = source(c, m);
      f.push(r.actual.get(c)?.get(l) ?? 0, CLS_LABEL[k], k === 'ok' ? '' : pathText(src.model.paths(src.root, l)));
    }
    lines.push(csvLine(f));
  }
  return lines.join('\n');
}

function pathHtml(list: Edge[][], editable: boolean): string {
  if (!list.length) { return `<div class="muted">${esc(L.noPath)}</div>`; }
  return list.map(p => {
    const w = p.reduce((a, e) => a * e.weight, 1);
    return `<div class="path mono"><span title="${esc(p[0].parent)}">${esc(lbl(p[0].parent))}</span>` + p.map(e => {
      const sel = editable && S.selEdge === key(e.parent, e.child);
      return (editable
        ? `<button class="edge${sel ? ' sel' : ''}" data-edge="${esc(e.parent)}" data-edgec="${esc(e.child)}">×${fmtW(e.weight)}</button>`
        : `<span class="muted">×${fmtW(e.weight)}</span>`) + `<span title="${esc(e.child)}">${esc(lbl(e.child))}</span>`;
    }).join('') + `<span class="w">= ${fmtW(w)}</span></div>`;
  }).join('') + (list.length >= MAX_PATHS ? `<div class="muted">${esc(fmt(L, 'pathsCapped', MAX_PATHS))}</div>` : '');
}

function renderDetail(m: Model, r: CompareResult): void {
  const d = $('detail');
  const msg = S.message ? `<div class="err">${esc(S.message)}</div>` : '';
  if (!S.cur || !S.cmp.includes(S.cur.root)) {
    d.innerHTML = `<h2>${esc(L.paths)}</h2><div class="muted">${esc(L.pickCell)}</div>${msg}`;
    return;
  }
  const { leaf, root: col } = S.cur;
  const s = r.expected.get(leaf) ?? 0;
  const i = r.actual.get(col)?.get(leaf) ?? 0;
  const k = r.cls.get(col)?.get(leaf) ?? 'ok';
  const ref = source(S.ref, m);
  const refPs = ref.model.paths(ref.root, leaf);
  const imp = importOf(col);
  if (imp) {
    d.innerHTML = `<div class="row" style="justify-content:space-between"><h2>${esc(L.paths)}</h2><span class="pill k-${k}">${esc(CLS_LABEL[k])}</span></div>
      <div>${esc(fmt(L, 'actualExpected', lbl(leaf), colLabel(col), fmtW(i), fmtW(s)))}</div>
      <div>${pathHtml(imp.model.paths(imp.root, leaf), false)}</div>
      <h2>${esc(L.inReference)}</h2><div>${pathHtml(refPs, false)}</div>`;
    return;
  }
  const root = col;
  const ps = m.paths(root, leaf);

  if (ps.length && (!S.selEdge || !ps.some(p => p.some(e => key(e.parent, e.child) === S.selEdge)))) {
    const last = ps[0][ps[0].length - 1];
    S.selEdge = key(last.parent, last.child);
  }
  let edit = '';
  if (ps.length && S.selEdge) {
    const [p, c] = S.selEdge.split('\u0000');
    const users = rootsUsing(m, p, root);
    edit = `<div class="mono">${esc(lbl(p))} → ${esc(lbl(c))}</div>
      <div class="row"><button data-act="remove">${esc(L.removeEdge)}</button>
      <input type="number" id="newWeight" step="any" value="${m.weight(p, c) ?? 1}" aria-label="${esc(L.weight)}">
      <button data-act="weight">${esc(L.setWeight)}</button></div>` +
      (users.length ? `<div class="warn">${esc(fmt(L, 'sharedNode', lbl(p), users.map(lbl).join(', ')))}</div>` : '');
  }
  // Attach targets: consolidations under the compared root; preselect the
  // parent the reference uses, if this root contains it.
  const under = [...m.reach(root)].filter(n => m.children(n).length && n !== leaf);
  const refParents = refPs.map(p => p[p.length - 1].parent);
  const pre = refParents.find(p => under.includes(p)) ?? under[0];
  const attach = k === 'missing' || k === 'wrongWeight'
    ? `<div class="row"><span>${esc(L.attachUnder)}</span><select id="attachParent">${options(under, pre ?? '')}</select>
       <input type="number" id="attachWeight" step="any" value="${isZero(s) ? 1 : s}" aria-label="${esc(L.weight)}">
       <button data-act="add">${esc(L.attach)}</button></div>`
    : '';

  d.innerHTML = `<div class="row" style="justify-content:space-between"><h2>${esc(L.paths)}</h2><span class="pill k-${k}">${esc(CLS_LABEL[k])}</span></div>
    <div>${esc(fmt(L, 'actualExpected', lbl(leaf), lbl(root), fmtW(i), fmtW(s)))}</div>
    ${msg}
    <div>${pathHtml(ps, true)}</div>
    ${edit}${attach}
    <h2>${esc(L.inReference)}</h2><div>${pathHtml(refPs, false)}</div>`;
  if (attach) { filterable('attachParent'); }
}

function renderChanges(m: Model): void {
  $('changes').innerHTML = S.changes.length
    ? S.changes.map((c, ix) => {
      const edge = `${lbl(c.parent)} → ${lbl(c.child)}`;
      const t = c.action === 'add' ? `+ ${edge} (${fmtW(c.weight)})`
        : c.action === 'remove' ? `− ${edge}` : `~ ${edge} = ${fmtW(c.weight)}`;
      return `<li class="mono">${esc(t)}<button data-drop="${ix}"${S.saving ? ' disabled' : ''} title="${esc(L.dropChange)}">×</button></li>`;
    }).join('')
    : `<li class="muted" style="list-style:none;margin-left:-22px">${esc(L.noChanges)}</li>`;
  ($('undo') as HTMLButtonElement).disabled = !S.changes.length;
  ($('discard') as HTMLButtonElement).disabled = !S.changes.length;
  ($('exportChanges') as HTMLButtonElement).disabled = !S.changes.length;
  ($('save') as HTMLButtonElement).disabled = !S.changes.length || S.saving;
  ($('undo') as HTMLButtonElement).disabled ||= S.saving;
  ($('discard') as HTMLButtonElement).disabled ||= S.saving;
  $('saveMsg').innerHTML = S.saveMsg ? `<div class="${S.saveErr ? 'err' : 'muted'}">${esc(S.saveMsg)}</div>` : '';
  ($('exportSubtree') as HTMLButtonElement).disabled = !m.consolidations.includes(S.treeRoot);
}

/** Puts the difference between an imported list and a server root into the draft. */
function applyImport(id: string): void {
  const imp = importOf(id);
  if (!imp || !S.ref || S.saving) { return; }
  if (!imp.target) { imp.note = L.pickTarget; return render(); }
  const m = drafted();
  const r = draftFromImport(m, imp.target, imp.model, imp.root, new Set(imp.unknown));
  S.changes.push(...r.changes);
  const parts = [fmt(L, 'importApplied', r.changes.length, lbl(imp.target))];
  if (r.skipped.length) { parts.push(fmt(L, 'importSkipped', r.skipped.length)); }
  if (r.shared.length) { parts.push(fmt(L, 'importShared', r.shared.map(lbl).join(', '))); }
  imp.note = parts.join(' ');
  // Put the target next to the source column, so the draft's effect is visible at once.
  if (imp.target !== S.ref && !S.cmp.includes(imp.target)) {
    S.cmp.splice(S.cmp.indexOf(id) + 1, 0, imp.target);
    if (!P.cmp.includes(imp.target)) { P.cmp.push(imp.target); }
  }
  S.selEdge = null; S.message = '';
  render();
}

function addSource(group: number, kind: ImportCol['kind'], file: string, root: string, model: Model, unknown: string[], pick: boolean, own: ReadonlySet<string>): string {
  const id = `\u0001${++importSeq}`;
  // Preselect the consolidation of the same name in this hierarchy, if there is one.
  const target = own.has(root) ? root : '';
  S.imports.push({ id, group, kind, file, root, model, unknown, target, note: '' });
  if (pick) { P.cmp.push(id); }
  return id;
}

/** Consolidations of the shown hierarchy as loaded, for preselecting an apply target. */
let ownCache: { base: Edge[]; set: Set<string> } | null = null;
function ownConsolidations(): Set<string> {
  if (ownCache?.base !== S.base) { ownCache = { base: S.base, set: new Set(buildModel(S.base).consolidations) }; }
  return ownCache.set;
}

/**
 * Another hierarchy as a source: every consolidation of it becomes pickable,
 * and a column once picked,
 * tops first — the right root often sits under a collector like "all
 * structures", so nothing is picked on its own. Leaves are named alike across
 * hierarchies, so no name matching; consolidations that exist only there are
 * "unknown" for applying. A reload replaces the model in place.
 */
function addHierarchy(hier: string, edges: Edge[], server?: string): void {
  const model = buildModel(edges);
  const known = new Set(S.elements);
  for (const e of S.base) { known.add(e.parent); known.add(e.child); }
  const unknown = [...new Set(edges.flatMap(e => [e.parent, e.child]))].filter(n => !known.has(n));
  const src = hierSources.find(h => h.hier === hier);
  if (src) { src.model = model; src.unknown = unknown; } else {
    hierSources.push({ hier, group: ++groupSeq, model, unknown, server });
    S.addOpen = false;
  }
  const had = S.imports.filter(i => i.kind === 'hier' && i.file === hier);
  for (const i of had) { i.model = model; i.unknown = unknown; }
  // Roots gone from that hierarchy drop out.
  const now = new Set(model.consolidations);
  const gone = new Set(had.filter(i => !now.has(i.root)).map(i => i.id));
  S.imports = S.imports.filter(i => !gone.has(i.id));
  P.cmp = P.cmp.filter(c => !gone.has(c));
  S.cmp = S.cmp.filter(c => !gone.has(c));
  if (gone.has(P.ref)) { P.ref = ''; }
  if (gone.has(S.ref)) { S.ref = ''; }
  render();
}

/** One column per top consolidation of the list, names matched to the server's spelling. */
function addImport(file: string, text: string): void {
  let parsed: Edge[];
  try { parsed = parseEdgeText(text); } catch (e) { $('importMsg').textContent = String((e as Error).message ?? e); return; }
  if (!parsed.length) { $('importMsg').textContent = L.importNoEdges; return; }
  const known = new Set(S.elements);
  for (const e of S.base) { known.add(e.parent); known.add(e.child); }
  const { edges, unknown } = matchNames(parsed, known);
  const model = buildModel(edges);
  const tops = model.tops.length ? model.tops : model.consolidations.slice(0, 1);
  const group = ++groupSeq;
  const own = ownConsolidations();
  for (const root of tops) { addSource(group, 'list', file, root, model, unknown, true, own); }
  ($('importText') as HTMLTextAreaElement).value = '';
  $('importMsg').textContent = '';
  S.addOpen = false;
  renderPickersOnly();
}

// ── events ──────────────────────────────────────────────────────────────────

function numberOf(id: string): number | undefined {
  const v = Number(($(id) as HTMLInputElement).value);
  return Number.isFinite(v) ? v : undefined;
}

document.addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('button, td.cell, tr.grp');
  if (!t) { return; }
  const ds = t.dataset;
  if (ds.grp !== undefined) {
    if (S.collapsed.has(ds.grp)) { S.collapsed.delete(ds.grp); } else { S.collapsed.add(ds.grp); }
    return renderMatrix();
  }
  if (ds.bulk !== undefined) { return applyBulk(ds.bulk); }
  if (t.id === 'exportResult') {
    return post({ type: 'export', kind: 'result', name: `${S.hier}_compare.csv`, text: resultCsv() });
  }
  if (t.matches('td.cell')) {
    S.cur = { leaf: ds.leaf as string, root: ds.root as string };
    S.selEdge = null; S.message = '';
    return render();
  }
  if (ds.uncmp !== undefined) { P.cmp = P.cmp.filter(c => c !== ds.uncmp); return renderPickersOnly(); }
  if (t.id === 'compare') {
    S.ref = P.ref; S.cmp = [...P.cmp];
    S.filter = null; S.cur = null; S.selEdge = null; S.message = ''; S.bulkNote = {}; S.collapsed.clear();
    if (!S.treeRoot) { S.treeRoot = S.cmp[0]; }
    remember();
    return render();
  }
  if (ds.filter !== undefined) {
    const f = { root: ds.filter, cls: ds.cls as CellClass };
    S.filter = S.filter?.root === f.root && S.filter.cls === f.cls ? null : f;
    return render();
  }
  if (t.id === 'clearFilter') { S.filter = null; return render(); }
  if (ds.edge !== undefined) { S.selEdge = key(ds.edge, ds.edgec as string); return render(); }
  if (ds.act && S.cur) {
    if (ds.act === 'add') {
      const w = numberOf('attachWeight');
      if (w === undefined) { S.message = L.notANumber; return render(); }
      return pushChange({ action: 'add', parent: ($('attachParent') as HTMLSelectElement).value, child: S.cur.leaf, weight: w });
    }
    if (!S.selEdge) { return; }
    const [parent, child] = S.selEdge.split('\u0000');
    if (ds.act === 'remove') { return pushChange({ action: 'remove', parent, child }); }
    const w = numberOf('newWeight');
    if (w === undefined) { S.message = L.notANumber; return render(); }
    return pushChange({ action: 'weight', parent, child, weight: w });
  }
  if (ds.drop !== undefined && !S.saving) { S.changes.splice(Number(ds.drop), 1); return render(); }
  if (t.id === 'undo') { S.changes.pop(); return render(); }
  if (t.id === 'discard') { S.changes = []; return render(); }
  if (t.id === 'reload') { return post({ type: 'reload' }); }
  if (t.id === 'importPaste') { return addImport('Paste', ($('importText') as HTMLTextAreaElement).value); }
  if (t.id === 'importFile') { return post({ type: 'pickImportFile' }); }
  if (t.id === 'loadServer') { return post({ type: 'loadServer' }); }
  if (t.id === 'addSrcBtn') { S.addOpen = !S.addOpen; return renderPickersOnly(); }
  if (ds.loadhier !== undefined) { return post({ type: 'loadHierarchy', hier: ds.loadhier }); }
  if (ds.applyimport !== undefined) { return applyImport(ds.applyimport); }
  if (ds.dropgroup !== undefined) {
    const g = Number(ds.dropgroup);
    const gone = new Set(S.imports.filter(i => i.group === g).map(i => i.id));
    S.imports = S.imports.filter(i => i.group !== g);
    hierSources = hierSources.filter(h => h.group !== g);
    P.cmp = P.cmp.filter(c => !gone.has(c));
    if (gone.has(P.ref)) { P.ref = ''; }
    const shown = gone.has(S.ref) || S.cmp.some(c => gone.has(c));
    if (gone.has(S.ref)) { S.ref = ''; }
    S.cmp = S.cmp.filter(c => !gone.has(c));
    if (S.filter && gone.has(S.filter.root)) { S.filter = null; }
    if (S.cur && gone.has(S.cur.root)) { S.cur = null; }
    return shown ? render() : renderPickersOnly();
  }
  if (t.id === 'save') {
    if (!S.changes.length || S.saving) { return; }
    S.saving = true; S.saveMsg = L.saving; S.saveErr = false;
    render();
    return post({ type: 'save', base: S.base, changes: S.changes });
  }
  if (t.id === 'exportChanges') {
    return post({ type: 'export', kind: 'changes', name: `${S.hier}_changes.csv`, text: changesCsv(S.changes) });
  }
  if (t.id === 'exportSubtree') {
    const m = drafted();
    return post({ type: 'export', kind: 'subtree', name: `${S.treeRoot}.csv`, text: subtreeCsv(m, S.treeRoot) });
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === 'ref') {
    P.ref = columnFor(t.value); P.cmp = P.cmp.filter(c => c !== P.ref);
    return renderPickersOnly();
  }
  if (t.id === 'addRoot') {
    const id = columnFor(t.value);
    if (id && !P.cmp.includes(id)) { P.cmp.push(id); }
    return renderPickersOnly();
  }
  if (t.id === 'hier') {
    if (t.value === S.hier || S.changes.length) { return; }
    // Sources of the hierarchy now shown would compare it with itself.
    const self = new Set(S.imports.filter(i => i.kind === 'hier' && i.file === t.value).map(i => i.id));
    S.imports = S.imports.filter(i => !self.has(i.id));
    hierSources = hierSources.filter(h => h.hier !== t.value);
    P.cmp = P.cmp.filter(c => !self.has(c));
    if (self.has(P.ref)) { P.ref = ''; }
    S.ref = ''; S.cmp = []; S.cur = null; S.filter = null;
    switching = true;
    return post({ type: 'switchHierarchy', hier: t.value });
  }
  if (t.id === 'onlyDiff') { S.onlyDiff = t.checked; remember(); return render(); }
  if (t.id === 'groupRows') { S.group = t.checked; remember(); return renderMatrix(); }
  if (t.id === 'scopeAttr') {
    S.scopeAttr = t.value; S.scopeValue = ''; S.scopeValues = {}; S.scopeFor = '';
    remember();
    if (S.scopeAttr) { post({ type: 'scopeAttr', attr: S.scopeAttr }); }
    return render();
  }
  if (t.id === 'scopeValue') { S.scopeValue = t.value; remember(); return render(); }
  if (t.id === 'alias') {
    S.aliasName = t.value;
    remember();
    if (!S.aliasName) { S.alias = {}; return render(); }
    return post({ type: 'alias', alias: S.aliasName });
  }
  if (t.id === 'treeRoot') { S.treeRoot = t.value; return render(); }
  if (t.dataset.target !== undefined) {
    const imp = importOf(t.dataset.target);
    // No re-render: the combo stays as it is, the button reads the target on click.
    if (imp) { imp.target = t.value; }
    return;
  }
});

window.addEventListener('message', (ev: MessageEvent<ToClient>) => {
  const m = ev.data;
  if (m.type === 'loading') {
    $('status').hidden = false;
    $('status').textContent = L.loading;
  } else if (m.type === 'edges') {
    S.elements = m.elements;
    S.hierarchies = m.hierarchies;
    S.leaves = m.leaves;
    S.attributes = m.attributes;
    // Fresh open or hierarchy switch: start from what was picked here last time.
    const fresh = switching || (!P.ref && !P.cmp.length && !S.ref);
    switching = false;
    if (fresh) {
      const v = m.view;
      // Sources from other hierarchies stay picked; the server roots come from the view.
      const kept = P.cmp.filter(isImport);
      P.ref = isImport(P.ref) ? P.ref : v.ref;
      P.cmp = [...v.cmp.filter(c => c !== P.ref), ...kept];
      S.aliasName = v.alias; S.onlyDiff = v.onlyDiff; S.group = v.group;
      S.scopeAttr = m.attributes.includes(v.scopeAttr) ? v.scopeAttr : '';
      S.scopeValue = S.scopeAttr ? v.scopeValue : ''; S.scopeValues = {}; S.scopeFor = '';
    }
    load(m.dim, m.hier, m.edges);
    S.aliases = m.aliases;
    if (!S.aliases.includes(S.aliasName)) { S.aliasName = ''; S.alias = {}; }
    if (!S.attributes.includes(S.scopeAttr)) { S.scopeAttr = ''; S.scopeValue = ''; S.scopeValues = {}; S.scopeFor = ''; }
    if (S.scopeAttr) { post({ type: 'scopeAttr', attr: S.scopeAttr }); }
    render();
    // A reload refreshes the alias values too — they may have changed with the edges.
    if (S.aliasName) { post({ type: 'alias', alias: S.aliasName }); }
    // A server source follows the shown hierarchy: the host reads it anew for it.
    for (const h of hierSources) {
      post(h.server ? { type: 'loadServer', serverId: h.server } : { type: 'loadHierarchy', hier: h.hier });
    }
  } else if (m.type === 'saved') {
    S.saving = false;
    rebase(m.edges);
    S.saveMsg = L.saved; S.saveErr = false;
    render();
  } else if (m.type === 'saveFailed') {
    S.saving = false;
    // Conflict: keep the base so the draft still makes sense next to it; the
    // user reloads. Partial write: the server state is the new base, the draft
    // is kept as-is so it shows what did not make it.
    if (!m.conflict && m.edges) { rebase(m.edges); }
    S.saveMsg = m.conflict ? L.conflict : fmt(L, 'saveFailed', m.message);
    S.saveErr = true;
    render();
  } else if (m.type === 'saveCancelled') {
    S.saving = false; S.saveMsg = '';
    render();
  } else if (m.type === 'scopeValues') {
    if (m.attr !== S.scopeAttr) { return; }
    S.scopeValues = m.values; S.scopeFor = m.attr;
    render();
  } else if (m.type === 'aliasValues') {
    if (m.alias !== S.aliasName) { return; }
    S.alias = m.values;
    render();
  } else if (m.type === 'error') {
    // A failed save comes as saveFailed; an error now is some other read, and
    // must not unlock the draft while the write still runs.
    if (m.switchFailed) { switching = false; render(); }
    $('status').hidden = false;
    $('status').innerHTML = `<div class="err">${esc(m.message)}</div>`;
  } else if (m.type === 'hierEdges') {
    addHierarchy(m.hier, m.edges);
  } else if (m.type === 'serverEdges') {
    // Keyed by name, like a hierarchy; an existing source of the same server
    // is refreshed in place. A new one gets a name no hierarchy or other
    // source has — else it would replace that source's model.
    const old = hierSources.find(h => h.server === m.serverId);
    let name = old?.hier ?? m.label;
    for (let n = 2; !old && (S.hierarchies.includes(name) || name === S.hier || hierSources.some(h => h.hier === name)); n++) {
      name = `${m.label} (${n})`;
    }
    addHierarchy(name, m.edges, m.serverId);
  } else if (m.type === 'importText') {
    addImport(m.name, m.text);
  } else if (m.type === 'exported') {
    if (m.kind === 'result') { $('filterNote').textContent = fmt(L, 'exported', m.path); return; }
    $(m.kind === 'subtree' ? 'subtreeMsg' : 'exportMsg').textContent = fmt(L, 'exported', m.path);
  }
});

filterable('ref', () => fillPicker('ref'));
filterable('addRoot', () => fillPicker('addRoot'));
filterable('scopeValue');
document.addEventListener('input', (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === 'rowSearch') { S.search = t.value; renderMatrix(); }
});
filterable('treeRoot', () => fillPicker('treeRoot'));
post({ type: 'ready' });

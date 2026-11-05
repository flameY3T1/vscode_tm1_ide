import type { HostToBuilder, BuilderToHost, BuilderMode, ElementRow } from './protocol';
import { build, type BuilderModel, type DimPick } from '../../tiLogicVisualizer/areaDbBuilderPure';
import { getVsCodeApi } from '../_shared/vscodeApi';
import { getL10n } from '../_shared/l10n';
import { mountTitleCombo } from '../_shared/filterCombo';

const vscode = getVsCodeApi<BuilderToHost>();
const L = getL10n();

interface DimState { name: string; elements: string[]; }
interface ElemCache { rows: ElementRow[]; skip: number; hasMore: boolean; query: string; }

const state = {
  mode: 'AREA' as BuilderMode,
  currentCube: '',
  cubes: [] as string[],
  dbCube: '',
  dims: [] as DimState[],
  openDim: null as string | null,
  elems: new Map<string, ElemCache>(), // key: dim name
};

const $ = (id: string): HTMLElement => document.getElementById(id)!;

function init(): void {
  $('mode-area').textContent = L.modeArea;
  $('mode-db').textContent = L.modeDb;
  $('cube-label').textContent = L.targetCube;
  $('btn-insert').textContent = L.insert;
  $('btn-cancel').textContent = L.cancel;

  document.querySelectorAll('#mode-seg button').forEach((b) =>
    b.addEventListener('click', () => setMode((b as HTMLElement).dataset.mode as BuilderMode)));
  const cubeSel = $('cube-select') as HTMLSelectElement;
  // Servers carry hundreds of cubes: filterable list on top of the select (filterCombo.ts).
  mountTitleCombo(cubeSel);
  cubeSel.addEventListener('change', (e) => {
    state.dbCube = (e.target as HTMLSelectElement).value;
    requestDims(state.dbCube);
  });
  $('btn-insert').addEventListener('click', onInsert);
  $('btn-cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
}

function targetCube(): string {
  return state.mode === 'DB' ? state.dbCube : state.currentCube;
}

function setMode(mode: BuilderMode): void {
  state.mode = mode;
  document.querySelectorAll('#mode-seg button').forEach((b) =>
    b.classList.toggle('active', (b as HTMLElement).dataset.mode === mode));
  $('cube-wrap').style.display = mode === 'DB' ? 'flex' : 'none';
  // Reset dims + picks when switching the underlying cube context.
  state.dims = [];
  state.openDim = null;
  state.elems.clear();
  renderDims();
  requestDims(targetCube());
  renderPreview();
}

function requestDims(cube: string): void {
  if (!cube) { return; }
  vscode.postMessage({ type: 'fetchDims', cube });
}

function renderDims(): void {
  const host = $('dims');
  host.innerHTML = '';
  for (const d of state.dims) {
    const wrap = document.createElement('div');
    wrap.className = 'dim' + (state.openDim === d.name ? ' open' : '');

    const head = document.createElement('div');
    head.className = 'dim-head';
    const nm = document.createElement('span');
    nm.className = 'dim-name';
    nm.textContent = d.name;
    const val = document.createElement('span');
    val.className = 'dim-val';
    val.textContent = dimSummary(d);
    head.appendChild(nm);
    head.appendChild(val);
    head.addEventListener('click', () => toggleDim(d.name));
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.className = 'dim-body';
    if (state.openDim === d.name) { renderDimBody(body, d); }
    wrap.appendChild(body);
    host.appendChild(wrap);
  }
}

function dimSummary(d: DimState): string {
  if (d.elements.length === 0) { return state.mode === 'DB' ? '!' + d.name : '—'; }
  if (d.elements.length === 1) { return d.elements[0]; }
  return '{' + d.elements.length + '}';
}

function toggleDim(name: string): void {
  state.openDim = state.openDim === name ? null : name;
  renderDims();
  if (state.openDim === name && !state.elems.has(name)) {
    requestElements(name, '', 0);
  }
}

function renderDimBody(body: HTMLElement, d: DimState): void {
  // chips
  const chips = document.createElement('div');
  chips.className = 'chips';
  d.elements.forEach((el) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.textContent = el;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.addEventListener('click', (e) => { e.stopPropagation(); removePick(d, el); });
    c.appendChild(x);
    chips.appendChild(c);
  });
  body.appendChild(chips);

  // search
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = L.searchPlaceholder;
  search.style.width = '100%';
  let timer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => requestElements(d.name, search.value, 0), 200);
  });
  body.appendChild(search);

  // element list
  const list = document.createElement('div');
  list.className = 'elist';
  list.id = 'elist-' + d.name;
  body.appendChild(list);
  renderElements(d);
}

function renderElements(d: DimState): void {
  const list = document.getElementById('elist-' + d.name);
  if (!list) { return; }
  const cache = state.elems.get(d.name);
  list.innerHTML = '';
  if (!cache) { return; }
  // Client-side alias OR name match over loaded pages.
  const q = cache.query.trim().toLowerCase();
  const rows = q
    ? cache.rows.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.aliases.some((a) => a.toLowerCase().includes(q)))
    : cache.rows;
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'erow' + (d.elements.includes(r.name) ? ' picked' : '');
    const nm = document.createElement('span');
    nm.textContent = r.name;
    const al = document.createElement('span');
    al.className = 'alias';
    al.textContent = r.aliases[0] ?? '';
    row.appendChild(nm);
    row.appendChild(al);
    row.addEventListener('click', () => addPick(d, r.name));
    list.appendChild(row);
  }
  if (cache.hasMore) {
    const more = document.createElement('div');
    more.className = 'erow';
    more.style.justifyContent = 'center';
    more.textContent = L.loadMore;
    more.addEventListener('click', () => requestElements(d.name, cache.query, cache.skip + 50));
    list.appendChild(more);
  }
}

function addPick(d: DimState, name: string): void {
  if (state.mode === 'DB') {
    d.elements = [name]; // single-cell: replace
  } else if (!d.elements.includes(name)) {
    d.elements.push(name);
  }
  renderDims();
  renderPreview();
}

function removePick(d: DimState, name: string): void {
  d.elements = d.elements.filter((e) => e !== name);
  renderDims();
  renderPreview();
}

function requestElements(dim: string, query: string, skip: number): void {
  vscode.postMessage({ type: 'fetchElements', dim, query, skip });
}

function model(): BuilderModel {
  const dims: DimPick[] = state.dims.map((d) => ({ name: d.name, elements: d.elements }));
  return state.mode === 'DB'
    ? { mode: 'DB', cube: targetCube(), dims }
    : { mode: 'AREA', dims };
}

function renderPreview(): void {
  const text = state.dims.length || state.mode === 'DB' ? build(model()) : '';
  ($('preview-text') as HTMLElement).textContent = text;
  const empty = state.mode === 'AREA' && !state.dims.some((d) => d.elements.length);
  $('preview-hint').textContent = empty ? L.emptyArea : '';
  ($('btn-insert') as HTMLButtonElement).disabled = empty || !targetCube();
}

function onInsert(): void {
  if (state.mode === 'AREA' && !state.dims.some((d) => d.elements.length)) { return; }
  vscode.postMessage({ type: 'confirm', text: build(model()) });
}

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data as HostToBuilder;
  switch (msg.type) {
    case 'init': {
      state.currentCube = msg.currentCube;
      state.cubes = msg.cubes;
      state.dbCube = msg.cubes.includes(msg.currentCube) ? msg.currentCube : (msg.cubes[0] ?? '');
      const sel = $('cube-select') as HTMLSelectElement;
      sel.innerHTML = '';
      for (const c of msg.cubes) {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        if (c === state.dbCube) { o.selected = true; }
        sel.appendChild(o);
      }
      requestDims(targetCube()); // AREA default → current cube
      break;
    }
    case 'dims': {
      if (msg.cube !== targetCube()) { return; } // stale response
      state.dims = msg.dims.map((n) => ({ name: n, elements: [] }));
      state.openDim = null;
      renderDims();
      renderPreview();
      break;
    }
    case 'elements': {
      const prev = state.elems.get(msg.dim);
      const merged = msg.skip > 0 && prev ? [...prev.rows, ...msg.rows] : msg.rows;
      state.elems.set(msg.dim, { rows: merged, skip: msg.skip, hasMore: msg.hasMore, query: msg.query });
      const d = state.dims.find((x) => x.name === msg.dim);
      if (d) { renderElements(d); }
      break;
    }
    case 'error': {
      $('preview-hint').textContent = msg.message;
      break;
    }
  }
});

init();
vscode.postMessage({ type: 'ready' });

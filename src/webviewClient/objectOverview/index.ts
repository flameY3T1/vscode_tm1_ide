// src/webviewClient/objectOverview/index.ts
import { sortRows, filterRows } from '../../webviews/objectOverview/overviewSortPure';
import { NO_VALUE, applyCellPatches, cellDisplayState } from '../../webviews/objectOverview/overviewCellsPure';
import type { ColumnDef, OverviewRow, KpiValue, ColumnPatch, ColumnKind, CellValue } from '../../webviews/objectOverview/overviewTypes';
import type { HostToOverview, OverviewToHost } from '../../webviews/objectOverview/overviewProtocol';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<OverviewToHost>;
const vscode = getVsCodeApi<OverviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

let columns: ColumnDef[] = [];
let rows: OverviewRow[] = [];
let kpis: KpiValue[] = [];
let i18n: Record<string, string> = {};
let sortKey = 'name';
let sortDir: 1 | -1 = 1;
let showControl = false;
// Click a badge (e.g. a cube's dimension) to filter rows to those whose badges
// column contains that value; click it (or the chip) again to clear.
let badgeFilter: { col: string; val: string } | null = null;
// Click a tile that carries row ids to show only those rows; again (or chip) to clear.
let tileFilter: { key: string; label: string; ids: Set<string> } | null = null;

const $ = (id: string) => document.getElementById(id)!;
const thead = $('ov-thead');
const tbody = $('ov-tbody');
const tiles = $('ov-tiles');
const filterInput = $('ov-filter') as HTMLInputElement;
const countEl = $('ov-count');
const errorEl = $('ov-error');
const showCtrl = $('ov-showctrl') as HTMLInputElement;
const showCtrlLabel = $('ov-showctrl-label');
const refreshBtn = $('ov-refresh');

function t(key: string, ...args: string[]): string {
  const tpl = i18n[key] ?? key;
  let result = tpl;
  for (let i = 0; i < args.length; i++) {
    result = result.replace(`{${i}}`, args[i]);
  }
  return result;
}

window.addEventListener('message', (e) => {
  const msg = e.data as HostToOverview;
  switch (msg.type) {
    case 'init':
      columns = msg.columns;
      i18n = msg.i18n;
      badgeFilter = null;
      tileFilter = null;
      filterInput.placeholder = i18n.filterPlaceholder ?? '';
      refreshBtn.title = i18n.refresh ?? '';
      showCtrlLabel.textContent = i18n.showControl ?? '';
      renderHead();
      break;
    case 'rows':
      errorEl.textContent = '';
      rows = msg.rows;
      kpis = msg.kpis;
      if (tileFilter) {
        // Refresh: a tile that came with the rows brings its new ids; a lazy
        // tile arrives later and updates them in the 'kpi' case, so keep it.
        const k = kpis.find(x => x.key === tileFilter!.key);
        if (k?.rowIds) { tileFilter = { ...tileFilter, ids: new Set(k.rowIds) }; }
      }
      renderKpis();
      renderBody();
      break;
    case 'patch':
      applyPatches(msg.patches);
      renderBody();
      break;
    case 'kpi': {
      // A late KPI replaces its own tile or joins the list; it must not wipe
      // the tiles that came with the rows.
      let refiltered = false;
      for (const k of msg.kpis) {
        const i = kpis.findIndex(x => x.key === k.key);
        if (i >= 0) { kpis[i] = k; } else { kpis.push(k); }
        if (tileFilter?.key === k.key) { tileFilter.ids = new Set(k.rowIds ?? []); refiltered = true; }
      }
      renderKpis();
      if (refiltered) { renderBody(); }
      break;
    }
    case 'loading':
      countEl.textContent = msg.on ? t('loading') : countEl.textContent;
      break;
    case 'error':
      errorEl.textContent = msg.message;
      break;
  }
});

function renderHead(): void {
  thead.textContent = '';
  const tr = document.createElement('tr');
  for (const c of columns) {
    const th = document.createElement('th');
    th.textContent = c.label;
    if (c.kind === 'number') { th.className = 'num'; }
    if (c.sortable !== false) {
      th.addEventListener('click', () => {
        if (sortKey === c.key) { sortDir = (sortDir === 1 ? -1 : 1); }
        else { sortKey = c.key; sortDir = 1; }
        renderBody();
      });
    }
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

function kindOf(key: string): ColumnKind {
  return columns.find(c => c.key === key)?.kind ?? 'text';
}

function renderBody(): void {
  let list = filterRows(rows, filterInput.value, showControl);
  if (tileFilter) {
    const ids = tileFilter.ids;
    list = list.filter(r => ids.has(r.id));
  }
  if (badgeFilter) {
    const bf = badgeFilter;
    list = list.filter(r => {
      const cell = r.cells[bf.col];
      return Array.isArray(cell) && cell.includes(bf.val);
    });
  }
  renderBadgeChip();
  const visible = sortRows(list, sortKey, sortDir, kindOf(sortKey));
  tbody.textContent = '';
  for (const r of visible) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => vscode.postMessage({ type: 'openRow', id: r.id }));
    for (const c of columns) {
      const td = document.createElement('td');
      if (c.kind === 'number') { td.className = 'num'; }
      else if (c.kind === 'badges') { td.className = 'ov-badges-cell'; }
      renderCell(td, c, r.cells[c.key], r.badgeTitles?.[c.key]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  const totalVisibleUniverse = rows.filter(r => showControl || !r.isControl).length;
  countEl.textContent = t('countShown', String(visible.length), String(totalVisibleUniverse));
}

// "Showing only: X  [Clear filter]" — the label says what is filtered, the
// button is the one thing that clears it. A bare "✕ X" chip read as a tag.
let chipEl: HTMLElement | null = null;
let chipText: HTMLElement | null = null;
function renderBadgeChip(): void {
  if (!chipEl) {
    chipEl = document.createElement('span');
    chipEl.className = 'ov-filterbar';
    chipText = document.createElement('span');
    const clear = document.createElement('button');
    clear.className = 'ov-filter-clear';
    clear.textContent = t('clearFilter');
    clear.addEventListener('click', () => { badgeFilter = null; tileFilter = null; renderKpis(); renderBody(); });
    chipEl.append(chipText, clear);
    countEl.insertAdjacentElement('afterend', chipEl);
  }
  const parts = [tileFilter?.label, badgeFilter?.val].filter(Boolean);
  if (parts.length) {
    chipText!.textContent = t('filteredBy', parts.join(' · '));
    chipEl.style.display = '';
  } else {
    chipEl.style.display = 'none';
  }
}

function renderCell(td: HTMLElement, c: ColumnDef, v: CellValue, titles?: Record<string, string>): void {
  // Loading vs. "no value" is decided in overviewCells.ts, not per column kind:
  // a resolved-but-empty cell must never fall through to the flag/badge branch.
  const state = cellDisplayState(c, v);
  if (state === 'loading') {
    const s = document.createElement('span');
    s.className = 'ov-spin';
    td.appendChild(s);
    return;
  }
  if (state === 'empty') {
    td.textContent = NO_VALUE;
    return;
  }
  if (c.kind === 'flag') {
    const el = document.createElement('span');
    el.className = v ? 'ov-flag-yes' : 'ov-flag-no';
    el.textContent = v ? '✓' : '–';
    td.appendChild(el);
  } else if (c.kind === 'badges') {
    const badges = v as string[];
    for (const badge of (badges ?? [])) {
      const el = document.createElement('span');
      const active = badgeFilter && badgeFilter.col === c.key && badgeFilter.val === badge;
      el.className = active ? 'ov-badge ov-badge-active' : 'ov-badge';
      el.textContent = badge;
      el.title = titles?.[badge] ?? badge;
      el.addEventListener('click', (e) => {
        e.stopPropagation(); // don't trigger the row's openRow
        badgeFilter = active ? null : { col: c.key, val: badge };
        renderBody();
      });
      td.appendChild(el);
    }
  } else {
    td.textContent = String(v ?? '');
  }
}

function renderKpis(): void {
  tiles.textContent = '';
  for (const k of kpis) {
    const el = document.createElement('div');
    el.className = 'ov-tile';
    const v = document.createElement('div');
    v.className = 'v';
    v.textContent = k.value;
    const l = document.createElement('div');
    l.className = 'l';
    l.textContent = k.label;
    el.appendChild(v);
    el.appendChild(l);
    if (k.rowIds && k.rowIds.length) {
      const ids = k.rowIds;
      el.classList.add('ov-tile-click');
      el.title = t('tileFilterHint');
      if (tileFilter?.key === k.key) { el.classList.add('ov-tile-active'); }
      el.addEventListener('click', () => {
        tileFilter = tileFilter?.key === k.key ? null : { key: k.key, label: k.label, ids: new Set(ids) };
        renderKpis();
        renderBody();
      });
    }
    tiles.appendChild(el);
  }
}

function applyPatches(patches: ColumnPatch[]): void {
  applyCellPatches(rows, patches);
}

filterInput.addEventListener('input', renderBody);
showCtrl.addEventListener('change', () => { showControl = showCtrl.checked; renderBody(); });
refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

vscode.postMessage({ type: 'ready' });

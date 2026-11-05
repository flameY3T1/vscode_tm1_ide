// src/webviewClient/cubeStats/index.ts
// Bundle of the RAM dashboard (cubeStats/cubeStatsWebview.ts). Until 2026-10
// an inline script in the host's template literal.
import type { CubeStat, StatFormat } from '../../cubeStats/cubeStatsTypes';
import type { CubeStatsBootstrap, CubeStatsToHost, CubeStatsToWebview } from './protocol';
import { escapeHtml as esc } from '../htmlUtils';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<CubeStatsToHost>();
const { measures: MEASURES, texts: L } = (window as unknown as { __cubeStats: CubeStatsBootstrap }).__cubeStats;
const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

let allStats: CubeStat[] = [];
let sortKey = 'totalMemoryBytes';
let sortDir: 'asc' | 'desc' = 'desc';
let filterText = '';

const fmtBytes = (n: number): string => {
  if (!isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)) + ' ' + u[i];
};
const fmtInt = (n: number): string => {
  if (!isFinite(n) || n <= 0) return '0';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};
const fmtPct = (n: number): string => (isFinite(n) ? n.toFixed(1) + '%' : '0%');
const fmtNum = (n: number): string => (isFinite(n) ? n.toFixed(2) : '0');
const fmt = (val: number, format: StatFormat): string => {
  if (format === 'bytes') return fmtBytes(val);
  if (format === 'int') return fmtInt(val);
  if (format === 'pct') return fmtPct(val);
  return fmtNum(val);
};

function applyFilters(): CubeStat[] {
  let list = allStats.slice();
  if (filterText) {
    const q = filterText.toLowerCase();
    list = list.filter((s) => s.name.toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    if (sortKey === 'name') {
      return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    }
    const va = a.values[sortKey] ?? 0;
    const vb = b.values[sortKey] ?? 0;
    return sortDir === 'asc' ? va - vb : vb - va;
  });
  return list;
}

function renderHeader(): void {
  const thRow = byId('th-row');
  let html = '<th data-sort="name">' + esc(L.cube) + '</th>';
  for (const m of MEASURES) {
    html += '<th class="num" data-sort="' + esc(m.key) + '">' + esc(m.label) + '</th>';
  }
  thRow.innerHTML = html;
  thRow.querySelectorAll<HTMLElement>('th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = key === 'name' ? 'asc' : 'desc';
      }
      rerender();
    });
  });
}

function tile(label: string, value: string): string {
  return '<div class="tile"><div class="label">' + esc(label) + '</div>'
    + '<div class="value">' + esc(value) + '</div></div>';
}

function renderTiles(list: CubeStat[]): void {
  const totals = list.reduce((s, x) => s + (x.values.totalMemoryBytes ?? 0), 0);
  byId('tiles').innerHTML = tile(L.totalRam, fmtBytes(totals)) + tile(L.cubeCount, String(list.length));
}

function renderTable(list: CubeStat[]): void {
  byId('stats-body').innerHTML = list.map((s) => {
    let row = '<tr class="' + (s.isSystem ? 'sys' : '') + '"><td>' + esc(s.name) + '</td>';
    for (const m of MEASURES) {
      row += '<td class="num">' + fmt(s.values[m.key] ?? 0, m.format) + '</td>';
    }
    return row + '</tr>';
  }).join('');
  byId('row-count').textContent = list.length + ' / ' + allStats.length + ' ' + L.cubes;
  byId('empty-msg').style.display = list.length === 0 ? 'block' : 'none';
  document.querySelectorAll<HTMLElement>('th').forEach((th) => {
    const wasSorted = th.dataset.sort === sortKey;
    th.classList.toggle('sorted', wasSorted);
    th.textContent = (th.textContent ?? '').replace(/[ ↑↓]+$/, '') + (wasSorted ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  });
}

function rerender(): void {
  const list = applyFilters();
  renderTiles(list);
  renderTable(list);
}

byId<HTMLInputElement>('filter').addEventListener('input', (e) => {
  filterText = (e.target as HTMLInputElement).value;
  rerender();
});
byId('btn-refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'refresh' });
});
byId('btn-csv').addEventListener('click', () => {
  vscode.postMessage({ type: 'exportCsv', stats: applyFilters() });
});

window.addEventListener('message', (ev: MessageEvent<CubeStatsToWebview>) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'loading') {
    byId('loading').style.display = msg.value ? 'block' : 'none';
    byId('error-box').innerHTML = '';
  }
  if (msg.type === 'error') {
    byId('error-box').innerHTML = '<div class="error">' + esc(msg.message) + '</div>';
  }
  if (msg.type === 'data') {
    allStats = Array.isArray(msg.stats) ? msg.stats : [];
    rerender();
  }
});

renderHeader();
vscode.postMessage({ type: 'ready' });

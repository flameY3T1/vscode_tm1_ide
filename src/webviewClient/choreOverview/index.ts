// src/webviewClient/choreOverview/index.ts
// Bundle of the Chore Overview window (table + calendar). Until 2026-10 this was
// an inline script in the host's template literal, with the sort and calendar
// helpers injected via toString() — invisible to tsc and eslint.
import type { ChoreOverviewBootstrap, ChoreOverviewState, HostToWebview, WebviewToHost } from './protocol';
import { compareChoreRows, overlappingIntervals, plannedStarts, type ChoreOverviewRow } from '../../chore/choreTablePure';
import { escapeHtml as esc } from '../htmlUtils';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost, ChoreOverviewState>;
const vscode = getVsCodeApi<WebviewToHost, ChoreOverviewState>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const { texts: L } = (window as unknown as { __choreOverview: ChoreOverviewBootstrap }).__choreOverview;

const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

const COLS: { key: string; label: string; tip?: string }[] = [
  { key: 'name', label: L.name },
  { key: 'active', label: L.status },
  { key: 'startTime', label: L.start, tip: L.tipSchedule },
  { key: 'frequency', label: L.frequency, tip: L.tipSchedule },
  { key: 'nextRun', label: L.nextRun, tip: L.tipNextRun },
  { key: 'executionMode', label: L.mode, tip: L.tipSchedule },
  { key: 'lastRun', label: L.lastRun, tip: L.tipLog },
  { key: 'duration', label: L.duration, tip: L.tipLog },
  { key: 'lastState', label: L.lastState, tip: L.tipState },
];
// Appended to the message-log tooltips once the host reports how far back it read.
let logReach = '';
let allRows: ChoreOverviewRow[] = [];
let sortKey = 'name';
let sortDir: 'asc' | 'desc' = 'asc';
let filterText = '';

// ---- Calendar ----------------------------------------------------------
type Bar = { name: string; s: number; e: number; kind: 'run' | 'open' | 'plan' | 'band'; every?: string; overlap?: boolean };

let view: 'table' | 'cal' = 'table';
let span: 'day' | 'week' = 'day';
let runsByChore: Record<string, Array<[number, number | null]>> = {};
let nowMs = Date.now();
let calStart = startOfDay(Date.now());
const DAY = 86400000;
const PLAN_CAP = 300;

function startOfDay(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek(ms: number): number { const d = new Date(startOfDay(ms)); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return d.getTime(); }
function spanEnd(start: number): number { const d = new Date(start); d.setDate(d.getDate() + (span === 'week' ? 7 : 1)); return d.getTime(); }
const p2 = (n: number): string => String(n).padStart(2, '0');
function fmtTime(ms: number): string { const d = new Date(ms); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function fmtDate(ms: number): string { const d = new Date(ms); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); }
function fmtDur(ms: number): string { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + p2(s % 60) + 's'; }

function renderCalendar(): void {
  const from = calStart, to = spanEnd(calStart), width = to - from;
  byId('cal-range').textContent = span === 'week'
    ? fmtDate(from) + ' – ' + fmtDate(to - 1)
    : fmtDate(from);
  const onlyActive = byId<HTMLInputElement>('cal-active').checked;
  const q = filterText.toLowerCase();
  const rows = allRows
    .filter((r) => (!onlyActive || r.active) && (!q || r.name.toLowerCase().includes(q)))
    .slice().sort((a, b) => a.name.localeCompare(b.name));

  // Collect every bar first, so overlaps can be found across chores.
  const bars: Bar[] = [];
  for (const r of rows) {
    for (const [s0, e0] of (runsByChore[r.name] || [])) {
      const e = e0 === null ? Math.max(nowMs, s0 + 1000) : e0;
      if (e < from || s0 >= to) continue;
      bars.push({ name: r.name, s: s0, e: e, kind: e0 === null ? 'open' : 'run' });
    }
    if (r.active && r.anchorMs !== null) {
      const dur = Math.max((r.durationSec || 0) * 1000, 1000);
      // Only the future is a plan; the past is what the log says happened.
      const planFrom = Math.max(from, nowMs);
      const starts = plannedStarts(r.anchorMs, r.frequencyMs || 0, planFrom, to, PLAN_CAP);
      if (starts.length >= PLAN_CAP) {
        bars.push({ name: r.name, s: planFrom, e: to, kind: 'band', every: r.frequency });
      } else {
        for (const t of starts) bars.push({ name: r.name, s: t, e: t + dur, kind: 'plan' });
      }
    }
  }
  const hit = overlappingIntervals(bars.filter((b) => b.kind !== 'band'));
  let k = 0;
  for (const b of bars) { if (b.kind !== 'band') { b.overlap = hit.has(k); k++; } }

  const pos = (ms: number): number => ((Math.max(from, Math.min(to, ms)) - from) / width * 100);
  const ticks: string[] = [];
  const gridLines: string[] = [];
  const step = span === 'week' ? DAY : 3600000;
  const labelEvery = span === 'week' ? 1 : 2;
  let n = 0;
  for (let t = from; t < to; t += step, n++) {
    const label = span === 'week' ? new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' }) : fmtTime(t);
    ticks.push('<div class="tick" style="left:' + pos(t) + '%">' + (n % labelEvery === 0 ? '<span>' + esc(label) + '</span>' : '') + '</div>');
    gridLines.push('<div class="tick" style="left:' + pos(t) + '%"></div>');
  }
  const grid = gridLines.join('');
  const nowLine = nowMs >= from && nowMs < to ? '<div class="now" style="left:' + pos(nowMs) + '%"></div>' : '';

  let html = '<div class="cal-row head"><div></div><div class="track">' + ticks.join('') + nowLine + '</div></div>';
  const byName: Record<string, Bar[]> = {};
  for (const b of bars) (byName[b.name] = byName[b.name] || []).push(b);
  for (const r of rows) {
    const own = byName[r.name] || [];
    const barHtml = own.map((b) => {
      const left = pos(b.s), w = Math.max(pos(b.e) - left, 0);
      const what = b.kind === 'band' ? L.every.replace('{0}', b.every ?? '')
        : (b.kind === 'plan' ? L.scheduled : L.ran) + ' ' + fmtDate(b.s) + ' ' + fmtTime(b.s)
          + (b.kind === 'open' ? ' – ' + L.noEnd : ' – ' + fmtTime(b.e) + ' (' + fmtDur(b.e - b.s) + ')');
      return '<div class="bar ' + b.kind + (b.overlap ? ' overlap' : '') + '" style="left:' + left + '%;width:' + w + '%" title="' + esc(r.name + ': ' + what) + '"></div>';
    }).join('');
    html += '<div class="cal-row' + (r.active ? '' : ' inactive') + '"><div class="cal-name" data-name="' + esc(r.name) + '" title="' + esc(r.name) + '">' + esc(r.name) + '</div>'
      + '<div class="track">' + grid + nowLine + barHtml + '</div></div>';
  }
  if (!rows.length) html += '<div class="empty">' + esc(L.noChoresInView) + '</div>';
  const cal = byId('cal');
  cal.innerHTML = html;
  cal.querySelectorAll<HTMLElement>('.cal-name').forEach((el) => el.addEventListener('click', () => {
    vscode.postMessage({ type: 'openChore', name: el.dataset.name ?? '' });
  }));
}

function saveState(patch: ChoreOverviewState): void {
  vscode.setState({ ...(vscode.getState() || {}), ...patch });
}

function setView(v: 'table' | 'cal'): void {
  view = v;
  byId('view-table').classList.toggle('on', v === 'table');
  byId('view-cal').classList.toggle('on', v === 'cal');
  byId('table-view').hidden = v !== 'table';
  byId('cal-view').hidden = v !== 'cal';
  byId('cal-controls').hidden = v !== 'cal';
  saveState({ view: v, span });
  if (v === 'cal') renderCalendar();
}
function setSpan(sp: 'day' | 'week'): void {
  // Week to day: land on today when today lies in the shown week, else on its first day.
  const showsNow = calStart <= Date.now() && Date.now() < spanEnd(calStart);
  span = sp;
  calStart = sp === 'week' ? startOfWeek(calStart) : startOfDay(showsNow ? Date.now() : calStart);
  byId('span-day').classList.toggle('on', sp === 'day');
  byId('span-week').classList.toggle('on', sp === 'week');
  saveState({ span: sp });
  renderCalendar();
}
function shift(dir: number): void { const d = new Date(calStart); d.setDate(d.getDate() + dir * (span === 'week' ? 7 : 1)); calStart = d.getTime(); renderCalendar(); }
byId('view-table').addEventListener('click', () => setView('table'));
byId('view-cal').addEventListener('click', () => setView('cal'));
byId('span-day').addEventListener('click', () => setSpan('day'));
byId('span-week').addEventListener('click', () => setSpan('week'));
byId('cal-prev').addEventListener('click', () => shift(-1));
byId('cal-next').addEventListener('click', () => shift(1));
byId('cal-today').addEventListener('click', () => { calStart = span === 'week' ? startOfWeek(Date.now()) : startOfDay(Date.now()); renderCalendar(); });
byId('cal-active').addEventListener('change', () => renderCalendar());

function applyFilters(): ChoreOverviewRow[] {
  let list = allRows.slice();
  if (filterText) {
    const q = filterText.toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(q));
  }
  list.sort((a, b) => compareChoreRows(a, b, sortKey, sortDir));
  return list;
}

function renderHeader(): void {
  const thRow = byId('th-row');
  thRow.innerHTML = COLS.map((c) => {
    const tip = c.tip ? (c.tip === L.tipLog && logReach ? c.tip + ' ' + logReach : c.tip) : '';
    return '<th data-sort="' + c.key + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + esc(c.label) + '</th>';
  }).join('');
  thRow.querySelectorAll<HTMLElement>('th').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (!key) return;
      if (sortKey === key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; } else { sortKey = key; sortDir = 'asc'; }
      rerender();
    });
  });
}

function renderTable(list: ChoreOverviewRow[]): void {
  const body = byId('chore-body');
  body.innerHTML = list.map((r) => {
    const cls = r.active ? '' : ' class="inactive"';
    const badge = '<span class="badge ' + (r.active ? 'on' : 'off') + '"></span>' + esc(r.active ? L.active : L.inactive);
    return '<tr' + cls + ' data-name="' + esc(r.name) + '">'
      + '<td>' + esc(r.name) + '</td>'
      + '<td>' + badge + '</td>'
      + '<td class="mono">' + esc(r.startTime) + '</td>'
      + '<td class="mono">' + esc(r.frequency) + '</td>'
      + '<td class="mono">' + esc(r.nextRun) + '</td>'
      + '<td>' + esc(r.executionMode) + '</td>'
      + '<td class="mono">' + esc(r.lastRun) + '</td>'
      + '<td class="mono num">' + esc(r.duration) + '</td>'
      + '<td>' + esc(r.lastState) + '</td>'
      + '</tr>';
  }).join('');
  byId('row-count').textContent = list.length + ' / ' + allRows.length + ' ' + L.chores;
  byId('empty-msg').style.display = (allRows.length === 0) ? 'block' : 'none';
  body.querySelectorAll<HTMLElement>('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      const name = tr.dataset.name;
      if (name) vscode.postMessage({ type: 'openChore', name });
    });
  });
  document.querySelectorAll<HTMLElement>('th').forEach((th) => {
    const wasSorted = th.dataset.sort === sortKey;
    th.classList.toggle('sorted', wasSorted);
    th.textContent = (th.textContent ?? '').replace(/[ ↑↓]+$/, '') + (wasSorted ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');
  });
}

function rerender(): void { renderTable(applyFilters()); if (view === 'cal') renderCalendar(); }

byId<HTMLInputElement>('filter').addEventListener('input', (e) => { filterText = (e.target as HTMLInputElement).value; rerender(); });
byId('btn-refresh').addEventListener('click', () => { vscode.postMessage({ type: 'refresh' }); });

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => {
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
    allRows = Array.isArray(msg.rows) ? msg.rows : [];
    runsByChore = msg.runs && typeof msg.runs === 'object' ? msg.runs : {};
    if (typeof msg.now === 'number') nowMs = msg.now;
    logReach = typeof msg.logReach === 'string' ? msg.logReach : '';
    // The reach sentence arrives with the rows, after the first renderHeader().
    renderHeader();
    rerender();
  }
});

renderHeader();
{
  const st = vscode.getState() || {};
  if (st.span === 'week') { span = 'week'; calStart = startOfWeek(Date.now()); byId('span-day').classList.remove('on'); byId('span-week').classList.add('on'); }
  if (st.view === 'cal') setView('cal');
}
vscode.postMessage({ type: 'ready' });

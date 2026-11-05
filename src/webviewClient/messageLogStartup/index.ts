// src/webviewClient/messageLogStartup/index.ts
// Bundle of the Server Startup Analysis window. Until 2026-10 this was an
// inline script in the host's template literal, with fmtSec injected via
// toString() — invisible to tsc and eslint (review finding D3).
import { fmtSec as fmt } from '../../utils/fmtSec';
import type { HostToWebview, MlsBootstrap, StartupAnalysisView, StartupRefView, WebviewToHost } from './protocol';
import { escapeHtml } from '../htmlUtils';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const { texts: T } = (window as unknown as { __mls: MlsBootstrap }).__mls;

const esc = (s: unknown): string => escapeHtml(s ?? '');

const byId = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

let startups: StartupRefView[] = [];
let coverageFrom: string | null = null;
let selected: string | null = null;

const p2 = (n: number) => String(n).padStart(2, '0');
function fmtWhen(ts: string): string {
  const d = new Date(ts);
  return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

function endLabel(s: StartupRefView): string {
  return s.prevEnd === 'clean' ? T.endClean : s.prevEnd === 'unlogged' ? T.endUnlogged : T.endUnknown;
}

/** One bar per startup, oldest left; the list below stays newest first. */
function renderTrend(): string {
  const chrono = [...startups].reverse();
  const max = Math.max(1, ...chrono.map(s => s.elapsedSec));
  const bars = chrono.map(s => '<div class="bar' + (s.readyTs === selected ? ' sel' : '') + '" data-ts="' + esc(s.readyTs)
    + '" style="height:' + Math.max(4, s.elapsedSec / max * 100).toFixed(1) + '%" title="'
    + esc(fmtWhen(s.readyTs) + ' — ' + fmt(s.elapsedSec) + '\n' + endLabel(s)) + '"></div>').join('');
  const cov = coverageFrom ? '<div class="cov">' + esc(T.coverage.replace('{0}', fmtWhen(coverageFrom))) + '</div>' : '';
  return '<div class="trend"><div class="k">' + esc(T.trend) + '</div><div class="bars">' + bars + '</div>' + cov + '</div>';
}

function renderList(): void {
  const el = byId('list');
  if (!startups.length) { el.innerHTML = '<div class="empty" style="padding:12px">' + esc(T.noStartups) + '</div>'; return; }
  const anyUnlogged = startups.some(s => s.prevEnd === 'unlogged');
  el.innerHTML = renderTrend() + startups.map((s) => {
    const extra = [s.downSec != null ? (s.prevEnd === 'clean' ? T.down : T.downMax).replace('{0}', fmt(s.downSec)) : '',
      s.abortedBefore > 0 ? T.aborted.replace('{0}', String(s.abortedBefore)) : ''].filter(Boolean).join(' · ');
    return '<div class="row' + (s.readyTs === selected ? ' sel' : '') + '" data-ts="' + esc(s.readyTs) + '">'
      + '<div class="when">' + esc(fmtWhen(s.readyTs)) + '</div>'
      + '<div class="tot">' + esc(fmt(s.elapsedSec)) + '</div>'
      + '<div class="end ' + s.prevEnd + '">' + (s.prevEnd === 'unlogged' ? '⚠ ' : '') + esc(endLabel(s)) + '</div>'
      + (extra ? '<div class="end">' + esc(extra) + '</div>' : '') + '</div>';
  }).join('')
    + (anyUnlogged ? '<p class="note" style="padding:0 12px 12px">' + esc(T.unloggedNote) + '</p>' : '');
}

function kpi(k: string, v: string, s?: string): string {
  return '<div class="kpi"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>'
    + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>';
}

function row(label: string, sec: number | null, total: number): string {
  if (sec == null) { return ''; }
  return '<tr><td>' + esc(label) + '</td><td class="n">' + esc(fmt(sec)) + '</td><td class="n">'
    + (total ? (sec / total * 100).toFixed(1) + '%' : '—') + '</td></tr>';
}

function renderDetail(a: StartupAnalysisView | null): void {
  const el = byId('detail');
  if (!a) { el.innerHTML = '<div class="empty">' + esc(T.pick) + '</div>'; return; }
  const total = a.wallSec ?? a.reportedSec ?? 0;
  const rest = total ? Math.max(0, total - (a.preludeSec ?? 0) - a.coveredSec - (a.tailSec ?? 0)) : 0;

  let h = '<div class="kpis">'
    + kpi(T.reported, fmt(a.reportedSec), a.loadTimeSec != null ? T.loadTime + ' ' + fmt(a.loadTimeSec) : '')
    + kpi(T.wall, fmt(a.wallSec))
    + kpi(T.floor, fmt(a.criticalLaneSec), T.floorSub + (a.criticalThread != null ? ' #' + a.criticalThread : ''))
    + kpi(T.workers, String(a.lanes.length), T.parallel + ' ' + a.maxParallel)
    + kpi(T.mtq, a.mtqThreads != null ? String(a.mtqThreads) : '—',
          a.cubeLoadThreads != null ? T.workers + ' ' + a.cubeLoadThreads : '')
    + kpi(T.feeders, a.feeders.length + ' ' + T.computed, a.feedersFromFile + ' ' + T.fromFile)
    + '</div>';
  h += '<p class="note">' + esc(T.floorNote) + '</p>';

  h += '<h2>' + esc(T.budget) + '</h2><table><tbody>'
    + row(T.prelude, a.preludeSec, total)
    + row(T.bodies, a.coveredSec, total)
    + row(T.tail, a.tailSec, total)
    + row(T.rest, rest, total)
    + '</tbody></table>'
    + '<p class="note">' + esc(T.work) + ': ' + esc(fmt(a.busySec)) + ' — ' + esc(T.sumNote) + '</p>';
  if (a.unpairedStarts + a.unpairedEnds > 0) {
    h += '<p class="note warn">' + esc(T.clipped.replace('{0}', String(a.unpairedStarts + a.unpairedEnds))) + '</p>';
  }

  if (a.lanes.length) {
    const t0 = Math.min(...a.cubes.map(c => Date.parse(c.startTs)));
    const t1 = Math.max(...a.cubes.map(c => Date.parse(c.endTs)));
    const width = Math.max(1, t1 - t0);
    const hot = a.cubes.length ? a.cubes[0].sec : 0;
    h += '<h2>' + esc(T.lanes) + '</h2>';
    h += a.lanes.map(l => {
      const segs = l.cubes.map(c => {
        const from = (Date.parse(c.startTs) - t0) / width * 100;
        const w = Math.max(0.15, (Date.parse(c.endTs) - Date.parse(c.startTs)) / width * 100);
        return '<div class="seg' + (c.sec >= hot * 0.5 ? ' hot' : '') + '" style="left:' + from.toFixed(3)
          + '%;width:' + w.toFixed(3) + '%" title="' + esc(c.name + ' — ' + fmt(c.sec)) + '"></div>';
      }).join('');
      const crit = l.spanSec === a.criticalLaneSec;
      return '<div class="lane' + (crit ? ' crit' : '') + '"><div class="lbl">'
        + esc((l.thread != null ? '#' + l.thread : '—') + '  ' + l.cubes.length + '×  ' + fmt(l.busySec))
        + '</div><div class="track">' + segs + '</div></div>';
    }).join('');
  }

  if (a.cubes.length) {
    h += '<h2>' + esc(T.cubesTbl) + ' (' + a.cubes.length + ')</h2><table data-resizable="cubes"><thead><tr><th>' + esc(T.cube)
      + '</th><th class="n">' + esc(T.dur) + '</th><th class="n">' + esc(T.share) + '</th><th class="n">' + esc(T.lane) + '</th></tr></thead><tbody>'
      + a.cubes.map(c => '<tr><td>' + esc(c.name) + '</td><td class="n">' + esc(fmt(c.sec))
        + '</td><td class="n">' + (total ? (c.sec / total * 100).toFixed(1) + '%' : '—')
        + '</td><td class="n">' + (c.thread != null ? c.thread : '—') + '</td></tr>').join('')
      + '</tbody></table>';
  }

  if (a.feeders.length) {
    h += '<h2>' + esc(T.feedersTbl) + '</h2><table data-resizable="feeders"><thead><tr><th>' + esc(T.cube) + '</th><th class="n">'
      + esc(T.dur) + '</th></tr></thead><tbody>'
      + a.feeders.map(f => '<tr><td>' + esc(f.name) + '</td><td class="n">' + esc(fmt(f.sec)) + '</td></tr>').join('')
      + '</tbody></table>';
  }

  h += '<h2>' + esc(T.counted) + '</h2><table><tbody>'
    + '<tr><td>' + esc(T.headers) + '</td><td class="n">' + a.headers + '</td></tr>'
    + '<tr><td>' + esc(T.dims) + '</td><td class="n">' + a.dimensions + '</td></tr>'
    + '<tr><td>' + esc(T.rules) + '</td><td class="n">' + a.rules + '</td></tr>'
    + '</tbody></table>';
  h += '<p class="note">' + a.lineCount + ' ' + esc(T.lines) + '</p>';
  el.innerHTML = h;
}

byId('list').addEventListener('click', (e) => {
  const rowEl = (e.target as HTMLElement).closest<HTMLElement>('.row, .bar');
  if (!rowEl) { return; }
  selected = rowEl.dataset.ts ?? null;
  renderList();
  byId('detail').innerHTML = '<div class="empty">' + esc('…') + '</div>';
  vscode.postMessage({ command: 'select', readyTs: selected ?? '' });
});
byId('reload').addEventListener('click', () => vscode.postMessage({ command: 'reload' }));

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => {
  const d = ev.data;
  const errEl = byId('error');
  // Own message, own branch — it carries neither a list nor an analysis.
  if (d.langHint !== undefined) {
    byId('langhint').textContent = d.langHint;
    return;
  }
  if (d.error) { errEl.textContent = d.error; return; }
  errEl.textContent = '';
  if (d.startups) { startups = d.startups; coverageFrom = d.coverageFrom ?? null; if (!selected && startups.length) { selected = startups[0].readyTs; } renderList(); }
  if (d.analysis !== undefined) { renderDetail(d.analysis); }
  if (d.status !== undefined) { byId('status').textContent = d.status; }
});

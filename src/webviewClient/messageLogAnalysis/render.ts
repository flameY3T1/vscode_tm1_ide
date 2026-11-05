// src/webviewClient/messageLogAnalysis/render.ts
//
// HTML builders of the Process Run Analysis window — no DOM access, so tests
// call them directly. Until 2026-10 this lived as an inline script in the
// host's template literal, invisible to tsc and eslint.
import type { CallNodeView, MlaTexts, ProcStatView } from './protocol';
import { escapeHtml } from '../htmlUtils';
import { fmt as fill } from '../_shared/l10n';

const esc = (s: unknown): string => escapeHtml(String(s ?? ''));

const fmt = (n: number | null | undefined): string => (n == null ? '' : n.toFixed(2) + 's');

/** ISO 2026-07-24T06:01:41.831Z -> 24.07. 06:01:41 (string reformat, no TZ shift). */
export function fmtTs(s: string | null | undefined): string {
  if (s == null) { return ''; }
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? (m[3] + '.' + m[2] + '. ' + m[4]) : String(s);
}

const GLYPH: Record<string, string> = { ok: '✔', error: '✖', running: '⏳', orphan: '⚠', group: '≡' };

function mark(cls: string, glyph: string, tip: string): string {
  return '<span class="mark ' + cls + '" title="' + esc(tip) + '">' + glyph + '</span>';
}

/**
 * An asynchronously started run that ran shorter than this AND reports no
 * runtime is noise: a rollback on a lock conflict. In the real log there
 * were 484 of them with a median of 0.01 s. Longer rollbacks have burned
 * work and are shown.
 */
const SHORT_SEC = 1;

function spanSec(n: CallNodeView): number | null {
  if (!n.startTs || !n.endTs) { return null; }
  const a = Date.parse(n.startTs), b = Date.parse(n.endTs);
  return (isNaN(a) || isNaN(b) || b < a) ? null : (b - a) / 1000;
}

function isNoise(n: CallNodeView): boolean {
  if (n.elapsedSec != null) { return false; }
  const sp = spanSec(n);
  return sp != null && sp < SHORT_SEC;
}

export function renderNode(n: CallNodeView, L: MlaTexts): string {
  const hasKids = n.children && n.children.length;
  // A chore is still not a process run, but TM1 DOES log its total
  // ("Chore \"x\" time = 0.11 seconds"), so show it when the analyzer got one —
  // the tooltip says what that number is. Without an end line in the window the
  // chore stays 'group' with a null elapsed and the cells stay empty as before.
  const isChore = n.kind === 'chore';
  const inclText = n.elapsedSec == null
    ? (n.status === 'running' ? esc(L.running) + '…' : '')
    : fmt(n.elapsedSec);
  // ONE clamped percentage feeds both the text and the bar — an unclamped text
  // next to a full bar ("50.00s (5000%)") hides that the numbers are impossible;
  // the analyzer flags that case as n.inconsistent instead.
  const pct = n.selfPct == null ? null : Math.max(0, Math.min(100, n.selfPct));
  const selfText = n.selfSec == null ? '' :
    (fmt(n.selfSec) + (pct == null ? '' : ' (' + Math.round(pct) + '%)'));
  const barPct = pct == null ? 0 : pct;
  let marks = '';
  if (n.ambiguous) { marks += mark('mk-amb', '≈', L.ambigTip); }
  if (n.truncated) { marks += mark('mk-trunc', '⋯', L.truncTip); }
  if (n.inconsistent) { marks += mark('mk-inc', '!', L.incTip); }
  let h = '<div class="node">';
  h += '<span class="nm-cell"><span class="tw">' + (hasKids ? '▼' : '&nbsp;') + '</span>';
  h += '<span class="nm">' + esc(n.name) + '</span>';
  h += '<span class="ts">' + esc(fmtTs(n.startTs)) + '</span>' + marks;
  if (n.errorFile) {
    // The first error line (v12) is the tooltip; v11 keeps the text only in the file.
    h += '<a class="errlog" href="#" data-file="' + esc(n.errorFile) + '" title="' + esc(n.errorText || n.errorFile) + '">'
      + esc(L.errorLog) + '</a>';
    if (n.errorText) { h += '<span class="errtext">' + esc(n.errorText) + '</span>'; }
  }
  h += '</span>';
  h += '<span class="st-badge st-' + esc(n.status) + '"' + (isChore ? ' title="' + esc(L.choreTip) + '"' : '') + '>' + (GLYPH[n.status] || '') + '</span>';
  h += '<span class="incl">' + inclText + '</span>';
  h += '<span class="bar-track"><span class="bar-fill" style="width:' + barPct + '%"></span></span>';
  h += '<span class="self">' + selfText + '</span>';
  if (hasKids) { h += '<div class="kids">' + renderKids(n.children, L) + '</div>'; }
  h += '</div>';
  return h;
}

/**
 * Bundle asynchronously attached children of the same name into ONE row.
 * Thousands of them quickly pile up under one caller (3580 in the real log),
 * and listed individually they drown the real children next to them.
 */
export function renderKids(kids: CallNodeView[], L: MlaTexts): string {
  type Item = { kind: 'node'; n: CallNodeView } | { kind: 'group'; name: string; runs: CallNodeView[] };
  const out: Item[] = [];
  const groups = new Map<string, Extract<Item, { kind: 'group' }>>();
  for (const k of kids) {
    if (!k.asyncAttached) { out.push({ kind: 'node', n: k }); continue; }
    let g = groups.get(k.name);
    if (!g) { g = { kind: 'group', name: k.name, runs: [] }; groups.set(k.name, g); out.push(g); }
    g.runs.push(k);
  }
  return out.map((x) => x.kind === 'node' ? renderNode(x.n, L) : renderGroup(x.name, x.runs, L)).join('');
}

function renderGroup(name: string, runs: CallNodeView[], L: MlaTexts): string {
  const times = runs.map((r) => r.elapsedSec).filter((v): v is number => v != null);
  const sum = times.reduce((a, b) => a + b, 0);
  const shown = runs.filter((r) => !isNoise(r));
  const hidden = runs.length - shown.length;
  let h = '<div class="node async-group">';
  h += '<span class="nm-cell"><span class="tw">▼</span>';
  h += '<span class="nm">' + esc(name) + '</span>';
  h += '<span class="ts">' + esc(fill(L, 'asyncRuns', runs.length)) + '</span>';
  h += mark('mk-async', '⇥', L.asyncTip) + '</span>';
  h += '<span class="st-badge st-group">' + GLYPH.group + '</span>';
  h += '<span class="incl">' + (times.length ? fmt(sum) : '') + '</span>';
  h += '<span class="bar-track"></span><span class="self"></span>';
  h += '<div class="kids">' + shown.map((r) => renderNode(r, L)).join('');
  if (hidden > 0) {
    h += '<div class="node short-hint"><span class="nm-cell">'
      + esc(fill(L, 'shortHidden', hidden, SHORT_SEC)) + '</span></div>';
  }
  h += '</div></div>';
  return h;
}

export type SortKey = keyof ProcStatView;

export function statsColumns(L: MlaTexts): { k: SortKey; label: string }[] {
  return [
    { k: 'name', label: L.proc }, { k: 'calls', label: L.calls },
    { k: 'totalSec', label: 'Σ s' }, { k: 'avgSec', label: 'Ø s' },
    { k: 'minSec', label: 'Min' }, { k: 'maxSec', label: 'Max' }, { k: 'failures', label: L.fail },
    { k: 'uncertain', label: L.uncertain },
  ];
}

export function renderStatsTable(
  stats: ProcStatView[], sortKey: SortKey, sortDir: 'asc' | 'desc', L: MlaTexts,
): string {
  const cols = statsColumns(L);
  const dir = sortDir === 'asc' ? 1 : -1;
  const rows = stats.slice().sort((a, b) =>
    sortKey === 'name'
      ? dir * String(a.name).localeCompare(String(b.name))
      : dir * ((Number(a[sortKey]) || 0) - (Number(b[sortKey]) || 0)));
  let h = '<table data-resizable><thead><tr>';
  for (const c of cols) {
    const arrow = c.k === sortKey ? '<span class="sort-arrow">' + (sortDir === 'asc' ? '▲' : '▼') + '</span>' : '';
    h += '<th data-k="' + c.k + '">' + esc(c.label) + arrow + '</th>';
  }
  h += '</tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td colspan="' + cols.length + '" class="empty-hint">–</td></tr>';
  } else {
    const maxTotal = Math.max(...rows.map((r) => r.totalSec || 0)) || 1;
    rows.forEach((s, i) => {
      const pct = Math.max(0, Math.min(100, (s.totalSec || 0) / maxTotal * 100));
      const totalStyle = 'background-image:linear-gradient(to right, var(--mla-accent-soft) ' + pct + '%, transparent ' + pct + '%)';
      const failCell = s.failures ? '<td class="stat-fail">' + s.failures + '</td>' : '<td></td>';
      // Runs whose runtime could not be attributed to a single instance. Their
      // seconds are kept OUT of the time columns (a guess must not read like a
      // measurement) — the tooltip says how much time that was (H4 / LOW-4).
      const uncTip = L.ambigTip + ' ' + L.uncExcluded + ' ' + (s.uncertainSec || 0).toFixed(2) + ' s';
      const uncCell = s.uncertain
        ? '<td class="stat-uncertain" title="' + esc(uncTip) + '">' + s.uncertain + '</td>'
        : '<td></td>';
      h += '<tr class="' + (i % 2 === 1 ? 'row-odd' : '') + '"><td>' + esc(s.name) + '</td><td>' + s.calls + '</td>' +
        '<td style="' + totalStyle + '">' + s.totalSec.toFixed(2) + '</td><td>' + s.avgSec.toFixed(2) + '</td>' +
        '<td>' + s.minSec.toFixed(2) + '</td><td>' + s.maxSec.toFixed(2) + '</td>' + failCell + uncCell + '</tr>';
    });
  }
  return h + '</tbody></table>';
}

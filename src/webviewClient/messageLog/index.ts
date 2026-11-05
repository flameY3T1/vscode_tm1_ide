// src/webviewClient/messageLog/index.ts
// Bundle of the Message Log window. Until 2026-10 this was an inline script in
// the host's template literal, with linkifyErrorLogFilenames and
// formatLogTimestamp injected via toString() — invisible to tsc and eslint.
import type { HostToWebview, Levels, LogEntryView, WebviewToHost } from './protocol';
import { linkifyErrorLogFilenames } from '../../messageLog/messageLogPure';
import { formatLogTimestamp } from '../../utils/logTimestamp';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

// Not htmlUtils#escapeHtml: that also turns ' into &#039;, and the error-log
// linkifier stops at '&' — a process name with an apostrophe would lose its link.
const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

let allEntries: LogEntryView[] = [];
let filterText = '';
const enabledLevels: Levels = { info: true, warn: true, error: true, debug: true };
// Sources (TM1 loggers) are sieved CLIENT-SIDE over the window already loaded,
// unlike the level toggles: the checkbox list is built from the rows on screen,
// so there is nothing to ask the server for that it has not already answered.
// Held as the DISABLED set, not the enabled one — a logger that first appears in
// a later poll is then on by default instead of silently filtered away.
const disabledLoggers = new Set<string>();
let loggerMenuKey = '';
// What was drawn last — so that a poll does not rebuild the whole table
// (finding C4). This used to hold the complete tbody string: at 10,000
// rows several MB, built, compared and usually also written on every poll,
// because on a live server new rows are practically always coming in. The
// short circuit therefore failed exactly when it got expensive.
//
// Now: the filter signature and the key of the topmost row. If only the data
// changes, the new rows are added at the TOP (the list is sorted by timestamp
// descending); if the filter changes, the table is rebuilt.
let lastFilterKey: string | null = null;
let lastFirstKey = '';
let lastCount = 0;

function levelOf(e: LogEntryView): keyof Levels {
  const u = (e.Level ?? '').toUpperCase();
  if (u === 'ERROR' || u === 'FATAL') { return 'error'; }
  if (u === 'WARN' || u === 'WARNING') { return 'warn'; }
  if (u === 'DEBUG') { return 'debug'; }
  return 'info';
}

document.querySelectorAll<HTMLElement>('button.lvl').forEach((btn) => {
  btn.addEventListener('click', () => {
    const lvl = btn.dataset.lvl as keyof Levels;
    enabledLevels[lvl] = !enabledLevels[lvl];
    btn.classList.toggle('toggled', enabledLevels[lvl]);
    // Sieve what is already on screen so the click feels immediate, AND ask
    // for a fresh window: the depth setting counts rows the SERVER matched, so
    // switching to "errors only" must re-fetch or it merely hides rows instead
    // of reaching further back.
    renderTable();
    vscode.postMessage({ command: 'setLevels', levels: enabledLevels });
  });
});

function loggerOf(e: LogEntryView): string { return e.Logger || '—'; }
function loggerNames(): string[] {
  return [...new Set(allEntries.map(loggerOf))].sort();
}
function updateLoggerCount(names: string[]): void {
  const on = names.filter((n) => !disabledLoggers.has(n)).length;
  byId('loggerCount').textContent = on === names.length ? '' : ' (' + on + '/' + names.length + ')';
}
function updateLoggerMenu(): void {
  const names = loggerNames();
  const key = names.join('|');
  // Rebuild only when the SET of sources changed — a rebuild on every click
  // would tear the checkbox out from under the pointer while the menu is open.
  if (key !== loggerMenuKey) {
    loggerMenuKey = key;
    byId('loggerMenu').innerHTML = names.map((n) =>
      '<label><input type="checkbox" data-logger="' + esc(n) + '"'
      + (disabledLoggers.has(n) ? '' : ' checked') + '>' + esc(n) + '</label>').join('');
  }
  updateLoggerCount(names);
}

byId('loggerMenu').addEventListener('change', (e) => {
  const cb = e.target as HTMLInputElement | null;
  const logger = cb?.dataset?.logger;
  if (!cb || !logger) { return; }
  if (cb.checked) { disabledLoggers.delete(logger); } else { disabledLoggers.add(logger); }
  updateLoggerCount(loggerNames());
  renderTable();
});

byId('topSel').addEventListener('change', (e) => {
  vscode.postMessage({ command: 'setTop', top: Number((e.target as HTMLSelectElement).value) });
});
// Debounced: each render rebuilds up to 10,000 rows as one HTML string.
let filterTimer: ReturnType<typeof setTimeout> | undefined;
byId('filterInput').addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value.toLowerCase();
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { filterText = value; renderTable(); }, 150);
});
byId('analyzeBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'openAnalysis' });
});
byId('startupBtn').addEventListener('click', () => {
  vscode.postMessage({ command: 'openStartup' });
});

byId('tbody').addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLElement>('.errlink');
  if (link && link.dataset.file) {
    vscode.postMessage({ command: 'openErrorLog', file: link.dataset.file });
  }
});

// NO title attribute any more: it carried the message a second time and
// thereby doubled the whole string. The cell holds the full text anyway
// (white-space nowrap, the content scrolls horizontally).
function rowHtml(e: LogEntryView): string {
  const cls = esc(e.LevelClass ?? 'l-info');
  const ts = esc(formatLogTimestamp(e.TimeStamp ?? e.Timestamp ?? ''));
  const lvl = esc(e.Level ?? '');
  const msgHtml = linkifyErrorLogFilenames(esc(e.Message ?? e.Text ?? JSON.stringify(e)));
  const lg = esc(loggerOf(e));
  const thr = e.ThreadID == null ? '' : esc(e.ThreadID);
  return `<tr><td class="ts">${ts}</td><td class="${cls}">${lvl}</td><td class="lg">${lg}</td><td class="thr">${thr}</td><td>${msgHtml}</td></tr>`;
}

// Key of ONE row. The timestamp alone is not enough: TM1 writes several
// rows within the same millisecond.
const keyOf = (e: LogEntryView): string => `${e.TimeStamp ?? e.Timestamp ?? ''}|${e.ThreadID ?? ''}|${e.Message ?? e.Text ?? ''}`;

function renderTable(): void {
  const tbody = byId('tbody');
  const filtered = allEntries.filter((e) => {
    if (!enabledLevels[levelOf(e)]) { return false; }
    if (disabledLoggers.has(loggerOf(e))) { return false; }
    if (!filterText) { return true; }
    return (e.Message || e.Text || '').toLowerCase().includes(filterText);
  });
  const filterKey = JSON.stringify([filterText, enabledLevels, [...disabledLoggers].sort()]);

  byId('status').textContent = `${filtered.length}/${allEntries.length}`;

  if (filtered.length === 0) {
    if (lastCount !== 0) { tbody.innerHTML = ''; }
    lastFilterKey = filterKey; lastFirstKey = ''; lastCount = 0;
    return;
  }

  // Only APPEND if the filter is the same AND the previously topmost row is
  // still there. Both must hold: otherwise a filter change would push rows
  // in front of a table that shows something else.
  if (filterKey === lastFilterKey && lastCount > 0) {
    let neu = -1;
    for (let i = 0; i < filtered.length && i <= 2000; i++) {
      if (keyOf(filtered[i]) === lastFirstKey) { neu = i; break; }
    }
    // The same topmost row does NOT mean "nothing to do": a change of the
    // log depth (100 -> 1000) delivers the same first row plus 900 older
    // ones. Only if the count matches as well is the table up to date.
    if (neu === 0 && filtered.length === lastCount) { return; }
    if (neu > 0 && filtered.length - neu === lastCount) {
      tbody.insertAdjacentHTML('afterbegin', filtered.slice(0, neu).map(rowHtml).join(''));
      lastFirstKey = keyOf(filtered[0]);
      lastCount = filtered.length;
      return;
    }
  }

  tbody.innerHTML = filtered.map(rowHtml).join('');
  lastFilterKey = filterKey;
  lastFirstKey = keyOf(filtered[0]);
  lastCount = filtered.length;
}

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  const { entries, error, ts } = e.data;
  const dot = byId('dot');
  const statusEl = byId('status');
  const errorEl = byId('error');
  if (error) {
    dot.className = 'dot err';
    errorEl.textContent = error;
    statusEl.textContent = new Date(ts).toLocaleTimeString();
    return;
  }
  dot.className = 'dot';
  errorEl.textContent = '';
  allEntries = entries ?? [];
  updateLoggerMenu();
  renderTable();
  statusEl.textContent = `${statusEl.textContent} · ${new Date(ts).toLocaleTimeString()}`;
});

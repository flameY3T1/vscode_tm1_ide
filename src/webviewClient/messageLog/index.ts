// src/webviewClient/messageLog/index.ts
// Bundle of the Message Log window. Until 2026-10 this was an inline script in
// the host's template literal, with linkifyErrorLogFilenames and
// formatLogTimestamp injected via toString() — invisible to tsc and eslint.
import type { HostToWebview, Levels, LogEntryView, WebviewToHost } from './protocol';
import { linkifyErrorLogFilenames } from '../../messageLog/messageLogPure';
import { csvLine } from '../../consolidationCompare/comparePure';
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
// Sources (TM1 loggers) are sieved here AND on the server, like the level
// toggles: the host turns the disabled set into a filter, so the depth setting
// counts rows of the wanted sources and reaches back to a source the newest rows
// do not hold. The sieve here stays for the immediate feel and for the host's
// unfiltered fallback. On v12 the host skips the run-log files instead.
// Held as the DISABLED set, not the enabled one — a logger that first appears in
// a later poll is then on by default instead of silently filtered away.
const disabledLoggers = new Set<string>();
let loggerMenuKey = '';
// Every source seen so far with the timestamp of its newest row: from the rows
// on screen, and from the host's search over the whole log (started by the first
// opening of the menu). The menu lists THESE, not the rows on screen — with the
// server filtering, an unticked source leaves the rows, and its checkbox would
// go with it.
const knownLoggers = new Map<string, string>();
let loggerWalk: '' | 'running' | 'done' | 'capped' | 'failed' = '';
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

// The text of a row. A v12 line names its process in a field of its own, and
// its end line ("Process execution finished normally.") not at all — put the
// name in front where the text lacks it, as v11 writes it into every message.
function messageOf(e: LogEntryView): string {
  const msg = e.Message ?? e.Text ?? '';
  return e.Name && !msg.includes(e.Name) ? `${e.Name}: ${msg}` : msg;
}

const threadOf = (e: LogEntryView): number | string => e.ThreadID ?? e.RunThread ?? '';

// The wire name; TM1 writes one line with an EMPTY logger, shown as a dash.
function loggerOf(e: LogEntryView): string { return e.Logger ?? ''; }
const loggerLabel = (name: string): string => name || '—';
function loggerNames(): string[] {
  return [...knownLoggers.keys()].sort();
}
function updateLoggerCount(names: string[]): void {
  const on = names.filter((n) => !disabledLoggers.has(n)).length;
  byId('loggerCount').textContent = on === names.length ? '' : ' (' + on + '/' + names.length + ')';
}
function updateLoggerMenu(): void {
  const menu = byId('loggerMenu');
  const names = loggerNames();
  const key = names.join('|');
  // Rebuild only when the SET of sources changed — a rebuild on every click
  // would tear the checkbox out from under the pointer while the menu is open.
  if (key !== loggerMenuKey) {
    loggerMenuKey = key;
    menu.innerHTML = names.map((n) =>
      '<label><input type="checkbox" data-logger="' + esc(n) + '"'
      + (disabledLoggers.has(n) ? '' : ' checked') + '>' + esc(loggerLabel(n)) + '<span class="last"></span></label>').join('');
  }
  // Mark the sources the loaded window does not hold, with their newest row, so
  // an empty table after ticking one is no surprise. An unticked source is
  // absent because it is filtered, which needs no hint.
  const loaded = new Set(allEntries.map(loggerOf));
  menu.querySelectorAll<HTMLElement>('label').forEach((label) => {
    const name = label.querySelector('input')?.dataset.logger ?? '';
    // Raw as the fallback: the line with the empty logger carries
    // 0000-00-00T00:00Z, which the formatter answers with nothing.
    const raw = knownLoggers.get(name) ?? '';
    const last = formatLogTimestamp(raw) || raw;
    const absent = !loaded.has(name) && !disabledLoggers.has(name);
    label.classList.toggle('absent', absent);
    label.title = absent ? (menu.dataset.absent ?? '').replace('{0}', last) : '';
    (label.querySelector('.last') as HTMLElement).textContent = absent ? last : '';
  });
  updateLoggerCount(names);
}
function updateLoggerNote(error?: string): void {
  const note = byId('loggerNote');
  note.textContent = loggerWalk === 'running' ? note.dataset.searching ?? ''
    : loggerWalk === 'capped' ? note.dataset.capped ?? ''
    : loggerWalk === 'failed' ? error ?? '' : '';
}
function loggersChanged(): void {
  updateLoggerMenu();
  renderTable();
  vscode.postMessage({ command: 'setLoggers', excluded: [...disabledLoggers] });
}

byId('loggerMenu').addEventListener('change', (e) => {
  const cb = e.target as HTMLInputElement | null;
  const logger = cb?.dataset?.logger;
  if (!cb || logger === undefined) { return; }
  if (cb.checked) { disabledLoggers.delete(logger); } else { disabledLoggers.add(logger); }
  loggersChanged();
});
function setAllLoggers(on: boolean): void {
  disabledLoggers.clear();
  if (!on) { for (const n of knownLoggers.keys()) { disabledLoggers.add(n); } }
  byId('loggerMenu').querySelectorAll<HTMLInputElement>('input').forEach((cb) => { cb.checked = on; });
  loggersChanged();
}
byId('loggerAll').addEventListener('click', () => setAllLoggers(true));
byId('loggerNone').addEventListener('click', () => setAllLoggers(false));
// The first opening starts the search over the whole log; a failed one retries.
byId('loggerDd').addEventListener('toggle', () => {
  if (!byId<HTMLDetailsElement>('loggerDd').open || (loggerWalk !== '' && loggerWalk !== 'failed')) { return; }
  loggerWalk = 'running';
  updateLoggerNote();
  vscode.postMessage({ command: 'loadLoggers' });
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
// Exports what the table shows: the loaded rows after all three filters.
byId('exportBtn').addEventListener('click', () => {
  const lines = [csvLine(['TimeStamp', 'Level', 'Logger', 'ThreadID', 'Message'])];
  for (const e of visibleEntries()) {
    // Local time as in the table, not the wire's UTC string.
    const ts = e.TimeStamp ?? e.Timestamp ?? '';
    lines.push(csvLine([formatLogTimestamp(ts) || ts, e.Level ?? '', loggerOf(e), threadOf(e), messageOf(e)]));
  }
  vscode.postMessage({ command: 'exportCsv', csv: lines.join('\r\n') });
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
  const msgHtml = linkifyErrorLogFilenames(esc(e.Message == null && e.Text == null ? JSON.stringify(e) : messageOf(e)));
  const lg = esc(loggerLabel(loggerOf(e)));
  const thr = esc(threadOf(e));
  return `<tr><td class="ts">${ts}</td><td class="${cls}">${lvl}</td><td class="lg">${lg}</td><td class="thr">${thr}</td><td>${msgHtml}</td></tr>`;
}

// Key of ONE row. The timestamp alone is not enough: TM1 writes several
// rows within the same millisecond.
const keyOf = (e: LogEntryView): string => `${e.TimeStamp ?? e.Timestamp ?? ''}|${threadOf(e)}|${e.Message ?? e.Text ?? ''}`;

function visibleEntries(): LogEntryView[] {
  return allEntries.filter((e) => {
    if (!enabledLevels[levelOf(e)]) { return false; }
    if (disabledLoggers.has(loggerOf(e))) { return false; }
    if (!filterText) { return true; }
    return messageOf(e).toLowerCase().includes(filterText);
  });
}

function renderTable(): void {
  const tbody = byId('tbody');
  const filtered = visibleEntries();
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

// Keep the newest timestamp per source; ISO timestamps order as strings.
function noteLogger(name: string, last: string): void {
  const had = knownLoggers.get(name);
  if (had === undefined || last > had) { knownLoggers.set(name, last); }
}

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  // The two messages of the source search carry no rows: handle them BEFORE the
  // table code below, which reads a missing `entries` as an empty log.
  if ('logger' in e.data) {
    noteLogger(e.data.logger.name, e.data.logger.last);
    updateLoggerMenu();
    return;
  }
  if ('loggerWalk' in e.data) {
    loggerWalk = e.data.loggerWalk;
    updateLoggerNote(e.data.error);
    return;
  }
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
  for (const row of allEntries) { noteLogger(loggerOf(row), row.TimeStamp ?? row.Timestamp ?? ''); }
  updateLoggerMenu();
  renderTable();
  statusEl.textContent = `${statusEl.textContent} · ${new Date(ts).toLocaleTimeString()}`;
});

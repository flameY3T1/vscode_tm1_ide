// src/webviewClient/transactionLog/index.ts
// Bundle of the transaction log. Until 09-24 it was ~220 lines of
// inline script in the template literal of the host — without type checking and lint.
import { formatLogTimestamp } from '../../utils/logTimestamp';
import type { HostToWebview, TxBootstrap, TxRow, WebviewToHost } from './protocol';
import { escapeHtml } from '../htmlUtils';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const { texts: TX, warnSpanHours: WARN_SPAN_HOURS } = (window as unknown as { __tx: TxBootstrap }).__tx;

let rows: TxRow[] = [];
let total = 0;
let findText = '';
/** Gewaehlte Zeilen als Index in rows — ein neues Laden leert die Auswahl. */
let selected = new Set<number>();
let undoing = false;

const esc = (s: unknown): string => escapeHtml(s ?? '');
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
function el<T extends HTMLElement = HTMLInputElement>(id: string): T {
  return document.getElementById(id) as T;
}

function query(): Extract<WebviewToHost, { type: 'load' }> {
  return {
    type: 'load',
    fromLocal: el('fromInput').value,
    toLocal: el('toInput').value,
    hours: Number(el('winSel').value) || 0,
    top: Number(el('topSel').value),
    cube: el('cubeInput').value.trim(),
    user: el('userInput').value.trim(),
    element: el('elemInput').value.trim(),
    includeControl: el('ctlChk').checked,
  };
}

/** Local time in the format datetime-local expects: no seconds, no zone. */
function toLocalField(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** Span in hours from the fields — only for the hint, the calculation happens in the host. */
function spanHours(): number {
  const from = el('fromInput').value ? new Date(el('fromInput').value) : null;
  const to = el('toInput').value ? new Date(el('toInput').value) : new Date();
  if (!from || isNaN(from.getTime()) || isNaN(to.getTime())) {
    return Number(el('winSel').value) || 24;
  }
  return Math.abs(to.getTime() - from.getTime()) / 3600000;
}

function updateNote(): void {
  const h = spanHours();
  const note = el('note');
  if (h > WARN_SPAN_HOURS) {
    note.className = 'warn';
    note.textContent = TX.wideSpan.replace('{0}', String(Math.round(h / 24))) + ' ' + TX.load;
  } else {
    note.className = '';
    note.textContent = TX.load;
  }
}

let loadSeq = 0;
function load(): void {
  el('dot').className = 'dot busy';
  el('status').textContent = TX.loading;
  updateNote();
  // Sequential identifier: a slow older search must not overwrite the table of a
  // newer one — the table feeds the undo selection.
  vscode.postMessage({ ...query(), seq: ++loadSeq });
}

// The quick selection WRITES the two bounds instead of living next to them:
// two paths to the same window that can drift apart would be the
// bug. Whoever types afterwards overwrites the quick selection.
el('winSel').addEventListener('change', () => {
  const h = Number(el('winSel').value);
  if (!h) { return; }
  el('fromInput').value = toLocalField(new Date(Date.now() - h * 3600000));
  el('toInput').value = '';
  load();
});
for (const id of ['topSel', 'ctlChk']) { el(id).addEventListener('change', load); }
for (const id of ['fromInput', 'toInput']) { el(id).addEventListener('change', () => { el('winSel').value = ''; updateNote(); }); }
el('searchBtn').addEventListener('click', load);
for (const id of ['cubeInput', 'userInput', 'elemInput']) {
  el(id).addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { load(); } });
}
el('findInput').addEventListener('input', (e) => { findText = (e.target as HTMLInputElement).value.toLowerCase(); render(); });

function updateUndo(): void {
  const btn = el<HTMLButtonElement>('undoBtn');
  btn.disabled = undoing || selected.size === 0;
  btn.textContent = '↶ ' + TX.undo + (selected.size > 0 ? ' (' + selected.size + ')' : '');
}
el('tbody').addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  if (!box.classList.contains('sel')) { return; }
  const i = Number(box.dataset.row);
  if (box.checked) { selected.add(i); } else { selected.delete(i); }
  updateUndo();
});
el('allChk').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  for (const box of Array.from(el('tbody').querySelectorAll<HTMLInputElement>('input.sel'))) {
    box.checked = on;
    const i = Number(box.dataset.row);
    if (on) { selected.add(i); } else { selected.delete(i); }
  }
  updateUndo();
});
el('undoBtn').addEventListener('click', () => {
  if (selected.size === 0) { return; }
  undoing = true;
  updateUndo();
  const entries = [...selected].map((i) => rows[i]).filter(Boolean).map((r) => ({
    TimeStamp: r.TimeStamp, Cube: r.Cube, Tuple: r.Tuple, OldValue: r.OldValue, NewValue: r.NewValue,
  }));
  vscode.postMessage({ type: 'undo', entries });
});

el('tbody').addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLElement>('.cubelink');
  if (!link) { return; }
  const r = rows[Number(link.dataset.row)];
  if (r) { vscode.postMessage({ type: 'openCell', cube: r.Cube || '', tuple: r.Tuple || [] }); }
});

/** Suggestion list from the loaded rows. The input stays free — a
  *  user whose changes lie outside the window does not appear here
  *  and must still be searchable. */
function fillList(listId: string, values: (string | undefined)[]): void {
  const opts = [...new Set(values.filter(Boolean))].sort();
  el(listId).innerHTML = opts.map((v) => '<option value="' + esc(v) + '"></option>').join('');
}

function render(): void {
  const shown = rows.filter((r) => {
    if (!findText) { return true; }
    const hay = [r.Cube, r.User, (r.Tuple || []).join(' '), r.OldValue, r.NewValue, r.StatusMessage].join(' ').toLowerCase();
    return hay.includes(findText);
  });
  el('hint').textContent = rows.length === 0 ? TX.empty : '';
  const parts = [shown.length + '/' + rows.length + ' ' + TX.shown, total + ' ' + TX.inWindow];
  if (total > rows.length) { parts.push(TX.truncated); }
  el('status').textContent = parts.join(' · ');

  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  el('tbody').innerHTML = shown.map((r) => {
    const idx = rowIndex.get(r)!;
    const oldN = num(r.OldValue);
    const newN = num(r.NewValue);
    const dirCls = oldN !== null && newN !== null && newN !== oldN ? (newN > oldN ? 'up' : 'down') : '';
    const numCls = oldN !== null && newN !== null ? 'num' : '';
    return '<tr>'
      + '<td><input class="sel" type="checkbox" data-row="' + idx + '"' + (selected.has(idx) ? ' checked' : '') + ' /></td>'
      + '<td class="ts">' + esc(formatLogTimestamp(r.TimeStamp)) + '</td>'
      + '<td class="usr">' + esc(r.User) + '</td>'
      + '<td><span class="cubelink" data-row="' + idx + '">' + esc(r.Cube) + '</span></td>'
      + '<td>' + esc((r.Tuple || []).join(' · ')) + '</td>'
      + '<td class="' + numCls + '">' + esc(r.OldValue) + '</td>'
      + '<td class="' + numCls + ' ' + dirCls + '">' + esc(r.NewValue) + '</td>'
      + '<td>' + esc(r.StatusMessage) + '</td>'
      + '</tr>';
  }).join('');
}

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  const d = e.data;
  if (d.undoDone) {
    undoing = false;
    updateUndo();
    if (d.reload) { load(); }
    return;
  }
  if (d.seq !== undefined && d.seq !== loadSeq) { return; }
  if (d.error) {
    undoing = false;
    updateUndo();
    el('dot').className = 'dot err';
    el('error').textContent = d.error;
    el('status').textContent = '';
    return;
  }
  el('dot').className = 'dot';
  el('error').textContent = '';
  rows = d.entries || [];
  total = d.total || 0;
  selected = new Set();
  el('allChk').checked = false;
  updateUndo();
  // The host sends back which window it really ran —
  // swapped bounds and the resolved quick selection are thereby visible
  // in the fields, instead of the form claiming something different from the table.
  if (d.fromLocal) { el('fromInput').value = d.fromLocal; }
  if (d.toLocal !== undefined) { el('toInput').value = d.toLocal; }
  fillList('cubeList', rows.map((r) => r.Cube));
  fillList('userList', rows.map((r) => r.User));
  updateNote();
  render();
});

el('winSel').dispatchEvent(new Event('change'));

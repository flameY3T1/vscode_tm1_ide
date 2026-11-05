import * as monaco from 'monaco-editor';
import { installCopyCutProxy, installPasteProxy } from '../_shared/clipboardProxy';
import { stubMonacoWorkers, installExternalLinkProxy } from '../_shared/monacoWebviewEnv';
import { registerMdxLanguage } from './mdxMonarch';
import { formatMdx } from '../../mdx/formatMdxPure';
import { tableToTsv } from '../../mdx/tsvExport';
import type { HistoryEntry } from '../../mdx/historyStore';
import { STARTER_SNIPPETS } from '../../mdx/starterSnippets';
import { CompletionBridge, registerMdxCompletion } from './completion';
import { ValidationBridge } from './validation';
import { getL10n, fmt } from '../_shared/l10n';
import { askConfirm } from '../_shared/confirmDialog';
import type { HostToWebview, WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

const L = getL10n();

stubMonacoWorkers();

const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: typeof vscode }).tm1VsApi = vscode;

registerMdxLanguage(monaco);

const editorEl = document.getElementById('mdx-editor');
if (!editorEl) { throw new Error('mdx-editor mount missing'); }

const model = monaco.editor.createModel('', 'mdx');

function pickMdxTheme(): 'mdx-light' | 'mdx-dark' {
  const cl = document.body.classList;
  if (cl.contains('vscode-light') || cl.contains('vscode-high-contrast-light')) { return 'mdx-light'; }
  return 'mdx-dark';
}

const editor = monaco.editor.create(editorEl, {
  model,
  language: 'mdx',
  theme: pickMdxTheme(),
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  fontSize: 14,
  minimap: { enabled: false },
  wordWrap: 'off',
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  renderWhitespace: 'selection',
  quickSuggestions: { other: true, comments: false, strings: false } as any,
  // Legacy <textarea> input instead of the experimental EditContext — analogous to the rule and process editors.
  // With native-edit-context, Ctrl+C/X/V keydown events no longer bubble up to our
  // clipboard proxy (getDomNode listener) → copy/cut/paste would silently break in the webview.
  experimentalEditContextEnabled: false,
} as any);

/**
 * Replace the whole editor content as one undoable step.
 *
 * Deliberately not model.setValue: that clears Monaco's undo stack, so Clear or a
 * picked history entry could not be taken back with Ctrl+Z.
 */
function replaceAll(text: string): void {
  editor.pushUndoStop();
  editor.executeEdits('replaceAll', [{
    range: model.getFullModelRange(),
    text,
    forceMoveMarkers: true,
  }]);
  editor.pushUndoStop();
}

// React to VSCode theme changes (body class flips between vscode-light/dark/high-contrast*).
new MutationObserver(() => monaco.editor.setTheme(pickMdxTheme()))
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });

const completionBridge = new CompletionBridge((msg) => vscode.postMessage(msg));
registerMdxCompletion(completionBridge);

const validationBridge = new ValidationBridge(model, (msg) => vscode.postMessage(msg));
model.onDidChangeContent(() => validationBridge.schedule());

// External-link proxy — rationale in `_shared/monacoWebviewEnv.ts`.
installExternalLinkProxy((url) => vscode.postMessage({ type: 'openExternal', url }));

// Paste via the host: the webview must not read the clipboard.
installPasteProxy(monaco, editor, (msg) => vscode.postMessage(msg));

// Copy/cut via the host — rationale in `_shared/clipboardProxy.ts`.
installCopyCutProxy(monaco, editor, (msg) => vscode.postMessage(msg));

// F5 / Ctrl+Enter → run
editor.addCommand(monaco.KeyCode.F5, () => run());
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run());

const runBtn    = document.getElementById('run') as HTMLButtonElement | null;
const clearBtn  = document.getElementById('clear') as HTMLButtonElement | null;
const formatBtn = document.getElementById('format') as HTMLButtonElement | null;
const copyBtn   = document.getElementById('copy-tsv') as HTMLButtonElement | null;
const statusEl  = document.getElementById('status');
const contextEl = document.getElementById('context');
const emptyEl   = document.getElementById('empty');
const errorEl   = document.getElementById('error');
const mountEl   = document.getElementById('table-mount');
const footerEl  = document.getElementById('footer-info');
const historyEl = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('history-clear') as HTMLButtonElement | null;
const snippetSelect   = document.getElementById('snippet-select') as HTMLSelectElement | null;

let currentTable: CellsetTable | null = null;

// Populate snippet dropdown once.
if (snippetSelect) {
  for (const s of STARTER_SNIPPETS) {
    const opt = document.createElement('option');
    opt.value = s.label;
    opt.textContent = s.label;
    opt.title = s.description;
    snippetSelect.appendChild(opt);
  }
  snippetSelect.addEventListener('change', () => {
    const picked = STARTER_SNIPPETS.find(s => s.label === snippetSelect.value);
    if (!picked) { return; }
    const sel = editor.getSelection();
    const text = picked.mdx;
    if (sel) {
      editor.executeEdits('snippet', [{ range: sel, text, forceMoveMarkers: true }]);
    } else {
      replaceAll(text);
    }
    editor.focus();
    snippetSelect.value = '';  // reset to placeholder
  });
}

// F5/Ctrl+Enter bypass the disabled button; results carry no run id, so a
// second run would let the older answer overwrite the newer one.
let isRunning = false;
function setRunning(running: boolean): void {
  isRunning = running;
  if (runBtn) { runBtn.disabled = running; }
  if (statusEl) { statusEl.textContent = running ? L.running : ''; }
}

function showEmpty(): void {
  if (emptyEl)  { emptyEl.style.display = ''; }
  if (errorEl)  { errorEl.classList.remove('visible'); }
  if (contextEl) { contextEl.classList.remove('visible'); }
  if (mountEl)  { mountEl.innerHTML = ''; }
  if (footerEl) { footerEl.textContent = ''; }
  currentTable = null;
  if (copyBtn) { copyBtn.disabled = true; }
}

function showError(err: { code: string; message: string }): void {
  if (emptyEl)  { emptyEl.style.display = 'none'; }
  if (mountEl)  { mountEl.innerHTML = ''; }
  if (contextEl) { contextEl.classList.remove('visible'); }
  if (!errorEl) { return; }
  errorEl.classList.add('visible');
  errorEl.innerHTML = '';
  const codeEl = document.createElement('div');
  codeEl.className = 'err-code';
  codeEl.textContent = L.errorPrefix + ' ' + (err.code || '');
  const msgEl = document.createElement('div');
  msgEl.textContent = err.message || '';
  errorEl.appendChild(codeEl);
  errorEl.appendChild(msgEl);
}

interface TitleHeader { hierarchy: string; member: string }
interface CellsetCell { value: number | string | null; formatted: string }
interface CellsetTable {
  colHeaders: string[][];
  colHierarchies: string[];
  rowHeaders: string[][];
  rowHierarchies: string[];
  titleHeaders: TitleHeader[];
  cells: CellsetCell[][];
  dims: { cols: number; rows: number };
}

function showContext(titleHeaders: TitleHeader[]): void {
  if (!contextEl) { return; }
  if (!titleHeaders || titleHeaders.length === 0) {
    contextEl.classList.remove('visible');
    return;
  }
  contextEl.innerHTML = '';
  for (const t of titleHeaders) {
    const span = document.createElement('span');
    span.className = 'ctx-item';
    const hier = document.createElement('span');
    hier.className = 'ctx-hier';
    hier.textContent = t.hierarchy + '=';
    const mem = document.createElement('span');
    mem.textContent = t.member;
    span.appendChild(hier);
    span.appendChild(mem);
    contextEl.appendChild(span);
  }
  contextEl.classList.add('visible');
}

function buildCellTooltip(
  table: CellsetTable,
  r: number,
  c: number,
  cell: CellsetCell,
): string {
  const lines: string[] = [];
  const rowTuple = table.rowHeaders[r] ?? [];
  for (let i = 0; i < table.rowHierarchies.length; i++) {
    lines.push(`${table.rowHierarchies[i]} = ${rowTuple[i] ?? ''}`);
  }
  const colTuple = table.colHeaders[c] ?? [];
  for (let i = 0; i < table.colHierarchies.length; i++) {
    lines.push(`${table.colHierarchies[i]} = ${colTuple[i] ?? ''}`);
  }
  for (const t of table.titleHeaders) {
    lines.push(`${t.hierarchy} = ${t.member}`);
  }
  lines.push('────────');
  if (cell.value === null) {
    lines.push(L.valueEmpty);
  } else if (typeof cell.value === 'number' && cell.formatted && cell.formatted !== String(cell.value)) {
    lines.push(fmt(L, 'valueRawFormatted', cell.value, cell.formatted));
  } else {
    lines.push(fmt(L, 'valueOnly', cell.formatted || String(cell.value)));
  }
  return lines.join('\n');
}

function renderTable(table: CellsetTable): void {
  if (!mountEl) { return; }
  if (emptyEl)  { emptyEl.style.display = 'none'; }
  if (errorEl)  { errorEl.classList.remove('visible'); }
  mountEl.innerHTML = '';

  const { colHeaders, colHierarchies, rowHeaders, rowHierarchies, cells, dims } = table;
  const tableEl = document.createElement('table');
  tableEl.className = 'pivot';
  tableEl.dataset.resizable = '';

  const thead = document.createElement('thead');
  const colHierCount = colHierarchies.length || 1;
  const rowHierCount = rowHierarchies.length;

  for (let h = 0; h < colHierCount; h++) {
    const tr = document.createElement('tr');
    if (h === 0) {
      const corner = document.createElement('th');
      corner.className = 'corner';
      corner.colSpan = Math.max(rowHierCount, 1);
      corner.rowSpan = colHierCount;
      corner.textContent = rowHierarchies.join(' · ') || '';
      tr.appendChild(corner);
    }
    for (let c = 0; c < dims.cols; c++) {
      const th = document.createElement('th');
      th.className = 'col-head';
      const tuple = colHeaders[c] ?? [];
      th.textContent = tuple[h] || '';
      th.title = colHierarchies.map((hier, i) => `${hier} = ${tuple[i] ?? ''}`).join('\n');
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }
  tableEl.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let r = 0; r < dims.rows; r++) {
    const tr = document.createElement('tr');
    if (rowHierCount > 0) {
      const rowTuple = rowHeaders[r] || [];
      for (let rh = 0; rh < rowHierCount; rh++) {
        const td = document.createElement('td');
        td.className = 'rowhead';
        td.textContent = rowTuple[rh] || '';
        td.title = rowHierarchies.map((hier, i) => `${hier} = ${rowTuple[i] ?? ''}`).join('\n');
        tr.appendChild(td);
      }
    }
    const rowCells = cells[r] || [];
    for (let c = 0; c < dims.cols; c++) {
      const cell = rowCells[c] || { value: null, formatted: '' };
      const td = document.createElement('td');
      const isNum = typeof cell.value === 'number';
      td.className = isNum ? 'num' : '';
      if (cell.value === null) { td.classList.add('num', 'null'); }
      else if (cell.value === 0) { td.classList.add('zero'); }
      td.textContent = cell.formatted;
      td.title = buildCellTooltip(table, r, c, cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
  mountEl.appendChild(tableEl);
}

function run(): void {
  const mdx = editor.getValue();
  if (!mdx.trim() || isRunning) { return; }
  setRunning(true);
  if (footerEl) { footerEl.textContent = ''; }
  vscode.postMessage({ type: 'execute', mdx });
}

function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.round(diff / 1000);
  if (sec < 60) { return L.justNow; }
  const min = Math.round(sec / 60);
  if (min < 60) { return fmt(L, 'minutesAgo', min); }
  const hr = Math.round(min / 60);
  if (hr < 24) { return fmt(L, 'hoursAgo', hr); }
  const d = Math.round(hr / 24);
  return fmt(L, 'daysAgo', d);
}

function firstLine(s: string, max = 80): string {
  const line = (s.split('\n')[0] ?? '').trim();
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

function renderHistory(entries: HistoryEntry[]): void {
  if (!historyEl) { return; }
  historyEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = L.noHistory;
    historyEl.appendChild(empty);
    return;
  }
  entries.forEach((e, idx) => {
    const item = document.createElement('div');
    item.className = 'history-item' + (e.error ? ' error' : '');
    item.title = e.mdx;

    const mdxLine = document.createElement('div');
    mdxLine.className = 'hi-mdx';
    mdxLine.textContent = firstLine(e.mdx);

    const meta = document.createElement('div');
    meta.className = 'hi-meta';
    const left = document.createElement('span');
    if (e.error) {
      left.textContent = `✕ ${e.error.code} · ${formatRelative(e.timestamp)}`;
    } else {
      left.textContent = `${e.rowCount}×${e.colCount} · ${e.elapsedMs}ms · ${formatRelative(e.timestamp)}`;
    }
    const del = document.createElement('button');
    del.className = 'hi-delete';
    del.textContent = '✕';
    del.title = L.deleteEntry;
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      vscode.postMessage({ type: 'deleteHistoryEntry', index: idx });
    });
    meta.appendChild(left);
    meta.appendChild(del);

    item.appendChild(mdxLine);
    item.appendChild(meta);
    item.addEventListener('click', () => {
      replaceAll(e.mdx);
      editor.focus();
    });
    historyEl.appendChild(item);
  });
}

// Native `confirm()` is blocked in the webview sandbox (returns falsy without
// showing anything), so this used to be a button that never cleared anything.
clearHistoryBtn?.addEventListener('click', () => {
  void askConfirm({
    message: L.confirmClearHistory,
    detail: L.confirmClearHistoryDetail,
    confirmLabel: L.clearAll,
    cancelLabel: L.cancel,
    danger: true,
  }).then(ok => {
    if (ok) { vscode.postMessage({ type: 'clearHistory' }); }
  });
});

runBtn?.addEventListener('click', run);
clearBtn?.addEventListener('click', () => { replaceAll(''); showEmpty(); });
// Drag bar between editor and result. Monaco runs with automaticLayout,
// the result area is flex:1 — only the height of .top is set.
const splitEl = document.getElementById('split');
const topEl = document.querySelector('.top') as HTMLElement | null;
splitEl?.addEventListener('mousedown', (down: MouseEvent) => {
  if (!topEl) { return; }
  down.preventDefault();
  const startY = down.clientY;
  const startH = topEl.getBoundingClientRect().height;
  splitEl.classList.add('dragging');
  document.body.classList.add('splitting');
  const onMove = (mv: MouseEvent) => {
    // Lower bound: Monaco needs room. Upper bound: 160px stay available so that the result,
    // toolbar and footer remain visible.
    const max = Math.max(120, window.innerHeight - 160);
    topEl.style.height = `${Math.min(max, Math.max(120, startH + (mv.clientY - startY)))}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    splitEl.classList.remove('dragging');
    document.body.classList.remove('splitting');
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// Same route as Shift+Alt+F (the mdx formatting provider), but as one undoable
// edit instead of a full setValue.
formatBtn?.addEventListener('click', () => {
  const src = model.getValue();
  const formatted = formatMdx(src);
  if (formatted !== src) { replaceAll(formatted); }
  editor.focus();
});
copyBtn?.addEventListener('click', () => {
  if (!currentTable) { return; }
  const tsv = tableToTsv(currentTable);
  if (!tsv) { return; }
  vscode.postMessage({ type: 'requestCopy', text: tsv });
  const original = copyBtn.textContent;
  copyBtn.textContent = L.copied;
  setTimeout(() => { if (copyBtn) { copyBtn.textContent = original; } }, 1500);
});

window.addEventListener('message', (e) => {
  const msg = (e as MessageEvent).data as HostToWebview;
  if (completionBridge.handleResponse(msg)) { return; }
  if (validationBridge.handleResponse(msg))  { return; }
  if (msg.type === 'pasteText') {
    const text = String(msg.text ?? '');
    const sel = editor.getSelection();
    if (sel) { editor.executeEdits('paste', [{ range: sel, text, forceMoveMarkers: true }]); }
    return;
  }
  if (msg.type === 'loadMdx') {
    // Prefill from "Open in MDX Runner" buttons in other panels.
    replaceAll(String(msg.mdx ?? ''));
    editor.focus();
    return;
  }
  if (msg.type === 'historyUpdate') {
    renderHistory(msg.entries ?? []);
    return;
  }
  setRunning(false);
  if (msg.type !== 'result') { return; }
  if (msg.ok) {
    currentTable = msg.table;
    if (copyBtn) { copyBtn.disabled = false; }
    showContext(msg.table.titleHeaders);
    renderTable(msg.table);
    const { rows, cols } = msg.table.dims;
    if (statusEl) { statusEl.textContent = msg.elapsedMs + ' ms'; }
    if (footerEl) { footerEl.textContent = fmt(L, 'cellsSummary', rows, cols, rows * cols); }
  } else {
    currentTable = null;
    if (copyBtn) { copyBtn.disabled = true; }
    showError(msg.error);
    if (statusEl) { statusEl.textContent = L.errorPrefix; }
    if (footerEl) { footerEl.textContent = ''; }
  }
});

// Signal the host that the message listener is registered — triggers a
// resend of the initial history/prefill-MDX payloads if they were posted
// before this listener existed (Monaco cold-start race, P1-8).
vscode.postMessage({ type: 'webviewReady' });

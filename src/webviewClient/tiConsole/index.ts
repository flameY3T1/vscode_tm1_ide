// MUST come FIRST: `KNOWN_SIGNATURES` is EMPTY at load time and is filled
// from the embedded JSON by this bootstrap. Without it there is no
// function list — so no suggestions, no explanation popup and no
// colored function names.
import '../_shared/sigsBootstrap';
import * as monaco from 'monaco-editor';
import { registerTiLanguage } from '../processEditorMonaco/tiMonarch';
import { registerCompletions, registerHover, setV12Mode } from '../processEditorMonaco/completions';
import {
  registerContextCompletions, setContextCompletionBridge,
  receiveContextCubes, receiveContextDimensions, receiveContextProcesses, receiveContextCubesWithDims,
  receiveContextHierarchies,
} from '../processEditorMonaco/contextCompletions';
import { installCopyCutProxy, installPasteProxy } from '../_shared/clipboardProxy';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import { getL10n, fmt } from '../_shared/l10n';
import type { HostToWebview, WebviewToHost } from './protocol';
import type { TiHistoryEntry } from '../../webviews/tiConsolePure';
import { getVsCodeApi } from '../_shared/vscodeApi';

const L = getL10n();

// Monaco web worker stub — as in processEditorMonaco (no real worker in the webview).
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker: () => ({
    postMessage: () => { /* noop */ },
    terminate: () => { /* noop */ },
    onmessage: null,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
  }),
};

const vscode = getVsCodeApi<WebviewToHost>();

// TI language with the built-in functions — the same registration as in the
// process editor, only without server object completion: the console has no
// loaded process from which variables could come.
const builtins: string[] = Array.from(KNOWN_SIGNATURES.values())
  .filter((sig) => !sig.rulesOnly)
  .map((sig) => sig.name);
registerTiLanguage(monaco, builtins);
// `registerTiLanguage` only does the coloring. The suggestion list and the explanation popup
// hang on `completions.ts` — the same two calls as in the process editor.
// The v12 state comes from the connection of this window, so that the HTTP and
// job family are not even suggested on an 11.x server.
setV12Mode((globalThis as unknown as { __v12?: boolean }).__v12 === true);
registerCompletions(monaco);
registerHover(monaco);

const editorEl = document.getElementById('ti-editor');
if (!editorEl) { throw new Error('ti-editor mount missing'); }

/**
 * `ti-light`/`ti-dark`, not `vs`/`vs-dark`: `registerTiLanguage` defines the two
 * color sets, and only they color function names, strings
 * and identifiers the way the process editor does. With the plain
 * Monaco color set, the same TI code looked different in the two windows.
 */
function pickTheme(): 'ti-light' | 'ti-dark' {
  const cl = document.body.classList;
  return cl.contains('vscode-light') || cl.contains('vscode-high-contrast-light') ? 'ti-light' : 'ti-dark';
}

const editor = monaco.editor.create(editorEl, {
  model: monaco.editor.createModel('', 'ti'),
  theme: pickTheme(),
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  fontSize: 14,
  minimap: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  // Legacy <textarea> input instead of EditContext — analogous to the rule/process editor,
  // otherwise Ctrl+C/X/V do not reach our own key hooks.
  // `as any` as in mdxRunnerMonaco: the option is not in the types of the
  // bundled Monaco build, but takes effect at runtime.
  experimentalEditContextEnabled: false,
} as any);

// Server objects in string arguments — the same completion as in
// the process editor. `getVariables` stays empty: the console has no loaded
// process from which variables could come; the cube suggestion then inserts the
// dimension names as placeholders instead of matching variables.
registerContextCompletions(monaco);
setContextCompletionBridge({
  fetchCubes: () => vscode.postMessage({ type: 'fetchCubes' }),
  fetchDimensions: () => vscode.postMessage({ type: 'fetchDimensions' }),
  fetchProcesses: () => vscode.postMessage({ type: 'fetchProcesses' }),
  fetchCubesWithDims: () => vscode.postMessage({ type: 'fetchCubesWithDims' }),
  fetchHierarchies: (dimension) => vscode.postMessage({ type: 'fetchHierarchies', dimension }),
  getVariables: () => [],
});

// Paste via the host: the webview must not read the clipboard.
installPasteProxy(monaco, editor, (msg) => vscode.postMessage(msg));
installCopyCutProxy(monaco, editor, (msg) => vscode.postMessage(msg));

// Follow the color change of VS Code — the UI is driven by the
// class on `body`, not by an event in the webview.
new MutationObserver(() => monaco.editor.setTheme(pickTheme()))
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });

const runBtn = document.getElementById('btn-run') as HTMLButtonElement;
const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
const outEl = document.getElementById('ti-out') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const historyEl = document.getElementById('history-list') as HTMLElement;
const clearHistoryBtn = document.getElementById('history-clear') as HTMLButtonElement;

let busy = false;

function setOut(text: string, kind: 'ok' | 'err' | 'plain'): void {
  outEl.textContent = text;
  outEl.className = `out-${kind}`;
}

function setBusy(next: boolean): void {
  busy = next;
  runBtn.disabled = next;
  runBtn.textContent = next ? (L.running ?? 'Running…') : (L.run ?? 'Run');
}

function relative(ts: number): string {
  const sec = Math.round(Math.max(0, Date.now() - ts) / 1000);
  if (sec < 60) { return L.justNow ?? 'just now'; }
  const min = Math.round(sec / 60);
  if (min < 60) { return fmt(L, 'minutesAgo', min); }
  const hr = Math.round(min / 60);
  if (hr < 24) { return fmt(L, 'hoursAgo', hr); }
  return fmt(L, 'daysAgo', Math.round(hr / 24));
}

/** First non-empty line — the history shows one line per entry. */
function firstLine(code: string, max = 80): string {
  const line = code.split('\n').map(l => l.trim()).find(l => l !== '') ?? '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

function renderHistory(entries: TiHistoryEntry[]): void {
  historyEl.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = L.noHistory ?? 'No snippets run yet.';
    historyEl.appendChild(empty);
    clearHistoryBtn.disabled = true;
    return;
  }
  clearHistoryBtn.disabled = false;
  entries.forEach((e) => {
    const item = document.createElement('div');
    item.className = 'history-item' + (e.ok ? '' : ' error');
    // The whole snippet as a tooltip — the line in the history is truncated.
    item.title = e.code;
    // Clicking loads it into the editor without running it: a snippet writes, and
    // whoever only wants to reread or touch it up should not fire it off in the process.
    item.addEventListener('click', () => { editor.setValue(e.code); editor.focus(); });

    const code = document.createElement('div');
    code.className = 'hi-code';
    code.textContent = firstLine(e.code);

    const meta = document.createElement('div');
    meta.className = 'hi-meta';
    const left = document.createElement('span');
    left.textContent = `${e.ok ? '✓' : '✕'} ${fmt(L, 'elapsed', e.elapsedMs.toLocaleString())} · ${relative(e.timestamp)}`;
    const spacer = document.createElement('span');
    spacer.className = 'hi-spacer';
    const again = document.createElement('button');
    again.className = 'hi-rerun';
    again.textContent = '▶';
    again.title = L.rerunTitle ?? 'Run again';
    again.addEventListener('click', (ev) => {
      ev.stopPropagation();
      editor.setValue(e.code);
      run();
    });
    const del = document.createElement('button');
    del.className = 'hi-delete';
    del.textContent = '✕';
    del.title = L.deleteEntryTitle ?? 'Remove';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // The timestamp, not the position: two windows on the same
      // history can be at different points (see host).
      vscode.postMessage({ type: 'deleteHistoryEntry', timestamp: e.timestamp });
    });

    meta.append(left, spacer, again, del);
    item.append(code, meta);
    historyEl.appendChild(item);
  });
}

function run(): void {
  if (busy) { return; }
  const code = editor.getValue().trim();
  if (code === '') { setOut(L.empty ?? 'Nothing to run.', 'plain'); return; }
  setBusy(true);
  statusEl.textContent = '';
  setOut(L.running ?? 'Running…', 'plain');
  vscode.postMessage({ type: 'run', code });
}

runBtn.addEventListener('click', run);
clearBtn.addEventListener('click', () => { editor.setValue(''); editor.focus(); });
clearHistoryBtn.addEventListener('click', () => vscode.postMessage({ type: 'clearHistory' }));
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run());
editor.addCommand(monaco.KeyCode.F5, () => run());

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => {
  const msg = ev.data;
  if (!msg) { return; }
  if (msg.type === 'historyUpdate') { renderHistory(msg.entries); return; }
  if (msg.type === 'pasteText') {
    const sel = editor.getSelection();
    if (sel) { editor.executeEdits('paste', [{ range: sel, text: msg.text, forceMoveMarkers: true }]); }
    editor.focus();
    return;
  }
  if (msg.type === 'cubeList') { receiveContextCubes(msg.cubes); return; }
  if (msg.type === 'dimensionList') { receiveContextDimensions(msg.dimensions); return; }
  if (msg.type === 'processList') { receiveContextProcesses(msg.processes); return; }
  if (msg.type === 'cubesWithDims') { receiveContextCubesWithDims(msg.cubes); return; }
  if (msg.type === 'hierarchyList') { receiveContextHierarchies(msg.dimension, msg.hierarchies); return; }
  if (msg.type === 'cancelled') {
    setBusy(false);
    setOut(L.cancelled ?? 'Cancelled.', 'plain');
    return;
  }
  if (msg.type === 'failed') {
    setBusy(false);
    setOut(msg.message, 'err');
    return;
  }
  if (msg.type === 'result') {
    setBusy(false);
    const elapsed = fmt(L, 'elapsed', msg.elapsedMs.toLocaleString());
    statusEl.textContent = elapsed;
    if (msg.ok) {
      setOut(`${L.ok ?? 'Completed successfully.'} (${elapsed})`, 'ok');
      return;
    }
    const head = `${fmt(L, 'failedStatus', msg.status || '?')} (${elapsed})`;
    setOut(msg.errorLog ? `${head}\n\n${msg.errorLog}` : head, 'err');
  }
});

renderHistory([]);
editor.focus();
vscode.postMessage({ type: 'webviewReady' });

// MUST be the FIRST import — populates KNOWN_SIGNATURES from inline JSON
// before initMonacoLanguage() runs at module-end.
import '../_shared/sigsBootstrap';
import * as monaco from 'monaco-editor';
import { installCopyCutProxy, installPasteProxy } from '../_shared/clipboardProxy';
import { stubMonacoWorkers, installExternalLinkProxy } from '../_shared/monacoWebviewEnv';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';

stubMonacoWorkers();

import { registerRulesLanguage } from './rulesMonarch';
import { registerRulesFolding } from './folding';
import { formatRules, setFormatConfig } from './format';
import { initFormatMenu, renderFormatMenu } from './formatMenu';
import { initLintMenu, onRulesLintConfig } from './lintMenu';
import { initEditMenu } from '../_shared/editMenu';
import { initLinter, receiveLintResults, receiveCompileResults, clearCompileResults } from './linter';
import {
  registerWordCompletions, registerContextCompletions, registerBangCompletions,
  registerHover, setContextBridge, receiveDimensions, receiveAttributes,
  receiveCubes, receiveCubesWithDims, setCubeDimensions,
} from './completions';
import { initReferences, refreshReferences, clearReferences } from '../_shared/monacoReferences';
import { escapeHtml } from '../htmlUtils';
import { getL10n, fmt } from '../_shared/l10n';
import { initFindOverlay } from '../_shared/findOverlay';
import { initRuleEditorGutterLayout, withRuleEditorGutter } from './gutterLayout';

const L = getL10n();

const RULES_FUNCTION_KEYS = new Set([
  'db', 'cellgetn', 'cellgets', 'cellputn', 'cellputs', 'cellexists',
  'cellisupdateable', 'cellisundefined', 'cellisrule',
  'attrs', 'attrn', 'attre', 'attributeget',
  'elementexists', 'elementindex', 'elementname', 'elementlevel',
  'elementcomponent', 'elementcomponentcount', 'elementweight',
  'elementtype', 'elementparent', 'elementparentcount',
  'dimsiz', 'dimnm', 'dimix', 'dtype', 'dnlev', 'dnxt',
  'elpar', 'elparn', 'elcomp', 'elcompn', 'elweight', 'ellev',
  'elisanc', 'elispar', 'elisstr',
  'str', 'trim', 'ltrim', 'rtrim', 'long', 'scan', 'subst', 'upper', 'lower',
  'char', 'code', 'fill', 'capit', 'delet', 'insrt', 'numbr',
  'int', 'round', 'abs', 'mod', 'max', 'min', 'power', 'exp',
  'log', 'log10', 'sqrt', 'sin', 'cos', 'tan',
  'now', 'today', 'date', 'time', 'dayno', 'month', 'year', 'day',
  'hour', 'minute', 'second', 'timst',
  'isund',
  'numbertostring', 'stringtonumber', 'expand', 'nvalue', 'svalue',
  'rand', 'servername',
]);

import type { HostToWebview, WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';


const vscode = getVsCodeApi<WebviewToHost>();

/**
 * Builds the rules-builtins list (filtered subset of KNOWN_SIGNATURES) and
 * registers the rules language + Monaco language providers.
 *
 * Called once at module-end below — extracted to a function in Phase 3a of
 * the tiSignatures JSON-asset split so Phase 3b can defer the call until
 * AFTER signatures are populated from the inline JSON asset.
 */
function initMonacoLanguage(): void {
  const builtins: string[] = ['DB'];
  for (const [key, sig] of KNOWN_SIGNATURES) {
    if (RULES_FUNCTION_KEYS.has(key)) { builtins.push(sig.name); }
  }
  registerRulesLanguage(monaco, builtins);
  try { registerRulesFolding(monaco); } catch (e) { console.error('[Monaco] registerRulesFolding failed:', e); }
  try { registerWordCompletions(monaco); } catch (e) { console.error('[Monaco] registerWordCompletions failed:', e); }
  try { registerContextCompletions(monaco); } catch (e) { console.error('[Monaco] registerContextCompletions failed:', e); }
  try { registerBangCompletions(monaco); } catch (e) { console.error('[Monaco] registerBangCompletions failed:', e); }
  try { registerHover(monaco); } catch (e) { console.error('[Monaco] registerHover failed:', e); }
}

initMonacoLanguage();

setContextBridge({
  fetchDimensions: () => vscode.postMessage({ type: 'getCompletions', context: 'dimensions' }),
  fetchAttributes: (dimension) => vscode.postMessage({ type: 'getCompletions', context: 'attributes', dimension }),
  fetchCubes: () => vscode.postMessage({ type: 'getCompletions', context: 'cubes' }),
  fetchCubesWithDims: () => vscode.postMessage({ type: 'getCompletions', context: 'cubesWithDims' }),
});

const container = document.getElementById('monaco-editor-mount');
if (!container) {
  throw new Error('Monaco mount point #monaco-editor-mount not found');
}

const model = monaco.editor.createModel('', 'tm1rules');

function pickRulesTheme(): 'tm1rules-light' | 'tm1rules-dark' {
  const cl = document.body.classList;
  if (cl.contains('vscode-light') || cl.contains('vscode-high-contrast-light')) { return 'tm1rules-light'; }
  return 'tm1rules-dark';
}

const editor = monaco.editor.create(container, withRuleEditorGutter({
  model,
  language: 'tm1rules',
  theme: pickRulesTheme(),
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  fontSize: 14,
  minimap: { enabled: false },
  wordWrap: 'off',
  lineNumbers: 'on',
  folding: true,
  foldingStrategy: 'auto',
  renderWhitespace: 'selection',
  scrollBeyondLastLine: false,
  quickSuggestions: { other: true, comments: false, strings: true } as any,
  suggestOnTriggerCharacters: true,
  hover: { enabled: true, delay: 300, sticky: true } as any,
  // Legacy <textarea> input instead of the experimental EditContext.
  // With native-edit-context, Ctrl+C/V keydown events no longer bubble,
  // so our clipboard proxy never fires.
  experimentalEditContextEnabled: false,
} as any));

initRuleEditorGutterLayout(editor, container);

// React to VSCode theme changes (body class flips between vscode-light/dark/high-contrast*).
new MutationObserver(() => monaco.editor.setTheme(pickRulesTheme()))
  .observe(document.body, { attributes: true, attributeFilter: ['class'] });

// External-link proxy — rationale in `_shared/monacoWebviewEnv.ts`.
installExternalLinkProxy((url) => vscode.postMessage({ type: 'openExternal', url }));

// Toolbar buttons focus-neutral: prevents stealing focus from the Monaco editor,
// so that keyboard shortcuts (Ctrl+C, Ctrl+/, etc.) keep landing
// in the editor after a toolbar click.
document.addEventListener('mousedown', (e: MouseEvent) => {
  const t = e.target as HTMLElement | null;
  if (!t) { return; }
  if (t.closest('.toolbar button, .tabs button, .ref-toolbar button')) {
    e.preventDefault();
  }
}, true);

// Native paste event: sync path via clipboardData, independent of the
// extension host (also works when the event loop is blocked).
installPasteProxy(monaco, editor, (msg) => vscode.postMessage(msg));

// Copy/cut via the host — see `_shared/clipboardProxy.ts`.
installCopyCutProxy(monaco, editor, (msg) => vscode.postMessage(msg));

let suppressChange = false;
let dirty = false;

initLinter(monaco, {
  getModel: () => model,
  revealLine: (line) => {
    switchTab('code');
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  },
});

initReferences(monaco, {
  editor,
  sources: () => [{ key: 'rules', label: '', model }],
  reveal: (_key, line) => {
    switchTab('code');
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  },
  bangRefs: true,
  text: {
    hintHtml: escapeHtml(L.doubleClickWord),
    noneHtml: escapeHtml(L.noOccurrencesFound),
    noFilterMatchHtml: escapeHtml(L.noFilterMatch),
    colLineHtml: escapeHtml(L.colLine),
    colContextHtml: escapeHtml(L.colContext),
    jumpToLineHtml: escapeHtml(L.jumpToLine),
    wordLabelHtml: (strong) => fmt(L, 'wordLabel', strong),
    count: (n) => fmt(L, 'occurrencesCount', n),
    filtered: (n, total) => fmt(L, 'occurrencesFilteredCount', n, total),
  },
});

// In-editor Ctrl+F/Ctrl+H with a navigable match list (single source: the rule).
initFindOverlay(monaco, {
  getSources: () => [{ key: 'rules', label: '', model }],
  getEditor: () => editor,
  activate: () => switchTab('code'),
});

function switchTab(name: string): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll<HTMLElement>('.panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${name}`);
  });
  if (name === 'code') {
    requestAnimationFrame(() => editor.layout());
  }
}

document.querySelectorAll<HTMLElement>('.tab').forEach(tabEl => {
  tabEl.addEventListener('click', () => {
    const name = tabEl.dataset.tab;
    if (name) { switchTab(name); }
  });
});

function setDirty(val: boolean): void {
  dirty = val;
  const btn = document.getElementById('btn-save') as HTMLButtonElement | null;
  const dot = document.getElementById('dirty-dot');
  if (btn) { btn.disabled = !val; }
  if (dot) { dot.className = 'dirty-dot' + (val ? ' visible' : ''); }
}

function showError(msg: string): void {
  const el = document.getElementById('error-banner');
  if (el) { el.textContent = msg; el.className = 'visible'; }
  const ok = document.getElementById('success-banner');
  if (ok) { ok.className = ''; }
}

const DEFAULT_SUCCESS_TEXT = L.rulesSavedSuccessfully;
function showSuccess(text: string = DEFAULT_SUCCESS_TEXT): void {
  const el = document.getElementById('success-banner');
  if (el) {
    el.textContent = text;
    el.className = 'visible';
    setTimeout(() => {
      if (el) {
        el.className = '';
        el.textContent = DEFAULT_SUCCESS_TEXT;
      }
    }, 3000);
  }
  const err = document.getElementById('error-banner');
  if (err) { err.className = ''; }
}

function hideError(): void {
  const err = document.getElementById('error-banner');
  if (err) { err.className = ''; }
}

function updateLineCountBadge(): void {
  const el = document.getElementById('lc-rules');
  if (!el) { return; }
  const text = model.getValue();
  const n = text.length === 0 ? 0 : model.getLineCount();
  el.textContent = String(n);
}

model.onDidChangeContent(() => {
  refreshReferences();
  updateLineCountBadge();
  if (suppressChange) { return; }
  setDirty(true);
  hideError();
  vscode.postMessage({ type: 'codeChanged', code: model.getValue() });
});
updateLineCountBadge();

function doSave(): void {
  vscode.postMessage({ type: 'save', rulesText: model.getValue() });
}

document.getElementById('btn-save')?.addEventListener('click', doSave);

function setQualifyBusy(busy: boolean): void {
  const btn = document.getElementById('btn-qualify') as HTMLButtonElement | null;
  if (!btn) { return; }
  btn.disabled = busy;
  const label = btn.querySelector('.btn-label');
  if (label) { label.textContent = busy ? L.resolving : L.elementQualifier; }
}
function doQualify(): void {
  setQualifyBusy(true);
  vscode.postMessage({ type: 'qualifyElements', code: model.getValue() });
}
document.getElementById('btn-qualify')?.addEventListener('click', doQualify);

document.getElementById('btn-area-db-builder')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'openAreaDbBuilder' });
});

function doFormat(): void {
  formatRules(editor, model);
}
initFormatMenu((m) => vscode.postMessage(m), doFormat);
initLintMenu((m) => vscode.postMessage(m));
initEditMenu(editor);

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
  if (dirty) { doSave(); }
});

// Ctrl+S on `document` (capture): Monaco's addCommand binding only takes effect with
// editor focus — with focus in the toolbar/reference panels the shortcut did
// nothing otherwise. stopPropagation prevents a double save via the Monaco binding.
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) { return; }
  if (e.key.toLowerCase() !== 's') { return; }
  e.preventDefault();
  e.stopPropagation();
  if (dirty) { doSave(); }
}, true);

// Ctrl+Shift+I — Rules formatieren (wie im Process-Editor).
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI, doFormat);

// Ctrl+/ (on a German keyboard Strg+Shift+7) as an explicit comment toggle.
// TM1 rules use '#' as the line comment prefix (see tm1rulesMonarch).
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash, () => {
  void editor.getAction('editor.action.commentLine')?.run();
});

// '#' key: with a multi-line selection → comment toggle; otherwise insert normally.
editor.getDomNode()?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key !== '#' || e.ctrlKey || e.metaKey || e.altKey) { return; }
  const sel = editor.getSelection();
  const spansMultipleLines = sel !== null && sel.startLineNumber !== sel.endLineNumber;
  if (!spansMultipleLines) { return; }
  e.preventDefault();
  e.stopPropagation();
  void editor.getAction('editor.action.commentLine')?.run();
}, true);

window.addEventListener('message', (ev: MessageEvent<HostToWebview | null | undefined>) => {
  const msg = ev.data;
  if (!msg || !msg.type) { return; }

  switch (msg.type) {
    case 'pasteText': {
      const text = msg.text ?? '';
      if (!text) { return; }
      const sel = editor.getSelection();
      if (!sel) { return; }
      editor.executeEdits('paste', [{
        range: sel,
        text,
        forceMoveMarkers: true,
      }]);
      editor.focus();
      break;
    }
    case 'insertText': {
      const text = msg.text ?? '';
      if (!text) { return; }
      editor.focus();
      if (msg.snippet) {
        (editor.getContribution('snippetController2') as { insert(t: string): void } | null)?.insert(text);
      } else {
        const sel = editor.getSelection();
        if (!sel) { return; }
        editor.executeEdits('tm1-insert', [{ range: sel, text, forceMoveMarkers: true }]);
      }
      break;
    }
    case 'revealLine': {
      if (typeof msg.line === 'number' && msg.line > 0) {
        switchTab('code');
        editor.revealLineInCenter(msg.line);
        editor.setPosition({ lineNumber: msg.line, column: 1 });
        editor.focus();
      }
      break;
    }
    case 'initData': {
      suppressChange = true;
      model.setValue(msg.rulesText ?? '');
      suppressChange = false;
      setDirty(false);
      const loading = document.getElementById('loading');
      if (loading) { loading.style.display = 'none'; }
      const main = document.getElementById('main-area');
      if (main) { main.style.display = 'flex'; }
      if (Array.isArray(msg.cubeDimensions)) {
        setCubeDimensions(msg.cubeDimensions);
      }
      if (Array.isArray(msg.lintDiags)) {
        receiveLintResults(msg.lintDiags as Parameters<typeof receiveLintResults>[0]);
      }
      clearReferences();
      requestAnimationFrame(() => editor.layout());
      break;
    }
    case 'formatConfig': {
      setFormatConfig(msg.config);
      renderFormatMenu((m) => vscode.postMessage(m), msg.config, doFormat);
      break;
    }
    case 'rulesLintConfig': {
      onRulesLintConfig(msg.config);
      break;
    }
    case 'lintResults': {
      receiveLintResults((msg.diagnostics ?? []) as Parameters<typeof receiveLintResults>[0]);
      break;
    }
    case 'compileResults': {
      receiveCompileResults((msg.diagnostics ?? []) as Parameters<typeof receiveCompileResults>[0]);
      break;
    }
    case 'clearCompileResults': {
      clearCompileResults();
      break;
    }
    case 'completions': {
      if (msg.context === 'dimensions') {
        receiveDimensions(msg.items);
      } else if (msg.context === 'cubes') {
        receiveCubes(msg.items);
      } else if (msg.context === 'cubesWithDims') {
        receiveCubesWithDims(msg.cubes);
      } else if (msg.context === 'attributes') {
        receiveAttributes(msg.dimension, msg.items);
      }
      break;
    }
    case 'saveSuccess': {
      setDirty(false);
      showSuccess();
      break;
    }
    case 'saveError': {
      showError(msg.message ?? L.unknownSaveError);
      break;
    }
    case 'saveCancelled':
      // Nothing to undo: saving sets no busy state here, the editor stays dirty.
      break;
    case 'qualifyResult': {
      setQualifyBusy(false);
      if (!msg.ok) {
        showError(fmt(L, 'elementQualifierFailed', msg.message ?? L.unknown));
        break;
      }
      const newText = msg.text;
      const warnings = msg.warnings;
      let changed = false;
      if (typeof newText === 'string' && newText !== model.getValue()) {
        // Deliberately not model.setValue: that clears Monaco's undo stack, so a
        // qualifier run could not be taken back with Ctrl+Z. The undo stops around
        // the edit keep the whole run as a single step. The change-listener then
        // sets the dirty flag and re-lints on its own, as for a typed edit.
        editor.pushUndoStop();
        editor.executeEdits('elementQualifier', [{
          range: model.getFullModelRange(),
          text: newText,
          forceMoveMarkers: true,
        }]);
        editor.pushUndoStop();
        changed = true;
      }
      if (warnings.length === 0) {
        showSuccess(changed ? L.qualifierDoneSave : L.qualifierNothing);
      } else {
        const lines = warnings.slice(0, 20).map(w =>
          fmt(L, 'qualifierWarningLine', w.line, w.entry, w.reason, w.detail ? ' (' + w.detail + ')' : ''),
        );
        const more = warnings.length > 20 ? '\n' + fmt(L, 'qualifierMore', warnings.length - 20) : '';
        showError(fmt(L, 'qualifierWarningsHeader', warnings.length) + '\n' + lines.join('\n') + more);
      }
      break;
    }
  }
});

vscode.postMessage({ type: 'monacoReady' });

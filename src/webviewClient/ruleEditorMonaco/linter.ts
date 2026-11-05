import type * as monacoType from 'monaco-editor';
import type { LintDiagnose, LintSeverity } from '../../tiLogicVisualizer/lintTypes';
import {
  severityToMarker as _pureSeverityToMarker,
  stripRuleIdPrefix,
  escapeHtml,
} from '../processEditorMonaco/linterPure';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

interface LinterBridge {
  getModel(): monacoType.editor.ITextModel;
  revealLine(line: number): void;
}

const state: {
  diagnostics: LintDiagnose[];
  // Server-side TM1 compile errors (from tm1.CheckRules). 0-based line numbers.
  // Persisted across re-lints; cleared on next clean save or on optimistic edit.
  compileDiagnostics: LintDiagnose[];
  monaco: typeof monacoType | null;
  bridge: LinterBridge | null;
  ownerKey: string;
} = {
  diagnostics: [],
  compileDiagnostics: [],
  monaco: null,
  bridge: null,
  ownerKey: 'rules-linter',
};

export function initLinter(monaco: typeof monacoType, bridge: LinterBridge): void {
  state.monaco = monaco;
  state.bridge = bridge;
  // Optimistic clear: drop compile markers near edited lines (also code-neighbours).
  const model = bridge.getModel();
  model.onDidChangeContent((e) => {
    if (state.compileDiagnostics.length === 0) { return; }
    const lineCount = model.getLineCount();
    const isCode = (n: number): boolean => {
      if (n < 1 || n > lineCount) { return false; }
      const text = model.getLineContent(n).trim();
      if (text === '') { return false; }
      if (text.startsWith('#')) { return false; }
      return true;
    };
    const touched = new Set<number>();
    const addWithCodeNeighbors = (n: number) => {
      if (n >= 1 && n <= lineCount) { touched.add(n); }
      for (let l = n - 1; l >= 1; l--) { touched.add(l); if (isCode(l)) { break; } }
      for (let l = n + 1; l <= lineCount; l++) { touched.add(l); if (isCode(l)) { break; } }
    };
    for (const ch of e.changes) {
      for (let l = ch.range.startLineNumber; l <= ch.range.endLineNumber; l++) {
        addWithCodeNeighbors(l);
      }
    }
    const before = state.compileDiagnostics.length;
    state.compileDiagnostics = state.compileDiagnostics.filter(d => !touched.has(d.line + 1));
    if (state.compileDiagnostics.length !== before) {
      updateMarkers();
      render();
    }
  });
  wireTable();
  render();
}

export function receiveLintResults(diagnostics: LintDiagnose[]): void {
  state.diagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  updateMarkers();
  render();
}

export function receiveCompileResults(diagnostics: LintDiagnose[]): void {
  state.compileDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  updateMarkers();
  render();
}

export function clearCompileResults(): void {
  receiveCompileResults([]);
}

function updateMarkers(): void {
  if (!state.monaco || !state.bridge) { return; }
  const model = state.bridge.getModel();
  const lineCount = model.getLineCount();
  const markers: monacoType.editor.IMarkerData[] = [];
  const allDiagnostics = [...state.diagnostics, ...state.compileDiagnostics];
  for (const d of allDiagnostics) {
    const line = Math.max(1, Math.min(lineCount, d.line + 1));
    const lineLen = model.getLineMaxColumn(line);
    markers.push({
      severity: severityToMarker(d.severity),
      message: stripRuleIdPrefix(d.message ?? ''),
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: lineLen,
      code: d.ruleId,
      source: 'Rules Linter',
    });
  }
  state.monaco.editor.setModelMarkers(model, state.ownerKey, markers);
}

function severityToMarker(sev: LintSeverity): monacoType.MarkerSeverity {
  return _pureSeverityToMarker(sev) as unknown as monacoType.MarkerSeverity;
}

type SeverityFilter = 'all' | 'error' | 'warning' | 'info' | 'hint';

/** Active severity selection of the findings list. Purely client-side, as in the process editor —
  *  the host always sends all findings, filtering happens only at display time. */
let severityFilter: SeverityFilter = 'all';

function setSeverityFilter(sev: SeverityFilter): void {
  // Clicking the active button again clears the selection.
  severityFilter = severityFilter === sev ? 'all' : sev;
  render();
}

function updateFilterButtons(items: { severity: string }[]): void {
  let errors = 0, warnings = 0, infos = 0, hints = 0;
  for (const i of items) {
    if (i.severity === 'error') { errors++; }
    else if (i.severity === 'warning') { warnings++; }
    else if (i.severity === 'info') { infos++; }
    else { hints++; }
  }
  const setBtn = (id: string, sev: SeverityFilter, count: number, label: string): void => {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (!el) { return; }
    el.textContent = count > 0 ? `${label} (${count})` : label;
    el.classList.toggle('active', severityFilter === sev);
    el.disabled = sev !== 'all' && count === 0;
  };
  setBtn('lint-filter-all', 'all', items.length, L.rlFilterAll);
  setBtn('lint-filter-error', 'error', errors, L.rlFilterErrors);
  setBtn('lint-filter-warning', 'warning', warnings, L.rlFilterWarnings);
  setBtn('lint-filter-info', 'info', infos, L.rlFilterInfos);
  setBtn('lint-filter-hint', 'hint', hints, L.rlFilterHints);
}

function wireFilterButtons(): void {
  const map: Array<[string, SeverityFilter]> = [
    ['lint-filter-all', 'all'],
    ['lint-filter-error', 'error'],
    ['lint-filter-warning', 'warning'],
    ['lint-filter-info', 'info'],
    ['lint-filter-hint', 'hint'],
  ];
  for (const [id, sev] of map) {
    document.getElementById(id)?.addEventListener('click', () => setSeverityFilter(sev));
  }
}

function render(): void {
  updateBadge();

  const host = document.getElementById('linter-table-host');
  const info = document.getElementById('linter-info');
  if (!host) { return; }

  const filterEl = document.getElementById('linter-filter') as HTMLInputElement | null;
  const needle = (filterEl?.value ?? '').trim().toLowerCase();

  const items = state.diagnostics.slice().sort((a, b) => a.line - b.line);
  updateFilterButtons(items);

  const bySeverity = severityFilter === 'all'
    ? items
    : items.filter(d => d.severity === severityFilter);
  const rows = needle
    ? bySeverity.filter(d => {
        if (d.severity.toLowerCase().includes(needle)) { return true; }
        if (stripRuleIdPrefix(d.message ?? '').toLowerCase().includes(needle)) { return true; }
        if (String(d.line + 1).includes(needle)) { return true; }
        if (d.ruleId.toLowerCase().includes(needle)) { return true; }
        return false;
      })
    : bySeverity;

  if (items.length === 0) {
    host.innerHTML = '<div class="linter-empty">' + escapeHtml(L.noProblemsFound) + '</div>';
    if (info) { info.textContent = fmt(L, 'problemsCount', 0); }
    return;
  }
  if (rows.length === 0) {
    host.innerHTML = '<div class="linter-empty">' + escapeHtml(L.noFilterMatch) + '</div>';
    if (info) { info.textContent = fmt(L, 'problemsFilteredCount', 0, items.length); }
    return;
  }
  const filtered = needle !== '' || severityFilter !== 'all';

  let html = '<table class="linter-table"><thead><tr>';
  html += '<th class="lt-line">' + escapeHtml(L.colLine) + '</th><th class="lt-sev">' + escapeHtml(L.colSev) + '</th><th class="lt-rule">' + escapeHtml(L.colRule) + '</th><th class="lt-msg">' + escapeHtml(L.colMessage) + '</th>';
  html += '</tr></thead><tbody>';
  for (const d of rows) {
    const msg = stripRuleIdPrefix(d.message ?? '');
    html += '<tr data-line="' + (d.line + 1) + '" title="' + escapeHtml(L.jumpToLine) + '">';
    html += '<td class="lt-line">' + (d.line + 1) + '</td>';
    html += '<td class="lt-sev"><span class="lt-sev-badge ' + d.severity + '">' + d.severity + '</span></td>';
    html += '<td class="lt-rule">' + escapeHtml(d.ruleId) + '</td>';
    html += '<td class="lt-msg">' + escapeHtml(msg) + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
  if (info) {
    info.textContent = filtered
      ? fmt(L, 'problemsFilteredCount', rows.length, items.length)
      : fmt(L, 'problemsCount', items.length);
  }
}

function updateBadge(): void {
  const items = state.diagnostics;
  let errors = 0, warnings = 0, hints = 0;
  for (const i of items) {
    if (i.severity === 'error') { errors++; }
    else if (i.severity === 'warning') { warnings++; }
    else { hints++; }
  }
  const setBadge = (id: string, n: number) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = n > 0 ? String(n) : ''; }
  };
  setBadge('linter-errors', errors);
  setBadge('linter-warnings', warnings);
  setBadge('linter-hints', hints);
}

function wireTable(): void {
  const host = document.getElementById('linter-table-host');
  if (host) {
    host.addEventListener('click', (ev) => {
      const tr = (ev.target as HTMLElement | null)?.closest('tr');
      if (!tr) { return; }
      const line = parseInt(tr.getAttribute('data-line') ?? '', 10);
      if (!Number.isFinite(line) || !state.bridge) { return; }
      state.bridge.revealLine(line);
    });
  }
  const filterEl = document.getElementById('linter-filter') as HTMLInputElement | null;
  if (filterEl) { filterEl.addEventListener('input', render); }
  wireFilterButtons();
}

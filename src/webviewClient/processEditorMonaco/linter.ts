import type * as monacoType from 'monaco-editor';
import type { LintDiagnose, LintSeverity } from '../../tiLogicVisualizer/lintTypes';
import {
  SECTION_ORDER,
  stripRuleIdPrefix,
  escapeHtml,
  severityToMarker as _pureSeverityToMarker,
  flattenDiagnostics,
  applySeverityFilter,
  mergedSection,
  type SectionKey,
  type SeverityFilter,
  type FlatItem,
} from './linterPure';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

interface LinterBridge {
  /** Returns the Monaco text model backing the given section. */
  getModel(section: SectionKey): monacoType.editor.ITextModel;
  /** Switch UI to the given section and reveal a 1-based line number. */
  revealSectionLine(section: SectionKey, line: number): void;
}

const state: {
  // Main diagnostics from sync parse + AST lint (replaces on every push).
  mainDiagnostics: Record<SectionKey, LintDiagnose[]>;
  // Async server-side diagnostics (cube/dim existence). Kept separately so
  // a flood of server warnings does not wipe parse errors and AST diagnostics.
  serverDiagnostics: Record<SectionKey, LintDiagnose[]>;
  // Server-side TM1 compile errors (from tm1.Compile after save attempt).
  // Kept separately so a re-lint does not wipe these and they persist until
  // the user successfully saves.
  compileDiagnostics: Record<SectionKey, LintDiagnose[]>;
  severityFilter: SeverityFilter;
  monaco: typeof monacoType | null;
  bridge: LinterBridge | null;
  ownerKey: string;
} = {
  mainDiagnostics: { prolog: [], metadata: [], data: [], epilog: [] },
  serverDiagnostics: { prolog: [], metadata: [], data: [], epilog: [] },
  compileDiagnostics: { prolog: [], metadata: [], data: [], epilog: [] },
  severityFilter: 'all',
  monaco: null,
  bridge: null,
  ownerKey: 'ti-linter',
};

function mergedFor(section: SectionKey): LintDiagnose[] {
  return mergedSection(section, state.mainDiagnostics, state.serverDiagnostics, state.compileDiagnostics);
}

function _allMerged(): Record<SectionKey, LintDiagnose[]> {
  const out: Record<SectionKey, LintDiagnose[]> = {
    prolog: [], metadata: [], data: [], epilog: [],
  };
  for (const s of SECTION_ORDER) { out[s] = mergedFor(s); }
  return out;
}

/**
 * The diagnostic behind a marker Monaco hands to a code action. Markers move
 * with edits, the diagnostics here do not until the next lint — so match on
 * rule and text (which names the variable/operator), not on the line.
 */
export function diagnosticForMarker(
  model: monacoType.editor.ITextModel, marker: monacoType.editor.IMarkerData,
): { diagnostic: LintDiagnose; section: SectionKey; models: Record<SectionKey, monacoType.editor.ITextModel> } | undefined {
  if (!state.bridge || marker.source !== 'TI Linter') { return undefined; }
  const bridge = state.bridge;
  const section = SECTION_ORDER.find(s => bridge.getModel(s) === model);
  if (!section) { return undefined; }
  const diagnostic = mergedFor(section).find(d => d.ruleId === marker.code && stripRuleIdPrefix(d.message ?? '') === marker.message);
  if (!diagnostic) { return undefined; }
  const models = Object.fromEntries(SECTION_ORDER.map(s => [s, bridge.getModel(s)])) as Record<SectionKey, monacoType.editor.ITextModel>;
  return { diagnostic, section, models };
}

export function initLinter(monaco: typeof monacoType, bridge: LinterBridge): void {
  state.monaco = monaco;
  state.bridge = bridge;
  // Drop compile-error markers on lines the user just edited so they vanish
  // optimistically. If the issue is still present, the next save re-pushes them.
  for (const section of SECTION_ORDER) {
    const model = bridge.getModel(section);
    model.onDidChangeContent((e) => {
      if (state.compileDiagnostics[section].length === 0) { return; }
      // Drop compile markers near the edited region. TM1 often points the error
      // at the line above the actual mistake (missing semicolon detected only
      // when the next statement starts). We also extend to the next non-empty
      // code line above and below, in case the user is editing within a
      // whitespace/comment region.
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
        // walk up until first code line
        for (let l = n - 1; l >= 1; l--) {
          touched.add(l);
          if (isCode(l)) { break; }
        }
        // walk down until first code line
        for (let l = n + 1; l <= lineCount; l++) {
          touched.add(l);
          if (isCode(l)) { break; }
        }
      };
      for (const ch of e.changes) {
        for (let l = ch.range.startLineNumber; l <= ch.range.endLineNumber; l++) {
          addWithCodeNeighbors(l);
        }
      }
      const before = state.compileDiagnostics[section].length;
      state.compileDiagnostics[section] = state.compileDiagnostics[section]
        .filter(d => !touched.has(d.line));
      if (state.compileDiagnostics[section].length !== before) {
        updateMarkers(section);
        render();
      }
    });
  }
  wireTable();
  wireFilterButtons();
  wireTabBadgeFilters();
  render();
}

/**
 * Set the severity filter. Pass 'all' to clear the filter. Re-renders the table.
 * If the filter equals the current filter, it toggles back to 'all'.
 */
export function setSeverityFilter(filter: SeverityFilter): void {
  state.severityFilter = state.severityFilter === filter && filter !== 'all' ? 'all' : filter;
  render();
}

export function getErrorCount(): number {
  let n = 0;
  for (const s of SECTION_ORDER) {
    for (const d of mergedFor(s)) {
      if (d.severity === 'error') { n++; }
    }
  }
  return n;
}

export function receiveLintResults(section: string, diagnostics: LintDiagnose[]): void {
  const key = (section || '').toLowerCase() as SectionKey;
  if (!SECTION_ORDER.includes(key)) { return; }
  state.mainDiagnostics[key] = Array.isArray(diagnostics) ? diagnostics : [];
  updateMarkers(key);
  render();
}

export function receiveServerLintResults(section: string, diagnostics: LintDiagnose[]): void {
  const key = (section || '').toLowerCase() as SectionKey;
  if (!SECTION_ORDER.includes(key)) { return; }
  state.serverDiagnostics[key] = Array.isArray(diagnostics) ? diagnostics : [];
  updateMarkers(key);
  render();
}

/**
 * Replace compile-error diagnostics with the given map. Sections not present
 * in the map are cleared. Pass an empty object to clear all compile errors.
 */
export function receiveCompileResults(errorsBySection: Partial<Record<SectionKey, LintDiagnose[]>>): void {
  for (const key of SECTION_ORDER) {
    state.compileDiagnostics[key] = errorsBySection[key] ?? [];
    updateMarkers(key);
  }
  render();
}

export function clearCompileResults(): void {
  receiveCompileResults({});
}

function updateMarkers(section: SectionKey): void {
  if (!state.monaco || !state.bridge) { return; }
  const model = state.bridge.getModel(section);
  const lineCount = model.getLineCount();
  const markers: monacoType.editor.IMarkerData[] = [];
  for (const d of mergedFor(section)) {
    const line = Math.max(1, Math.min(lineCount, d.line));
    const lineLen = model.getLineMaxColumn(line);
    markers.push({
      severity: severityToMarker(state.monaco, d.severity),
      message: stripRuleIdPrefix(d.message ?? ''),
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: lineLen,
      code: d.ruleId,
      source: 'TI Linter',
    });
  }
  state.monaco.editor.setModelMarkers(model, state.ownerKey, markers);
}

function severityToMarker(_monaco: typeof monacoType, sev: LintSeverity): monacoType.MarkerSeverity {
  // Double-cast intentional: _pureSeverityToMarker returns numeric literals
  // (1/2/4/8) so the pure module avoids importing monaco at runtime. The cast
  // bridges back into the MarkerSeverity enum type at the boundary.
  return _pureSeverityToMarker(sev) as unknown as monacoType.MarkerSeverity;
}

function flatten(): FlatItem[] {
  return flattenDiagnostics(_allMerged());
}

function applyFilter(items: FlatItem[]): FlatItem[] {
  return applySeverityFilter(items, state.severityFilter);
}

function render(): void {
  const all = flatten();
  updateBadge(all);
  updateFilterButtons(all);

  const items = applyFilter(all);
  const host = document.getElementById('linter-table-host');
  const info = document.getElementById('linter-info');
  if (!host) { return; }

  const filterLabel = state.severityFilter === 'all'
    ? ''
    : fmt(L, 'lintFilterLabel', state.severityFilter);

  if (items.length === 0) {
    if (all.length === 0) {
      host.innerHTML = '<div class="linter-empty">' + L.lintNoProblems + '</div>';
      if (info) { info.textContent = fmt(L, 'lintCountProblems', 0); }
    } else {
      host.innerHTML = '<div class="linter-empty">' + L.lintNoFilterMatch + '</div>';
      if (info) { info.textContent = fmt(L, 'lintCountFiltered', 0, all.length) + filterLabel; }
    }
    return;
  }

  let html = '<table class="linter-table"><thead><tr>';
  html += '<th class="lt-section">Section</th><th class="lt-line">' + L.lintHdrLine + '</th><th class="lt-sev">Sev</th><th class="lt-rule">' + L.lintHdrRule + '</th><th class="lt-msg">' + L.lintHdrMessage + '</th>';
  html += '</tr></thead><tbody>';
  for (const r of items) {
    html += '<tr data-section="' + r.section + '" data-line="' + r.line + '" title="' + L.lintJumpToLine + '">';
    html += '<td class="lt-section">' + escapeHtml(r.sectionLabel) + '</td>';
    html += '<td class="lt-line">' + r.line + '</td>';
    html += '<td class="lt-sev"><span class="lt-sev-badge ' + r.severity + '">' + r.severity + '</span></td>';
    html += '<td class="lt-rule">' + escapeHtml(r.ruleId) + '</td>';
    html += '<td class="lt-msg">' + escapeHtml(r.message) + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
  if (info) {
    info.textContent = state.severityFilter === 'all'
      ? fmt(L, 'lintCountProblems', items.length)
      : fmt(L, 'lintCountFiltered', items.length, all.length) + filterLabel;
  }
}

function updateBadge(items: FlatItem[]): void {
  let errors = 0, warnings = 0, infos = 0, hints = 0;
  for (const i of items) {
    if (i.severity === 'error') { errors++; }
    else if (i.severity === 'warning') { warnings++; }
    else if (i.severity === 'info') { infos++; }
    else { hints++; }
  }
  const setBadge = (id: string, n: number, sev: SeverityFilter) => {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.textContent = n > 0 ? String(n) : '';
    el.classList.toggle('filter-active', state.severityFilter === sev);
  };
  setBadge('linter-errors', errors, 'error');
  setBadge('linter-warnings', warnings, 'warning');
  setBadge('linter-infos', infos, 'info');
  setBadge('linter-hints', hints, 'hint');
}

function updateFilterButtons(items: FlatItem[]): void {
  let errors = 0, warnings = 0, infos = 0, hints = 0;
  for (const i of items) {
    if (i.severity === 'error') { errors++; }
    else if (i.severity === 'warning') { warnings++; }
    else if (i.severity === 'info') { infos++; }
    else { hints++; }
  }
  const setBtn = (id: string, sev: SeverityFilter, count: number, label: string) => {
    const el = document.getElementById(id);
    if (!el) { return; }
    el.textContent = count > 0 ? `${label} (${count})` : label;
    el.classList.toggle('active', state.severityFilter === sev);
    (el as HTMLButtonElement).disabled = sev !== 'all' && count === 0;
  };
  setBtn('lint-filter-all', 'all', items.length, L.lintFilterAll);
  setBtn('lint-filter-error', 'error', errors, 'Errors');
  setBtn('lint-filter-warning', 'warning', warnings, 'Warnings');
  setBtn('lint-filter-info', 'info', infos, 'Infos');
  setBtn('lint-filter-hint', 'hint', hints, 'Hints');
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
    const el = document.getElementById(id);
    if (!el) { continue; }
    el.addEventListener('click', () => setSeverityFilter(sev));
  }
}

function wireTabBadgeFilters(): void {
  const map: Array<[string, SeverityFilter]> = [
    ['linter-errors', 'error'],
    ['linter-warnings', 'warning'],
    ['linter-infos', 'info'],
    ['linter-hints', 'hint'],
  ];
  for (const [id, sev] of map) {
    const el = document.getElementById(id);
    if (!el) { continue; }
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      // Switch to linter tab manually since stopPropagation kills the parent tab handler.
      document.querySelectorAll<HTMLElement>('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === 'linter' && !t.dataset.section);
      });
      document.querySelectorAll<HTMLElement>('.panel').forEach(p => {
        p.classList.toggle('active', p.id === 'panel-linter');
      });
      setSeverityFilter(sev);
    });
  }
}

function wireTable(): void {
  const host = document.getElementById('linter-table-host');
  if (!host) { return; }
  host.addEventListener('click', (ev) => {
    const tr = (ev.target as HTMLElement | null)?.closest('tr');
    if (!tr) { return; }
    const section = tr.getAttribute('data-section') as SectionKey | null;
    const line = parseInt(tr.getAttribute('data-line') ?? '', 10);
    if (!section || !Number.isFinite(line) || !state.bridge) { return; }
    state.bridge.revealSectionLine(section, line);
  });
}

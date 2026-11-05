/**
 * References tab of the process and rule editor: double-click a word in the
 * editor, every occurrence (outside strings and `#`-comments) is highlighted
 * and listed; a row click jumps to the line.
 *
 * The two editors differ on purpose and pass that in:
 * - process: four models (Prolog/Metadata/Data/Epilog), a Section column;
 * - rules: one model, and `!DimElem` references (`bangRefs`).
 * Texts come pre-rendered from the caller because the two editors use
 * different l10n keys.
 */
import type * as monacoType from 'monaco-editor';
import { escapeHtml } from '../htmlUtils';
import { escapeRegex } from '../../utils/escapeRegexPure';
import { buildTiSkipMask } from './tiSkipMask';

export interface RefSource {
  key: string;
  label: string;
  model: monacoType.editor.ITextModel;
}

/** HTML strings are inserted as-is — escape at the caller where needed. */
export interface ReferencesText {
  hintHtml: string;
  noneHtml: string;
  noFilterMatchHtml: string;
  colLineHtml: string;
  colContextHtml: string;
  jumpToLineHtml: string;
  wordLabelHtml(strongHtml: string): string;
  count(n: number): string;
  filtered(n: number, total: number): string;
}

export interface ReferencesConfig {
  editor: monacoType.editor.IStandaloneCodeEditor;
  sources(): RefSource[];
  reveal(key: string, line: number): void;
  /** Header of the Section column; omit for single-model editors. */
  sectionHeaderHtml?: string;
  /**
   * Rules: a word double-clicked right after `!` searches `!Word` (a DimElem
   * reference), and a plain-word search skips `!`-prefixed hits.
   */
  bangRefs?: boolean;
  text: ReferencesText;
}

interface RefItem {
  key: string;
  label: string;
  line: number;
  ctxHtml: string;
  ctxText: string;
}

const state: {
  monaco: typeof monacoType | null;
  cfg: ReferencesConfig | null;
  /** Raw active word; begins with `!` when the user double-clicked a !DimElem. */
  activeWord: string | null;
  items: RefItem[];
  decorations: Map<string, string[]>;
  filter: string;
} = {
  monaco: null,
  cfg: null,
  activeWord: null,
  items: [],
  decorations: new Map(),
  filter: '',
};

export function initReferences(monaco: typeof monacoType, cfg: ReferencesConfig): void {
  state.monaco = monaco;
  state.cfg = cfg;
  wireEvents();
  render();
}

/** Re-run the scan against the current model contents — call when code changes or parameters are updated. */
export function refreshReferences(): void {
  if (!state.activeWord) { return; }
  recompute();
  render();
}

export function clearReferences(): void {
  state.activeWord = null;
  state.items = [];
  removeDecorations();
  render();
}

function setActiveRefWord(rawWord: string, hasBangPrefix: boolean): void {
  const m = rawWord.match(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!m) { return; }
  state.activeWord = hasBangPrefix ? '!' + m[0] : m[0];
  recompute();
  render();
}

function removeDecorations(): void {
  if (!state.cfg) { return; }
  for (const src of state.cfg.sources()) {
    state.decorations.set(src.key, src.model.deltaDecorations(state.decorations.get(src.key) ?? [], []));
  }
}

function recompute(): void {
  if (!state.monaco || !state.cfg || !state.activeWord) { return; }
  const word = state.activeWord;
  const isDimElem = word.startsWith('!');
  // For !DimElem: match !\bname\b; for plain: \bname\b skipping inside strings/comments(/!prefix for rules).
  const re = isDimElem
    ? new RegExp(escapeRegex(word) + '\\b', 'gi')
    : new RegExp('\\b' + escapeRegex(word) + '\\b', 'gi');
  const skipBang = !isDimElem && state.cfg.bangRefs === true;
  const items: RefItem[] = [];

  for (const src of state.cfg.sources()) {
    const model = src.model;
    const lineCount = model.getLineCount();
    const decos: monacoType.editor.IModelDeltaDecoration[] = [];
    for (let line = 1; line <= lineCount; line++) {
      const text = model.getLineContent(line);
      const mask = buildTiSkipMask(text);
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      let lineHasMatch = false;
      let ctxHtml = '';
      let ctxLast = 0;
      while ((match = re.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const skip = mask[start] || (skipBang && start > 0 && text[start - 1] === '!');
        ctxHtml += escapeHtml(text.substring(ctxLast, start));
        if (skip) {
          ctxHtml += escapeHtml(match[0]);
        } else {
          ctxHtml += '<mark>' + escapeHtml(match[0]) + '</mark>';
          lineHasMatch = true;
          decos.push({
            range: new state.monaco.Range(line, start + 1, line, end + 1),
            options: { inlineClassName: 'hl-ref-active' },
          });
        }
        ctxLast = end;
      }
      if (lineHasMatch) {
        ctxHtml += escapeHtml(text.substring(ctxLast));
        items.push({ key: src.key, label: src.label, line, ctxHtml, ctxText: text });
      }
    }
    state.decorations.set(src.key, model.deltaDecorations(state.decorations.get(src.key) ?? [], decos));
  }
  state.items = items;
}

function render(): void {
  updateBadge();
  updateWordInfo();
  const host = document.getElementById('ref-table-host');
  const info = document.getElementById('ref-info');
  if (!host || !state.cfg) { return; }
  const T = state.cfg.text;
  const sectionHeader = state.cfg.sectionHeaderHtml;

  if (!state.activeWord) {
    host.innerHTML = '<div class="linter-empty">' + T.hintHtml + '</div>';
    if (info) { info.textContent = ''; }
    return;
  }

  const needle = state.filter.trim().toLowerCase();
  const rows = state.items.filter(r => {
    if (!needle) { return true; }
    if (sectionHeader !== undefined && r.label.toLowerCase().includes(needle)) { return true; }
    if (String(r.line).includes(needle)) { return true; }
    if (r.ctxText.toLowerCase().includes(needle)) { return true; }
    return false;
  });

  if (state.items.length === 0) {
    host.innerHTML = '<div class="linter-empty">' + T.noneHtml + '</div>';
    if (info) { info.textContent = T.count(0); }
    return;
  }
  if (rows.length === 0) {
    host.innerHTML = '<div class="linter-empty">' + T.noFilterMatchHtml + '</div>';
    if (info) { info.textContent = T.filtered(0, state.items.length); }
    return;
  }

  let html = '<table class="linter-table ref-table"><thead><tr>';
  if (sectionHeader !== undefined) { html += '<th class="lt-section">' + sectionHeader + '</th>'; }
  html += '<th class="lt-line">' + T.colLineHtml + '</th><th class="rft-ctx">' + T.colContextHtml + '</th>';
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    const sectionAttr = sectionHeader !== undefined ? ' data-section="' + escapeHtml(r.key) + '"' : '';
    html += '<tr' + sectionAttr + ' data-line="' + r.line + '" title="' + T.jumpToLineHtml + '">';
    if (sectionHeader !== undefined) { html += '<td class="lt-section">' + escapeHtml(r.label) + '</td>'; }
    html += '<td class="lt-line">' + r.line + '</td>';
    html += '<td class="rft-ctx">' + r.ctxHtml + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
  if (info) {
    info.textContent = needle
      ? T.filtered(rows.length, state.items.length)
      : T.count(state.items.length);
  }
}

function updateBadge(): void {
  const badge = document.getElementById('ref-badge');
  if (!badge) { return; }
  badge.textContent = state.activeWord && state.items.length > 0 ? String(state.items.length) : '';
  badge.className = 'tab-badge';
}

function updateWordInfo(): void {
  const wi = document.getElementById('ref-word-info');
  if (!wi || !state.cfg) { return; }
  wi.innerHTML = state.activeWord
    ? state.cfg.text.wordLabelHtml('<strong>' + escapeHtml(state.activeWord) + '</strong>')
    : '';
}

function wireEvents(): void {
  if (!state.cfg) { return; }
  const { editor, bangRefs } = state.cfg;

  const container = document.getElementById('monaco-editor-mount');
  container?.addEventListener('dblclick', () => {
    const pos = editor.getPosition();
    if (!pos) { return; }
    const model = editor.getModel();
    if (!model) { return; }
    const wordInfo = model.getWordAtPosition(pos);
    if (!wordInfo) { return; }
    const text = model.getLineContent(pos.lineNumber);
    const mask = buildTiSkipMask(text);
    // startColumn is 1-based, mask is 0-based
    if (mask[wordInfo.startColumn - 1]) { return; }
    const hasBang = bangRefs === true && wordInfo.startColumn > 1 && text[wordInfo.startColumn - 2] === '!';
    setActiveRefWord(wordInfo.word, hasBang);
  });

  const filterEl = document.getElementById('ref-filter') as HTMLInputElement | null;
  filterEl?.addEventListener('input', () => {
    state.filter = filterEl.value || '';
    render();
  });

  const clearBtn = document.getElementById('ref-clear');
  clearBtn?.addEventListener('click', () => clearReferences());

  const host = document.getElementById('ref-table-host');
  host?.addEventListener('click', (ev) => {
    const tr = (ev.target as HTMLElement | null)?.closest('tr');
    if (!tr || !state.cfg) { return; }
    const line = parseInt(tr.getAttribute('data-line') ?? '', 10);
    if (!Number.isFinite(line)) { return; }
    // Single-model editors carry no data-section: jump within the only source.
    const key = tr.getAttribute('data-section') ?? state.cfg.sources()[0]?.key;
    if (!key) { return; }
    state.cfg.reveal(key, line);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeWord) { clearReferences(); }
  }, true);
}

// src/webviewClient/_shared/findOverlay.ts
// Generic in-editor find/replace overlay with a navigable match list. Works over
// N "sources" (Monaco text models): the process editor passes its 4 sections
// (Prolog/Metadata/Data/Epilog), the rule editor passes a single model. All
// sources share ONE Monaco editor instance; `host.activate(key)` swaps the
// active model to a source before revealing a match (a no-op for single-source
// editors). DOM element ids are fixed (`xfind*`) — each webview owns its own
// document, so both can use the same ids.
//
// Extracted from `processEditorMonaco/crossSectionFind.ts` so the rule editor
// gains the same match-list Ctrl+F. Pure snippet building lives in `findSnippet`.
import type * as monacoNS from 'monaco-editor';
import { getL10n, fmt } from './l10n';
import { buildSnippet } from './findSnippet';
import { pickInitialMatchIdx, matchIdxAtSelection } from './findPick';

const L = getL10n();

/**
 * Wait time before a typed input is searched.
 *
 * Without it the search started at the FIRST letter and yanked the editor to
 * the first hit for "E" — you kept typing and were long since somewhere else.
 * Long enough that a quickly typed word triggers ONE search; short enough that
 * it does not feel like waiting.
 */
const FIND_INPUT_DEBOUNCE_MS = 400;

/** One searchable model plus its display label (shown as a badge when >1 source). */
export interface FindSource {
  key: string;
  label: string;
  model: monacoNS.editor.ITextModel;
}

export interface FindOverlayHost {
  /** Ordered list of models to search; called fresh per operation. */
  getSources: () => FindSource[];
  /** The single shared editor instance all sources render into. */
  getEditor: () => monacoNS.editor.IStandaloneCodeEditor;
  /** Make `key`'s source the active model before a match is revealed. No-op for single-source. */
  activate: (key: string) => void;
}

interface Match {
  sourceKey: string;
  lineNumber: number;
  column: number;
  length: number;
}

export function initFindOverlay(monaco: typeof monacoNS, host: FindOverlayHost): void {
  const bar         = document.getElementById('xfind') as HTMLElement | null;
  const input       = document.getElementById('xfind-input') as HTMLInputElement | null;
  const replaceInp  = document.getElementById('xfind-replace') as HTMLInputElement | null;
  const count       = document.getElementById('xfind-count') as HTMLElement | null;
  const prevBtn     = document.getElementById('xfind-prev') as HTMLButtonElement | null;
  const nextBtn     = document.getElementById('xfind-next') as HTMLButtonElement | null;
  const caseBtn     = document.getElementById('xfind-case') as HTMLButtonElement | null;
  const closeBtn    = document.getElementById('xfind-close') as HTMLButtonElement | null;
  const toggleBtn   = document.getElementById('xfind-toggle') as HTMLButtonElement | null;
  const replOneBtn  = document.getElementById('xfind-replace-one') as HTMLButtonElement | null;
  const replAllBtn  = document.getElementById('xfind-replace-all') as HTMLButtonElement | null;
  const resultsEl   = document.getElementById('xfind-results') as HTMLElement | null;
  if (!bar || !input || !replaceInp || !count || !prevBtn || !nextBtn || !caseBtn || !closeBtn
      || !toggleBtn || !replOneBtn || !replAllBtn) { return; }

  let matches: Match[] = [];
  let currentIdx = -1;
  let caseSensitive = false;

  function sourceMap(): Map<string, FindSource> {
    const m = new Map<string, FindSource>();
    for (const s of host.getSources()) { m.set(s.key, s); }
    return m;
  }
  function isMultiSource(): boolean {
    return host.getSources().length > 1;
  }
  function labelOf(key: string): string {
    return sourceMap().get(key)?.label ?? '';
  }

  /**
   * The key of the source currently in the editor — or `null` if none can be
   * assigned.
   *
   * Determined via the MODEL IDENTITY and not via an additional field in the
   * host contract: all sources share one editor, the attached model IS the
   * active source. A carried-along marker could deviate from it.
   */
  function activeSourceKey(): string | null {
    const model = host.getEditor().getModel();
    if (!model) { return null; }
    for (const src of host.getSources()) {
      if (src.model === model) { return src.key; }
    }
    return null;
  }

  /**
   * Collect hits. `reveal: false` leaves the editor where it is — that is what
   * opening over a selection needs, which would otherwise jump away.
   */
  function runSearch(opts?: { reveal?: boolean }): void {
    const reveal = opts?.reveal !== false;
    const term = input!.value;
    matches = [];
    currentIdx = -1;
    if (!term) { updateCountDisplay(); renderResults(); return; }

    for (const src of host.getSources()) {
      const hits = src.model.findMatches(term, false, false, caseSensitive, null, false);
      for (const hit of hits) {
        matches.push({
          sourceKey: src.key,
          lineNumber: hit.range.startLineNumber,
          column: hit.range.startColumn,
          length: hit.range.endColumn - hit.range.startColumn,
        });
      }
    }
    // NOT blindly hit 0: that is the first hit of the FIRST source, so usually
    // a different tab than the one currently being worked in.
    currentIdx = pickInitialMatchIdx(matches, activeSourceKey());
    updateCountDisplay();
    renderResults();
    if (reveal && currentIdx >= 0) { revealMatch(currentIdx); }
  }

  let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function runSearchDebounced(): void {
    if (_debounceTimer !== null) { clearTimeout(_debounceTimer); }
    _debounceTimer = setTimeout(function () {
      _debounceTimer = null;
      runSearch();
    }, FIND_INPUT_DEBOUNCE_MS);
  }

  /**
   * Run a still-pending search immediately.
   *
   * Whoever types and immediately presses Enter is faster than the wait time.
   * Without this, "next" would run against the hit list of the previous search
   * term — and the trailing timer would then reset the selection again.
   */
  function flushPendingSearch(): boolean {
    if (_debounceTimer === null) { return false; }
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    runSearch();
    return true;
  }

  // After a flush the selection already sits on the first hit of the active
  // tab — "next" would then be a skip. Whoever types and immediately presses
  // Enter wants to see the FIRST hit, not the second.
  function nextOrFlush(): void { if (!flushPendingSearch()) { next(); } }
  function prevOrFlush(): void { if (!flushPendingSearch()) { prev(); } }

  function updateCountDisplay(): void {
    if (matches.length === 0) {
      count!.textContent = input!.value ? L.xfindNoMatch : '0 / 0';
      prevBtn!.disabled = true;
      nextBtn!.disabled = true;
      replOneBtn!.disabled = true;
      replAllBtn!.disabled = !input!.value;
      return;
    }
    const cur = matches[currentIdx];
    const suffix = cur && isMultiSource() ? ` · ${labelOf(cur.sourceKey)}` : '';
    count!.textContent = `${currentIdx + 1} / ${matches.length}${suffix}`;
    prevBtn!.disabled = false;
    nextBtn!.disabled = false;
    replOneBtn!.disabled = false;
    replAllBtn!.disabled = false;
  }

  function revealMatch(idx: number): void {
    if (idx < 0 || idx >= matches.length) { return; }
    const m = matches[idx];
    host.activate(m.sourceKey);
    const editor = host.getEditor();
    const range = new monaco.Range(m.lineNumber, m.column, m.lineNumber, m.column + m.length);
    editor.setSelection(range);
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    updateCountDisplay();
    highlightActiveRow(idx);
  }

  function renderResults(): void {
    if (!resultsEl) { return; }
    resultsEl.textContent = '';
    if (matches.length === 0) {
      resultsEl.classList.remove('has-results');
      return;
    }
    resultsEl.classList.add('has-results');
    const srcMap = sourceMap();
    const multi = isMultiSource();
    matches.forEach((m, idx) => {
      const src = srcMap.get(m.sourceKey);
      const line = src ? src.model.getLineContent(m.lineNumber) : '';
      const parts = buildSnippet(line, m.column, m.length);

      const row = document.createElement('div');
      row.className = 'xfr-row';
      row.setAttribute('role', 'option');
      row.dataset.idx = String(idx);

      if (multi) {
        const badge = document.createElement('span');
        badge.className = 'xfr-badge';
        badge.textContent = src ? src.label : '';
        row.appendChild(badge);
      }

      const ln = document.createElement('span');
      ln.className = 'xfr-ln';
      ln.textContent = String(m.lineNumber);
      row.appendChild(ln);

      const snip = document.createElement('span');
      snip.className = 'xfr-snip';
      snip.title = line;
      if (parts.truncatedLeft) { snip.appendChild(document.createTextNode('…')); }
      snip.appendChild(document.createTextNode(parts.before));
      const hit = document.createElement('span');
      hit.className = 'xfr-match';
      hit.textContent = parts.match;
      snip.appendChild(hit);
      snip.appendChild(document.createTextNode(parts.after));
      if (parts.truncatedRight) { snip.appendChild(document.createTextNode('…')); }
      row.appendChild(snip);

      row.addEventListener('click', () => {
        currentIdx = idx;
        revealMatch(idx);
      });
      resultsEl.appendChild(row);
    });
    highlightActiveRow(currentIdx);
  }

  function highlightActiveRow(idx: number): void {
    if (!resultsEl) { return; }
    const rows = resultsEl.children;
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i] as HTMLElement;
      const active = el.dataset.idx === String(idx);
      el.classList.toggle('active', active);
      if (active) { el.scrollIntoView({ block: 'nearest' }); }
    }
  }

  function next(): void {
    if (matches.length === 0) { return; }
    currentIdx = (currentIdx + 1) % matches.length;
    revealMatch(currentIdx);
  }

  function prev(): void {
    if (matches.length === 0) { return; }
    currentIdx = (currentIdx - 1 + matches.length) % matches.length;
    revealMatch(currentIdx);
  }

  function replaceOne(): void {
    if (matches.length === 0 || currentIdx < 0) { return; }
    const m = matches[currentIdx];
    const src = sourceMap().get(m.sourceKey);
    if (!src) { runSearch(); return; }
    const model = src.model;
    const range = new monaco.Range(m.lineNumber, m.column, m.lineNumber, m.column + m.length);
    // Guard against a stale match range. `matches` is a snapshot from the last
    // runSearch(); the editor can be edited afterwards (typing, paste) which
    // shifts text under a stored range. Writing blindly would replace whatever
    // now sits there, not the search term. Verify the slice first — plain-text
    // search means the range length equals the term length — and on mismatch
    // refresh the list against the current models instead of corrupting content.
    const term = input!.value;
    const atRange = model.getValueInRange(range);
    const stillMatches = caseSensitive ? atRange === term : atRange.toLowerCase() === term.toLowerCase();
    if (!stillMatches) { runSearch(); return; }
    const replaceText = replaceInp!.value;
    model.pushEditOperations(
      [],
      [{ range, text: replaceText, forceMoveMarkers: true }],
      () => null,
    );
    // Re-run search; jump to same position (replacement may have changed positions)
    const savedIdx = currentIdx;
    runSearch();
    // If matches still exist, position cursor at or past the replaced location
    if (matches.length > 0) {
      currentIdx = Math.min(savedIdx, matches.length - 1);
      revealMatch(currentIdx);
    }
  }

  function replaceAll(): void {
    if (matches.length === 0) { return; }
    const replaceText = replaceInp!.value;
    const srcMap = sourceMap();
    // Group matches by source; apply in reverse order per source so earlier
    // ranges stay valid.
    const bySource = new Map<string, Match[]>();
    for (const m of matches) {
      const arr = bySource.get(m.sourceKey) ?? [];
      arr.push(m);
      bySource.set(m.sourceKey, arr);
    }
    let replaced = 0;
    for (const [key, secMatches] of bySource) {
      const src = srcMap.get(key);
      if (!src || secMatches.length === 0) { continue; }
      // Reverse by position (sorted ascending → reverse to iterate back→front)
      const sorted = secMatches.slice().sort((a, b) =>
        a.lineNumber !== b.lineNumber
          ? a.lineNumber - b.lineNumber
          : a.column - b.column
      ).reverse();
      const edits = sorted.map(m => ({
        range: new monaco.Range(m.lineNumber, m.column, m.lineNumber, m.column + m.length),
        text: replaceText,
        forceMoveMarkers: true,
      }));
      src.model.pushEditOperations([], edits, () => null);
      replaced += secMatches.length;
    }
    // Re-run search to update state
    runSearch();
    if (replaced) { updateAfterReplaceAll(replaced); }
  }

  function updateAfterReplaceAll(n: number): void {
    // Show short confirmation via count field (re-run will overwrite after 1s)
    count!.textContent = fmt(L, 'xfindReplaced', n);
  }

  function toggleReplace(): void {
    const isOpen = bar!.classList.toggle('replace-mode');
    toggleBtn!.textContent = isOpen ? '▾' : '▸';
    if (isOpen) { replaceInp!.focus(); }
    else { input!.focus(); }
  }

  function open(withReplace = false): void {
    bar!.classList.add('visible');
    if (withReplace && !bar!.classList.contains('replace-mode')) {
      bar!.classList.add('replace-mode');
      toggleBtn!.textContent = '▾';
    }
    const editor = host.getEditor();
    const sel = editor.getSelection();
    const selText = sel ? editor.getModel()?.getValueInRange(sel) ?? '' : '';
    if (selText && !selText.includes('\n')) {
      input!.value = selText;
      // Search WITHOUT jumping. A word selected by double-click is itself one of
      // the hits — so the editor already stands in the right place, and a `reveal`
      // would yank it to another occurrence precisely now.
      runSearch({ reveal: false });
      // The counter should still say where you stand ("3 / 17", not "1 / 17"),
      // and Enter must continue from HERE.
      const atSel = sel
        ? matchIdxAtSelection(matches, activeSourceKey(), sel.startLineNumber, sel.startColumn)
        : -1;
      if (atSel >= 0) {
        currentIdx = atSel;
        updateCountDisplay();
        renderResults();
      }
    }
    if (withReplace) { replaceInp!.focus(); replaceInp!.select(); }
    else { input!.focus(); input!.select(); }
  }

  function close(): void {
    // Discard a pending search: it would fire after closing and yank the
    // editor to a hit that nobody is looking for anymore.
    if (_debounceTimer !== null) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    bar!.classList.remove('visible');
    host.getEditor().focus();
  }

  input.addEventListener('input', runSearchDebounced);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) { prevOrFlush(); } else { nextOrFlush(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      caseSensitive = !caseSensitive;
      caseBtn!.classList.toggle('toggled', caseSensitive);
      runSearch();
    }
  });
  replaceInp.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey && e.altKey) { replaceAll(); }
      else { replaceOne(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  prevBtn.addEventListener('click', prevOrFlush);
  nextBtn.addEventListener('click', nextOrFlush);
  caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('toggled', caseSensitive);
    runSearch();
    input.focus();
  });
  closeBtn.addEventListener('click', close);
  toggleBtn.addEventListener('click', toggleReplace);
  replOneBtn.addEventListener('click', replaceOne);
  replAllBtn.addEventListener('click', replaceAll);

  host.getEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => open(false));
  host.getEditor().addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => open(true));
}

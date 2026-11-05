export {};
import { buildSnippet } from '../_shared/findSnippet';
import { getL10n, fmt } from '../_shared/l10n';
import { getVsCodeApi } from '../_shared/vscodeApi';
import type { HostToWebview, WebviewToHost } from '../../findReplace/protocol';

const vscode = getVsCodeApi<WebviewToHost>();
const L = getL10n();

const $ = (id: string) => document.getElementById(id)!;
const q = $('fr-q') as HTMLInputElement;
const r = $('fr-r') as HTMLInputElement;
const wordT = $('fr-word') as HTMLInputElement;
const rxT = $('fr-rx') as HTMLInputElement;
const procT = $('fr-proc') as HTMLInputElement;
const ruleT = $('fr-rule') as HTMLInputElement;
const prefixI = $('fr-prefix') as HTMLInputElement;
const suffixI = $('fr-suffix') as HTMLInputElement;
const containsI = $('fr-contains') as HTMLInputElement;
const results = $('fr-results');
const summary = $('fr-summary');
const replaceBtn = $('fr-replace') as HTMLButtonElement;

function opts() { return { wholeWord: wordT.checked, regex: rxT.checked }; }

/** comma-separated → trimmed non-empty list */
function splitList(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(s => s !== '');
}

function filter() {
  return {
    includeProcesses: procT.checked,
    includeRules: ruleT.checked,
    prefixes: splitList(prefixI.value),
    suffixes: splitList(suffixI.value),
    contains: splitList(containsI.value),
    includeControl: (document.getElementById('fr-control') as HTMLInputElement).checked,
  };
}

$('fr-search').addEventListener('click', () =>
  vscode.postMessage({ type: 'search', query: q.value, opts: opts(), filter: filter() }));

// Guards a double-click: a second apply must not fire while the first round-trip
// is still open (it would run against the same selection and prepend a duplicate
// report). Re-enabled when the report arrives.
let applying = false;

replaceBtn.addEventListener('click', () => {
  if (applying || replaceBtn.disabled) { return; }
  const selected = Array.from(results.querySelectorAll('input.fr-cb:checked')).map(c => (c as HTMLElement).dataset.id!);
  applying = true;
  replaceBtn.disabled = true;
  vscode.postMessage({ type: 'replace', query: q.value, replacement: r.value, opts: opts(), selected });
});

r.addEventListener('input', () => {
  const anyMatch = results.querySelector('input.fr-cb') !== null;
  replaceBtn.disabled = applying || !anyMatch || r.value === '';
});

wordT.addEventListener('change', resetOnOptsChange);
rxT.addEventListener('change', resetOnOptsChange);
// Editing the query after a search invalidates the shown results: their match ids
// belong to the old query, so Replace must not run against them. Clear + disable
// until the user searches again.
q.addEventListener('input', resetOnOptsChange);

function resetOnOptsChange(): void {
  results.textContent = '';
  summary.textContent = '';
  replaceBtn.disabled = true;
}

window.addEventListener('message', ev => {
  const m = ev.data as HostToWebview;
  if (m.type === 'results') { renderResults(m.groups, m.unreadable ?? []); }
  else if (m.type === 'report') { renderReport(m.report); }
});

function renderResults(groups: Extract<HostToWebview, { type: 'results' }>['groups'], unreadable: string[]): void {
  results.textContent = '';
  let total = 0;
  for (const g of groups) {
    const head = document.createElement('div');
    head.className = 'fr-obj';
    head.textContent = `${g.objectKind === 'rule' ? '⊟' : '⚙'} ${g.objectName}`;
    head.addEventListener('click', () => {
      const first = g.matches[0];
      vscode.postMessage({
        type: 'open', objectKind: g.objectKind, objectName: g.objectName,
        unit: first?.unit, line: first?.match.line,
      });
    });
    results.appendChild(head);
    for (const fm of g.matches) {
      total++;
      const row = document.createElement('div');
      row.className = 'fr-row';
      // checkbox + badge + line number: clicking toggles selection (label wrap)
      const sel = document.createElement('label');
      sel.className = 'fr-sel';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'fr-cb'; cb.checked = true; cb.dataset.id = fm.id;
      sel.appendChild(cb);
      const badge = document.createElement('span');
      badge.className = 'fr-badge'; badge.textContent = fm.unit;
      sel.appendChild(badge);
      const ln = document.createElement('span');
      ln.className = 'fr-ln'; ln.textContent = String(fm.match.line);
      sel.appendChild(ln);
      row.appendChild(sel);
      // snippet (after the line number): clicking jumps to this exact match
      const parts = buildSnippet(fm.match.lineText, fm.match.column, fm.match.length);
      const snip = document.createElement('span');
      snip.className = 'fr-snip';
      snip.addEventListener('click', () => vscode.postMessage({
        type: 'open', objectKind: g.objectKind, objectName: g.objectName,
        unit: fm.unit, line: fm.match.line,
      }));
      if (parts.truncatedLeft) { snip.appendChild(document.createTextNode('…')); }
      snip.appendChild(document.createTextNode(parts.before));
      const hit = document.createElement('span'); hit.className = 'fr-match'; hit.textContent = parts.match;
      snip.appendChild(hit);
      snip.appendChild(document.createTextNode(parts.after));
      if (parts.truncatedRight) { snip.appendChild(document.createTextNode('…')); }
      row.appendChild(snip);
      results.appendChild(row);
    }
  }
  summary.textContent = fmt(L, 'matchesSummary', total, groups.length);
  replaceBtn.disabled = total === 0 || r.value === '';

  if (unreadable.length > 0) {
    const warn = document.createElement('div');
    warn.className = 'fr-warn';
    warn.textContent = fmt(L, 'couldNotRead', unreadable.join(', '));
    results.appendChild(warn);
  }
}

/** Compact, comma-joined names line prefixed with a status symbol. */
function namesLine(symbol: string, names: string[]): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'fr-names';
  el.textContent = `${symbol} ${names.join(', ')}`;
  return el;
}

function renderReport(rep: Extract<HostToWebview, { type: 'report' }>['report']): void {
  // Replace the prior report block instead of appending — a repeated apply must
  // not stack duplicate report divs at the top of the results list.
  document.getElementById('fr-report-block')?.remove();
  const block = document.createElement('div');
  block.id = 'fr-report-block';

  const div = document.createElement('div'); div.className = 'fr-report';
  if (rep.failed) {
    div.textContent = `❌ ${fmt(L, 'replaceFailed', rep.failed.object, rep.failed.error, rep.applied.length, rep.notAttempted.length)}`;
  } else {
    div.textContent = `✅ ${fmt(L, 'replacedInObjects', rep.applied.length)}`;
  }
  block.appendChild(div);

  // Surface WHICH objects, not just counts: ✓ written, ○ not attempted (after a
  // failure). Names are data — no l10n key needed. The failed object itself is
  // already named in the localized line above.
  if (rep.applied?.length > 0) { block.appendChild(namesLine('✓', rep.applied)); }
  if (rep.notAttempted?.length > 0) { block.appendChild(namesLine('○', rep.notAttempted)); }
  if (rep.skipped && rep.skipped > 0) {
    const warn = document.createElement('div');
    warn.className = 'fr-warn';
    warn.textContent = `⚠ ${fmt(L, 'skippedStale', rep.skipped)}`;
    block.appendChild(warn);
  }

  results.prepend(block);

  // Apply round-trip done: re-enable Replace (subject to the usual guards).
  applying = false;
  replaceBtn.disabled = results.querySelector('input.fr-cb') === null || r.value === '';
}

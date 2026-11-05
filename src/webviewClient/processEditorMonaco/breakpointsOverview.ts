// src/webviewClient/processEditorMonaco/breakpointsOverview.ts
//
// "Breakpoints" tab: a live overview table of every breakpoint in the process,
// with its condition + hit-count. Click a row to jump to the section/line;
// edit the condition/hit inputs inline (commits on blur/Enter). Mirrors the
// linter/references tab pattern (data-section/data-line rows + a tab badge).
export {};

import { getL10n } from '../_shared/l10n';
import { escapeHtml } from '../htmlUtils';
import type { SectionKey } from './state';
import { getBreakpointEntries, onBreakpointsMutated } from './breakpoints';

const L = getL10n();

const SECTION_LABEL: Record<SectionKey, string> = {
  prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog',
};

export interface BpOverviewBridge {
  /** Reveal + focus a section/line (same as the linter tab's jump). */
  revealSectionLine(section: SectionKey, line: number): void;
  /** Commit an edited condition/hit-count for an existing breakpoint. */
  setCondition(section: SectionKey, line: number, condition: string, hitCondition: string): void;
  /** Remove a single breakpoint (row "✕" button). */
  removeBreakpoint(section: SectionKey, line: number): void;
  /** Remove every breakpoint ("Delete all" button). */
  clearAll(): void;
}

let _bridge: BpOverviewBridge | null = null;

export function initBreakpointsOverview(bridge: BpOverviewBridge): void {
  _bridge = bridge;
  // Re-render whenever a breakpoint is added/removed/verified or a condition changes.
  onBreakpointsMutated(renderBreakpointsOverview);

  const host = document.getElementById('bp-table-host');
  if (host) {
    // Jump to source on row click — but not when the click lands in an input,
    // the row "✕" delete button, or the "Delete all" toolbar button.
    host.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement | null;
      if (!target) { return; }
      // "Delete all" — clear every breakpoint.
      if (target.closest('.bp-clear-all')) { _bridge?.clearAll(); return; }
      // Row "✕" — remove just that breakpoint (don't also jump).
      const delBtn = target.closest('.bp-del');
      if (delBtn) {
        const dtr = delBtn.closest('tr');
        const dsec = dtr?.getAttribute('data-section') as SectionKey | null;
        const dline = parseInt(dtr?.getAttribute('data-line') ?? '', 10);
        if (dsec && Number.isFinite(dline)) { _bridge?.removeBreakpoint(dsec, dline); }
        return;
      }
      if (target.tagName === 'INPUT') { return; }
      const tr = target.closest('tr');
      const section = tr?.getAttribute('data-section') as SectionKey | null;
      const line = parseInt(tr?.getAttribute('data-line') ?? '', 10);
      if (!section || !Number.isFinite(line)) { return; }
      _bridge?.revealSectionLine(section, line);
    });
    // Commit condition/hit edits on change (fires on blur / Enter-then-blur).
    host.addEventListener('change', (ev) => {
      const inp = ev.target as HTMLInputElement | null;
      if (!inp || inp.tagName !== 'INPUT') { return; }
      _commitRow(inp.closest('tr'));
    });
    // Enter = commit now (blur triggers the change handler above).
    host.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') { (ev.target as HTMLElement)?.blur?.(); }
    });
  }
  renderBreakpointsOverview();
}

function _commitRow(tr: Element | null): void {
  const section = tr?.getAttribute('data-section') as SectionKey | null;
  const line = parseInt(tr?.getAttribute('data-line') ?? '', 10);
  if (!section || !Number.isFinite(line)) { return; }
  const condInp = tr?.querySelector('.bp-cond') as HTMLInputElement | null;
  const hitInp = tr?.querySelector('.bp-hit') as HTMLInputElement | null;
  _bridge?.setCondition(section, line, condInp?.value ?? '', hitInp?.value ?? '');
}

export function renderBreakpointsOverview(): void {
  const entries = getBreakpointEntries();
  const badge = document.getElementById('bp-count');
  if (badge) { badge.textContent = entries.length ? String(entries.length) : ''; }

  const host = document.getElementById('bp-table-host');
  if (!host) { return; }
  // Never rebuild the table while the user is mid-edit in one of its inputs
  // (a mutation elsewhere would otherwise steal focus / drop keystrokes).
  const active = document.activeElement as HTMLElement | null;
  if (active && active.tagName === 'INPUT' && host.contains(active)) { return; }

  if (entries.length === 0) {
    host.innerHTML = '<div class="bp-empty">' + escapeHtml(L['bpOverviewEmpty'] ?? 'No breakpoints set.') + '</div>';
    return;
  }

  const deleteAll = escapeHtml(L['bpDeleteAll'] ?? 'Delete all breakpoints');
  let html = '<div class="bp-toolbar"><button type="button" class="bp-clear-all" title="' + deleteAll + '">' + deleteAll + '</button></div>';
  html += '<table class="bp-table"><thead><tr>';
  html += '<th class="bp-c-section">' + escapeHtml(L['bpHdrSection'] ?? 'Section') + '</th>';
  html += '<th class="bp-c-line">' + escapeHtml(L['bpHdrLine'] ?? 'Line') + '</th>';
  html += '<th class="bp-c-cond">' + escapeHtml(L['bpHdrCondition'] ?? 'Condition') + '</th>';
  html += '<th class="bp-c-hit">' + escapeHtml(L['bpHdrHit'] ?? 'Hit count') + '</th>';
  html += '<th class="bp-c-status">' + escapeHtml(L['bpHdrStatus'] ?? 'Status') + '</th>';
  html += '<th class="bp-c-del"></th>';
  html += '</tr></thead><tbody>';
  const condPh = escapeHtml(L['bpConditionPlaceholder'] ?? '');
  const hitPh = escapeHtml(L['bpHitCountPlaceholder'] ?? '');
  const removeLbl = escapeHtml(L['bpRemove'] ?? 'Remove breakpoint');
  for (const e of entries) {
    html += '<tr data-section="' + e.section + '" data-line="' + e.line + '" title="' + escapeHtml(L['bpJumpToLine'] ?? 'Jump to line') + '">';
    html += '<td class="bp-c-section">' + escapeHtml(SECTION_LABEL[e.section] ?? e.section) + '</td>';
    html += '<td class="bp-c-line">' + e.line + '</td>';
    html += '<td class="bp-c-cond"><input class="bp-cond" type="text" value="' + escapeHtml(e.condition ?? '') + '" placeholder="' + condPh + '"></td>';
    html += '<td class="bp-c-hit"><input class="bp-hit" type="text" value="' + escapeHtml(e.hitCondition ?? '') + '" placeholder="' + hitPh + '"></td>';
    html += '<td class="bp-c-status"><span class="bp-status bp-status-' + e.status + '">' + escapeHtml(e.status) + '</span></td>';
    html += '<td class="bp-c-del"><button type="button" class="bp-del" title="' + removeLbl + '" aria-label="' + removeLbl + '">✕</button></td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
}

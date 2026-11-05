import type * as monacoType from 'monaco-editor';

import type { SectionKey } from './sectionTypes';
import { escapeHtml } from '../htmlUtils';
import { liveSpan, rowMatches } from './resolverPure';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

interface ResolverArgPart {
  identifier: string;
  kind: 'literal' | 'param' | 'datasource';
  display: string;
}

interface ResolverArg {
  name: string;
  raw: string;
  kind: 'literal' | 'param' | 'datasource' | 'dynamic';
  display: string;
  parts?: ResolverArgPart[];
}

interface ResolverRow {
  section: SectionKey;
  line: number;
  funcName: string;
  args: ResolverArg[];
}

interface ResolverBridge {
  revealSectionLine(section: SectionKey, line: number): void;
  requestResolver(): void;
  /** Returns the currently paused debug variables, or null when not debugging. */
  getLiveValue?(ident: string): string | null;
}

const SECTION_LABELS: Record<SectionKey, string> = {
  prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog',
};

const state: {
  monaco: typeof monacoType | null;
  bridge: ResolverBridge | null;
  rows: ResolverRow[];
  filter: string;
  pending: boolean;
} = {
  monaco: null,
  bridge: null,
  rows: [],
  filter: '',
  pending: false,
};

export function initResolver(monaco: typeof monacoType, bridge: ResolverBridge): void {
  state.monaco = monaco;
  state.bridge = bridge;
  wireEvents();
  render();
}

export function receiveResolverResults(rows: unknown, error?: string): void {
  state.pending = false;
  state.rows = Array.isArray(rows) ? (rows as ResolverRow[]) : [];
  render(error);
}

export function markResolverPending(): void {
  state.pending = true;
  const info = document.getElementById('resolver-info');
  if (info) { info.textContent = L.resCalculating; }
}

/** Called by the Monaco index when debug state changes so live-value spans
 *  can be recomputed without a full extension round-trip. */
export function refreshResolverLiveValues(): void {
  if (state.rows.length > 0) { render(); }
}


function renderArgs(args: ResolverArg[]): string {
  const getLive = state.bridge?.getLiveValue;
  const chunks: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    let piece = '<span class="resolver-arg-name">' + escapeHtml(a.name) + '</span>=';
    if (a.kind === 'literal') {
      piece += '<span class="resolver-arg-literal">' + escapeHtml(a.display) + '</span>';
    } else if (a.kind === 'param') {
      piece += '<span class="resolver-arg-param">' + escapeHtml(a.display) + '</span>';
      const lv = getLive?.(a.raw);
      if (lv !== null && lv !== undefined) { piece += liveSpan(lv); }
    } else if (a.kind === 'datasource') {
      piece += '<span class="resolver-arg-datasource">' + escapeHtml(a.display) + '</span>';
      const lv = getLive?.(a.raw);
      if (lv !== null && lv !== undefined) { piece += liveSpan(lv); }
    } else {
      piece += '<span class="resolver-arg-dynamic">' + escapeHtml(a.display) + '</span>';
      if (a.parts && a.parts.length > 0) {
        const partsHtml = a.parts.map(p => {
          let out = '<span class="rap-ident">' + escapeHtml(p.identifier) + '</span>=' +
                    '<span class="rap-' + p.kind + '">' + escapeHtml(p.display) + '</span>';
          const plv = getLive?.(p.identifier);
          if (plv !== null && plv !== undefined) { out += liveSpan(plv); }
          return out;
        }).join(', ');
        piece += '<span class="resolver-arg-parts"> \u2192 ' + partsHtml + '</span>';
      }
    }
    chunks.push(piece);
  }
  return chunks.join(', ');
}

function render(error?: string): void {
  const host = document.getElementById('resolver-table-host');
  const info = document.getElementById('resolver-info');
  if (!host) { return; }

  if (error) {
    host.innerHTML = '<div class="linter-empty">' + fmt(L, 'resError', escapeHtml(error)) + '</div>';
    if (info) { info.textContent = ''; }
    return;
  }

  if (state.pending) {
    if (info) { info.textContent = L.resCalculating; }
    return;
  }

  const needle = state.filter.trim().toLowerCase();
  const rows = state.rows.filter(r => rowMatches(r, needle));

  if (state.rows.length === 0) {
    host.innerHTML = '<div class="linter-empty">' + L.resNoCalls + '</div>';
    if (info) { info.textContent = fmt(L, 'resCountCalls', 0); }
    return;
  }
  if (rows.length === 0) {
    host.innerHTML = '<div class="linter-empty">' + L.resNoFilterMatch + '</div>';
    if (info) { info.textContent = fmt(L, 'resCountFiltered', 0, state.rows.length); }
    return;
  }

  let html = '<table class="linter-table resolver-table"><thead><tr>';
  html += '<th class="lt-section">Section</th><th class="lt-line">' + L.resHdrLine + '</th><th class="rt-func">' + L.resHdrFunction + '</th><th class="rt-args">' + L.resHdrArguments + '</th>';
  html += '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr data-section="' + r.section + '" data-line="' + r.line + '" title="' + L.resJumpToLine + '">';
    html += '<td class="lt-section">' + escapeHtml(SECTION_LABELS[r.section]) + '</td>';
    html += '<td class="lt-line">' + r.line + '</td>';
    html += '<td class="rt-func">' + escapeHtml(r.funcName) + '</td>';
    html += '<td class="rt-args">' + renderArgs(r.args) + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;
  if (info) {
    info.textContent = needle
      ? fmt(L, 'resCountFiltered', rows.length, state.rows.length)
      : fmt(L, 'resCountCalls', state.rows.length);
  }
}

function wireEvents(): void {
  const filterEl = document.getElementById('resolver-filter') as HTMLInputElement | null;
  filterEl?.addEventListener('input', () => {
    state.filter = filterEl.value || '';
    render();
  });

  const refreshBtn = document.getElementById('btn-resolver-refresh');
  refreshBtn?.addEventListener('click', () => {
    if (state.bridge) { markResolverPending(); state.bridge.requestResolver(); }
  });

  const host = document.getElementById('resolver-table-host');
  host?.addEventListener('click', (ev) => {
    const tr = (ev.target as HTMLElement | null)?.closest('tr');
    if (!tr) { return; }
    const section = tr.getAttribute('data-section') as SectionKey | null;
    const line = parseInt(tr.getAttribute('data-line') ?? '', 10);
    if (!section || !Number.isFinite(line) || !state.bridge) { return; }
    state.bridge.revealSectionLine(section, line);
  });
}

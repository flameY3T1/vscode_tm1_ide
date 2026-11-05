/**
 * Generic security-matrix webview engine.
 *
 * Backs Cube / Dimension / Process / Element security matrices — all four have an
 * identical row/group/level matrix UI with the same controls (group chips,
 * row filter, save/revert/refresh/view, dirty badge, status line). The only
 * differences are:
 *   - Entity name displayed in row header column ("Cube" / "Dimension" / "Process")
 *   - Permission-level enum per resource type (cube/dim/process)
 *   - Field names in the host↔webview protocol (msg.cubes vs msg.dims vs msg.processes)
 *
 * Each matrix's index.ts now provides a ~30-LOC `MatrixConfig` adapter; the
 * 250-LOC render/event glue lives here once.
 *
 * Pre-conditions on the host HTML — must contain these element IDs:
 *   tab-bar (with .tab[data-tab=select|matrix])  — tab switcher
 *   chip-bar                                     — group-selection chips
 *   row-filter   (input)                         — filter text input
 *   matrix-wrap                                  — table container
 *   btn-refresh / btn-revert / btn-save / btn-view (buttons)
 *   dirty-badge  (element with .visible toggle)
 *   status       (status line element)
 */

import type { Group } from '../../security/types/group';
import { getL10n, fmt } from './l10n';
import { escapeHtml } from '../htmlUtils';
import { getVsCodeApi } from './vscodeApi';

/** Normalized internal store — type-erased to avoid 3-way generic per matrix. */
interface InternalStore {
  rows: string[];
  groups: string[];
  selectedGroups: Set<string>;
  rowFilter: string;
  original: Record<string, Record<string, string>>;
  current:  Record<string, Record<string, string>>;
}

/** Normalized init payload regardless of matrix variant. */
export interface MatrixInit<TLevel extends string> {
  rows: string[];
  groups: Group[];
  perms: Record<string, Record<string, TLevel>>;
}

/** Normalized saved-response payload. */
export interface MatrixSavedNormalized {
  ok: Array<{ row: string; group: string }>;
  errors: Array<{ row: string; group: string; reason: string }>;
}

/** Normalized client-side change descriptor (uniform across all matrix variants). */
export interface MatrixChange<TLevel extends string> {
  row: string;
  group: string;
  level: TLevel;
}

/**
 * Variant-specific protocol adapter. All methods are pure — they translate
 * arbitrary host messages to (or from) the normalized internal shapes the
 * core engine works with.
 */
export interface MatrixConfig<TLevel extends string> {
  /** Header label for the row column (e.g. "Cube"). */
  entityLabel: string;
  /** Plural lowercase form for empty-state ("No cubes match the filter."). */
  entityLabelPlural: string;
  /** All selectable permission levels for a single cell. */
  levels: readonly TLevel[];

  /** Return normalized init from a host message of type 'init', or null. */
  parseInit(msg: unknown): MatrixInit<TLevel> | null;
  /** Return normalized perms-map from a 'refreshed' message, or null. */
  parseRefresh(msg: unknown): Record<string, Record<string, TLevel>> | null;
  /** Return normalized ok/errors from a 'saved' message, or null. */
  parseSaved(msg: unknown): MatrixSavedNormalized | null;

  /** Build the WebviewToHost save-message from normalized changes. */
  buildSaveMsg(changes: Array<MatrixChange<TLevel>>): unknown;

  /**
   * Optional: sees every host message before the core handles it. For
   * variant-only messages and side effects (element matrix: missing-cube
   * banner, dimension name in the heading).
   */
  onHostMessage?(msg: unknown, ui: MatrixUi): void;
  /** Optional: wire variant-only controls; runs on DOMContentLoaded before 'ready' is posted. */
  onReady?(ui: MatrixUi): void;
}

/** What the core lends to variant hooks (the vscode API can be acquired only once). */
export interface MatrixUi {
  post(msg: unknown): void;
  showStatus(kind: 'ok' | 'error', msg: string): void;
}


// ─── Pure store ops (exported for testing) ──────────────────────────────────

export function initInternalStore<TLevel extends string>(init: MatrixInit<TLevel>): InternalStore {
  const cloned: Record<string, Record<string, string>> = {};
  for (const r of Object.keys(init.perms)) { cloned[r] = { ...init.perms[r] }; }
  const clone2: Record<string, Record<string, string>> = {};
  for (const r of Object.keys(cloned)) { clone2[r] = { ...cloned[r] }; }
  return {
    rows: [...init.rows],
    groups: init.groups.map(g => g.name),
    selectedGroups: new Set<string>(),
    rowFilter: '',
    original: cloned,
    current: clone2,
  };
}

export function toggleGroup(s: InternalStore, group: string): InternalStore {
  const next = new Set(s.selectedGroups);
  if (next.has(group)) { next.delete(group); } else { next.add(group); }
  return { ...s, selectedGroups: next };
}

export function setFilter(s: InternalStore, filter: string): InternalStore {
  return { ...s, rowFilter: filter };
}

export function setCellLevel(s: InternalStore, row: string, group: string, level: string): InternalStore {
  const curRow = { ...(s.current[row] ?? {}) };
  curRow[group] = level;
  return { ...s, current: { ...s.current, [row]: curRow } };
}

export function revertAll(s: InternalStore): InternalStore {
  const reverted: Record<string, Record<string, string>> = {};
  for (const r of Object.keys(s.original)) { reverted[r] = { ...s.original[r] }; }
  return { ...s, current: reverted };
}

/** Level shown for a cell; a missing entry means `NONE`. */
export function cellLevel(perms: Record<string, Record<string, string>>, row: string, group: string): string {
  return perms[row]?.[group] ?? 'NONE';
}

export function isCellDirty(s: InternalStore, row: string, group: string): boolean {
  return cellLevel(s.current, row, group) !== cellLevel(s.original, row, group);
}

export function isDirty(s: InternalStore): boolean {
  return Object.keys(s.current).some(r => Object.keys(s.current[r]).some(g => isCellDirty(s, r, g)));
}

export function visibleRows(s: InternalStore): string[] {
  const f = s.rowFilter.trim().toLowerCase();
  if (!f) { return s.rows; }
  return s.rows.filter(r => r.toLowerCase().includes(f));
}

export function visibleSelectedGroups(s: InternalStore): string[] {
  return s.groups.filter(g => s.selectedGroups.has(g));
}

export function computeChanges<TLevel extends string>(s: InternalStore): Array<MatrixChange<TLevel>> {
  const out: Array<MatrixChange<TLevel>> = [];
  for (const r of Object.keys(s.current)) {
    for (const g of Object.keys(s.current[r])) {
      if (isCellDirty(s, r, g)) { out.push({ row: r, group: g, level: cellLevel(s.current, r, g) as TLevel }); }
    }
  }
  return out;
}

// ─── Runtime engine ─────────────────────────────────────────────────────────

/**
 * Bootstrap the matrix in the current document. Call once at module-load
 * from the variant's index.ts with its config.
 */
/** Rows drawn at most; beyond that the filter narrows the list. */
export const MATRIX_ROW_CAP = 500;

export function runSecurityMatrix<TLevel extends string>(cfg: MatrixConfig<TLevel>): void {
  // `unknown`: the save payload is per adapter (cfg.buildSaveMsg); each adapter's
  // protocol.ts types it. ready/refresh/openView are common to all four.
  const vscode = getVsCodeApi<unknown>();
  const L = getL10n();
  const entityLabel = L.entityLabel ?? cfg.entityLabel;
  const entityLabelPlural = L.entityLabelPlural ?? cfg.entityLabelPlural;

  let store: InternalStore = initInternalStore({ rows: [], groups: [], perms: {} });
  let groupsMeta: Group[] = [];
  let activeTab: 'select' | 'matrix' = 'select';
  const errorByCell = new Map<string, string>();

  const $ = (id: string): HTMLElement => {
    const el = document.getElementById(id);
    if (!el) { throw new Error(`Missing #${id}`); }
    return el;
  };
  const cellKey = (row: string, group: string): string => `${row}::${group}`;

  function visibleGroupsForRender(): string[] {
    return activeTab === 'matrix' ? store.groups : visibleSelectedGroups(store);
  }

  function renderTabs(): void {
    document.querySelectorAll('.tab-bar .tab').forEach(t => {
      const id = t.getAttribute('data-tab') ?? '';
      t.classList.toggle('active', id === activeTab);
    });
    ($('chip-bar') as HTMLElement).style.display = activeTab === 'matrix' ? 'none' : '';
  }

  function onTabClick(ev: Event): void {
    const id = ((ev.currentTarget as HTMLElement).getAttribute('data-tab') ?? 'select') as 'select' | 'matrix';
    activeTab = id;
    renderTabs();
    renderMatrix();
  }

  function renderChips(): void {
    const bar = $('chip-bar');
    if (groupsMeta.length === 0) {
      bar.innerHTML = `<span class="empty-state" style="padding:0">${escapeHtml(L.noGroupsLoaded ?? 'No groups loaded.')}</span>`;
      return;
    }
    const sel = new Set(store.selectedGroups);
    bar.innerHTML = groupsMeta.map(g => {
      const selected = sel.has(g.name) ? ' selected' : '';
      return `<span class="chip${selected}" data-group="${escapeHtml(g.name)}">${escapeHtml(g.name)}</span>`;
    }).join('');
    bar.querySelectorAll('.chip').forEach(c => c.addEventListener('click', onChipClick));
  }

  function renderMatrix(): void {
    const wrap = $('matrix-wrap');
    const visGroups = visibleGroupsForRender();
    if (visGroups.length === 0) {
      const msg = activeTab === 'matrix'
        ? (L.noGroupsLoaded ?? 'No groups loaded.')
        : (L.selectGroupsHint ?? 'Select one or more groups (chips above) to start editing.');
      wrap.innerHTML = `<div class="empty-state">${escapeHtml(msg)}</div>`;
      return;
    }
    const allRows = visibleRows(store);
    if (allRows.length === 0) {
      wrap.innerHTML = `<div class="empty-state">${escapeHtml(fmt(L, 'noMatchFilter', entityLabelPlural))}</div>`;
      return;
    }
    // A 100k-element dimension × 20 groups would be 2 million <select> nodes.
    // Only the first MATRIX_ROW_CAP rows are drawn; the filter narrows the rest.
    const visRows = allRows.slice(0, MATRIX_ROW_CAP);
    const capNote = allRows.length > visRows.length
      ? `<div class="empty-state">${escapeHtml(fmt(L, 'rowsCapped', visRows.length, allRows.length))}</div>`
      : '';
    const head = `<thead><tr>
      <th class="row-col">${escapeHtml(entityLabel)}</th>
      ${visGroups.map(g => `<th>${escapeHtml(g)}</th>`).join('')}
    </tr></thead>`;

    const rows = visRows.map(row => {
      const anyDirty = visGroups.some(g => isCellDirty(store, row, g));
      const tdCells = visGroups.map(g => {
        const cur = cellLevel(store.current, row, g);
        const dirty = isCellDirty(store, row, g);
        const err = errorByCell.get(cellKey(row, g));
        const tdClasses = [dirty ? 'dirty' : '', err ? 'error' : ''].filter(Boolean).join(' ');
        const options = cfg.levels.map(l =>
          `<option value="${l}"${l === cur ? ' selected' : ''}>${l}</option>`).join('');
        const title = err ? ` title="${escapeHtml(err)}"` : '';
        return `<td class="${tdClasses}"${title}>
          <select class="cell-dropdown" data-row="${escapeHtml(row)}" data-group="${escapeHtml(g)}">${options}</select>
        </td>`;
      }).join('');
      return `<tr class="${anyDirty ? 'dirty' : ''}" data-row="${escapeHtml(row)}">
        <td class="row-col">${escapeHtml(row)}</td>
        ${tdCells}
      </tr>`;
    }).join('');

    wrap.innerHTML = `<table class="matrix">${head}<tbody>${rows}</tbody></table>${capNote}`;
  }

  function renderDirty(): void {
    const dirty = isDirty(store);
    $('dirty-badge').classList.toggle('visible', dirty);
    ($('btn-save') as HTMLButtonElement).disabled = !dirty;
    ($('btn-revert') as HTMLButtonElement).disabled = !dirty;
  }

  function showStatus(kind: 'ok' | 'error', msg: string): void {
    const s = $('status');
    s.className = `status ${kind}`;
    s.textContent = msg;
  }
  function clearStatus(): void {
    const s = $('status');
    s.className = 'status';
    s.textContent = '';
  }

  function onChipClick(ev: Event): void {
    const el = ev.currentTarget as HTMLElement;
    const group = el.getAttribute('data-group') ?? '';
    store = toggleGroup(store, group);
    renderChips();
    renderMatrix();
  }

  function onFilterInput(ev: Event): void {
    const inp = ev.target as HTMLInputElement;
    store = setFilter(store, inp.value);
    renderMatrix();
  }

  /**
   * One delegated listener on the matrix wrapper. A change patches only its own
   * cell and row marker — redrawing the whole table rebuilt every <select>
   * (200 cubes × 30 groups = 6,000) on each dropdown change.
   */
  function onCellChange(ev: Event): void {
    const sel = ev.target as HTMLSelectElement;
    if (!sel.classList?.contains('cell-dropdown')) { return; }
    const row = sel.getAttribute('data-row') ?? '';
    const group = sel.getAttribute('data-group') ?? '';
    store = setCellLevel(store, row, group, sel.value);
    errorByCell.delete(cellKey(row, group));
    const td = sel.parentElement;
    if (td) {
      td.classList.toggle('dirty', isCellDirty(store, row, group));
      td.classList.remove('error');
      td.removeAttribute('title');
    }
    const tr = td?.parentElement;
    if (tr) {
      tr.classList.toggle('dirty', visibleGroupsForRender().some(g => isCellDirty(store, row, g)));
    }
    renderDirty();
  }

  function onRefreshClick(): void {
    vscode.postMessage({ type: 'refresh' });
    clearStatus();
  }

  function onRevertClick(): void {
    store = revertAll(store);
    errorByCell.clear();
    renderMatrix();
    renderDirty();
    clearStatus();
  }

  function onSaveClick(): void {
    const changes = computeChanges<TLevel>(store);
    if (changes.length === 0) { return; }
    vscode.postMessage(cfg.buildSaveMsg(changes));
    ($('btn-save') as HTMLButtonElement).disabled = true;
  }

  const ui: MatrixUi = { post: m => vscode.postMessage(m), showStatus };

  function handleHost(msg: unknown): void {
    cfg.onHostMessage?.(msg, ui);
    const init = cfg.parseInit(msg);
    if (init) {
      groupsMeta = init.groups;
      store = initInternalStore(init);
      errorByCell.clear();
      renderChips();
      renderMatrix();
      renderDirty();
      return;
    }
    const refreshed = cfg.parseRefresh(msg);
    if (refreshed) {
      const initLike: MatrixInit<TLevel> = { rows: store.rows, groups: groupsMeta, perms: refreshed };
      store = initInternalStore(initLike);
      errorByCell.clear();
      renderMatrix();
      renderDirty();
      showStatus('ok', L.refreshed ?? 'Refreshed');
      return;
    }
    const saved = cfg.parseSaved(msg);
    if (saved) {
      if (saved.errors.length === 0) {
        const newOriginal: Record<string, Record<string, string>> = {};
        for (const r of Object.keys(store.current)) { newOriginal[r] = { ...store.current[r] }; }
        store = { ...store, original: newOriginal };
        errorByCell.clear();
        showStatus('ok', fmt(L, 'savedChanges', saved.ok.length));
      } else {
        const newOriginal: Record<string, Record<string, string>> = {};
        for (const r of Object.keys(store.original)) { newOriginal[r] = { ...store.original[r] }; }
        for (const o of saved.ok) {
          const cur = store.current[o.row]?.[o.group];
          if (cur !== undefined) {
            if (!newOriginal[o.row]) { newOriginal[o.row] = {}; }
            newOriginal[o.row][o.group] = cur;
          }
        }
        errorByCell.clear();
        for (const e of saved.errors) { errorByCell.set(cellKey(e.row, e.group), e.reason); }
        store = { ...store, original: newOriginal };
        showStatus('error', fmt(L, 'savedPartial', saved.ok.length, saved.errors.length));
      }
      renderMatrix();
      renderDirty();
    }
  }

  window.addEventListener('message', ev => handleHost(ev.data));

  document.addEventListener('DOMContentLoaded', () => {
    $('btn-refresh').addEventListener('click', onRefreshClick);
    $('btn-revert').addEventListener('click', onRevertClick);
    $('btn-save').addEventListener('click', onSaveClick);
    $('row-filter').addEventListener('input', onFilterInput);
    $('matrix-wrap').addEventListener('change', onCellChange);
    document.querySelectorAll('.tab-bar .tab:not(.tab-action)').forEach(t => t.addEventListener('click', onTabClick));
    $('btn-view').addEventListener('click', () => vscode.postMessage({ type: 'openView' }));
    cfg.onReady?.(ui);
    vscode.postMessage({ type: 'ready' });
  });
}

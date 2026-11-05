/**
 * DOM-Refs + UI-presentational helpers (toast, banners, td-class refresh).
 *
 * `getRefs()` is called once at boot from index.ts and returns a frozen object
 * holding direct references to the static DOM nodes declared in the shell's
 * htmlBody. Subsequent modules consume the result. Returning a single frozen
 * object instead of separate exports avoids the import-time-side-effect issue
 * (modules can't run document.getElementById at parse time — DOM may not be
 * ready depending on how the bundle is injected).
 */

import { state } from './state';

export interface DomRefs {
  zoneRows: HTMLElement;
  zoneCols: HTMLElement;
  zoneTitles: HTMLElement;
  btnRefresh: HTMLButtonElement;
  btnReloadView: HTMLButtonElement;
  btnExport: HTMLButtonElement;
  cellCount: HTMLElement;
  loading: HTMLElement;
  placeholder: HTMLElement;
  gridContainer: HTMLElement;
  errorBanner: HTMLElement;
  warnBanner: HTMLElement;
  chkSuppRows: HTMLButtonElement;
  chkSuppCols: HTMLButtonElement;
  chkAutoRefresh: HTMLButtonElement;
  viewSelect: HTMLSelectElement;
}

let _refs: DomRefs | null = null;

function _required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) { throw new Error(`[cubeViewerMonaco] missing required DOM element: #${id}`); }
  return el as T;
}

export function initDomRefs(): DomRefs {
  if (_refs) return _refs;
  _refs = Object.freeze({
    zoneRows:      _required<HTMLElement>('zone-rows'),
    zoneCols:      _required<HTMLElement>('zone-cols'),
    zoneTitles:    _required<HTMLElement>('zone-titles'),
    btnRefresh:    _required<HTMLButtonElement>('btn-refresh'),
    btnReloadView: _required<HTMLButtonElement>('btn-reload-view'),
    btnExport:     _required<HTMLButtonElement>('btn-export'),
    cellCount:     _required<HTMLElement>('cell-count'),
    loading:       _required<HTMLElement>('loading'),
    placeholder:   _required<HTMLElement>('placeholder'),
    gridContainer: _required<HTMLElement>('grid-container'),
    errorBanner:   _required<HTMLElement>('error-banner'),
    warnBanner:    _required<HTMLElement>('warn-banner'),
    chkSuppRows:      _required<HTMLButtonElement>('chk-supp-rows'),
    chkSuppCols:      _required<HTMLButtonElement>('chk-supp-cols'),
    chkAutoRefresh:   _required<HTMLButtonElement>('chk-auto-refresh'),
    viewSelect:    _required<HTMLSelectElement>('view-select'),
  });
  return _refs;
}

export function getRefs(): DomRefs {
  if (!_refs) { throw new Error('[cubeViewerMonaco] getRefs() called before initDomRefs()'); }
  return _refs;
}

/** Read live title-zone selections from the DOM (not state, which lags on autoLoad).
 *  Lives here instead of in `actions.ts` because `grid.ts` needs it for the picklist arrow -
 *  via `actions.ts` this would run into a cycle (`actions → axis → grid`). */
export function getTitleAssignments(): Record<string, string> {
  const result: Record<string, string> = {};
  getRefs().zoneTitles
    .querySelectorAll<HTMLSelectElement>('.title-elem-sel')
    .forEach((sel) => {
      if (sel.dataset.dim && sel.value) result[sel.dataset.dim] = sel.value;
    });
  return result;
}

/** An open input field owns itself: key paths on the grid (Ctrl+C,
 *  Ctrl+V, Delete) keep away from it. Also covers the open cell editor
 *  - that is an `<input>` and has the focus. */
export function focusIsInput(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  const tag = ae?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!ae?.isContentEditable;
}

/** Reads aria-pressed state of a toggle button (suppress-rows / suppress-cols). */
export function isToggleOn(btn: HTMLButtonElement): boolean {
  return btn.getAttribute('aria-pressed') === 'true';
}

/** Sets aria-pressed state of a toggle button. */
export function setToggleOn(btn: HTMLButtonElement, on: boolean): void {
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// ── Presentational helpers ─────────────────────────────────────

const TOAST_TTL_MS = 3000;
const TOAST_MAX_STACK = 5;

function _toastContainer(): HTMLElement {
  let c = document.getElementById('cv-toast-stack');
  if (c) return c;
  c = document.createElement('div');
  c.id = 'cv-toast-stack';
  c.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:9999;'
    + 'display:flex;flex-direction:column-reverse;gap:6px;'
    + 'pointer-events:none;max-width:420px;';
  document.body.appendChild(c);
  return c;
}

export function showToast(text: string, kind: 'error' | 'success' = 'success'): void {
  const container = _toastContainer();
  // Cap stack — drop oldest (first child in column-reverse layout = newest visually,
  // so oldest is the LAST element we'd shift out)
  while (container.childElementCount >= TOAST_MAX_STACK) {
    container.removeChild(container.firstElementChild!);
  }
  const t = document.createElement('div');
  t.textContent = text;
  t.setAttribute('role', 'alert');
  t.setAttribute('aria-live', 'assertive');
  const bg = kind === 'error'
    ? 'var(--vscode-inputValidation-errorBackground)'
    : 'var(--vscode-editor-selectionBackground)';
  // Pair a foreground with the background. Without it the toast inherits the body
  // text colour, which is dark on the light-theme error background → unreadable.
  const fg = kind === 'error'
    ? 'var(--vscode-inputValidation-errorForeground, var(--vscode-foreground))'
    : 'var(--vscode-foreground)';
  const border = kind === 'error'
    ? 'var(--vscode-inputValidation-errorBorder, var(--vscode-panel-border))'
    : 'var(--vscode-panel-border)';
  t.style.cssText =
    `padding:8px 12px;background:${bg};color:${fg};`
    + `border:1px solid ${border};`
    + `border-radius:3px;font-size:12px;`
    + `word-wrap:break-word;pointer-events:auto;`
    + `opacity:0;transform:translateY(4px);`
    + `transition:opacity 140ms ease,transform 140ms ease;`;
  container.appendChild(t);
  // Force a frame so the transition kicks in
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateY(0)';
  });
  // Click to dismiss
  t.addEventListener('click', () => _removeToast(t));
  setTimeout(() => _removeToast(t), TOAST_TTL_MS);
}

function _removeToast(t: HTMLElement): void {
  if (!t.isConnected) return;
  t.style.opacity = '0';
  t.style.transform = 'translateY(4px)';
  setTimeout(() => { if (t.isConnected) t.remove(); }, 160);
}

export function showLoading(on: boolean): void {
  const r = getRefs();
  state.loading = on;
  r.loading.style.display = on ? 'flex' : 'none';
  r.btnRefresh.disabled = on;
  // While loading, the view button is dead as well; afterwards the selection in
  // the dropdown alone decides again (`viewPicker.ts#syncReloadViewEnabled`).
  r.btnReloadView.disabled = on || r.viewSelect.value === '__none__';
  if (on) {
    r.placeholder.style.display = 'none';
    r.gridContainer.style.display = 'none';
    r.errorBanner.style.display = 'none';
    r.warnBanner.style.display = 'none';
  }
}

export function showError(msg: string): void {
  const r = getRefs();
  r.errorBanner.textContent = msg;
  r.errorBanner.style.display = msg ? 'block' : 'none';
  r.loading.style.display = 'none';
  r.placeholder.style.display = 'none';
  r.gridContainer.style.display = 'none';
}

/**
 * Reset the cell-state classes on a `<td>` based on its current value.
 * Preserves flag classes (rule/consolidated/leaf/locked) that the caller put there.
 */
export function refreshTdClassByValue(td: HTMLTableCellElement, val: string | null | undefined): void {
  td.classList.remove('cell-empty', 'cell-zero', 'cell-numeric', 'cell-string', 'editing');
  if (!val) { td.classList.add('cell-empty'); return; }
  // String cell according to the server (`data-str`, set in grid.ts): always text.
  if (td.dataset.str === '1') { td.classList.add('cell-string'); return; }
  // Numeric only if the ENTIRE string is a number (with optional sign,
  // thousands dots/commas, decimal separator, % sign, whitespace).
  // Prevents: "Q1 Sales" → "1" → wrongly numeric.
  const trimmed = String(val).trim();
  const numeric = /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*%?$/.test(trimmed)
               || /^-?\d+(?:[.,]\d+)?\s*%?$/.test(trimmed);
  if (numeric) {
    const n = parseFloat(trimmed.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
    if (!isNaN(n) && n === 0) td.classList.add('cell-zero');
    else td.classList.add('cell-numeric');
  } else {
    td.classList.add('cell-string');
  }
}

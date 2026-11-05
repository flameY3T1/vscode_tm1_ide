/**
 * Cell-Range-Selection state + mouse handlers.
 *
 * Excel-style:
 *  - mousedown on a data cell:    start selection (anchor + {cell}); drag extends rectangle
 *  - shift-click on data cell:    extend rectangle from anchor to clicked cell
 *  - ctrl/cmd-click on data cell: toggle that cell in the selection (anchor unchanged)
 *  - mousedown elsewhere / Esc:   clear selection
 *
 * Selection state lives in `state.selection` as a Set of `${ri},${ci}` keys.
 * Anchor is the cell from which shift-extension and drag-extension grow.
 *
 * Re-render: state.selection survives a renderGrid call (so the user can spread
 * after pivoting the suppression toggle); the message handler clears it on
 * cellData (full reload) since indices may have shifted.
 */

import { state } from './state';
import { getRefs } from './dom';
import { writeClipboard } from '../_shared/clipboardWrite';

export function key(ri: number, ci: number): string { return `${ri},${ci}`; }

export function isSelected(ri: number, ci: number): boolean {
  return state.selection?.has(key(ri, ci)) ?? false;
}

export function clearSelection(): void {
  if (!state.selection) state.selection = new Set();
  if (state.selection.size === 0 && !state.selectionAnchor) return;
  state.selection.clear();
  state.selectionAnchor = null;
  updateSelectionReadout();
}

function _setRectangle(r1: number, c1: number, r2: number, c2: number): void {
  if (!state.selection) state.selection = new Set();
  state.selection.clear();
  const rmin = Math.min(r1, r2), rmax = Math.max(r1, r2);
  const cmin = Math.min(c1, c2), cmax = Math.max(c1, c2);
  for (let r = rmin; r <= rmax; r++) {
    for (let c = cmin; c <= cmax; c++) state.selection.add(key(r, c));
  }
}

/** Apply current selection state to all rendered td.cell-selected classes. */
export function paintSelection(): void {
  const refs = getRefs();
  const tds = refs.gridContainer.querySelectorAll<HTMLTableCellElement>('td[data-ri][data-ci]');
  tds.forEach((td) => {
    if (td.classList.contains('row-label')) return;
    const ri = Number(td.dataset.ri);
    const ci = Number(td.dataset.ci);
    const selected = isSelected(ri, ci);
    const anchor = state.selectionAnchor;
    const isAnchor = !!(anchor && anchor.ri === ri && anchor.ci === ci);
    td.classList.toggle('cell-selected', selected);
    td.classList.toggle('cell-anchor', isAnchor && selected);
  });
  updateSelectionReadout();
}

function _fmtAgg(n: number): string {
  return n.toLocaleString(state.numFmt.comma ? 'de-DE' : undefined, { maximumFractionDigits: 6 });
}

/** Update the floating readout to reflect the current selection: a single cell
 * shows its full-precision value; multiple cells show count, sum and average
 * over the numeric cells. Hidden when nothing is selected. */
export function updateSelectionReadout(): void {
  const pop = document.getElementById('cell-value-pop');
  if (!pop) { return; }
  const sel = state.selection;
  if (!sel || sel.size === 0) { pop.textContent = ''; pop.classList.remove('show'); return; }

  const raw = state.lastMatrix?.rawValues ?? {};
  const disp = state.lastMatrix?.values ?? {};

  if (sel.size === 1) {
    const k = sel.values().next().value as string;
    const shown = raw[k] ?? disp[k] ?? '';
    if (shown === '') { pop.textContent = ''; pop.classList.remove('show'); return; }
    pop.textContent = shown;
    pop.classList.add('show');
    return;
  }

  let sum = 0, numCount = 0;
  for (const k of sel) {
    const rv = raw[k] ?? disp[k];
    if (rv === undefined || rv === '') { continue; }
    const n = Number(rv);
    if (Number.isFinite(n)) { sum += n; numCount++; }
  }
  const parts = [`${sel.size} cells`];
  if (numCount > 0) {
    parts.push(`Σ ${_fmtAgg(sum)}`);
    parts.push(`ø ${_fmtAgg(sum / numCount)}`);
  }
  pop.textContent = parts.join('     ');
  pop.classList.add('show');
}

/** Build a tab/newline TSV of the selection's raw values (Excel-pasteable).
 * Spans the bounding box; cells outside the selection are left blank. */
function _selectionToTsv(): string {
  const sel = state.selection;
  if (!sel || sel.size === 0) { return ''; }
  const raw = state.lastMatrix?.rawValues ?? {};
  const disp = state.lastMatrix?.values ?? {};
  let rmin = Infinity, rmax = -Infinity, cmin = Infinity, cmax = -Infinity;
  for (const k of sel) {
    const [r, c] = k.split(',').map(Number);
    if (r < rmin) { rmin = r; } if (r > rmax) { rmax = r; }
    if (c < cmin) { cmin = c; } if (c > cmax) { cmax = c; }
  }
  const lines: string[] = [];
  for (let r = rmin; r <= rmax; r++) {
    const cells: string[] = [];
    for (let c = cmin; c <= cmax; c++) {
      const k = key(r, c);
      cells.push(sel.has(k) ? _fmtCopyValue(raw[k] ?? disp[k] ?? '') : '');
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/** When `tm1.cubeViewer.copyDecimalComma` is on (for a German Excel while VS Code
 * runs English), copy numeric values with a comma decimal separator so Excel
 * parses them as numbers instead of text. Non-numeric strings pass through. */
function _fmtCopyValue(v: string): string {
  if (v === '') { return v; }
  if (state.numFmt.comma && /^-?\d+\.\d+$/.test(v)) { return v.replace('.', ','); }
  return v;
}

let _dragging = false;

function _isDataCell(td: HTMLTableCellElement | null | undefined): td is HTMLTableCellElement {
  return !!td
    && td.dataset.ri !== undefined
    && td.dataset.ci !== undefined
    && !td.classList.contains('row-label');
}

export function wireSelection(): void {
  const refs = getRefs();

  refs.gridContainer.addEventListener('mousedown', (ev: MouseEvent) => {
    // Right-click handled by contextMenu; left-click only for selection.
    if (ev.button !== 0) return;
    const tgt = ev.target as Element | null;
    const td = tgt?.closest<HTMLTableCellElement>('td[data-ri][data-ci]');
    if (!_isDataCell(td)) return;
    const ri = Number(td.dataset.ri);
    const ci = Number(td.dataset.ci);

    if (ev.shiftKey && state.selectionAnchor) {
      _setRectangle(state.selectionAnchor.ri, state.selectionAnchor.ci, ri, ci);
      paintSelection();
      ev.preventDefault();
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      if (!state.selection) state.selection = new Set();
      const k = key(ri, ci);
      if (state.selection.has(k)) state.selection.delete(k);
      else state.selection.add(k);
      // Anchor only set when none exists, to keep ctrl-add additive
      if (!state.selectionAnchor) state.selectionAnchor = { ri, ci };
      paintSelection();
      ev.preventDefault();
      return;
    }
    // Plain click: anchor + single-cell, drag will extend
    state.selectionAnchor = { ri, ci };
    _setRectangle(ri, ci, ri, ci);
    _dragging = true;
    paintSelection();
    // Don't preventDefault — dblclick to start edit relies on default click flow
  });

  refs.gridContainer.addEventListener('mousemove', (ev: MouseEvent) => {
    if (!_dragging || !state.selectionAnchor) return;
    const tgt = ev.target as Element | null;
    const td = tgt?.closest<HTMLTableCellElement>('td[data-ri][data-ci]');
    if (!_isDataCell(td)) return;
    _setRectangle(
      state.selectionAnchor.ri, state.selectionAnchor.ci,
      Number(td.dataset.ri), Number(td.dataset.ci),
    );
    paintSelection();
  });

  // mouseup is window-level so a release outside the cell still ends drag
  window.addEventListener('mouseup', () => { _dragging = false; });

  // Esc clears selection (only when no editor / dropdown open)
  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable) return;
    if (!state.selection || state.selection.size === 0) return;
    clearSelection();
    paintSelection();
  });

  // Ctrl/Cmd+C copies the selection's raw values as TSV (Excel-pasteable). A
  // keydown handler fires reliably even with user-select:none (which suppresses
  // the native formatted-text copy); the 'copy' event can be skipped when there
  // is no text selection.
  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (!(ev.ctrlKey || ev.metaKey) || (ev.key !== 'c' && ev.key !== 'C')) return;
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable) return;
    if (!state.selection || state.selection.size === 0) return;
    ev.preventDefault();
    const tsv = _selectionToTsv();
    if (tsv !== '') { void writeClipboard(tsv); }
  });

  // Click outside the grid clears selection (e.g., on toolbar / title zone)
  document.addEventListener('mousedown', (ev: MouseEvent) => {
    if (ev.button !== 0) return;
    const tgt = ev.target as Element | null;
    if (!tgt) return;
    if (refs.gridContainer.contains(tgt)) return;
    if (!state.selection || state.selection.size === 0) return;
    clearSelection();
    paintSelection();
  });
}

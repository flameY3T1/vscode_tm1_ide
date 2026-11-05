/**
 * Row renderer for the cube grid: row-label cells (single- and multi-dim,
 * level-based indent, sticky columns) and the data cells with their flag
 * classes and display formatting.
 */

import { state } from './state';
import { isSelected } from './selection';
import { hasPicklist, cellTakesPicklist } from './gridPure';
import { applyDecimalSeparator } from './decimalSepPure';
import { formatTm1 } from './tm1FormatPure';
import { resolveDisplayFormat, hasDisplayFormats } from '../../cubeViewer/displayFormatPure';
import { escapeHtml as escHtml } from '../htmlUtils';
import type { GridCtx } from './gridAxes';
import { _dispElem, type ToggleHtml } from './gridLabels';
import { _colKey } from './gridHeader';
import { _applyColW, _rowDimLeft, _rowDimWidth } from './gridResize';

// Numeric-detection patterns hoisted out of the per-cell render loop:
// recompiling these for every cell was ~2 RegExp allocations × rows × cols.
const NUM_THOUSANDS_RE = /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*%?$/;
const NUM_SIMPLE_RE = /^-?\d+(?:[.,]\d+)?\s*%?$/;
const THOUSANDS_SEP_RE = /[.,](?=\d{3}\b)/g;

/** Displayed value for a cell: the server-formatted string by default, or a
 *  client-side reformat from the raw value when the number-format toolbar is
 *  engaged (fixed decimals + chosen separator).
 *
 *  Without a reformat the server representation is NOT re-rendered, only its
 *  separator is switched — otherwise the separator button would overwrite the
 *  number of decimal places set by the modeller and TM1's rounding (same line
 *  as `numberFormatPure.ts`). */
export function _fmtDisplay(raw: string | undefined, val: string | undefined, ri?: number, ci?: number): string {
  const nf = state.numFmt;
  const own = ri === undefined || ci === undefined ? undefined : _displayFormatAt(ri, ci);
  // A string cell stays text even when it looks like a number ("01223").
  const isText = ri !== undefined && ci !== undefined && state.lastMatrix?.cellFlags?.[`${ri},${ci}`]?.s === 1;
  if (own && !isText && raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return formatTm1(Number(raw), own, nf.comma ? { dec: ',', grp: '.' } : { dec: '.', grp: ',' });
  }
  if (!nf.reformat || raw === undefined) {
    return applyDecimalSeparator(val ?? '', raw, nf.comma);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) { return applyDecimalSeparator(val ?? raw, raw, nf.comma); }
  return n.toLocaleString(nf.comma ? 'de-DE' : 'en-US', {
    minimumFractionDigits: nf.decimals,
    maximumFractionDigits: nf.decimals,
  });
}

// Title picks of the last render: a changed title fetches new data and
// renders again, so they cannot go stale in between (and reading the title
// zone per cell is what `gridTitleAssignmentsHoisted` forbids).
let _renderTitles: Record<string, string> = {};

export function setRenderTitles(titles: Record<string, string>): void {
  _renderTitles = titles;
}

/** The user's display format for a cell, by TM1's own priority (see
 *  `displayFormatPure`). Beats the decimal buttons: it is the more specific
 *  wish. */
function _displayFormatAt(ri: number, ci: number): string | undefined {
  const m = state.lastMatrix;
  if (!m || !hasDisplayFormats(state.displayFormats)) { return undefined; }
  return resolveDisplayFormat(state.displayFormats, {
    colDims: m.colDims?.length ? m.colDims : state.colDims,
    colTuple: m.colTuples?.[ci] ?? [m.colElements[ci]],
    rowDims: m.rowDims?.length ? m.rowDims : state.rowDims,
    rowTuple: m.rowTuples?.[ri] ?? [m.rowElements[ri]],
    titles: _renderTitles,
  });
}

// Multi-dim row header: one sticky label cell per row dimension; a label is
// only drawn where the tuple prefix changed against the previous row.
function _appendMultiDimLabels(
  ctx: GridCtx, rowTuples: string[][], tr: HTMLTableRowElement, numHdrCols: number,
  _toggleHtml: ToggleHtml, ri: number, prevRi: number,
): void {
  const { rowElements, rowAxisDims, rowDepths, rowLevels, maxLvl } = ctx;
  const tuple = rowTuples[ri] || [rowElements[ri]];
  const prevTuple = prevRi >= 0 ? (rowTuples[prevRi] ?? null) : null;
  for (let di = 0; di < numHdrCols; di++) {
    const td = document.createElement('td');
    td.className = 'row-label';
    td.dataset.rowdimIdx = String(di);
    td.style.left = `${_rowDimLeft(di)}px`;
    _applyColW(td, _rowDimWidth(di));
    if (di === numHdrCols - 1) td.style.borderRight = '2px solid var(--vscode-editorGroup-border)';
    td.dataset.dimName = rowAxisDims[di];
    td.dataset.elemName = tuple[di] || '';
    if (tuple[di] && state.headerSelection?.[rowAxisDims[di]]?.has(tuple[di]!)) {
      td.classList.add('header-selected');
    }
    if (rowDepths && rowDepths[ri]) {
      const depth = rowDepths[ri][di] || 0;
      if (depth > 0) { td.style.paddingLeft = `${6 + depth * 14}px`; }
    } else if (rowLevels && maxLvl && maxLvl[di] > 0 && rowLevels[ri]) {
      const depth = maxLvl[di] - (rowLevels[ri][di] || 0);
      if (depth > 0) { td.style.paddingLeft = `${6 + depth * 14}px`; }
    }
    const changed = !prevTuple || tuple.slice(0, di + 1).some((v, i) => v !== prevTuple[i]);
    const lbl = changed ? _dispElem(rowAxisDims[di], tuple[di] || '') : '';
    const toggle = changed ? _toggleHtml('row', di, tuple[di] || '', ri) : '';
    td.innerHTML = toggle + escHtml(String(lbl));
    tr.appendChild(td);
  }
}

function _appendSingleDimLabel(ctx: GridCtx, tr: HTMLTableRowElement, _toggleHtml: ToggleHtml, ri: number): void {
  const { rowElements, rowAxisDims, rowDepths, rowLevels, maxLvl } = ctx;
  const td = document.createElement('td');
  td.className = 'row-label';
  if (state.rowHdrWidth) { _applyColW(td, state.rowHdrWidth); }
  td.dataset.dimName = rowAxisDims[0];
  td.dataset.elemName = rowElements[ri];
  if (rowAxisDims[0] && state.headerSelection?.[rowAxisDims[0]]?.has(rowElements[ri])) {
    td.classList.add('header-selected');
  }
  if (rowDepths && rowDepths[ri]) {
    const depth = rowDepths[ri][0] || 0;
    if (depth > 0) { td.style.paddingLeft = `${10 + depth * 14}px`; }
  } else if (rowLevels && maxLvl && maxLvl[0] > 0 && rowLevels[ri]) {
    const depth = maxLvl[0] - (rowLevels[ri][0] || 0);
    if (depth > 0) { td.style.paddingLeft = `${10 + depth * 14}px`; }
  }
  td.innerHTML = _toggleHtml('row', 0, rowElements[ri], ri) + escHtml(_dispElem(rowAxisDims[0], rowElements[ri]));
  tr.appendChild(td);
}

function _buildDataCell(ctx: GridCtx, ri: number, ci: number): HTMLTableCellElement {
  const { matrix, values, rawValues, cellFlags, titleAssignments } = ctx;
  const rawKey = `${ri},${ci}`;
  const val = _fmtDisplay(rawValues[rawKey], values[rawKey], ri, ci);
  const td = document.createElement('td');
  if (!val) {
    td.className = 'cell-empty';
  } else {
    const trimmed = String(val).trim();
    // String cell according to the server: left-aligned, even if the text looks like a number.
    const isNum = cellFlags[`${ri},${ci}`]?.s !== 1
      && (NUM_THOUSANDS_RE.test(trimmed) || NUM_SIMPLE_RE.test(trimmed));
    if (isNum) {
      const n = parseFloat(trimmed.replace(THOUSANDS_SEP_RE, '').replace(',', '.'));
      if (n === 0) { td.className = 'cell-zero'; td.textContent = val; }
      else         { td.className = 'cell-numeric'; td.textContent = val; }
    } else {
      td.className = 'cell-string'; td.textContent = val;
    }
  }
  const flag = cellFlags[`${ri},${ci}`];
  // `cell-leaf` is the counter-class to `cell-consolidated` and carries the
  // area marking, because in the viewer the consolidation is the normal
  // case: if it were tinted, the tint would be the background. The server
  // sends no flag at all for pure leaf cells (only c/r/u are transmitted),
  // so a missing flag means leaf. Unloaded pages cannot wrongly appear as
  // leaf here: in paged mode `rowIdx` is cut off above at `_loadedRowMax`.
  if (flag?.c) { td.classList.add('cell-consolidated'); }
  else { td.classList.add('cell-leaf'); }
  // For refreshTdClassByValue after a write: the type belongs to the cell,
  // not to the new text.
  if (flag?.s === 1) { td.dataset.str = '1'; }
  if (flag) {
    if (flag.r) td.classList.add('cell-rule');
    if (flag.u === 0) td.classList.add('cell-locked');
  }
  // Selection arrow. Rule, locked and consolidated cells do NOT get it:
  // there the editor either does not lead at all or — for a consolidation —
  // into the spread, which does not take a single list value. An arrow would
  // promise usability that does not exist.
  if (cellTakesPicklist(flag)
      && hasPicklist(matrix, ri, ci, state.dimensions, titleAssignments)) {
    td.classList.add('cell-picklist');
  }
  if (isSelected(ri, ci)) {
    td.classList.add('cell-selected');
    if (state.selectionAnchor?.ri === ri && state.selectionAnchor.ci === ci) {
      td.classList.add('cell-anchor');
    }
  }
  td.dataset.ri = String(ri);
  td.dataset.ci = String(ci);
  // Hover reveals the full-precision value when the display is rounded.
  const _raw = rawValues[`${ri},${ci}`];
  if (_raw !== undefined && _raw !== val) { td.title = _raw; }
  const _ck = _colKey(ctx, ci);
  td.dataset.colKey = _ck;
  const _cw = state.colWidths[_ck];
  if (_cw) { _applyColW(td, _cw); }
  return td;
}

// prevRi = ri of the previous row in rowIdx (-1 = none / force show).
// Pass -1 for the first rendered row of each virtual slice so the row
// header is always visible at the top of the viewport.
export function buildDataRow(
  ctx: GridCtx, colIdx: number[], numHdrCols: number, _toggleHtml: ToggleHtml,
  ri: number, prevRi: number,
): HTMLTableRowElement {
  const tr = document.createElement('tr');

  if (numHdrCols > 1 && ctx.rowTuples) {
    _appendMultiDimLabels(ctx, ctx.rowTuples, tr, numHdrCols, _toggleHtml, ri, prevRi);
  } else {
    _appendSingleDimLabel(ctx, tr, _toggleHtml, ri);
  }

  colIdx.forEach((ci) => {
    tr.appendChild(_buildDataCell(ctx, ri, ci));
  });

  return tr;
}

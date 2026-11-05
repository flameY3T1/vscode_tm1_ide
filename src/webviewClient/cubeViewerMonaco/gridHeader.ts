/**
 * Column-header renderer for the cube grid: corner cells (row-dim headings),
 * single- and multi-dim column header rows with grouped colspans.
 */

import { state } from './state';
import { escapeHtml as escHtml } from '../htmlUtils';
import type { GridCtx } from './gridAxes';
import { _dispElem, type ToggleHtml } from './gridLabels';
import { _applyColW, _rowDimLeft, _rowDimWidth } from './gridResize';

// Stable identity for a leaf data column (used to remember manual widths
// across re-renders). Tuple-join for multi-col-dim, else the element name.
export function _colKey(ctx: GridCtx, ci: number): string {
  const { colTuples, colElements } = ctx;
  return (colTuples && colTuples[ci]) ? colTuples[ci].join('\x00') : String(colElements[ci] ?? ci);
}

// Attach a width to a leaf header th and tag it with its column key, then add
// the drag handle. Re-applies any remembered width.
function _wireHeaderCol(ctx: GridCtx, th: HTMLElement, ci: number): void {
  const key = _colKey(ctx, ci);
  th.dataset.colKey = key;
  const w = state.colWidths[key];
  if (w) { _applyColW(th, w); }
  const rz = document.createElement('div');
  rz.className = 'col-resizer';
  rz.dataset.colKey = key;
  th.appendChild(rz);
}

function _makeCornerCells(rowAxisDims: string[], numHdrCols: number, hRow: HTMLTableRowElement, rowSpan: number): void {
  if (numHdrCols > 1) {
    // Each row-dim column is independently resizable; width+sticky-left come
    // from _rowDimWidth/_rowDimLeft (cumulative). The dim name is the heading.
    rowAxisDims.forEach((dimName, dri) => {
      const th = document.createElement('th');
      th.className = 'row-header-corner';
      th.rowSpan = rowSpan;
      th.dataset.rowdimIdx = String(dri);
      th.style.left = `${_rowDimLeft(dri)}px`;
      _applyColW(th, _rowDimWidth(dri));
      if (dri === numHdrCols - 1) th.style.borderRight = '2px solid var(--vscode-editorGroup-border)';
      th.innerHTML = '<span class="rowdim-head">' + escHtml(dimName) + '</span>';
      const rz = document.createElement('div');
      rz.className = 'col-resizer';
      rz.dataset.colKey = '__rowdim__' + dri;
      th.appendChild(rz);
      hRow.appendChild(th);
    });
  } else {
    // Single row-header column → resizable via __rowhdr__. Dim name as heading.
    const corner = document.createElement('th');
    corner.className = 'row-header-corner';
    corner.rowSpan = rowSpan;
    if (state.rowHdrWidth) { _applyColW(corner, state.rowHdrWidth); }
    corner.innerHTML = '<span class="rowdim-head">' + escHtml(rowAxisDims[0] || '') + '</span>';
    const rz = document.createElement('div');
    rz.className = 'col-resizer';
    rz.dataset.colKey = '__rowhdr__';
    corner.appendChild(rz);
    hRow.appendChild(corner);
  }
}

export function buildThead(
  ctx: GridCtx,
  colIdx: number[],
  numHdrCols: number,
  _toggleHtml: ToggleHtml,
): HTMLTableSectionElement {
  const { colTuples, colElements, colAxisDims, rowAxisDims } = ctx;
  const thead = document.createElement('thead');
  const numColDimRows = (colTuples && colAxisDims.length > 1) ? colAxisDims.length : 1;

  if (numColDimRows > 1 && colTuples) {
    for (let di = 0; di < colAxisDims.length; di++) {
      const hRow = document.createElement('tr');
      if (di === 0) { _makeCornerCells(rowAxisDims, numHdrCols, hRow, numColDimRows); }
      let ci2 = 0;
      while (ci2 < colIdx.length) {
        const ci = colIdx[ci2];
        const val = (colTuples[ci] && colTuples[ci][di]) || '';
        let span = 1;
        while (ci2 + span < colIdx.length) {
          const nextCi = colIdx[ci2 + span];
          const samePrefix = colTuples[nextCi] && colTuples[ci]
            && colTuples[nextCi].slice(0, di + 1).every((v, i) => v === colTuples[ci][i]);
          if (!samePrefix) { break; }
          span++;
        }
        const th = document.createElement('th');
        if (span > 1) { th.colSpan = span; }
        th.innerHTML = _toggleHtml('col', di, val, ci) + (val ? escHtml(_dispElem(colAxisDims[di], val)) : '');
        th.dataset.dimName = colAxisDims[di];
        th.dataset.elemName = val;
        if (val && state.headerSelection?.[colAxisDims[di]]?.has(val)) {
          th.classList.add('header-selected');
        }
        // Only the leaf header row maps 1:1 to data columns → resizable there.
        if (di === colAxisDims.length - 1 && span === 1) { _wireHeaderCol(ctx, th, ci); }
        hRow.appendChild(th);
        ci2 += span;
      }
      thead.appendChild(hRow);
    }
  } else {
    const headerRow = document.createElement('tr');
    _makeCornerCells(rowAxisDims, numHdrCols, headerRow, 1);
    colIdx.forEach((ci) => {
      const th = document.createElement('th');
      const val = colElements[ci];
      th.innerHTML = _toggleHtml('col', 0, val, ci) + escHtml(_dispElem(colAxisDims[0] || '', val));
      th.dataset.dimName = colAxisDims[0] || '';
      th.dataset.elemName = val;
      if (colAxisDims[0] && val && state.headerSelection?.[colAxisDims[0]]?.has(val)) {
        th.classList.add('header-selected');
      }
      _wireHeaderCol(ctx, th, ci);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
  }
  return thead;
}

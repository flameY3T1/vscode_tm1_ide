/**
 * Column widths for the cube grid: width helpers shared by the header and
 * row renderers, plus the delegated drag-to-resize handler.
 */

import { state } from './state';
import { getRefs } from './dom';

// ── Manual column resize ────────────────────────────────────────────────────
// Drag a column header's right-edge handle (.col-resizer) to set that column's
// width. Width is forced via width+min+max (so the column can also shrink) plus
// overflow/ellipsis. Client-only display state (state.colWidths / rowHdrWidth);
// never persisted into the saved TM1 view. The mousedown listener is delegated
// on the stable gridContainer (the <table> is rebuilt on every render), wired
// once via _resizeWired.
const MIN_COL_W = 48;
const MIN_ROWHDR_W = 80;
let _resizeWired = false;

export function _applyColW(cell: HTMLElement, w: number): void {
  cell.style.width = `${w}px`;
  cell.style.minWidth = `${w}px`;
  cell.style.maxWidth = `${w}px`;
  cell.style.overflow = 'hidden';
  cell.style.textOverflow = 'ellipsis';
}

function _applyWidthToColumn(container: HTMLElement, key: string, w: number): void {
  if (key === '__rowhdr__') {
    container.querySelectorAll<HTMLElement>('th.row-header-corner, td.row-label')
      .forEach((c) => _applyColW(c, w));
    return;
  }
  container.querySelectorAll<HTMLElement>('th[data-col-key], td[data-col-key]')
    .forEach((c) => { if (c.dataset.colKey === key) { _applyColW(c, w); } });
}

// ── Multi-dim row-header columns: per-column width + cumulative sticky left ──
// Each row-dim column can be resized independently; the sticky `left` of every
// column is the sum of preceding column widths (not a fixed ROW_HDR_W), so
// widening one column pushes the rest right. Helpers are module-level so the
// (closure-free) resize handler can recompute layout from state.renderedRowDims.
const DEFAULT_ROWDIM_W = 140;
export function _rowDimWidth(di: number): number {
  const d = state.renderedRowDims[di];
  return (d && state.rowDimWidths[d]) || DEFAULT_ROWDIM_W;
}
export function _rowDimLeft(di: number): number {
  let l = 0;
  for (let k = 0; k < di; k++) { l += _rowDimWidth(k); }
  return l;
}
function _applyRowDimLayout(container: HTMLElement): void {
  const n = state.renderedRowDims.length;
  for (let di = 0; di < n; di++) {
    const w = _rowDimWidth(di);
    const left = _rowDimLeft(di);
    container.querySelectorAll<HTMLElement>(`[data-rowdim-idx="${di}"]`).forEach((c) => {
      _applyColW(c, w);
      c.style.left = `${left}px`;
    });
  }
}

export function wireColumnResize(): void {
  if (_resizeWired) { return; }
  const container = getRefs().gridContainer as HTMLElement | undefined;
  if (!container) { return; }
  _resizeWired = true;

  // Capture-phase: a click that originated on a resizer must not reach the
  // table's header click handler (sort / collapse / header-select).
  container.addEventListener('click', (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest?.('.col-resizer')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  container.addEventListener('mousedown', (e: MouseEvent) => {
    const handle = (e.target as Element | null)?.closest?.<HTMLElement>('.col-resizer');
    if (!handle) { return; }
    e.preventDefault();
    e.stopPropagation();
    const key = handle.dataset.colKey || '';
    const isRowHdr = key === '__rowhdr__';
    const isRowDim = key.startsWith('__rowdim__');
    const rowDimIdx = isRowDim ? parseInt(key.slice('__rowdim__'.length), 10) : -1;
    const min = (isRowHdr || isRowDim) ? MIN_ROWHDR_W : MIN_COL_W;
    const headerCell = handle.parentElement as HTMLElement | null;
    const startW = headerCell ? headerCell.offsetWidth : min;
    const startX = e.clientX;
    document.body.style.userSelect = 'none';

    const onMove = (me: MouseEvent): void => {
      const w = Math.max(min, startW + (me.clientX - startX));
      if (isRowDim) {
        const dim = state.renderedRowDims[rowDimIdx];
        if (dim) { state.rowDimWidths[dim] = w; }
        _applyRowDimLayout(container); // recompute width+left for all row-dim cols
        return;
      }
      if (isRowHdr) { state.rowHdrWidth = w; } else { state.colWidths[key] = w; }
      _applyWidthToColumn(container, key, w);
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  });
}

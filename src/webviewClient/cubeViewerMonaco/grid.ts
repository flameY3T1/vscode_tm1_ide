/**
 * Grid renderer: builds the `<table>` body from a MatrixData payload.
 *
 * Responsibilities (split across the grid* modules in this folder):
 *  - Preserve server-returned tuple order (subset-defined or MDX-explicit)
 *  - Collapse-aware hide of descendants (`state.collapsed[dim][elem]`) — gridAxes.ts
 *  - Null-suppression (rows + cols, runs on full set BEFORE capping) — gridAxes.ts
 *  - Cap to MAX_COLS for DOM-size sanity (columns only — rows are virtualised) — gridAxes.ts
 *  - Multi-dim row headers with sticky columns + level-based indent — gridCells.ts
 *  - Multi-dim column headers with grouped colspans — gridHeader.ts
 *  - Cell flag classes (rule / consolidated / locked) — gridCells.ts
 *  - Click handler that toggles a clicked consolidation — gridClick.ts
 *  - Virtual scroll: only renders visible rows + VIRT_BUFFER above/below — here
 */

import { state } from './state';
import { vscode } from './vscodeApi';
import { getRefs, isToggleOn, getTitleAssignments } from './dom';
import type { MatrixData } from './state';
import { hasDisplayFormats } from '../../cubeViewer/displayFormatPure';
import { CELL_PAGE_ROWS_CLIENT } from './pageMerge';
import { getL10n, fmt } from '../_shared/l10n';
import { cancelPendingPicklistBeforeRerender } from './pendingEditGuard';
import { buildGridCtx, computeVisibleAxes, MAX_COLS } from './gridAxes';
import { makeToggleHtml } from './gridLabels';
import { buildThead } from './gridHeader';
import { buildDataRow as buildRowFor, _fmtDisplay, setRenderTitles } from './gridCells';
import { wireColumnResize } from './gridResize';
import { wireGridClick } from './gridClick';

const L = getL10n();

const VIRT_BUFFER = 15; // extra rows above + below the visible viewport

// ── Virtual-scroll state ───────────────────────────────────────────────────
// Cleaned up every time renderGrid is called so stale scroll listeners from
// a previous matrix don't interfere with the freshly-built table.
let _virtCleanup: (() => void) | null = null;

function _detachVirtScroll(): void {
  if (_virtCleanup) { _virtCleanup(); _virtCleanup = null; }
}

/** "Server format" is visible while anything overrides the server's rendering:
 *  the decimal buttons or a display format from the format dialog. */
export function syncResetButton(): void {
  const btn = document.getElementById('btn-dec-reset');
  if (btn) { btn.hidden = !(state.numFmt.reformat || hasDisplayFormats(state.displayFormats)); }
}

/** Re-apply the current number format to already-rendered data cells in place
 *  (no full re-render → keeps scroll position). Called when a toolbar control
 *  changes the separator or decimal count. */
export function applyNumberFormat(): void {
  if (!state.lastMatrix) { return; }
  const raw = state.lastMatrix.rawValues ?? {};
  const vals = state.lastMatrix.values ?? {};
  const cells = document.querySelectorAll<HTMLElement>(
    'td.cell-numeric, td.cell-zero, td.cell-string, td.cell-empty',
  );
  cells.forEach((td) => {
    const ri = td.dataset.ri, ci = td.dataset.ci;
    if (ri === undefined || ci === undefined) { return; }
    const key = `${ri},${ci}`;
    const disp = _fmtDisplay(raw[key], vals[key], Number(ri), Number(ci));
    td.textContent = disp;
    const rv = raw[key];
    if (rv !== undefined && rv !== disp) { td.title = rv; } else { td.removeAttribute('title'); }
  });
}

export function renderGrid(matrix: MatrixData): void {
  // Single choke point (Fix round 1, Finding 1): every renderGrid call — not
  // just the 5 message-driven paths messaging.ts guards individually via
  // `_cancelEditorBeforeRerender` — is about to replace `<td>`s. A pending
  // picklist editor (no focused control, so no blur fired to close it on its
  // own) would otherwise survive pointing at a `<td>` this call is about to
  // detach; see `editor.ts#applyPicklistValues`'s `td.isConnected` comment.
  cancelPendingPicklistBeforeRerender();
  _detachVirtScroll();

  if (!matrix) return;
  const refs = getRefs();
  // Capture the live scroll position BEFORE the table is rebuilt (innerHTML=''
  // resets scrollTop to 0). Restored after the body slice renders so a cellPage
  // re-render keeps the viewport instead of jumping back to the top.
  const _savedScrollTop = state.holdScrollTop ?? refs.gridContainer.scrollTop;
  state.holdScrollTop = null;
  state.lastMatrix = matrix;

  // ONCE per render, not per cell (review 2026-08-13, finding 2): the call
  // used to be an argument of the `hasPicklist(...)` call in the cell
  // renderer, and arguments are evaluated BEFORE the body — so the cheap early
  // exit in `hasPicklist` never came into play. Every drawn cell paid a
  // `querySelectorAll` over the title zone plus an allocation; at the cell
  // upper limit that is tens of thousands per render, even for users without a
  // single picklist. The value may be held for the whole render run (including
  // the slices drawn later by `renderBodySlice`): a changed title assignment
  // fetches new data and calls `renderGrid` again.
  const titleAssignments = getTitleAssignments();
  setRenderTitles(titleAssignments);
  const ctx = buildGridCtx(matrix, titleAssignments);
  const { rowTuples, rowAxisDims } = ctx;

  const suppRows = isToggleOn(refs.chkSuppRows);
  const suppCols = isToggleOn(refs.chkSuppCols);
  const { rowIdx, colIdx, structRowIdx, structColIdx, sizedCapped } = computeVisibleAxes(ctx, suppRows, suppCols);

  // Publish the final form — `paste.ts` maps targets via these lists instead of
  // via raw row/column counts (see the comment at `state.renderedRowIdx`).
  state.renderedRowIdx = rowIdx.slice();
  state.renderedColIdx = colIdx.slice();

  // ── Banners ──────────────────────────────────────────────
  const msgs: string[] = [];
  if (sizedCapped) {
    msgs.push(fmt(L, 'cappedColsOnly', MAX_COLS));
  }
  refs.warnBanner.style.display = msgs.length ? 'block' : 'none';
  refs.warnBanner.textContent = msgs.join('  ');

  refs.cellCount.textContent = state.paged
    ? fmt(L, 'pagedCount', rowIdx.length, state.totalRows ?? 0, colIdx.length)
    : fmt(L, 'cellCount', rowIdx.length, colIdx.length);

  // ── Table structure ──────────────────────────────────────
  // Expose the row-dim list to the (closure-free) resize handler for cumulative offsets.
  state.renderedRowDims = rowAxisDims;
  const numHdrCols = (rowTuples && rowAxisDims.length > 1) ? rowAxisDims.length : 1;
  const totalCols  = numHdrCols + colIdx.length;

  const toggleHtml = makeToggleHtml(ctx, structRowIdx, structColIdx);

  const table = document.createElement('table');
  table.className = 'cube-table';

  // ── Header ───────────────────────────────────────────────
  table.appendChild(buildThead(ctx, colIdx, numHdrCols, toggleHtml));

  // ── Row renderer (bound to this render) ──────────────────
  const buildDataRow = (ri: number, prevRi: number): HTMLTableRowElement =>
    buildRowFor(ctx, colIdx, numHdrCols, toggleHtml, ri, prevRi);

  // ── DOM attachment ───────────────────────────────────────
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  refs.gridContainer.innerHTML = '';
  refs.gridContainer.appendChild(table);
  refs.gridContainer.style.display = 'block';
  refs.placeholder.style.display = 'none';
  // Delegated column-resize handler on the stable container (wired once).
  wireColumnResize();
  refs.btnExport.style.display = '';

  // Sticky-top fix for multi-row column headers
  const theadRows = Array.from(table.querySelectorAll<HTMLTableRowElement>('thead tr'));
  let theadH = 0;
  if (theadRows.length > 1) {
    let cumTop = 0;
    theadRows.forEach((tr) => {
      tr.querySelectorAll<HTMLTableCellElement>('th').forEach((th) => { th.style.top = `${cumTop}px`; });
      cumTop += tr.offsetHeight || 27;
    });
    theadH = cumTop;
  } else if (theadRows.length === 1) {
    theadH = theadRows[0].offsetHeight || 27;
  }

  // Align axis-bar "Spalten" zone with first data column start
  const firstDataTh = table.querySelector<HTMLTableCellElement>('thead tr:last-child th:not(.row-header-corner)');
  if (firstDataTh) {
    const gridLeft = refs.gridContainer.getBoundingClientRect().left;
    const dataLeft = firstDataTh.getBoundingClientRect().left;
    const rowsZoneW = Math.max(120, Math.round(dataLeft - gridLeft));
    document.documentElement.style.setProperty('--cv-rows-zone-w', `${rowsZoneW}px`);
  }

  // ── Virtual scroll ───────────────────────────────────────
  // Measure row height via one sample row; fall back to 24px if not in DOM yet.
  let rowH = 24;
  if (rowIdx.length > 0) {
    const sampleTr = buildDataRow(rowIdx[0], -1);
    tbody.appendChild(sampleTr);
    rowH = Math.max(1, sampleTr.offsetHeight || 24);
    tbody.innerHTML = '';
  }

  // Rebuild tbody with slice [from, to) plus top/bottom spacer rows.
  function renderBodySlice(startRow: number): void {
    const container = refs.gridContainer;
    const viewH   = Math.max(50, container.clientHeight - theadH);
    const visible = Math.ceil(viewH / rowH) + 1;
    const from    = Math.max(0, startRow - VIRT_BUFFER);
    const to      = Math.min(rowIdx.length, startRow + visible + VIRT_BUFFER);

    // Paged mode: scrolling into not-yet-loaded rows triggers a server cell page.
    // Reached the bottom of the loaded rows → stream the next contiguous page,
    // which grows _loadedRowMax and (on re-render) extends the scrollbar.
    if (state.paged && !state._cellPagePending && to >= rowIdx.length && state._loadedRowMax < state.totalRows) {
      state._cellPagePending = true;
      vscode.postMessage({
        type: 'fetchCellPage', startRow: state._loadedRowMax, rowCount: CELL_PAGE_ROWS_CLIENT,
        cellsetId: state.cellsetId ?? undefined,
      });
    }

    const newTbody = document.createElement('tbody');

    if (from > 0) {
      const sp = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = totalCols;
      td.style.cssText = `height:${from * rowH}px;padding:0;border:0;background:none`;
      sp.appendChild(td);
      newTbody.appendChild(sp);
    }

    for (let i = from; i < to; i++) {
      // prevRi = -1 for first rendered row so header always shows at viewport top
      const prevRi = i === from ? -1 : rowIdx[i - 1];
      newTbody.appendChild(buildDataRow(rowIdx[i], prevRi));
    }

    if (to < rowIdx.length) {
      const sp = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = totalCols;
      td.style.cssText = `height:${(rowIdx.length - to) * rowH}px;padding:0;border:0;background:none`;
      sp.appendChild(td);
      newTbody.appendChild(sp);
    }

    table.replaceChild(newTbody, table.tBodies[0]);
  }

  // Initial render — at the saved scroll position so a paged re-render (after a
  // cellPage merge calls renderGrid again) keeps the viewport instead of jumping to top.
  renderBodySlice(Math.max(0, Math.floor(_savedScrollTop / rowH)));
  // Restore the live scroll position: the body slice sized its spacers to the full
  // loaded height, so the container is tall enough for scrollTop to stick.
  refs.gridContainer.scrollTop = _savedScrollTop;

  // Attach scroll virtualizer when content taller than one viewport
  if (rowIdx.length > 0 && rowIdx.length * rowH > refs.gridContainer.clientHeight - theadH) {
    let _raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(_raf);
      _raf = requestAnimationFrame(() => {
        const startRow = Math.max(0, Math.floor(refs.gridContainer.scrollTop / rowH));
        renderBodySlice(startRow);
      });
    };
    refs.gridContainer.addEventListener('scroll', onScroll, { passive: true });
    _virtCleanup = (): void => {
      cancelAnimationFrame(_raf);
      refs.gridContainer.removeEventListener('scroll', onScroll);
    };
  }

  wireGridClick(table, ctx, renderGrid);
}

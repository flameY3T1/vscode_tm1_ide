import {
  viewRowsHtml, ROW_H_FALLBACK, viewportRange, spacerHtml, VBUFFER,
  attrHeadHtml, colgroupHtml, tableMinWidth,
} from './viewRender';
import { isMarked } from './viewMarks';
import { rafThrottle } from './pure';
import { attrColLabel } from './viewControls';
import { attrColumns, columnWidth } from './attrColumns';
import { vr } from './viewRun';
import { fetchRows } from './viewFetch';

/**
 * The measured height of ONE row, in pixels.
 *
 * NOT a constant. `height: 22px` on `.dim-table tbody tr` is a minimum, not
 * a cap: the content can push the row beyond it, and the screen scaling
 * shifts it additionally. With today's padding (`1px 10px`,
 * `dimensionBrowserCss.ts`) it is 22.000px up to font size 14 and across all
 * screen scalings (measured 2026-08-24). That the height CAN fluctuate at all was
 * shown by the values before this rework with the padding of the time (`2px 6px`):
 * 22.547 / 22.350 / 22.208 at deviceScaleFactor 1 / 1.25 / 1.5 - not the
 * current state, only the evidence.
 * The virtualizer computes placeholders from the currently measured number; on
 * 295,000 rows even a 0.547px deviation is 7,333 rows of offset.
 */
let rowH: number = ROW_H_FALLBACK;
/** Measured height of the header row; 0 without attribute columns (see `measureHeadH`). */
let headH = 0;
/**
 * Must the row/header height be measured AGAIN on the next draw?
 *
 * Measuring means `getBoundingClientRect()` on a just-written
 * `<tbody>` - for that the renderer has to lay out immediately instead of collecting until the end of
 * the frame. On a dragged scrollbar this was a forced reflow per
 * frame (review 2026-08-24, H7). The height can only change, however,
 * when font/zoom change (`resize`), when rows exist at all for the first time
 * (first response), or when the column selection rebuilds the header - and
 * exactly these three set the flag. Plain scrolling no longer measures.
 */
let rowHDirty = true;
/**
 * How deep is `drawWindow()` currently inside its own re-measurement?
 *
 * The self-recursion so far terminated only under the assumption that two
 * measurements return the same value. But `measureRowH` measures the first row of the
 * SLICE, and the slice depends on `rowH`: with non-uniform
 * row heights an oscillation is structurally possible (never observed live).
 */
let remeasureDepth = 0;
/** Column count of the last draw — if it changes, the header height must be measured again. */
let lastColumnCount = -1;
/** Has `resize` already been listened to? */
let resizeBound = false;
let scrollBound = false;

/**
 * The height of a real data row - or the fallback.
 *
 * Measured on `tr.vw-row`, NOT on the placeholder: that one is arbitrarily high.
 *
 * The fallback covers two cases, and both are real: the test environment has
 * no layout (vitest without jsdom), and the container is still on `display: none`
 * at the first draw (the same situation that forced the
 * `|| window.innerHeight || 800` fallback in the old drawing path).
 */
/**
 * The height of the header row - measured, not set (fix round 2, finding 3).
 *
 * The same reasoning as for the row height: it depends on font size,
 * zoom and theme padding. An empty `<thead>` (no attribute column selected)
 * measures 0 - then `viewportRange` computes bit-identically to before.
 */
function measureHeadH(head: unknown): number {
  const h = head as { getBoundingClientRect?: () => { height: number } } | null;
  if (!h || typeof h.getBoundingClientRect !== 'function') { return 0; }
  const px = h.getBoundingClientRect().height;
  return px > 0 ? px : 0;
}

function measureRowH(body: unknown): number {
  const b = body as { querySelector?: (s: string) => unknown } | null;
  if (!b || typeof b.querySelector !== 'function') { return ROW_H_FALLBACK; }
  const firstRow = b.querySelector('tr.vw-row') as
    { getBoundingClientRect?: () => { height: number } } | null;
  if (!firstRow || typeof firstRow.getBoundingClientRect !== 'function') { return ROW_H_FALLBACK; }
  const h = firstRow.getBoundingClientRect().height;
  return h > 0 ? h : ROW_H_FALLBACK;
}

/** For tests only. */
export function _rowHForTest(): number { return rowH; }
/** For tests only. */
export function _measureRowHForTest(body: unknown): number { return measureRowH(body); }

/** The row height the virtualizer currently computes with. */
export function rowHeight(): number { return rowH; }

/** The next draw must measure row and header height again (see `rowHDirty`). */
export function markRowHDirty(): void { rowHDirty = true; }

/** For tests only: reset the viewport state. */
export function _resetViewportForTest(): void {
  rowH = ROW_H_FALLBACK; headH = 0; resizeBound = false; scrollBound = false;
  rowHDirty = true; remeasureDepth = 0; lastColumnCount = -1;
}


/**
 * Write the VISIBLE SLICE into the table body.
 *
 * Virtualized: on top a placeholder for everything skipped, then the
 * rows that fit into the field of view (plus `VBUFFER` above and below), then
 * a placeholder for the rest. The DOM thus stays constant, whether the
 * set has 40 rows or 295,000 - measured 2026-08-24: ~13 KB of DOM per row,
 * an unvirtualized 295,000-row dimension would be ~3.8 GB.
 *
 * Idempotent and callable for any reason: response, marking, count,
 * scrolling, resizing. There is no second drawing path any more - the
 * formerly separate appending (`appendView`) is gone, because a rebuild
 * now costs ~52 rows instead of 20,000.
 */
export function drawWindow(): void {
  const body = document.getElementById('table-body');
  if (!body) { return; }
  const c = document.getElementById('table-container');
  const geo = c as unknown as { scrollTop: number; clientHeight: number } | null;
  const viewH = (geo && geo.clientHeight) || 800;
  const a = viewportRange(vr.rows.length, geo ? geo.scrollTop : 0, viewH, rowH, VBUFFER, headH);

  // Columns from `attrColumns()` - the renderer only paints what is chosen,
  // it decides nothing about that itself (task 5 contract).
  const columns = attrColumns();
  const cols = document.getElementById('table-cols');
  // `colgroupHtml` delivers the WHOLE `<colgroup>...</colgroup>` frame (see
  // test) - only the content is needed here, otherwise the `id` would be lost at the
  // next draw and `getElementById('table-cols')` would never find
  // the element again.
  if (cols) { cols.innerHTML = colgroupHtml(columns, columnWidth).replace(/^<colgroup>|<\/colgroup>$/g, ''); }
  const head = document.getElementById('table-head');
  if (head) { head.innerHTML = attrHeadHtml(columns, columnWidth, attrColLabel); }
  // Minimum width of the table (fix round 2, finding 4): it keeps the
  // name column open and lets the table protrude beyond the container as soon as
  // the attribute columns need more room than there is - then
  // `#table-container` scrolls horizontally. Empty without columns, hence as before.
  const tab = document.getElementById('dim-table') as { style?: { minWidth: string } } | null;
  if (tab && tab.style) { tab.style.minWidth = tableMinWidth(columns, columnWidth); }

  body.innerHTML = spacerHtml(a.topPx, columns.length)
    + viewRowsHtml(vr.rows.slice(a.start, a.end), a.start, isMarked, vr.total ?? -1, columns)
    + spacerHtml(a.botPx, columns.length);
  // Write the clamped state back, otherwise the next pass computes
  // with the old one again (scar 1). Deliberately stands BEHIND the `innerHTML`, in the
  // same write block: a write between two reads turns
  // one frame into two layout passes (review 2026-08-24, H7).
  if (geo && geo.scrollTop !== a.scrollTop) { geo.scrollTop = a.scrollTop; }

  // If the column count changes, the header row rebuilds - then its height must
  // be measured again, even if nothing else has set the flag.
  if (columns.length !== lastColumnCount) { lastColumnCount = columns.length; rowHDirty = true; }

  // Measuring happens ONLY when something may have changed (see `rowHDirty`).
  // Plain scrolling passes by here, and exactly that was the reflow per frame
  // (review 2026-08-24, H7).
  //
  // The flag is a field of its own and NOT "rowH is still at the
  // fallback value": a real measurement may yield 22 - then the
  // condition would be permanently true and the reflow back, without anyone noticing
  // (exactly this was caught by `dimBrowserRowHeightNoReflow.test.ts`).
  //
  // Comparison is with a tolerance, NOT with `!==`: `getBoundingClientRect()`
  // returns a floating-point value, and the change is never smaller than 0.01px.
  if (rowHDirty) {
    const measuredRowH = measureRowH(body);
    // The header row likewise: it appears/disappears with the column selection,
    // and the slice just painted was then computed with the old height.
    const measuredHeadH = measureHeadH(head);
    rowHDirty = false;
    if (Math.abs(measuredRowH - rowH) > 0.01 || Math.abs(measuredHeadH - headH) > 0.01) {
      rowH = measuredRowH; headH = measuredHeadH;
      // Re-adjust at most twice. If the measurement does not terminate by itself
      // (non-uniform row heights), a slightly wrong slice is the
      // lesser evil compared to an endless loop in the renderer - and the case should
      // be visible instead of silently running on.
      if (remeasureDepth >= 2) {
        console.warn('[dimbrowser] Zeilenhoehe pendelt (rowH=' + rowH + ', headH=' + headH + ') — Nachmessen abgebrochen');
      } else {
        remeasureDepth++;
        try { drawWindow(); } finally { remeasureDepth--; }
        return;
      }
    }
  }

  bindResize();
  bindScroll();
  // Reloading belongs HERE, not in a scroll listener of its own: the
  // renderer is the only one that knows which position at the bottom is currently visible.
  if (vr.hasMore && !vr.fetching && a.end >= vr.rows.length - VBUFFER) { fetchRows(true); }
}

/**
 * Scrolling draws. Bound on the container, once - like `bindClick`.
 *
 * THROTTLED to one pass per frame: `scroll` fires several times per frame with
 * a pressed wheel and during dragging, and every pass replaces the
 * whole table body. Everything except the last rebuild of a frame is
 * wasted work - and during a drag it costs double, because every
 * rebuild throws away the row under the pointer and Chromium has to re-resolve
 * the drop target (report 2026-08-04: "follows slowly upward").
 *
 * The reloading lives in the renderer, not here: two listeners on the same
 * event with different thresholds would be the next trap.
 */
export function bindScroll(): void {
  if (scrollBound) { return; }
  const c = document.getElementById('table-container');
  if (!c) { return; }
  scrollBound = true;
  c.addEventListener('scroll', rafThrottle(
    drawWindow,
    (cb) => (typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(cb)
      : (cb(), 0)),
  ));
}

/**
 * Draw size changes - and re-measure beforehand.
 *
 * Font-size and zoom changes arrive here: both change the
 * row height (measured 2026-08-24), and with the old number the
 * virtualizer afterwards pointed at the wrong place.
 *
 * `window` is not there in the test environment (vitest without jsdom) - the binding
 * is therefore optional, not a prerequisite.
 */
function bindResize(): void {
  if (resizeBound) { return; }
  const w = (globalThis as { addEventListener?: (t: string, h: () => void) => void });
  if (typeof w.addEventListener !== 'function') { return; }
  resizeBound = true;
  w.addEventListener('resize', () => {
    // A font or zoom change is the only way in which the row height can change
    // without new rows - so measuring happens here and the flag
    // for the renderer is set.
    const body = document.getElementById('table-body');
    const measuredRowH = measureRowH(body);
    // Tolerance as in `drawWindow()`: `getBoundingClientRect()` returns
    // a floating-point value, `!==` never hit it reliably.
    if (Math.abs(measuredRowH - rowH) > 0.01) { rowH = measuredRowH; }
    rowHDirty = true;
    drawWindow();
  });
}

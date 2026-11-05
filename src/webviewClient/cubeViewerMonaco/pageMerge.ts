import type { MatrixData } from './state';

/**
 * Rows the client ASKS for per scroll-loaded cell page — an upper bound, not a
 * promise. The host sizes pages by cells (`cellBudgetPure.ts`) and clamps this
 * request down for wide views, so a page may come back much shorter; a 1.000
 * column view delivers ~50 rows. That is not drift to be "fixed": the watermark
 * below advances by the rows actually delivered, so a short page self-corrects.
 * Only the host knows `numCols`, so only the host can size the page.
 *
 * Defined here (a pure module) so `grid.ts` and `messaging.ts` share one value.
 */
export const CELL_PAGE_ROWS_CLIENT = 10000;

/**
 * Advance the loaded-row watermark after merging a cell page. Uses the actual
 * number of rows delivered (`rowElements.length`, one entry per row) so the
 * last short page lands exactly on `totalRows`; falls back to `fallback` when
 * the page carried no row headers. Never moves the watermark backwards.
 */
export function nextLoadedRowMax(
  current: number,
  startRow: number,
  rowElements: readonly string[] | undefined,
  fallback: number,
): number {
  const pageRows = rowElements?.length ?? fallback;
  return Math.max(current, startRow + pageRows);
}

/** Write a scroll-loaded page of row headers into the matrix at its absolute offset. */
export function mergeRowPage(
  m: MatrixData,
  startRow: number,
  page: { rowElements?: string[]; rowTuples?: string[][]; rowLevels?: number[][] | null },
): void {
  if (page.rowElements) {
    page.rowElements.forEach((e, i) => { m.rowElements[startRow + i] = e; });
  }
  if (page.rowTuples) {
    if (!m.rowTuples) { m.rowTuples = []; }
    page.rowTuples.forEach((t, i) => { m.rowTuples![startRow + i] = t; });
  }
  if (page.rowLevels) {
    if (!m.rowLevels) { m.rowLevels = []; }
    page.rowLevels.forEach((l, i) => { m.rowLevels![startRow + i] = l; });
  }
}

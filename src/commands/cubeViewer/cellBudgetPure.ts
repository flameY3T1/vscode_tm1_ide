/**
 * Cell-page sizing for the cube viewer.
 *
 * Paging used to be measured in ROWS only (a flat 10.000), while the request
 * actually asks for `rowCount * numCols` cells. A view with 200 columns pulled
 * 2 million cell objects per page, 1.000 columns pulled 10 million — REST JSON,
 * parsed objects and three string-keyed hash tables live at the same time, so
 * the peak is a multiple of the payload. Budgeting CELLS instead of rows makes
 * the page cost independent of how wide the view is.
 *
 * Pure by contract (`pure-no-vscode`, depcruise-enforced).
 */

/** Rows per page for narrow views — the historical page size, kept as the cap. */
export const CELL_PAGE_ROWS = 10000;

/** Max cells fetched per page. Review recommended 25k–100k; 50k sits mid-range. */
export const CELL_PAGE_BUDGET = 50000;

/**
 * Rows to request for a page of a view that is `numCols` wide.
 *
 * Always >= 1: a view wider than the whole budget must still page, otherwise
 * scrolling can never advance.
 */
export function rowsForCellBudget(numCols: number): number {
  const cols = Number.isFinite(numCols) && numCols > 0 ? Math.floor(numCols) : 1;
  const byBudget = Math.floor(CELL_PAGE_BUDGET / cols);
  return Math.max(1, Math.min(CELL_PAGE_ROWS, byBudget));
}

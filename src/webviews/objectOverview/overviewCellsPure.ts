// src/webviews/objectOverview/overviewCellsPure.ts
// Cell-level contract of the generic object overviews, in ONE place: how a cell
// value maps to a rendered state, and how a lazy patch lands on a row.
// Host configs (commands/*OverviewConfig.ts) and the client bundle
// (webviewClient/objectOverview) both import from here — a config must not
// re-invent what "no value" looks like.

import type { CellValue, ColumnDef, ColumnPatch, OverviewRow } from './overviewTypes';

/**
 * The one explicit "resolved, but there is no value" sentinel for a cell.
 *
 * `null`/absent means *still loading* (that is what `buildCubeRows` & friends
 * seed a lazy cell with), so a failed lazy fetch MUST NOT patch `null` back —
 * the cell would spin forever. Patch `NO_VALUE` instead; it is recognised
 * whatever the column kind is (a flag column would otherwise read the string as
 * truthy and show "✓"), and it sorts last in both directions (number columns via
 * `numOrNull`, text columns via `isPlaceholderText`).
 */
export const NO_VALUE = '—';

/** What a cell should render: a spinner, the no-value placeholder, or the value. */
export type CellDisplay = 'loading' | 'empty' | 'value';

/** Classify a cell value against the loading/no-value contract above. */
export function cellDisplayState(col: ColumnDef, v: CellValue | undefined): CellDisplay {
  if (v === NO_VALUE) { return 'empty'; }
  if (col.lazy && (v === undefined || v === null)) { return 'loading'; }
  return 'value';
}

/** Apply lazy cell patches to `rows` in place (rows are keyed by `id`). */
export function applyCellPatches(rows: OverviewRow[], patches: ColumnPatch[]): void {
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const p of patches) {
    const r = byId.get(p.rowId);
    if (!r) { continue; }
    r.cells[p.columnKey] = p.value;
    if (p.badgeTitles) { (r.badgeTitles ??= {})[p.columnKey] = p.badgeTitles; }
    // Raw sort key behind a formatted value (e.g. bytes behind "1.02 GB").
    if (p.sortValue !== undefined) {
      (r.sortValues ??= {})[p.columnKey] = p.sortValue;
    } else if (r.sortValues) {
      // A later patch WITHOUT a raw key must drop the previous one, otherwise
      // the cell displays "—" while still sorting as the stale byte count.
      delete r.sortValues[p.columnKey];
    }
  }
}

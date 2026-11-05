// src/webviews/objectOverview/overviewTypes.ts
// Shared data contracts for the generic object-overview webviews (processes,
// dimensions, cubes). Host, client bundle, and pure mappers all import these.

export type ColumnKind = 'text' | 'number' | 'badges' | 'flag' | 'link';

/** Describes one table column; drives generic header + cell rendering. */
export interface ColumnDef {
  key: string;
  label: string;
  kind: ColumnKind;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  /** Value arrives later via a `patch` message; render a spinner until then. */
  lazy?: boolean;
}

/** Describes one KPI tile shown above the table. */
export interface KpiDef {
  key: string;
  label: string;
}

export type CellValue = string | number | boolean | string[] | null;

/** One row. `id` is the stable object name; `cells` keyed by ColumnDef.key. */
export interface OverviewRow {
  id: string;
  isControl: boolean;
  cells: Record<string, CellValue>;
  /**
   * Raw numeric sort keys for columns whose cell is a formatted string (e.g.
   * RAM: the byte count behind "1.02 GB"). Keyed by ColumnDef.key; a column
   * that carries one sorts numerically on it, whatever its `kind` says.
   */
  sortValues?: Record<string, number>;
  /** Tooltip per badge, keyed by ColumnDef.key, then badge text (default: the text). */
  badgeTitles?: Record<string, Record<string, string>>;
}

/** A computed KPI tile value (already formatted for display). */
export interface KpiValue {
  key: string;
  label: string;
  value: string;
  /** Rows this tile counts: clicking the tile filters the table to them. */
  rowIds?: string[];
}

/** A single lazy cell update. */
export interface ColumnPatch {
  rowId: string;
  columnKey: string;
  value: CellValue;
  /** Raw numeric sort key behind a formatted `value` (see OverviewRow.sortValues). */
  sortValue?: number;
  /** Tooltip per badge of a `badges` cell (see OverviewRow.badgeTitles). */
  badgeTitles?: Record<string, string>;
}

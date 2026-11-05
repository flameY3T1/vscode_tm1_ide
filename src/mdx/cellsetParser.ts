import type { ODataAxis, ODataCell, ODataCellset } from '../tm1Rest/odataTypes';

export interface CellsetCell {
  value: number | string | null;
  formatted: string;
}

export interface TitleHeader {
  hierarchy: string;
  member: string;
}

export interface CellsetTable {
  /** Per-column tuple of member names. `colHeaders[c]` = `[memberOfHier1, memberOfHier2, …]` for column c. */
  colHeaders: string[][];
  /** Hierarchy names for the columns axis in order. */
  colHierarchies: string[];
  /** Per-row tuple of member names. `rowHeaders[r]` = `[memberOfHier1, memberOfHier2, …]` for row r. */
  rowHeaders: string[][];
  /** Hierarchy names for the rows axis in order. */
  rowHierarchies: string[];
  /** Slicer axis (fixed members from WHERE clause and default selections for dimensions not on an axis). */
  titleHeaders: TitleHeader[];
  /** `cells[row][col]`. */
  cells: CellsetCell[][];
  dims: { cols: number; rows: number };
}

function hierarchyNames(axis: ODataAxis | undefined): string[] {
  return (axis?.Hierarchies ?? []).map(h => String(h.Name ?? ''));
}

function tupleMembers(axis: ODataAxis | undefined): string[][] {
  return (axis?.Tuples ?? []).map(t => (t.Members ?? []).map(m => String(m.Name ?? '')));
}

export function parseCellset(json: ODataCellset): CellsetTable {
  const axes = json.Axes ?? [];
  const colsAxis = axes[0];
  const cols = colsAxis?.Tuples?.length ?? 0;
  // Axes layout by TM1 convention: [0]=Columns, [1]=Rows, [2]=Title (when ROWS present)
  // If only 2 axes: [1] is the Title axis (no ROWS in MDX).
  const hasRows = axes.length >= 3;
  const rowsAxis = hasRows ? axes[1] : undefined;
  const titleAxis = hasRows ? axes[2] : axes[1];
  const rows = rowsAxis ? (rowsAxis.Tuples?.length ?? 0) : 1;

  const titleHierarchies = hierarchyNames(titleAxis);
  const titleMembers = titleAxis?.Tuples?.[0]?.Members ?? [];
  const titleHeaders: TitleHeader[] = titleHierarchies.map((h, i) => ({
    hierarchy: h,
    member: String(titleMembers[i]?.Name ?? ''),
  }));

  // Cells are ordered by Ordinal = row * cols + col (row-major).
  const rawCells = json.Cells ?? [];
  const cellByOrdinal = new Map<number, ODataCell>();
  for (const c of rawCells) {
    if (typeof c.Ordinal === 'number') { cellByOrdinal.set(c.Ordinal, c); }
  }
  const cells: CellsetCell[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: CellsetCell[] = [];
    for (let c = 0; c < cols; c++) {
      const raw = cellByOrdinal.get(r * cols + c);
      row.push({
        value: raw?.Value ?? null,
        formatted: String(raw?.FormattedValue ?? ''),
      });
    }
    cells.push(row);
  }

  return {
    colHeaders: tupleMembers(colsAxis),
    colHierarchies: hierarchyNames(colsAxis),
    rowHeaders: rowsAxis ? tupleMembers(rowsAxis) : [],
    rowHierarchies: rowsAxis ? hierarchyNames(rowsAxis) : [],
    titleHeaders,
    cells,
    dims: { cols, rows },
  };
}

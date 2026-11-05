import type { CellsetTable } from './cellsetParser';

/**
 * Converts a parsed cellset into a TSV string suitable for clipboard-paste
 * into Excel or similar spreadsheet apps.
 *
 * Layout:
 *   - One header row per column hierarchy (stacked when crossjoin on cols)
 *   - First columns on the left are row hierarchy labels (one per hier)
 *   - Cell values use the FormattedValue (keeps server-locale numeric format)
 *   - null values render as empty cells
 *
 * Embedded tabs/newlines in any cell content are replaced with spaces to
 * preserve the row/column structure.
 */
export function tableToTsv(table: CellsetTable): string {
  const { colHeaders, colHierarchies, rowHeaders, rowHierarchies, cells, dims } = table;

  if (dims.cols === 0 && dims.rows === 0) { return ''; }

  const rowHierCount = rowHierarchies.length;
  const colHierCount = colHierarchies.length;

  const lines: string[] = [];

  // Header rows — one per column hierarchy. The left-most cells on the FIRST
  // header row are the row-hierarchy labels; subsequent header rows pad those
  // cells with blanks.
  for (let h = 0; h < Math.max(colHierCount, 1); h++) {
    const cells: string[] = [];
    for (let rh = 0; rh < rowHierCount; rh++) {
      cells.push(h === 0 ? safe(rowHierarchies[rh]) : '');
    }
    for (let c = 0; c < dims.cols; c++) {
      const tuple = colHeaders[c] ?? [];
      cells.push(safe(tuple[h] ?? ''));
    }
    lines.push(cells.join('\t'));
  }

  // Body rows
  for (let r = 0; r < dims.rows; r++) {
    const rowTuple = rowHeaders[r] ?? [];
    const cellsArr: string[] = [];
    for (let rh = 0; rh < rowHierCount; rh++) {
      cellsArr.push(safe(rowTuple[rh] ?? ''));
    }
    const rowCells = cells[r] ?? [];
    for (let c = 0; c < dims.cols; c++) {
      const cell = rowCells[c];
      if (!cell || cell.value === null) { cellsArr.push(''); continue; }
      cellsArr.push(safe(cell.formatted));
    }
    lines.push(cellsArr.join('\t'));
  }

  return lines.join('\n');
}

function safe(s: string | number | null | undefined): string {
  if (s === null || s === undefined) { return ''; }
  return String(s).replace(/[\t\n\r]+/g, ' ');
}

/**
 * Pure cellset-cell parser shared by initial load and scroll-paging.
 * Ordinal is row-major over the FULL cellset (row = floor(Ordinal/numCols)),
 * so a page fetched via $skip yields ABSOLUTE row indices — verified live.
 */
import type { CellFlag } from './state';
import type { ODataAxis, ODataHierarchy } from '../../tm1Rest/odataTypes';
import { hierKey } from '../../utils/hierKeyPure';
import { applyDefaultGrouping } from './numberFormatPure';

export interface RawCell {
  Ordinal: number;
  Value?: number | string | null;
  FormattedValue?: string;
  /** Cells read through an MDX cellset render unformatted numbers without
   *  thousands separators; the pattern says which case it is. See
   *  `numberFormatPure`. */
  FormatString?: string;
  Consolidated?: boolean;
  RuleDerived?: boolean;
  /** A bit mask (`Edm.Int32`), not a boolean. Measured on 11.8 with a
   *  non-admin user: writable leaf `0x10a`, writable consolidation `0x102`,
   *  read-only by cube or element security `0x10000101` (leaf and
   *  consolidation alike), rule `0x10000104`, calculated member `0x10000004`.
   *  Bit `0x2` is set exactly where a value or a spread is accepted. */
  Updateable?: number | boolean;
}

const UPDATEABLE_WRITE_BIT = 0x2;

/** A cell the server will not take a value or a spread for. Rule cells lack
 *  the bit too but carry their own flag and look. */
function isLocked(cell: RawCell): boolean {
  if (cell.RuleDerived) { return false; }
  const u = cell.Updateable;
  return u === false || (typeof u === 'number' && (u & UPDATEABLE_WRITE_BIT) === 0);
}

export function parseCellsPage(
  cells: ReadonlyArray<RawCell>, numCols: number,
): { values: Record<string, string>; rawValues: Record<string, string>; cellFlags: Record<string, CellFlag> } {
  const cols = numCols || 1;
  const values: Record<string, string> = {};
  // Full-precision raw value (server `Value`), kept alongside the rounded
  // `FormattedValue` display so the grid can reveal the true value on click —
  // rule-derived cells included.
  const rawValues: Record<string, string> = {};
  const cellFlags: Record<string, CellFlag> = {};
  for (const cell of cells) {
    const row = Math.floor(cell.Ordinal / cols);
    const col = cell.Ordinal % cols;
    const key = `${row},${col}`;
    // Numbers keep the server's own rendering; the only repair is the grouping
    // an MDX cellset drops for unformatted cells (see `numberFormatPure`).
    const fv = cell.FormattedValue === undefined
      ? undefined
      : applyDefaultGrouping(cell.FormattedValue, cell.FormatString);
    const v = cell.Value;
    let display: string | undefined;
    if (typeof v === 'string') { display = v; rawValues[key] = v; }
    else if (v === null || v === undefined) { display = fv && fv !== 'error' ? fv : undefined; }
    else { display = fv && fv !== 'error' ? fv : String(v); rawValues[key] = String(v); }
    if (display) { values[key] = display; }
    const flag: CellFlag = {};
    if (cell.Consolidated) { flag.c = 1; }
    if (cell.RuleDerived) { flag.r = 1; }
    if (isLocked(cell)) { flag.u = 0; }
    // The type comes from the server, not from appearance: "01223" in a string
    // cell looks like a number and still has to stay text.
    if (typeof v === 'string') { flag.s = 1; }
    if (flag.c || flag.r || flag.u === 0 || flag.s) { cellFlags[key] = flag; }
  }
  return { values, rawValues, cellFlags };
}

/** Viewer key of a cellset hierarchy: `dim` for the default hierarchy, `dim:hier`
 *  for an alternate one. Without the expanded `Dimension` the name is taken as
 *  the dimension (the pre-alternate-hierarchy convention). */
export function axisKeyOf(h: ODataHierarchy | undefined): string {
  const hier = String(h?.Name ?? '');
  return hier ? hierKey(String(h?.Dimension?.Name ?? hier), hier) : '';
}

export interface TitleTuples {
  rowElements: string[]; colElements: string[];
  rowTuples: string[][]; colTuples: string[][];
  rowDims: string[]; colDims: string[];
  titleAssignments: Record<string, string>;
}

/** Derive row/col tuples + title-axis assignments from the cellset axes (pure). */
export function parseTitleAndTuples(
  axes: ODataAxis[], rowAxis: ODataAxis | undefined, colAxis: ODataAxis | undefined,
): TitleTuples {
  const colDims: string[] = (colAxis?.Hierarchies ?? []).map(axisKeyOf).filter(Boolean);
  const rowDims: string[] = (rowAxis?.Hierarchies ?? []).map(axisKeyOf).filter(Boolean);
  const titleAssignments: Record<string, string> = {};
  for (const ax of axes) {
    const ord = typeof ax?.Ordinal === 'number' ? ax.Ordinal : -1;
    if (ord < 2) { continue; }
    const hiers = ax?.Hierarchies ?? [];
    const members = (ax?.Tuples ?? [])[0]?.Members ?? [];
    for (let i = 0; i < hiers.length; i++) {
      const dimName = axisKeyOf(hiers[i]);
      const elemName = String(members[i]?.Name ?? '');
      if (dimName && elemName) { titleAssignments[dimName] = elemName; }
    }
  }
  const rowTuples: string[][] = (rowAxis?.Tuples ?? []).map((t) => (t.Members ?? []).map((m) => String(m.Name ?? '')));
  const colTuples: string[][] = (colAxis?.Tuples ?? []).map((t) => (t.Members ?? []).map((m) => String(m.Name ?? '')));
  const rowElements: string[] = rowTuples.map(t => t.filter(Boolean).join(' / '));
  const colElements: string[] = colTuples.map(t => t.filter(Boolean).join(' / '));
  return { rowElements, colElements, rowTuples, colTuples, rowDims, colDims, titleAssignments };
}

/** Parse one page of axis tuples (member-name rows + joined labels). Pure. */
export function parseTuplesPage(
  rawTuples: ReadonlyArray<{ Members?: ReadonlyArray<{ Name?: string }> }>,
): { tuples: string[][]; elements: string[] } {
  const tuples = rawTuples.map((t) => (t.Members ?? []).map((m) => String(m.Name ?? '')));
  const elements = tuples.map((t) => t.filter(Boolean).join(' / '));
  return { tuples, elements };
}

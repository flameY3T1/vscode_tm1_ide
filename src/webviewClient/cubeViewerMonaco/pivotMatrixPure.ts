/**
 * Compute a new axis layout from the already loaded matrix (no DOM,
 * no vscode). Consumer: axis.ts#moveDimToZone.
 *
 * Why this works at all: the grid is the full cross product of row and
 * column tuples — every row tuple appears in the grid with EVERY column
 * tuple. A pair (row tuple, column tuple) therefore determines, for all
 * axis dimensions, which element is meant, and any redistribution of the
 * same dimensions across rows, columns and context is a re-sorting of
 * existing values.
 *
 * It also follows that nobody has to walk all pairs: the new row axis is
 * the product of what the old row tuples contribute and what the old column
 * tuples contribute. The work is therefore done only over the two tuple
 * lists and over the cells that actually exist.
 *
 * The reverse direction (context → axis) does NOT belong here: the other
 * elements of the context dimension were never loaded. Such cases return
 * `null` and the caller asks the server.
 */

import { axisBaseFromTuples } from './gridPure';
import type { MatrixData, CellFlag } from './state';

/** Upper bound for `rows × columns`. Above it, recomputing costs more than
 *  reloading saves — and a matrix that large is in paging mode anyway. */
export const MAX_PIVOT_PAIRS = 500_000;

export interface LocalPivotInput {
  matrix: MatrixData;
  oldRowDims: string[];
  oldColDims: string[];
  nextRowDims: string[];
  nextColDims: string[];
  /** Dimensions that move into the context: name → pinned element. */
  titleMembers: Record<string, string>;
}

/** Where a dimension came from in the old layout. */
interface DimSource {
  side: 'row' | 'col';
  di: number;
  /** Level per element, read from the old `rowLevels`/`colLevels`. */
  levels: Record<string, number>;
  parents?: Record<string, string>;
  allParents?: Record<string, string[]>;
  /** Expand-triangle set of this dimension. It travels along because, since
   *  the parent maps were trimmed, it comes from the host and can no longer be
   *  derived from the (trimmed) maps — without carrying it over, every axis
   *  would lose all of its triangles after a local axis change. The content is
   *  keyed by element name and therefore independent of the axis layout. */
  hasChildren?: Record<string, true>;
}

const KEY_SEP = '\u0000';
const PART_SEP = '\u0001';

function _levelsByName(
  tuples: ReadonlyArray<ReadonlyArray<string>>, di: number, levels: number[][] | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!levels) { return out; }
  for (let ti = 0; ti < tuples.length; ti++) {
    const name = tuples[ti]?.[di];
    const lv = levels[ti]?.[di];
    if (name !== undefined && lv !== undefined && out[name] === undefined) { out[name] = lv; }
  }
  return out;
}

/** Split an axis into its parts: which of the new dimensions come from the
 *  old row tuples and which from the old column tuples. */
function _split(dims: string[], src: Map<string, DimSource>): { rowPos: number[]; colPos: number[] } {
  const rowPos: number[] = [];
  const colPos: number[] = [];
  dims.forEach((d, k) => { (src.get(d)!.side === 'row' ? rowPos : colPos).push(k); });
  return { rowPos, colPos };
}

/** The values a tuple contributes at the given positions. */
function _part(tuple: ReadonlyArray<string>, pos: number[], dims: string[], src: Map<string, DimSource>): string[] {
  return pos.map((k) => tuple[src.get(dims[k])!.di] ?? '');
}

export function pivotMatrixLocal(inp: LocalPivotInput): MatrixData | null {
  const { matrix, oldRowDims, oldColDims, nextRowDims, nextColDims, titleMembers } = inp;

  // ── Abort conditions ─────────────────────────────────────────────────────
  if (matrix.paged) { return null; }
  const rowTuples: string[][] = matrix.rowTuples ?? (matrix.rowElements ?? []).map((e) => [e]);
  const colTuples: string[][] = matrix.colTuples ?? (matrix.colElements ?? []).map((e) => [e]);
  if (rowTuples.length === 0 || colTuples.length === 0) { return null; }
  if (rowTuples.length * colTuples.length > MAX_PIVOT_PAIRS) { return null; }
  // The client cannot empty an axis completely — TM1 needs both.
  if (nextRowDims.length === 0 || nextColDims.length === 0) { return null; }

  const src = new Map<string, DimSource>();
  oldRowDims.forEach((d, di) => src.set(d, {
    side: 'row', di,
    levels: _levelsByName(rowTuples, di, matrix.rowLevels),
    parents: matrix.rowParents?.[di], allParents: matrix.rowAllParents?.[di],
    hasChildren: matrix.rowHasChildren?.[di],
  }));
  oldColDims.forEach((d, di) => src.set(d, {
    side: 'col', di,
    levels: _levelsByName(colTuples, di, matrix.colLevels),
    parents: matrix.colParents?.[di], allParents: matrix.colAllParents?.[di],
    hasChildren: matrix.colHasChildren?.[di],
  }));

  // A new axis dimension that was not on an axis before comes from the
  // context — its other elements were never loaded.
  for (const d of [...nextRowDims, ...nextColDims]) {
    if (!src.has(d)) { return null; }
  }
  // Conversely, every old axis dimension must end up somewhere.
  for (const d of src.keys()) {
    if (nextRowDims.includes(d) || nextColDims.includes(d)) { continue; }
    if (!Object.prototype.hasOwnProperty.call(titleMembers, d)) { return null; }
  }

  // ── Order per dimension ──────────────────────────────────────────────────
  // `axisBaseFromTuples` reads it from the loaded axis and carries gaps caused
  // by suppressed empty rows along. Its `null` (an axis that cannot be explained
  // as a sequence of names) is also our abort.
  const rank = new Map<string, Map<string, number>>();
  for (const d of [...nextRowDims, ...nextColDims]) {
    const s = src.get(d)!;
    const order = axisBaseFromTuples(s.side === 'row' ? rowTuples : colTuples, s.di);
    if (!order) { return null; }
    const m = new Map<string, number>();
    order.forEach((n, i) => m.set(n, i));
    rank.set(d, m);
  }

  // ── Context cut ──────────────────────────────────────────────────────────
  const rowKeep: boolean[] = rowTuples.map(() => true);
  const colKeep: boolean[] = colTuples.map(() => true);
  for (const d of Object.keys(titleMembers)) {
    const s = src.get(d);
    if (!s) { continue; } // was already in the context — nothing to cut
    const want = titleMembers[d];
    const keep = s.side === 'row' ? rowKeep : colKeep;
    const tuples = s.side === 'row' ? rowTuples : colTuples;
    for (let i = 0; i < tuples.length; i++) {
      if (tuples[i]?.[s.di] !== want) { keep[i] = false; }
    }
  }
  if (!rowKeep.some(Boolean) || !colKeep.some(Boolean)) { return null; }

  // ── New axes as the product of the two contributions ─────────────────────
  /** Builds a new axis and returns the key per old tuple index with it. */
  function buildAxis(dims: string[]): {
    tuples: string[][]; index: Map<string, number>;
    rowKeyOf: string[]; colKeyOf: string[];
  } {
    const { rowPos, colPos } = _split(dims, src);
    const fromRow = new Map<string, string[]>();
    const rowKeyOf: string[] = [];
    for (let ri = 0; ri < rowTuples.length; ri++) {
      const vals = _part(rowTuples[ri], rowPos, dims, src);
      const key = vals.join(KEY_SEP);
      rowKeyOf[ri] = key;
      if (rowKeep[ri] && !fromRow.has(key)) { fromRow.set(key, vals); }
    }
    const fromCol = new Map<string, string[]>();
    const colKeyOf: string[] = [];
    for (let ci = 0; ci < colTuples.length; ci++) {
      const vals = _part(colTuples[ci], colPos, dims, src);
      const key = vals.join(KEY_SEP);
      colKeyOf[ci] = key;
      if (colKeep[ci] && !fromCol.has(key)) { fromCol.set(key, vals); }
    }
    // Every combination really occurs — every row tuple appears in the grid
    // with every column tuple.
    const combos: Array<{ key: string; tuple: string[] }> = [];
    for (const [rk, rv] of fromRow) {
      for (const [ck, cv] of fromCol) {
        const tuple = new Array<string>(dims.length);
        rowPos.forEach((k, i) => { tuple[k] = rv[i]; });
        colPos.forEach((k, i) => { tuple[k] = cv[i]; });
        combos.push({ key: `${rk}${PART_SEP}${ck}`, tuple });
      }
    }
    // Nested cross-product order: outermost dimension first, and per
    // dimension the order the loaded axis held.
    combos.sort((a, b) => {
      for (let k = 0; k < dims.length; k++) {
        const m = rank.get(dims[k])!;
        const ra = m.get(a.tuple[k]) ?? Number.MAX_SAFE_INTEGER;
        const rb = m.get(b.tuple[k]) ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) { return ra - rb; }
        if (a.tuple[k] !== b.tuple[k]) { return a.tuple[k] < b.tuple[k] ? -1 : 1; }
      }
      return 0;
    });
    const index = new Map<string, number>();
    combos.forEach((c, i) => index.set(c.key, i));
    return { tuples: combos.map((c) => c.tuple), index, rowKeyOf, colKeyOf };
  }

  const rowAxis = buildAxis(nextRowDims);
  const colAxis = buildAxis(nextColDims);

  // ── Rewrite cells ────────────────────────────────────────────────────────
  // Only over the existing keys: what is missing was missing before as well —
  // suppressed combinations were empty and stay empty.
  const values: Record<string, string> = {};
  const rawValues: Record<string, string> = {};
  const cellFlags: Record<string, CellFlag> = {};
  const oldRaw = matrix.rawValues ?? {};
  const oldFlags = matrix.cellFlags ?? {};
  const remap = (oldKey: string): string | null => {
    const comma = oldKey.indexOf(',');
    const ri = Number(oldKey.slice(0, comma));
    const ci = Number(oldKey.slice(comma + 1));
    if (!rowKeep[ri] || !colKeep[ci]) { return null; }
    const nri = rowAxis.index.get(`${rowAxis.rowKeyOf[ri]}${PART_SEP}${rowAxis.colKeyOf[ci]}`);
    const nci = colAxis.index.get(`${colAxis.rowKeyOf[ri]}${PART_SEP}${colAxis.colKeyOf[ci]}`);
    if (nri === undefined || nci === undefined) { return null; }
    return `${nri},${nci}`;
  };
  for (const k in matrix.values) {
    const nk = remap(k);
    if (nk) { values[nk] = matrix.values[k]; }
  }
  for (const k in oldRaw) {
    const nk = remap(k);
    if (nk) { rawValues[nk] = oldRaw[k]; }
  }
  for (const k in oldFlags) {
    const nk = remap(k);
    if (nk) { cellFlags[nk] = oldFlags[k]; }
  }

  // ── Carried-over data ────────────────────────────────────────────────────
  const levelsFor = (dims: string[], tuples: string[][]): number[][] | undefined => {
    if (!dims.some((d) => Object.keys(src.get(d)!.levels).length > 0)) { return undefined; }
    return tuples.map((t) => dims.map((d, k) => src.get(d)!.levels[t[k]] ?? 0));
  };
  const mapsFor = <T>(dims: string[], pick: (s: DimSource) => T | undefined): T[] | undefined => {
    const arr = dims.map((d) => pick(src.get(d)!));
    return arr.some((x) => x !== undefined) ? arr.map((x) => x ?? ({} as T)) : undefined;
  };

  const out: MatrixData = {
    rowElements: rowAxis.tuples.map((t) => t.filter(Boolean).join(' / ')),
    colElements: colAxis.tuples.map((t) => t.filter(Boolean).join(' / ')),
    values,
    rowTuples: rowAxis.tuples,
    colTuples: colAxis.tuples,
    rowDims: nextRowDims,
    colDims: nextColDims,
    numCols: colAxis.tuples.length,
    totalRows: rowAxis.tuples.length,
    loadedRows: rowAxis.tuples.length,
    paged: false,
    titleAssignments: { ...(matrix.titleAssignments ?? {}), ...titleMembers },
  };
  if (Object.keys(rawValues).length > 0) { out.rawValues = rawValues; }
  if (Object.keys(cellFlags).length > 0) { out.cellFlags = cellFlags; }
  // Both picklist maps hang on element NAMES, not on grid indices —
  // they travel along unchanged on a local axis change instead of being
  // rewritten. That was exactly the reason to abandon the grid-wide `"ri,ci"`
  // map: it had to be rotated along on every pivot, and FILLING it cost, as
  // measured, over ten minutes (Task 15).
  if (matrix.picklistByElem) { out.picklistByElem = matrix.picklistByElem; }
  if (matrix.picklistByRuleElem) { out.picklistByRuleElem = matrix.picklistByRuleElem; }
  if (matrix.picklistCubePresent !== undefined) {
    out.picklistCubePresent = matrix.picklistCubePresent;
  }
  const rl = levelsFor(nextRowDims, rowAxis.tuples);
  const cl = levelsFor(nextColDims, colAxis.tuples);
  if (rl) { out.rowLevels = rl; }
  if (cl) { out.colLevels = cl; }
  const rp = mapsFor<Record<string, string>>(nextRowDims, (s) => s.parents);
  const cp = mapsFor<Record<string, string>>(nextColDims, (s) => s.parents);
  const rap = mapsFor<Record<string, string[]>>(nextRowDims, (s) => s.allParents);
  const cap = mapsFor<Record<string, string[]>>(nextColDims, (s) => s.allParents);
  if (rp) { out.rowParents = rp; }
  if (cp) { out.colParents = cp; }
  if (rap) { out.rowAllParents = rap; }
  if (cap) { out.colAllParents = cap; }
  const rhc = mapsFor<Record<string, true>>(nextRowDims, (s) => s.hasChildren);
  const chc = mapsFor<Record<string, true>>(nextColDims, (s) => s.hasChildren);
  if (rhc) { out.rowHasChildren = rhc; }
  if (chc) { out.colHasChildren = chc; }
  return out;
}

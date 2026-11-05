/**
 * Per-render axis context for the cube grid and the visible-index pass:
 * collapse-aware hiding, Local-Focus filter, locally collapsed blocks,
 * empty-row/column suppression and the column cap.
 */

import { state } from './state';
import type { MatrixData, CellFlag } from './state';
import { hasData as _hasData, hasCollapsedAncestorDag, computeBlockOrdinals, removedOccurrences, occKey } from './gridPure';
import { computeIndentDepths } from './rowIndentPure';

export const MAX_COLS = 200;

/** Everything the grid renderers read from one matrix, derived once per
 *  `renderGrid` call. Plain data — no DOM. */
export interface GridCtx {
  matrix: MatrixData;
  rowElements: string[];
  colElements: string[];
  values: Record<string, string>;
  /** Title assignments of this render (hoisted once, see grid.ts). */
  titleAssignments: Record<string, string>;
  cellFlags: Record<string, CellFlag>;
  rawValues: Record<string, string>;
  rowTuples: string[][] | null;
  colTuples: string[][] | null;
  rowLevels: number[][] | null;
  rowParents: Record<string, string>[];
  colParents: Record<string, string>[];
  rowAllParents: Record<string, string[]>[];
  colAllParents: Record<string, string[]>[];
  rowAxisDims: string[];
  colAxisDims: string[];
  maxLvl: number[] | null;
  rowDepths: number[][] | null;
  rowHasChildren: Record<string, true>[];
  colHasChildren: Record<string, true>[];
}

export function buildGridCtx(matrix: MatrixData, titleAssignments: Record<string, string>): GridCtx {
  const { rowElements, colElements, values } = matrix;
  const cellFlags = matrix.cellFlags ?? {};
  const rawValues = matrix.rawValues ?? {};
  const rowTuples = matrix.rowTuples ?? null;
  const colTuples = matrix.colTuples ?? null;
  const rowLevels = matrix.rowLevels ?? null;
  const rowParents = matrix.rowParents ?? [];
  const colParents = matrix.colParents ?? [];
  const rowAllParents = matrix.rowAllParents ?? [];
  const colAllParents = matrix.colAllParents ?? [];
  const rowAxisDims = matrix.rowDims?.length ? matrix.rowDims : state.rowDims;
  const colAxisDims = matrix.colDims?.length ? matrix.colDims : state.colDims;

  const maxLvl: number[] | null = rowLevels && rowLevels.length > 0
    ? rowLevels[0].map((_, di) => rowLevels.reduce((m, row) => Math.max(m, row[di] || 0), 0))
    : null;
  // Indentation is measured against the ancestors that THEMSELVES stand on the
  // axis — the indentation may only claim relationships that the grid also
  // shows (reasoning, including the two discarded rules, in
  // `rowIndentPure.ts`). TM1 `Level` (maxLvl - level, below) remains the
  // fallback if no parent maps arrived at all.
  const rowDepths: number[][] | null = rowParents.length > 0
    ? computeIndentDepths(
      rowTuples ?? (matrix.rowElements ?? []).map((e) => [e]), rowParents, rowAllParents,
    )
    : null;

  // Now comes from the host: the client only sees the trimmed map and could no
  // longer derive "has children" from it — a collapsed consolidation without
  // loaded children would otherwise lose its collapse triangle.
  const rowHasChildren: Record<string, true>[] = matrix.rowHasChildren
    ?? rowAxisDims.map(() => ({}));
  const colHasChildren: Record<string, true>[] = matrix.colHasChildren
    ?? colAxisDims.map(() => ({}));

  return {
    matrix, rowElements, colElements, values, titleAssignments, cellFlags, rawValues,
    rowTuples, colTuples, rowLevels, rowParents, colParents, rowAllParents, colAllParents,
    rowAxisDims, colAxisDims, maxLvl, rowDepths, rowHasChildren, colHasChildren,
  };
}

/** Axis tuples, one per position; a single-dim axis is wrapped as `[name]`. */
export function axisTuples(ctx: GridCtx, axis: 'row' | 'col'): string[][] {
  return axis === 'row'
    ? (ctx.rowTuples ?? ctx.rowElements.map((e) => [e]))
    : (ctx.colTuples ?? ctx.colElements.map((e) => [e]));
}

function _hasCollapsedAncestor(
  dimName: string,
  elemName: string,
  pmap: Record<string, string> | undefined,
  apmap?: Record<string, string[]> | undefined,
): boolean {
  // `pmap` goes in as a fallback TOO: `apmap` only carries multi-parent
  // elements, so the ascent needs the `first` chain for all the others. A
  // missing `apmap` needs no branch of its own — with `{}` the same ascent
  // runs as a plain chain over `pmap`.
  return hasCollapsedAncestorDag(elemName, apmap || {}, state.collapsed[dimName], pmap);
}

function _axisHidden(ctx: GridCtx, axis: 'row' | 'col', idx: number): boolean {
  const tuples = axis === 'row' ? ctx.rowTuples : ctx.colTuples;
  const dims = axis === 'row' ? ctx.rowAxisDims : ctx.colAxisDims;
  const parents = axis === 'row' ? ctx.rowParents : ctx.colParents;
  const allParents = axis === 'row' ? ctx.rowAllParents : ctx.colAllParents;
  if (!tuples) {
    const elems = axis === 'row' ? ctx.rowElements : ctx.colElements;
    return _hasCollapsedAncestor(dims[0], elems[idx], parents[0], allParents[0]);
  }
  const t = tuples[idx] ?? [];
  for (let di = 0; di < dims.length; di++) {
    if (_hasCollapsedAncestor(dims[di], t[di], parents[di], allParents[di])) return true;
  }
  return false;
}

// Local-Focus client-side visible-set filter
function _focusHidden(ctx: GridCtx, axis: 'row' | 'col', idx: number): boolean {
  if (!state.localFocus) return false;
  const dims = axis === 'row' ? ctx.rowAxisDims : ctx.colAxisDims;
  const di = dims.indexOf(state.localFocus.dim);
  if (di < 0) return false;
  const tuples = axis === 'row' ? ctx.rowTuples : ctx.colTuples;
  const elems = axis === 'row' ? ctx.rowElements : ctx.colElements;
  const t = tuples ? tuples[idx] : [elems[idx]];
  return !state.localFocus.visible.has(t[di] ?? '');
}

// Locally collapsed blocks: what the base list of the matrix still has but
// the current selection no longer has. Purely derived — no carried hiding
// state that could get out of step with the matrix. Its own ordinal buffer
// instead of `_blockOcc` (gridLabels.ts), which counts lazily per click target.
// Built ONCE per render, not per row: `removedOccurrences` runs over the
// whole base list, and since every axis dimension has one, the call per row
// would be O(rows × base list).
type OccHidePlan = Array<{ di: number; gone: Set<string>; ords: number[]; tuples: string[][] }>;
function _occHidePlan(ctx: GridCtx, axis: 'row' | 'col'): OccHidePlan {
  const dims = axis === 'row' ? ctx.rowAxisDims : ctx.colAxisDims;
  const tuples = axisTuples(ctx, axis);
  const plan: OccHidePlan = [];
  for (let di = 0; di < dims.length; di++) {
    const base = state.axisBaseNames[dims[di]];
    const sel = state.dimSelections[dims[di]];
    if (!base || sel?.kind !== 'elements') { continue; }
    const gone = removedOccurrences(base, sel.names);
    if (gone.size === 0) { continue; }
    plan.push({ di, gone, ords: computeBlockOrdinals(tuples, di), tuples });
  }
  return plan;
}

function _occHidden(plan: OccHidePlan, idx: number): boolean {
  for (const p of plan) {
    if (p.gone.has(occKey(p.tuples[idx]?.[p.di] ?? '', p.ords[idx] ?? 0))) { return true; }
  }
  return false;
}

export interface VisibleAxes {
  rowIdx: number[];
  colIdx: number[];
  /** Before empty-row suppression — see `structRowIdx` comment below. */
  structRowIdx: number[];
  structColIdx: number[];
  sizedCapped: boolean;
}

export function computeVisibleAxes(ctx: GridCtx, suppRows: boolean, suppCols: boolean): VisibleAxes {
  const { rowElements, colElements, values } = ctx;
  const _rowHidePlan = _occHidePlan(ctx, 'row');
  const _colHidePlan = _occHidePlan(ctx, 'col');

  let rowIdx = rowElements.map((_, i) => i)
    .filter((ri) => !_axisHidden(ctx, 'row', ri) && !_focusHidden(ctx, 'row', ri) && !_occHidden(_rowHidePlan, ri));
  let colIdx = colElements.map((_, i) => i)
    .filter((ci) => !_axisHidden(ctx, 'col', ci) && !_focusHidden(ctx, 'col', ci) && !_occHidden(_colHidePlan, ci));

  // Structurally visible = what collapse state, focus and selection leave
  // standing, BEFORE empty-row suppression. The collapse triangle asks exactly
  // this set (`_dispSeq`): whether a child row is empty says nothing about
  // whether it is expanded — otherwise a consolidation with nothing but empty
  // children would show "collapsed" and a click on it would expand further.
  const structRowIdx = rowIdx;
  const structColIdx = colIdx;

  // Suppress empty rows/cols — single pass over `values` to avoid O(rows×cols)
  if (suppRows && !state.paged) {
    const colSet = new Set(colIdx);
    const rowsWithData = new Set<number>();
    for (const key in values) {
      if (!_hasData(values[key])) { continue; }
      const comma = key.indexOf(',');
      const ci = +key.slice(comma + 1);
      if (!colSet.has(ci)) { continue; }
      rowsWithData.add(+key.slice(0, comma));
    }
    rowIdx = rowIdx.filter((ri) => rowsWithData.has(ri));
  }
  if (suppCols && !state.paged) {
    const rowSet = new Set(rowIdx);
    const colsWithData = new Set<number>();
    for (const key in values) {
      if (!_hasData(values[key])) { continue; }
      const comma = key.indexOf(',');
      if (!rowSet.has(+key.slice(0, comma))) { continue; }
      colsWithData.add(+key.slice(comma + 1));
    }
    colIdx = colIdx.filter((ci) => colsWithData.has(ci));
  }

  // Rows are NO LONGER capped — neither here nor in page mode.
  // `renderBodySlice` only draws the visible window plus `VIRT_BUFFER`
  // anyway, in BOTH modes; the old limit of 500 dates from the time before this
  // virtualisation and has since thrown away rows that the client already held
  // in memory. This became visible as a contradiction: a large view paginates
  // and scrolls on cleanly, a smaller one stayed under the cell budget
  // (`rowsForCellBudget`), therefore counted as NOT paginated — and showed 500
  // of 3000 rows with no way to the rest (click test flameY3T1, 2026-08-12:
  // "sometimes the view loads more while scrolling down and sometimes this
  // happens").
  //
  // Columns stay capped: they are not virtualised, every drawn row builds ALL
  // columns — 200 is real DOM protection there, not a legacy leftover.
  const sizedCapped = colIdx.length > MAX_COLS;
  // Page mode: only the rows whose cells are already there — the scrollbar
  // grows with every arriving page (dimBrowser pattern) instead of spanning
  // all `totalRows` from the start.
  if (state.paged) { rowIdx = rowIdx.slice(0, Math.min(state._loadedRowMax, state.totalRows)); }
  colIdx = colIdx.slice(0, MAX_COLS);

  return { rowIdx, colIdx, structRowIdx, structColIdx, sizedCapped };
}

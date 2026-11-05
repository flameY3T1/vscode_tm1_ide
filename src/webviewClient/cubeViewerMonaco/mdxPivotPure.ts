/**
 * Pure MDX builder for a PIVOTED cube-viewer state.
 *
 * When the user drags a dimension between the Rows / Columns / Title zones of an
 * MDX view, the axes must be rebuilt from scratch. The old refresh path
 * (`rewriteMdxSlicer`) only patched the WHERE slicer and left the original
 * `ON ROWS` / `ON COLUMNS` untouched — so moving a row dim into the title left
 * it on the axis AND added it to the slicer, which TM1 rejects with
 * "Dimension <x> already included in the view" (rte 33). The mirror case
 * (title → axis) dropped the dim from the slicer without adding it to any axis.
 *
 * This builder places every dimension exactly ONCE: row dims on ROWS, col dims
 * on COLUMNS, title dims in the WHERE slicer. Given disjoint row/col/title
 * arrays (the invariant `moveDimToZone` maintains), double-inclusion is
 * structurally impossible.
 *
 * Per-dim member sets come from `dimSubsets` (the viewer's current members per
 * row/col dim, e.g. `currentDimSubsetsAll()`); a dim without a subset falls back
 * to all members via `TM1SUBSETALL`. Title dims use their single assigned member.
 *
 * Member reference/set/CROSSJOIN/SELECT building blocks since B1 (2026-08-19)
 * from `mdxParts.ts` — there were three copies of the same building block here,
 * in `mdxBuild.ts` and `mdxSlicerPure.ts`.
 *
 * Real webview JS — single backslash in escapes.
 */

import { memberRef, dimSet, crossjoinAll, selectStatement } from './mdxParts';

export interface PivotMdxInput {
  cube: string;
  rowDims: string[];
  colDims: string[];
  titleDims: string[];
  /** Current members per row/col dim; empty/absent → all members. */
  dimSubsets: Record<string, string[]>;
  /** Single member per title dim. */
  titleAssignments: Record<string, string>;
  suppressRows: boolean;
  suppressCols: boolean;
}

function axisExpr(dims: string[], dimSubsets: Record<string, string[]>): string {
  if (dims.length === 0) { return '{}'; }
  return crossjoinAll(dims.map((d) => dimSet(d, dimSubsets[d])));
}

export function buildPivotedMdx(inp: PivotMdxInput): string {
  const rowSet = axisExpr(inp.rowDims, inp.dimSubsets);
  const colSet = axisExpr(inp.colDims, inp.dimSubsets);

  const titleMembers = inp.titleDims
    .filter((d) => inp.titleAssignments[d])
    .map((d) => memberRef(d, inp.titleAssignments[d]));

  return selectStatement({
    cube: inp.cube,
    rowSet,
    colSet,
    titleMembers,
    suppressRows: inp.suppressRows,
    suppressCols: inp.suppressCols,
  });
}

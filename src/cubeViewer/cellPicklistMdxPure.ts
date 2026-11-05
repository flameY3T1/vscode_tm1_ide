/**
 * The MDX for EXACTLY ONE cell of the control cube `}PickList_<Cube>`.
 *
 * Measured 2026-08-13 (TM1 11.8): a single cell costs 1–2 ms, even the
 * first time; 417 cells in ONE cellset cost 12.5 s; the window of a
 * real saved view ran for over 10 minutes and had to be cancelled on the
 * server. The control cube is not expensive per cell, but with the
 * CELLSET SIZE. That is why there is only this one form here — one tuple
 * on each axis, everything else in the slicer. Whoever turns this into a
 * range query again rebuilds the bug that triggered Task 15.
 */

import { memberMdxRef as member } from '../utils/hierKeyPure';
import { escapeMdx } from '../utils/odataKey';

/**
 * `null` if the coordinate does not determine the cell uniquely: unequal
 * lengths or an empty element name. A dimension missing from the slicer
 * is filled up by TM1 with its default element — the query then succeeds and
 * returns the definition of a DIFFERENT cell without anything being noticed.
 * Wrong data that looks valid is worse than none at all.
 */
export function buildCellPicklistMdx(
  cube: string, dims: readonly string[], coordinates: readonly string[],
): string | null {
  if (dims.length === 0 || dims.length !== coordinates.length) { return null; }
  if (coordinates.some((c) => !c)) { return null; }

  const axes = [`{${member(dims[0], coordinates[0])}} ON 0`];
  if (dims.length > 1) {
    axes.push(`{${member(dims[1], coordinates[1])}} ON 1`);
  }

  const slicer = dims.slice(2).map((d, i) => member(d, coordinates[i + 2]));
  slicer.push('[}PickList].[}PickList].[Value]');

  return `SELECT ${axes.join(', ')} FROM [}PickList_${escapeMdx(cube)}] WHERE (${slicer.join(',')})`;
}

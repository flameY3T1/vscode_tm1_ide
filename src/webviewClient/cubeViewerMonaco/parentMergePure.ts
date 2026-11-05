import { nameMap, asNameMap } from '../../utils/nameMapPure';
import type { MatrixData } from './protocol';

/** Name-keyed maps from the host lose their prototype, in place (utils/nameMapPure.ts). */
export function stripMatrixNameMapPrototypes(matrix: MatrixData): void {
  for (const maps of [matrix.rowParents, matrix.rowAllParents, matrix.rowHasChildren,
    matrix.colParents, matrix.colAllParents, matrix.colHasChildren]) {
    (maps as Record<string, unknown>[] | undefined)?.forEach((m) => { if (m) { asNameMap(m); } });
  }
  if (matrix.picklistByElem) { Object.values(asNameMap(matrix.picklistByElem)).forEach((m) => asNameMap(m)); }
}

/** Merges a follow-up delta per axis dimension into the existing map.
 *  New copy instead of in place: `state.lastMatrix` is read in several places,
 *  and a silently mutated map makes rendering errors impossible to track down.
 *
 *  SUPPLEMENT, do not replace: the page only brings the names of ITS rows.
 *  Whoever overwrites the map throws away the parent chains of the rows that
 *  are already loaded - those would then be indented flat and lose their
 *  collapse triangle. */
export function mergeParentDelta<T>(
  base: Record<string, T>[], delta?: Record<string, T>[],
): Record<string, T>[] {
  if (!delta) { return base; }
  const n = Math.max(base.length, delta.length);
  const out: Record<string, T>[] = [];
  // No prototype: keys are element names (utils/nameMapPure.ts); a spread would bring it back.
  for (let i = 0; i < n; i++) { out.push(Object.assign(nameMap<T>(), base[i], delta[i])); }
  return out;
}

/**
 * What the LAZY single-cell query (Task 15) has already learned about
 * individual cells.
 *
 * Keyed by the COORDINATE, not by `"ri,ci"`: the cell keeps its identity when
 * the grid is rotated, filtered or reloaded — a grid position does not. That
 * is exactly what the deleted grid-wide map suffered from, which had to be
 * rotated along on every axis change.
 *
 * `null` is a REAL result ("this cell has no picklist") and must remain
 * distinguishable from "not asked yet" — which is why `knownCellPicklistDef`
 * returns `undefined` for "unknown".
 *
 * Purpose beyond the editor: the paste pre-check (`paste.ts`) checks against
 * KNOWN definitions — attribute map, rule map and whatever is already stored
 * here. It does NOT resolve cell definitions one by one; that would be the same
 * trap in miniature (417 cells = 12.5 s measured).
 */

const _byCoordinates = new Map<string, string | null>();

/** Coordinates → key. `\u0000` does not occur in TM1 element names. */
function coordKey(coordinates: readonly string[]): string {
  return coordinates.join('\u0000');
}

/** `undefined` = never asked, `null` = asked and "no picklist". */
export function knownCellPicklistDef(coordinates: readonly string[]): string | null | undefined {
  return _byCoordinates.get(coordKey(coordinates));
}

export function rememberCellPicklistDef(
  coordinates: readonly string[], def: string | null,
): void {
  _byCoordinates.set(coordKey(coordinates), def);
}

/**
 * Clear when a new matrix arrives. The definition of a cell may have changed
 * in TM1, and the host discards its own cell cache at the same moment
 * (`invalidatePicklistResolutions`) — two caches with different lifetimes would
 * be two truths.
 */
export function clearCellPicklistCache(): void {
  _byCoordinates.clear();
}

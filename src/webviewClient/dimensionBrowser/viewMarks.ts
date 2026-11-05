export {};

import type { DisplayRow } from './rowsFromAnswer';

/**
 * Markings of the new load path — ELEMENT NAMES, ONE level.
 *
 * The old path keeps two (`state._markedNames` for elements,
 * `state._markedKeys` for occurrences) and derives from them in
 * the old `rowIdentity.ts#rowIsMarked` which copy lights up. One is enough here, because
 * the spec has already decided: Keep and Remove hit the ELEMENT, not the
 * occurrence (`INTERSECT`/`EXCEPT` with `ALL`).
 *
 * The visible consequence is INTENDED: if `a` under `d` is marked, both
 * `a` rows light up. The marking thus predicts what Remove will do —
 * the same rule that the collapse triangle already carries (`DRILLUPMEMBER` hits
 * every occurrence) and that was accepted in the click test of plan 4. Two
 * models in the user's head would be one too many.
 *
 * `Set` instead of `Record<string, boolean>`: an object inherits from
 * `Object.prototype` — an element name `constructor` or `toString` would read
 * `marken[name]` as truthy WITHOUT ever having been set (the same class of error
 * that `rowsFromAnswer.ts` avoids with `collapsedInWindow`).
 */
const marks = new Set<string>();

/** The most recently clicked position — anchor for the shift range. */
let lastClickPosition: number | null = null;

export function isMarked(name: string): boolean { return marks.has(name); }

export function toggleMark(name: string): void {
  if (marks.has(name)) { marks.delete(name); } else { marks.add(name); }
}

/**
 * The shift range. Runs over the DRAWN rows, not over a raw
 * index — exactly like `rowIdentity.ts#shiftRangeRows` in the old (removed) path, and for
 * the same reason: between two visible rows there may be filtered-away
 * ones that nobody wanted to mark.
 *
 * Both directions, bounds inclusive: a shift click upwards
 * means the same range as one downwards.
 */
export function markRange(rows: readonly DisplayRow[], fromIdx: number, toIdx: number): void {
  const from = Math.min(fromIdx, toIdx);
  const to = Math.max(fromIdx, toIdx);
  for (let i = from; i <= to && i < rows.length; i++) {
    if (i < 0) { continue; }
    marks.add(rows[i].name);
  }
}

/** All LOADED rows — not the whole set; that is not even available here. */
export function markAll(rows: readonly DisplayRow[]): void {
  for (const r of rows) { marks.add(r.name); }
}

export function clearMarks(): void { marks.clear(); lastClickPosition = null; }

export function markedNames(): string[] { return Array.from(marks); }

export function markCount(): number { return marks.size; }

export function setLastClicked(idx: number | null): void { lastClickPosition = idx; }
export function lastClicked(): number | null { return lastClickPosition; }

/** For tests only: reset the module state. */
export function _resetMarksForTest(): void { marks.clear(); lastClickPosition = null; }

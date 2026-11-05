/**
 * Stateful diff-snapshot for the debug variables panel, isolated in its own
 * leaf module so `debug.ts` can reset it without importing `debugVarsPanel.ts`
 * (which imports back from `debug.ts` → dependency cycle). Only depends on the
 * pure helpers, so it stays a leaf.
 *
  * The comparison runs per STOP, not per render. That is the difference through
  * which the highlighting was lost until 2026-09-01: during a pause the host keeps
  * polling and reports the same position again (`debug.ts`), every poll
  * renders, and the panel re-primed itself at the end of EVERY render. On the second
  * poll it therefore compared the values against themselves and found nothing any more — the
  * highlight disappeared after one poll interval, although the process was still
  * stopped at the same breakpoint.
  *
  * For that reason the comparison is built once when the pause is entered and remembered for
  * the entire pause. The values cannot change in the meantime anyway —
  * the process is stopped.
 */
import { snapshotOf, diffChangedNames, type DebugVariable } from './debugVarsPanelPure';

/** Values at the PREVIOUS stop — the priming baseline that is compared against. */
let prevSnapshot = new Map<string, string>();
/** Result for the current stop; stays in place across all renders of this pause. */
let changedAtBreak = new Set<string>();
/** True as soon as the comparison for the current pause has been built. */
let breakOpen = false;

/** Clear the diff snapshot (call on debug-session start AND end). */
export function resetDebugVarsDiff(): void {
  prevSnapshot = new Map();
  changedAtBreak = new Set();
  breakOpen = false;
}

/**
 * The names changed since the last stop.
 *
 * On the FIRST call of a pause the values are compared and re-primed; after that only
 * the remembered result is returned. When the process is running (`paused` =
 * false), the stop is closed — the next one builds a fresh
 * comparison again. The result stays in place in the meantime, so that the list does not
 * flash up briefly and go empty while the process keeps running.
 *
 * The first stop of a session has an empty baseline and therefore reports
 * nothing as changed — otherwise everything would be marked on the first halt.
 */
export function changedNamesForBreak(
  all: ReadonlyArray<DebugVariable>,
  paused: boolean,
): ReadonlySet<string> {
  if (!paused) {
    breakOpen = false;
    return changedAtBreak;
  }
  if (!breakOpen) {
    changedAtBreak = prevSnapshot.size === 0 ? new Set<string>() : diffChangedNames(prevSnapshot, all);
    prevSnapshot = snapshotOf(all);
    breakOpen = true;
  }
  return changedAtBreak;
}

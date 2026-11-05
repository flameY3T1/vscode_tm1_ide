/** Read-only questions about the running view: rows, totals, dimension, alias, MDX. */

import type { WebviewToHost } from './protocol';
import type { ViewState } from './intents';
import { storedMdx } from './viewMdx';
import type { DisplayRow } from './rowsFromAnswer';
import { isMarked, markCount, markedNames } from './viewMarks';
import { state } from './state';
import { vr, currentView } from './viewRun';

export function currentRows(): DisplayRow[] { return vr.rows; }

/**
 * Does `currentRows()` carry the WHOLE set - or only a window of it?
 *
 * Decisive for static saving: as long as the end was not scrolled to,
 * `rows` holds only a window, and a subset of a few thousand instead of
 * 1.6 million elements would be data loss without a message. `hasMore` reports what the
 * server would still have.
 */
export function rowsComplete(): boolean { return !!vr.run && !vr.hasMore; }

/**
 * Post a message from the running view.
 *
 * For concerns that have to ask the server without themselves being
 * an intent - "default element", for example. Without an open view, without effect.
 */
export function postFromView(m: WebviewToHost): void {
  if (vr.run && vr.poster) { vr.poster(m); }
}

/**
 * The counted total of the view - `-1` while it is not available.
 *
 * Do NOT fall back to the loaded rows: "loaded" and "total" are
 * different numbers, and equating them claimed something about the
 * unseen ones.
 */
export function currentTotal(): number { return vr.total ?? -1; }

/**
 * Is the view UNTOUCHED, i.e. the whole dimension?
 *
 * Decided solely via the stack, never via a count comparison:
 * "loaded rows == total" would, in window mode, be a claim about
 * the unseen ones - the same mistake that `helpers.ts` explicitly avoids
 * in the old path.
 *
 * An `explicit` or `mdx` base is never "everything": both describe a
 * selected set, even if it happens to contain all elements.
 */
export function viewIsPristine(): boolean {
  if (!vr.run || vr.run.preview) { return false; }
  const b = vr.run.view.base.kind;
  return vr.run.view.intents.length === 0 && (b === 'tree' || b === 'set');
}

/** The dimension of the running view. */
export function dimOfView(): string { return vr.run ? vr.run.dim : ''; }

/** The hierarchy of the running view. */
export function hierOfView(): string { return vr.run ? vr.run.hier : ''; }

/** The display alias - empty if elements are shown under their name. */
export function currentAlias(): string { return vr.run ? vr.run.alias : ''; }

/** The current view - ONLY for the diagnosis (`viewDiag.ts`), not for changing. */
export function viewOfDiag(): ViewState | null { return vr.run ? vr.run.view : null; }

/**
 * What Ctrl+C puts on the clipboard.
 *
 * Copying happens in DRAWING order (not in marking order), but ONCE PER
 * MARKED ELEMENT. If an element hangs under two parents, both rows do
 * light up - the mark is nevertheless ONE, because it is the element that is marked
 * and not the occurrence (`viewMarks.ts`). Emitting it twice would have meant
 * claiming that the user chose twice (click test by flameY3T1,
 * 2026-09-20). Until then it came as often as it was drawn.
 *
 * If a mark is currently NOT drawn (behind a filter), it falls back to
 * the name set - emitting nothing would be worse. That one is simple anyway as a `Set`.
 *
 * Without any marking it is ALL visible rows, WITH repetitions:
 * "Copy" without a selection means the display, and there the two rows
 * belong to the picture - that is the contiguous case, not the individual choice.
 */
export function clipboardNames(): string[] {
  if (!vr.run) { return []; }
  // The LABEL, not the root name: what is copied is what is shown
  // (click test by flameY3T1, 2026-08-23). It still stays round-trip capable - TM1
  // resolves an alias value in a member reference (measured live:
  // `[Dim].[Dim].[<alias value>]` returns the root name), so the
  // paste finds the rows again.
  //
  // The fallback to `markedNames()` stays with the NAME: a mark behind
  // a filter has no drawn row, hence no label either.
  if (!markCount()) { return vr.rows.map((r) => r.caption || r.name); }
  const seen = new Set<string>();
  const drawnNames: string[] = [];
  for (const r of vr.rows) {
    if (!isMarked(r.name) || seen.has(r.name)) { continue; }
    seen.add(r.name);
    drawnNames.push(r.caption || r.name);
  }
  return drawnNames.length ? drawnNames : markedNames();
}

/**
 * Does the current expression deviate from the SERVER STATE of the loaded subset?
 *
 * Returns the server state (for the tooltip), otherwise `null`.
 *
 * The old path shows this at the MDX bar; the new one lacked it, and with that
 * one could not see, when filtering a loaded subset, that one deviates from the
 * saved state (inventory 2026-08-23).
 *
 * No marker without a POINT OF COMPARISON: a static subset has no expression,
 * and an unread one is unknown - not empty. In both cases
 * a deviation message would claim a change to a rule that never existed or
 * that nobody knows.
 */
export function mdxDeviates(): string | null {
  if (!vr.run) { return null; }
  if (state._subsetExpressionUnread) { return null; }
  const server = (state._subsetSourceExpression || '').trim();
  if (!server) { return null; }
  const currentExpr = (currentMdx() || '').trim();
  return currentExpr && currentExpr !== server ? server : null;
}

/**
 * The expression that APPLIES - the one source for MDX bar and MDX popup.
 *
 * `null` as long as no dimension is open: the caller should be able to tell "there is nothing
 * to show" from "the expression would be empty".
 *
 * Without a window (`storedMdx`, not `fetchMdx`): whoever copies it or saves it as a subset
 * wants the SET, not the scroll position.
 *
 * WITH preview, because it is part of what is on the screen. The trail
 * marks it as pending next to it - so the bar shows what one sees,
 * and the trail says which part of it is not yet declared.
 */
export function currentMdx(): string | null {
  if (!vr.run) { return null; }
  return storedMdx(currentView(), vr.run.dim, vr.run.hier);
}

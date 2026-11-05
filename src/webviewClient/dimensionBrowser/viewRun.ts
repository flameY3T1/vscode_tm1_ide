import { pushIntent } from './intents';
import type { ViewState } from './intents';
import type { DisplayRow } from './rowsFromAnswer';
import type { FilterLayer } from './filterPredicate';
import type { WebviewToHost } from './protocol';

/**
 * The run of the open view - the request in flight and what it has delivered.
 *
 * Shared by `viewPath.ts`, `viewFetch.ts`, `viewViewport.ts` and `viewStats.ts`.
 * One object instead of module variables, because an imported `let` binding is
 * read-only for the importer: every module that writes the run state needs
 * the same mutable object.
 */

export interface ViewRun {
  dim: string;
  hier: string;
  view: ViewState;
  /**
   * Important 3 (final review): `toggleAt` flips the intent BEFORE the fetch.
   * This holds the state from before - only while an intent change is
   * in flight (`null` otherwise). If the response comes back with `ok:false`,
   * `onViewRows` rolls `run.view` back to it: otherwise the (unchanged)
   * display shows a state that `run.view` no longer shares at all - the next
   * click would flip the intent a second time, without the first ever having
   * been seen.
   */
  previousView: ViewState | null;
  /**
   * The layer the user is currently TYPING - not yet declared.
   *
   * It deliberately lies NEXT TO the stack, not in it: "Apply" is the
   * conclusion, and without it nothing should have come into being that an `x`
   * would have to undo. If it lay in the stack, every typing pause would have to
   * create a layer and the next would have to take it out again - the trail counted
   * intents that never were one.
   *
   * It still applies for fetching AND drawing, otherwise it would not be a preview
   * (see `currentView()`). It sits on TOP: it is the youngest.
   */
  preview: FilterLayer | null;
  /**
   * The names appended last - only until the next response.
   *
   * TM1 drops an unknown name SILENTLY (measured live 2026-08-23:
   * `UNION(M, {[gibtsnicht]}, ALL)` returns `M` unchanged, without an error).
   * Without this comparison the user would only see fewer rows than were inserted and
   * would not know which.
   */
  appended: string[] | null;
  /**
   * The display alias - NOT a layer, but display state.
   *
   * It changes what the rows are called, not which ones are there: hence no chip
   * in the trail and no place in the expression. A SEARCH that was confirmed while it
   * was in effect, on the other hand, carries it permanently within itself (`attr` of the
   * pattern layer) - it was declared against what could be seen at the time.
   */
  alias: string;
  /**
   * A COLLAPSE attempt whose effect is still open.
   *
   * `rowsBefore` are the names of the rows that were there at the time of the click - the
   * response is compared against them. Only set if the window was COMPLETE
   * at the click (see `toggleAt`); otherwise "nothing happened" cannot be told apart from
   * "the block lies outside the window".
   */
  toggleAttempt: { member: string; rowsBefore: string[] } | null;
  /**
   * The row that should STAY at its screen position after the reload.
   *
   * A replaced row set otherwise resets the scroll position to 0 (see
   * below, justified for sorting and filtering). When collapsing this is wrong:
   * whoever collapses an element far down wants to stay there and not start
   * at the top again (report from flameY3T1, 2026-08-30). `offsetPx` is the distance of the
   * row from the top edge of the window at the moment of the click - so it ends up
   * exactly there again afterwards, instead of merely "somewhere visible".
   */
  holdPosition: { member: string; offsetPx: number } | null;
  /** Counts up; only the YOUNGEST request may draw. */
  requestId: number;
  /**
   * Is the RUNNING request an append? Then the existing rows stay
   * and the response is appended at the end. For a state change this is
   * `false` - there the old display is obsolete.
   */
  appending: boolean;
}

function initialRunState() {
  return {
    run: null as ViewRun | null,
    rows: [] as DisplayRow[],
    nextRequestId: 1,
    poster: null as ((m: WebviewToHost) => void) | null,
    /** Has the server said that something comes after the last window? */
    hasMore: false,
    /** Is a request currently running? Prevents scrolling from doubling it. */
    fetching: false,
    /** The total count of the current expression; `null` while it is in flight. */
    total: null as number | null,
    /** Only the YOUNGEST count may write - it is slower than the rows. */
    countRequestId: 0,
  };
}

export const vr = initialRunState();

/** For tests only: reset the run state. */
export function resetViewRun(): void { Object.assign(vr, initialRunState()); }


/**
 * The state that APPLIES - stack plus the typed preview on top.
 *
 * Everything that fetches or draws reads through this: `fetchRows`, `fetchCount`,
 * `rowsFromAnswer` (indentation) and the trail. Reaching directly into `run.view`
 * would mean forgetting the preview at exactly one place - and that
 * goes unnoticed, it merely indents wrongly.
 */
export function currentView(): ViewState {
  if (!vr.run) { throw new Error('sicht() ohne offene Dimension'); }
  return vr.run.preview
    ? pushIntent(vr.run.view, { kind: 'filter', layer: vr.run.preview })
    : vr.run.view;
}

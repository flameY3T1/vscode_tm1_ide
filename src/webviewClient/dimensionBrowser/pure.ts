/**
 * Pure helpers for the Dimension Browser webview.
 *
 * Stateless, side-effect-free utilities — no DOM, no closure state.
 * Extracted from `index.ts` in Hebel 9 (Phase B).
 *
 * Since S2-10 (2026-08-02) this file re-exports `drillModel.ts` (drill
 * tokens, resolution, dynamic saving); every import `from './pure'` keeps
 * working unchanged. Only the topic-less remainders are still here: the HTML
 * escaping and the three race/drag guards. The other four topic files of the
 * old compose/sort path (rowIdentity, treeOps, subsetMdx, rowOrder) and
 * `composeModel.ts` had no production caller left and were removed on
 * 2026-10-04 (review 2026-10-03, C1).
 */

import { escapeHtml } from '../htmlUtils';

export * from './drillModel';

/**
 * HTML-escape. Delegates to the canonical `escapeHtml` (which also escapes `'`),
 * keeping the local null/undefined → '' guard the call sites rely on.
 */
export function esc(s: unknown): string {
  return escapeHtml(s == null ? '' : s);
}

/**
 * Run `fn` at most once per animation frame.
 *
 * Intended for `_drawViewport` on the `scroll` event: that fires several times
 * per frame when the wheel is spun or auto-scroll is running, and every pass
 * REPLACES the complete `tbody` via `innerHTML`. More than one rebuild per
 * frame is wasted work - only the last one becomes visible anyway.
 *
 * The frame scheduler comes in as a parameter, not from `window`: this way the
 * throttling is testable without a browser (this project has no jsdom).
 */
export function rafThrottle(
  fn: () => void,
  raf: (cb: () => void) => number,
): () => void {
  let scheduled = false;
  return function () {
    if (scheduled) { return; }
    scheduled = true;
    raf(function () { scheduled = false; fn(); });
  };
}

/**
 * P1-2/P1-2b (Stufe 4 Race-Protokolle): true when a host response's echoed
 * dim/hier matches the browser's CURRENT selection. A hier switch (or dim
 * switch) leaves any in-flight request for the OLD selection stale — its
 * eventual response must never overwrite the new selection's data
 * (`setElementPage` would otherwise splice dimension-A elements under
 * dimension-B's header, an ancestor drill would splice A's edges into B's
 * `_allData`, a late subset MDX would arm a foreign save).
 *
 * S2-5 (2026-08-02): the predicate, NO LONGER the guard. It has exactly two
 * callers, and both are collection points: `msgScope.ts#acceptForSelection`
 * (the one router head for all host→webview responses) and the delayed
 * comparison in `msg.ts#subsetSaveResult`, which asks a different question (the
 * present against the pair for which the save was made — K16). Before, the
 * call stood eleven times individually in the handlers; whoever builds a new
 * response site today registers it in `MSG_SCOPE` instead of creating a twelfth
 * copy here.
 */
export function isCurrentSelection(
  msgDim: string, msgHier: string, currentDim: string, currentHier: string,
): boolean {
  return msgDim === currentDim && msgHier === currentHier;
}

/**
 * Compute the list of names to drag. If the clicked element is itself in the
 * mark-set and there is more than one mark, drag the whole mark-set (snapshot
 * via `slice()`). Otherwise drag just the clicked element.
 *
 * Pure: caller passes the relevant mark-set — since the Pane-Merge there is only
 * one, `state._markedNames` of the single table.
 */
export function computeDragNames(clickedName: string, markedNames: ReadonlyArray<string>): string[] {
  if (markedNames.length > 1 && markedNames.indexOf(clickedName) >= 0) {
    return markedNames.slice();
  }
  return [clickedName];
}

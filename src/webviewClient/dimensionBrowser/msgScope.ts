/**
 * THE ONE PLACE where it is decided whether a host answer still belongs to
 * what the browser is currently showing.
 *
 * S2-5 (2026-08-02). Before, the same question stood eleven times on its own
 * in the handlers — as a hand-written `isCurrentSelection` call, two of them
 * with a deviating special rule. Every NEW answer site had to think of it
 * individually; three times it was added afterwards, after it had destroyed
 * data live (H3, K11, K24).
 *
 * -- What the epoch IS ------------------------------------------------------
 *
 * It is not a new counter. The epoch of a load is the pair
 * `(dimName, hierName)` — it is already on every request and is echoed back by
 * the host on every answer. What was missing was never the value, but the one
 * place that checks it.
 *
 * A running number assigned by the HOST would be WRONG at this point, and not
 * out of convenience, but because it would reopen the bug the guards close:
 * the client switches the hierarchy itself (`dom.ts`, `hier-select`) without
 * going through the host for it. It would learn of a host-assigned new epoch
 * only with the FIRST answer to the new state — until then every still-flying
 * answer of the old selection would carry exactly the epoch the client still
 * considers current, and would pass. Exactly this window is the K11/K24 case.
 * The pair, by contrast, is new at the very moment the user clicks.
 *
 * Known, PRE-EXISTING limit of the pair: A->B->A in quick succession. An
 * answer from the first A phase fits again after the return. A client-assigned
 * running number would catch that as well — but it would be a mandatory field
 * on every `WebviewToHost` message and a change of behavior beyond parity.
 * Deliberately not part of this step.
 *
 * -- Why `seq` continues to exist alongside ---------------------------------
 *
 * `pure.ts#isStaleSeq` answers a DIFFERENT question: "is this list answer
 * newer than the one applied last?" — for two requests for the SAME dim/hier
 * (double refresh click, "Clear filter", whose answer overtakes the slower
 * predecessor). The epoch cannot handle that as well: for that it would have
 * to keep counting per REQUEST, and then every running page would also discard
 * the simultaneously flying drill, the attribute lookup and the subset answer
 * — which today (correctly) pass, because they only check the selection, not
 * the order. Two questions, two predicates; `seq` therefore still applies only
 * to `setElementPage`.
 *
 * -- The completeness guarantee ---------------------------------------------
 *
 * `MSG_SCOPE` is TOTAL over `HostToWebview['type']`: a new message type is a
 * compile error until it is classified. And the classification is not free —
 * `ScopeOf<>` permits a check only for messages that carry dim/hier at all;
 * everything else can ONLY be `'unscoped'`. Forgetting is thus no longer an
 * option, skipping only with a spelled-out intent.
 */

import { isCurrentSelection } from './pure';
import type { HostToWebview } from './protocol';

/** How an answer is checked against the current selection. */
export type SelectionScope =
  /**
   * Dim AND hier must match the current selection exactly. The normal case.
   */
  | 'strict'
  /**
   * Like `strict`, but the current hierarchy is read as `hier || dim`.
   *
   * Necessary because on these paths the client itself asks with
   * `_currentHier || _currentDim` (`contextMenu.ts`/`dom.ts`) and the host
   * echoes exactly that back (`runSubsetMdx`: `hier = msg.hier || dim`).
   * Without the same normalization on the comparison side, the guard would
   * discard the client's OWN answer as soon as no hierarchy is set.
   */
  | 'hierFallback'
  /**
   * Like `hierFallback`, and additionally tolerated AS LONG AS no dimension is
   * loaded yet.
   *
   * This is deliberately not a pure epoch question: on a fresh open the
   * message arrives BEFORE `setHierarchies`, so the browser does not know any
   * dimension yet (`_currentDim === ''`). That is the normal start order, not
   * a stale answer — whoever compared strictly here would discard the preset
   * completely. The guard only takes effect once a dimension is really loaded.
   */
  | 'coldStartTolerant'
  /**
   * No check. Enforced for messages without dim/hier (see `ScopeOf`), for the
   * rest a spelled-out decision.
   */
  | 'unscoped';

/**
 * A message without `dimName`/`hierName` cannot be related to the selection at
 * all — for it `'unscoped'` is the only assignable value. That makes the table
 * below honest: where "unchecked" stands, it stands either because there is no
 * other way or because someone decided so.
 */
type ScopeOf<M> = M extends { dimName: string; hierName: string } ? SelectionScope : 'unscoped';

/**
 * Total over the union. The justifications are the bug history of the guards
 * that converged here — it belongs with the epoch, not in eleven handlers.
 */
export const MSG_SCOPE: { [K in HostToWebview['type']]: ScopeOf<Extract<HostToWebview, { type: K }>> } = {
  // -- checked ---------------------------------------------------------------

  /**
   * P1-2/P1-2b (stage 4 race protocols): a hierarchy switch A->B makes every
   * flying `fetchElements` request for A stale — its answer must never
   * overwrite B's data (otherwise dimension A elements would stand under
   * dimension B's header row). The equal-rank ordering question within the
   * same dim/hier is additionally answered by `isStaleSeq` IN the handler.
   *
   * Mandatory BEFORE `_pageLoading`, otherwise a stale answer would clear the
   * lock that protects the running request.
   */
  /**
   * P1-2 (follow-up): a switch makes the running lazy attribute load of the
   * OLD selection stale — it would otherwise splice dimension A attributes
   * onto dimension B's rows. Discard BEFORE any mutation, and without
   * clearing the `_attrsLoading` lock of the live selection.
   */
  /**
   * The host answers EVERY `fetchSubsetElements` with its own REST pair, so
   * two quick clicks can come back swapped — a large, slow subset A after the
   * small, fast B. A would then draw A's filter, A's mirror and A's marker
   * bar while the dropdown shows B, and a save would flatten B with A's
   * members. The second part of this identity — WHICH subset — stays in the
   * handler: it compares against the dropdown value, which only the handler
   * knows.
   */
  setSubsetElements: 'strict',
  /** An outline for an abandoned selection would describe foreign rows. */
  /**
   * P1-2 (follow-up): a drill issued under the OLD dim/hier must not merge its
   * descendants into the new selection.
   */
  /**
   * A stale abort must not clear the running action of the CURRENT selection.
   */
  /**
   * K11 (review 2026-08-02): an upward drill of the OLD hierarchy spliced its
   * elements and edges into `_allData` of the new one. There they would become
   * visible rows — and the visible rows are what a save writes.
   */
  ancestors: 'strict',
  /**
   * H3 (2026-07-05): a drill/MDX run under the OLD dim/hier must, after a
   * switch, overwrite neither filter nor list of the NEW one — errors
   * included: an error message for an abandoned dimension is just noise.
   */
  /**
   * K11/K24 (review 2026-08-02): the host sends this from a free-running
   * promise that races against its own `await _loadDimension(...)`. An answer
   * for hierarchy A can therefore land when B is already loaded, and
   * `expressionForSave` compares only name + visibility, never dim/hier — the
   * late answer would thus arm the MDX of a FOREIGN subset for the next save.
   */
  /**
   * Like `ancestors` (K11): a `fetchViewRows` answer of the OLD hierarchy must
   * not overwrite `rows` with rows of a selection that has been abandoned in
   * the meantime. `requestId` remains responsible alongside — but only for the
   * order WITHIN the same dim/hier (a faster second click before the answer to
   * the first); that is a different question and therefore stays in the caller
   * (`viewPath.ts#onViewRows`), not here.
   */
  viewRows: 'strict',
  /**
   * `strict` like `viewRows`: a count for the OLD hierarchy must no longer
   * write after a switch. It is even more susceptible than the rows — it runs
   * for up to 1.5 s and thus survives the switch more easily.
   */
  viewCount: 'strict',
  /**
   * `strict` like the two above: the answer for the PREVIOUS dimension would
   * otherwise fill the selection list with attributes after a switch that do
   * not exist here at all — and the list does not say where it comes from.
   * `viewPath.ts#onAttrDefs` checks the same epoch once more itself; the guard
   * here is the rule, the check there is the assurance within the module.
   */
  attrDefs: 'strict',
  /** `strict` for the same reason as `attrDefs` next to it. */
  levels: 'strict',

  // -- unchecked, with reason --------------------------------------------------

  /**
   * Carries dim/hier, but was never checked — recorded here so that the gap is
   * visible instead of invisible. It only fills the subset dropdown, which the
   * next `fetchSubsets` rewrites completely anyway; the damage of a late
   * answer ends at the next selection. Securing it would be a change of
   * behavior and therefore has to be decided, not done in passing.
   */
  setSubsets: 'unscoped',

  // -- unchecked, because without dim/hier (enforced by the type) -------------

  /** Opening configuration; arrives before any dimension. */
  setMode: 'unscoped',
  /** Pure loading indicator. */
  setLoading: 'unscoped',
  /** Error banner; an error while loading the NEXT selection must be visible too. */
  setError: 'unscoped',
  /** Establishes the selection in the first place — cannot measure itself against it. */
  setHierarchies: 'unscoped',
  /**
   * Arrives BEFORE `setHierarchies` (task 8) — carries only `dimName`, no
   * hierarchy: the column selection applies per dimension, not per hierarchy
   * (deliberately not included, see spec). A guard over `dimName` alone would
   * be half a check; unscoped is honest.
   */
  attrColumns: 'unscoped',
  /** Only toggles the toolbar button of the attribute cube. */
  setAttrCubeExists: 'unscoped',
  /** Carries no origin; follows immediately after `_applySubsetChoice`. */
  setDefaultMember: 'unscoped',
  /**
   * Carries no dim/hier — and its guard is not of this family either: it does
   * not compare the answer with the present, but the present with the pair for
   * which the save was made. Recorded on arrival, checked only 600 ms later in
   * the timer (K16). It therefore stays in the handler.
   */
  subsetSaveResult: 'unscoped',
  /**
   * The workbench asks for the state. Carries no dim/hier — and SHOULD not have
   * a guard either: the question refers to what is visible RIGHT NOW, not to an
   * earlier selection. A guard would discard it after a hierarchy switch and
   * the workbench would run into its cap.
   */
  requestState: 'unscoped',
};

/**
 * The guard itself — ONE call in the router head (`msg.ts`), before every
 * handler and thus before every state and DOM mutation.
 *
 * @param msg         the incoming host message
 * @param currentDim  `state._currentDim`
 * @param currentHier `state._currentHier`
 * @returns `false` => the answer no longer belongs to what the browser is
 *          showing, and is silently discarded.
 */
export function acceptForSelection(
  msg: HostToWebview, currentDim: string, currentHier: string,
): boolean {
  const scope: SelectionScope = MSG_SCOPE[msg.type];
  if (scope === 'unscoped') { return true; }
  // The cold-start tolerance stands BEFORE the comparison, not inside it: it
  // does not say "matches", but "there is nothing yet to check against".
  if (scope === 'coldStartTolerant' && !currentDim) { return true; }
  // `strict` compares the hierarchy raw; the other two normalize it exactly as
  // the client formed it when asking.
  const curHier = scope === 'strict' ? currentHier : (currentHier || currentDim);
  const scoped = msg as Extract<HostToWebview, { dimName: string; hierName: string }>;
  return isCurrentSelection(scoped.dimName, scoped.hierName, currentDim, curHier);
}

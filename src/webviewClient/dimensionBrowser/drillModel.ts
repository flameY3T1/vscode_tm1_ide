/**
 * Dynamic saving: whether the MDX option may be offered, and which
 * expression a ticked checkbox would store.
 *
 * Caller: `saveMode.ts` (via the facade `pure.ts`).
 *
 * Split out of `pure.ts` (S2-10, 2026-08-02). Until 2026-08-26 the file also
 * carried the drill model of the OLD path — `drillTokenPositions`,
 * `mergeLeafDrill`, `resolveDrills`, `planDynamicSave`, around 230 lines. Their
 * only caller was the drill machinery in `subset.ts`, and that depended on
 * `state._drills`, which had no writer any more since the old path was torn
 * down (review 2026-08-24, H6). The drill intent of the new path is computed by
 * `viewPath.ts`/`ctxIntents.ts`, and the save plan is supplied by
 * `subsetSource#dynamicSavePlanForView`.
 */

/**
 * Why the "save as dynamic subset (MDX)" option is (un)available, and which MDX
 * a ticked checkbox would store.
 *
 * - `existing` — the target subset already IS dynamic on the server and is saved
 *   under its own name (`expressionForSave` matched). Its CURRENT server
 *   expression is kept; nothing is rebuilt from the drill.
 * - `drill` — every active drill still matches the selection → its semantic MDX.
 * - `partial` — at least one drill still matches, at least one was degraded by
 *   a hand edit. Saving stays dynamic; the degraded drills sit as fixed members.
 * - `no-drill` — no drill context at all (plain hand-picked list).
 * - `selection-changed` — a drill is active but every one was edited by hand.
 * - `composed` — no own expression, no drill winning, but the composition
 *   machine (`composeCurrent`) derived a valid MDX from base + explained
 *   intents (EXCEPT/UNION/INTERSECT/…).
 * - the four `DegradeReason` values (`'duplicates' | 'too-many-moves' |
 *   'shared-elements' | 'simulation-mismatch'`) — the composition machine tried
 *   and named WHY the current state cannot stay dynamic; `'no-base'` is excluded
 *   here because it just means "nothing to compose", not a degrade the user
 *   caused. `'shared-elements'` is likewise none of the user's doing: it is the
 *   same count that would otherwise read `'too-many-moves'`, but over rows that
 *   repeat a name because a child hangs under several parents.
 */
export type DynamicSaveReason =
  | 'existing' | 'drill' | 'partial' | 'no-drill' | 'selection-changed'
  | 'composed' | 'duplicates' | 'too-many-moves' | 'shared-elements'
  | 'simulation-mismatch' | 'base-is-target' | 'window-limited';

export interface DynamicSavePlan {
  /** May the checkbox be ticked? Also its default state when the modal opens. */
  available: boolean;
  /** MDX stored when ticked; `''` when unavailable. */
  expression: string;
  reason: DynamicSaveReason;
  /** How many drills still describe the selection (0 outside `'drill'`/`'partial'`). */
  activeDrills: number;
  /** How many drills were degraded by a hand edit (0 outside `'partial'`/`'selection-changed'`). */
  demotedDrills: number;
}

/**
 * The `expression` a `saveSubset` message carries for a given checkbox state.
 *
 * Unticking is a deliberate "make this a STATIC subset" — even for a subset that
 * is dynamic on the server today. Dropping the expression here is what routes the
 * host to its element-list save, which in turn raises the "saving replaces its
 * MDX expression with a fixed list" confirmation before anything is destroyed.
 */
export function dynamicSaveExpression(plan: DynamicSavePlan, checked: boolean): string | undefined {
  if (!checked || !plan.available || !plan.expression) { return undefined; }
  return plan.expression;
}

/**
 * Whether the checkbox "as dynamic subset (MDX)" is PRESET.
 *
 * Basic rule: on, as soon as a dynamic expression is available — that is
 * the form that grows along.
 *
 * Exception: the target is a subset that is STATIC on the server. Opening a
 * native subset, changing it and writing it back should not turn it into a rule
 * on the side; afterwards its member list would no longer be fixed. The
 * conversion remains possible, it only has to be ticked.
 *
 * What does NOT count as "previously native": an unknown target name (no
 * history) and an entry without an `isDynamic` flag — the field is optional,
 * and "not reported" is no statement about the server. In both cases the
 * basic rule applies, instead of reading an intent into a gap.
 *
 * TM1 compares names case-insensitively (as `baseIsTarget` in the removed `composeModel` did).
 */
export function dynamicSaveDefaultOn(
  available: boolean,
  target: { name: string; isPrivate: boolean },
  known: ReadonlyArray<{ name: string; isPrivate: boolean; isDynamic?: boolean }>,
): boolean {
  if (!available) { return false; }
  const want = target.name.toLowerCase();
  for (const s of known) {
    if (s.isPrivate === target.isPrivate && s.name.toLowerCase() === want) {
      return s.isDynamic !== false;
    }
  }
  return true;
}

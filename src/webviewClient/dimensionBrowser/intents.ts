export {};

import type { FilterLayer } from './filterPredicate';

export type { FilterLayer };

/**
 * What the view starts with. Three different ANSWERS, not three speeds -
 * the user gets what they choose (decision by flameY3T1, 2026-08-21):
 *
 * - `set`     `TM1SUBSETALL` - every element exactly once (211,852 on the
 *             measurement dimension), in index order. Expensive: ~610 ms, independent of the window.
 * - `tree`    `[d].[h].Members` - every OCCURRENCE once (1,634,905), fully
 *             expanded. Lazy: ~82 ms, even at `$skip=100000`.
 * - `roots`   only the roots - the collapsed start for large dimensions.
 * - `explicit` an order fixed by hand (see `freezeOrder`).
 */
export type BaseKind = 'set' | 'tree' | 'roots';

export type Base =
  | { kind: BaseKind }
  | { kind: 'explicit'; names: string[] }
  /**
   * A hand-written expression (MDX popup, "Execute").
   *
   * A BASE, not a layer: it replaces the answer instead of restricting it.
   * That gives the button a meaning in the new path again without opening a
   * second state next to the stack - before, it wrote to
   * `state._subsetExpression` and let the OLD renderer draw over the new one.
   */
  | {
      kind: 'mdx'; expr: string;
      /**
       * What appears in the trail. Without it the base is simply called "MDX" -
       * which is right for a hand-written expression, but not for a drill
       * action: "Leaves of d" says what is there, `MDX` does not.
       */
      label?: string;
    };

/**
 * An intent - a LAYER on the set that was there at the time of its choice
 * (decision by flameY3T1, 2026-08-22: "the filter is applied to a set at time x;
 * if the set is changed afterwards, that has nothing to do with the filter
 * any more").
 *
 * The basic rule follows from that: only the TOP one is taken off (`popIntent`).
 * Pulling a layer out of the middle would mean applying all those above it to a
 * set that did not exist back then - a recalculation that looks like an undo.
 *
 * DELIBERATE EXCEPTION for `collapse` (closing review, 2026-08-22):
 * `toggleCollapse` removes its `collapse` layer wherever it is in the stack -
 * not only at the top. That does not contradict the basic rule, because the
 * reason for the rule does not apply here: the basic rule protects a layer
 * whose MEANING depends on the set beneath it. A `filter` is a pure predicate
 * per element - it selects the same elements whatever set lies beneath.
 * `FILTER(DRILLUPMEMBER(M,{d}), C)` and `FILTER(M, C)` are both well defined,
 * and the latter is exactly what someone expects who expands `d` again. A
 * triangle that first demanded clearing away all filters would be worse to
 * operate, with no gain.
 *
 * The exception applies ONLY as long as every layer is a predicate. The next
 * plan introduces "keep"/"remove" as ENUMERATED sets, whose meaning does very
 * much depend on the set they were chosen on - that case has to be decided anew
 * there, not silently go along.
 */
export type Intent =
  | { kind: 'collapse'; member: string }
  /**
   * `DRILLDOWNMEMBER` - push the block of a parent BEHIND it.
   *
   * The counterpart to `collapse`, and on the set (`TM1SUBSETALL`) the actual
   * meaning of the triangle: there, initially nothing stands behind the parent,
   * because the index order says nothing about the tree. Measured live
   * (2026-08-22, dimSubsetallDrillDownProbe.js):
   * `{DRILLDOWNMEMBER({TM1SUBSETALL([aa].[aa])}, {[aa].[aa].[sum]})}` turns
   * 8 rows into 9, `sum` afterwards reports "open", `a` stands behind it with the
   * chain `[sum]`, and a `DRILLUPMEMBER` on it leads back exactly.
   *
   * The price is measured and expressly accepted (decision by flameY3T1,
   * 2026-08-22): because `TM1SUBSETALL` already carries EVERY element, the child
   * then appears twice - once at its index position, once under the parent.
   */
  /**
   * Expand. `recursive` expands the WHOLE subtree instead of one level -
   * that is "expand fully" from the context menu.
   *
   * It is a LAYER, not a base (decision by flameY3T1, 2026-08-26: "if others are
   * supposed to stand next to it, they should stay there"). Measured live on
   * a test dimension (dimExpandFullyEdgeProbe.js, subtree 6
   * levels deep): the view with a collapsed target has 526 rows, with the layer
   * 620 - the same 620 as the fully open view. On a LEAF it changes nothing
   * (16 -> 16) and does not throw.
   *
   * Which expression achieves that is in `viewMdx.ts` - `RECURSIVE` alone is
   * NOT enough.
   */
  | { kind: 'expand'; member: string; recursive?: true }
  | { kind: 'filter'; layer: FilterLayer }
  /**
   * APPEND names - the only intent that ENLARGES the set.
   *
   * Everything else restricts: a base is replaced, layers take away.
   * `UNION(a, b, ALL)` appends and keeps repetitions, so an element may be added
   * a second time (decision by flameY3T1, 2026-08-23: "you should be able to add
   * the same thing even if it is already in"). Without `ALL`, `UNION`
   * deduplicates - measured live, 548 fell to 241.
   */
  | { kind: 'add'; names: string[] }
  /**
   * "Show all parents" - `TM1ROLLUP`. The element STAYS in place and gets its
   * parents above it; the rest of the set remains untouched.
   *
   * `ancestors` is the occurrence path of the clicked row (root first, without
   * the element). It is NOT decorative extra: `TM1ROLLUP` hits via the
   * OCCURRENCE, and a bare name that does not hit makes the expression silently
   * do nothing.
   */
  | { kind: 'rollup'; member: string; ancestors: string[] }
  /**
   * "Show parent" - the ONE parent chosen by the user, above its occurrence.
   *
   * Not `add`: `UNION(set, {p}, ALL)` appends at the END, and the parent then
   * stood below the last row instead of above its child. Not `rollup`:
   * `TM1ROLLUP` ALWAYS puts ALL parents of the hit, even with the occurrence
   * form as the hit and even on a one-element set (measured live on `aa`
   * 2026-08-25). A restricting third argument does not exist (HTTP 400/501),
   * neither does `GENERATE(..., IIF(...), ALL)`, and `RANK` as a position
   * SILENTLY returns the empty set instead of an error.
   *
   * What works is the CUT at the position: `HEAD` up to there, the parent,
   * `SUBSET` from there. `at` is the position of the clicked occurrence in the
   * set BENEATH this intent - not the name, because the same name occurs several
   * times, and exactly the clicked occurrence is meant.
   *
   * The position stays valid as long as this intent is in the stack: later
   * intents go on TOP (`pushIntent`), `popIntent` takes off only the topmost,
   * and a change of base throws the stack away anyway
   * (`setBase` -> `initialView`).
   */
  | { kind: 'pick-parent'; parent: string; at: number }
  /**
   * The first intent that REORDERS instead of removing.
   *
   * `attr` is the display alias, if one was switched on: the sort orders what is
   * to be SEEN - the same rule as for the search. `TM1SORT` knows only names, so
   * with an alias it becomes an `ORDER(...Properties())`. For `hierarchy` it is
   * irrelevant: the alias says nothing about the position in the tree.
   *
   * Measured live (2026-08-23, 621-element dimension): all three forms return
   * 621 of 621 - they remove nothing.
   */
  | { kind: 'sort'; mode: 'hierarchy' | 'hier-asc' | 'hier-desc' | 'asc' | 'desc' | 'index-asc' | 'index-desc'; attr?: string }
  /**
   * Keep/Remove - ENUMERATED sets, but still PREDICATES.
   *
   * Plan 4 deferred the question whether the `collapse` exception also holds
   * once these two are in the stack. It does: `EXCEPT(X, {a,b}, ALL)` means the
   * same for EVERY `X`, namely "without the elements a and b". The meaning does
   * not depend on the set beneath - only the SELECTION was made on a particular
   * set, and that is a question of operation, not of semantics. The collapse
   * triangle therefore stays a free toggle.
   */
  | { kind: 'keep'; names: string[] }
  | { kind: 'remove'; names: string[] };

export interface ViewState {
  base: Base;
  intents: Intent[];
}

export function initialView(base: BaseKind): ViewState {
  return { base: { kind: base }, intents: [] };
}

export function isCollapsed(v: ViewState, member: string): boolean {
  return v.intents.some((i) => i.kind === 'collapse' && i.member === member);
}

/**
 * Is the subtree already there in this base by default?
 *
 * Decides whether collapsing NEEDS a `collapse` layer or whether it suffices to
 * remove the `expand` layer.
 *
 *   tree      `.Members` shows the whole tree open                 -> yes
 *   mdx       foreign list, contains its descendants as well       -> yes
 *   explicit  frozen hand list, likewise                           -> yes
 *   set       `TM1SUBSETALL` contains ALL elements, hence also     -> yes
 *             the descendants
 *   roots     only the roots, the descendants are missing          -> no
 *
 * `set` stood at `no` here until 2026-08-30, with the measurement
 * "`DRILLUPMEMBER(TM1SUBSETALL(H), {d})` leaves the set unchanged (308 -> 308)".
 * The measurement is right - it ran only against a flat dimension without
 * consolidations, where nothing COULD drop out. From it, "TM1SUBSETALL is flat"
 * was generalised, and it is not: it returns all elements, consolidated ones and
 * leaves.
 *
 * Re-measured on its alternate hierarchy (2026-08-30,
 * subsetAllCollapseProbe.js): TM1SUBSETALL 171,322 rows, after
 * ONE `DRILLUPMEMBER` 128,466 - 42,856 fewer. So it does have an effect.
 *
 * The bug this caused (report by flameY3T1): on `TM1SUBSETALL`, expand an element
 * fully, then collapse it - the first click only removed the `expand` layer and
 * set NO `collapse`, because the base supposedly shows nothing. The row stayed
 * open, and only the second click restored the starting position.
 */
function baseShowsDescendants(base: Base): boolean {
  return base.kind === 'tree' || base.kind === 'mdx'
    || base.kind === 'explicit' || base.kind === 'set';
}

/**
 * Toggle the triangle of a row - the DIRECTION comes from the server.
 *
 * `open` is the expansion state that the answer reports for this occurrence
 * (`DisplayInfo` bit `DRILLED_DOWN`). That removes the need for a special case
 * per base: on `.Members` everything is open, so the triangle collapses; on
 * `TM1SUBSETALL` everything is closed, so it expands.
 *
 * An opposing intent that is already in place is REMOVED instead of putting a
 * new one on top - otherwise the stack grows with every back and forth, and
 * `DRILLUPMEMBER(DRILLDOWNMEMBER(x))` would be the same result, but a trail
 * that nobody can read any more.
 */
export function toggleDrill(v: ViewState, member: string, open: boolean): ViewState {
  if (open) {
    const withoutExpand = v.intents.filter((i) => !(i.kind === 'expand' && i.member === member));
    if (withoutExpand.length !== v.intents.length) {
      // The shortcut "remove the layer instead of collapsing" holds ONLY if the
      // row would really be closed without it. Over `.Members` it is not: the
      // subtree stands there anyway, so removal changes NOTHING and the triangle
      // seems dead. That is exactly how "expand fully" felt - it is the only
      // action that leaves an `expand` layer over an already open base
      // (click test by flameY3T1, 2026-08-26: "then the tree is rigid").
      const state = { base: v.base, intents: withoutExpand };
      return baseShowsDescendants(v.base)
        ? pushIntent(state, { kind: 'collapse', member })
        : state;
    }
    return pushIntent(v, { kind: 'collapse', member });
  }
  if (isCollapsed(v, member)) {
    return { base: v.base, intents: v.intents.filter((i) => !(i.kind === 'collapse' && i.member === member)) };
  }
  return pushIntent(v, { kind: 'expand', member });
}

/**
 * Collapsing appends, expanding removes. There is NO counterpart to
 * `DRILLUPMEMBER`: `DRILLDOWNMEMBER` on `.Members` returns the input row by row -
 * there is nothing left to expand (live 11.8, 2026-08-21).
 *
 * Takes the layer from the middle of the stack, not only from the top - that is
 * the documented, DELIBERATE exception to the "top only" rule (see the doc
 * comment on `Intent` above: filters are predicates, their meaning does not
 * depend on the set beneath). Do NOT "fix" this to `popIntent` behaviour - the
 * exception is intentional, not a bug.
 */
export function toggleCollapse(v: ViewState, member: string): ViewState {
  const intents = isCollapsed(v, member)
    ? v.intents.filter((i) => !(i.kind === 'collapse' && i.member === member))
    : v.intents.concat([{ kind: 'collapse', member }]);
  return { base: v.base, intents };
}

/**
 * "Expand fully" - the whole subtree, the rest of the view remains.
 *
 * Beforehand BOTH opposing intents for this element are thrown out: a
 * `collapse` would immediately undo the expansion, and a plain `expand` stacked
 * underneath would give `DRILLDOWNMEMBER(DRILLDOWNMEMBER(x,{d}),
 * {d}, RECURSIVE)` - the same picture, but a trail that nobody reads any more.
 * The same consideration as in `toggleDrill`, just with one more intent.
 */
export function expandFully(v: ViewState, member: string): ViewState {
  const without = v.intents.filter(
    (i) => !((i.kind === 'collapse' || i.kind === 'expand') && i.member === member),
  );
  return { base: v.base, intents: without.concat([{ kind: 'expand', member, recursive: true }]) };
}

/**
 * Moving/inserting makes the order rigid - and the expression says so,
 * instead of hiding it in set algebra (decision by flameY3T1, 2026-08-21:
 * "when you move or insert, it is legitimate to go into a rigid MDX list").
 * Measured: an enumerated set with 5,000 members 134 ms, nested splices from
 * 10 moves onward time out.
 *
 * The collapse intents drop out in the process: the frozen list IS already the
 * result in which they are contained.
 */
export function freezeOrder(v: ViewState, names: readonly string[]): ViewState {
  void v;
  return { base: { kind: 'explicit', names: names.slice() }, intents: [] };
}

/**
 * A view on a hand-written expression.
 *
 * Without intents: a new base is a new answer, and the layers above it applied
 * to the old one.
 */
export function mdxBase(expr: string, label?: string): ViewState {
  return { base: label ? { kind: 'mdx', expr, label } : { kind: 'mdx', expr }, intents: [] };
}

export function pushIntent(v: ViewState, i: Intent): ViewState {
  return { base: v.base, intents: v.intents.concat([i]) };
}

/** Takes off the TOP layer. Empty stack: unchanged, no error. */
export function popIntent(v: ViewState): ViewState {
  if (!v.intents.length) { return v; }
  return { base: v.base, intents: v.intents.slice(0, -1) };
}

/**
 * Is the order of the answer still that of the edge tree?
 *
 * Only then may it be indented. Measured (spec block A): filters remove and do
 * NOT reorder; `TM1SORT` reorders. `set` is index order, `explicit` a hand
 * order - neither is tree order.
 *
 * Sorting and moving are added in plan 5; they report in here.
 */
export function orderIsReplaced(v: ViewState): boolean {
  // `mdx`: we know nothing about the order of a foreign expression.
  // Indenting would mean asserting a tree order that nobody has checked.
  if (v.base.kind === 'set' || v.base.kind === 'explicit' || v.base.kind === 'mdx') { return true; }
  return v.intents.some((i) => {
    switch (i.kind) {
      case 'collapse': return false;
      case 'filter': return false;
      // Both remove but do NOT reorder - `EXCEPT`/`INTERSECT` with
      // `ALL` keep the order of the first set (spec block A).
      case 'keep': return false;
      case 'remove': return false;
      // `DRILLDOWNMEMBER` INSERTS behind the parent and does not reorder the
      // rest (measured live: the other rows keep their sequence).
      case 'expand': return false;
      // `UNION` appends at the END and leaves the first set alone. The
      // appended rows stand outside their tree position and appear flat -
      // that is honest, they are NOT in the tree there.
      case 'add': return false;
      // `TM1ROLLUP` puts the parents immediately BEFORE the occurrence and does
      // not reorder the rest - the indentation stays derivable.
      case 'rollup': return false;
      // The cut puts the parent immediately BEFORE the occurrence and leaves
      // the rest in its sequence - like `TM1ROLLUP`, just with one parent
      // instead of all.
      case 'pick-parent': return false;
      // Measured live on `aa` (2026-08-23):
      //   HIERARCHIZE     sum a | d c a x b | xxx x xx   tree order
      //   ORDER ASC       d a b c x | sum a | xxx x xx   tree stays, sorted
      //   BASC            a a b c d sum x x xx xxx       flat
      //   TM1SORTBYINDEX  a b sum c d xxx xx x           index order, flat
      //
      // Index order is NOT tree order - so it also reorders.
      case 'sort':
        return i.mode === 'asc' || i.mode === 'desc'
          || i.mode === 'index-asc' || i.mode === 'index-desc';
      default: {
        const unreachable: never = i;
        throw new Error(`unbekannte Absicht: ${JSON.stringify(unreachable)}`);
      }
    }
  });
}

/**
 * Set the sort - AT MOST ONE, swapped in place.
 *
 * Unlike search and attribute filter, which stack: those come from a field that
 * one confirms, and two name filters on top of each other are two meaningful
 * intents. Two sorts on top of each other are not - the lower one has no effect,
 * but would stand there as a chip that could be taken back individually. An
 * undo that changes nothing.
 *
 * `null` removes it.
 */
export function setSortIntent(
  v: ViewState, mode: 'hierarchy' | 'hier-asc' | 'hier-desc' | 'asc' | 'desc' | 'index-asc' | 'index-desc' | null, attr?: string,
): ViewState {
  const index = v.intents.findIndex((i) => i.kind === 'sort');
  if (!mode) {
    if (index < 0) { return v; }
    return { base: v.base, intents: v.intents.filter((_, n) => n !== index) };
  }
  // The alias is irrelevant for the tree order - writing it along would give a
  // chip that names a sort which does not take place.
  const next: Intent = mode === 'hierarchy' || !attr
    ? { kind: 'sort', mode }
    : { kind: 'sort', mode, attr };
  if (index < 0) { return pushIntent(v, next); }
  const intents = v.intents.slice();
  intents[index] = next;
  return { base: v.base, intents };
}

/**
 * TOGGLE one level - `null` clears all of them.
 *
 * Toggling instead of setting, because the selection field is a menu and after
 * every choice jumps back to its label: it cannot show the state, and toggling
 * is the only operation that allows a multiple selection without a state
 * display (decision by flameY3T1, 2026-08-23). The state is in the trail.
 *
 * There remains AT MOST ONE level layer - two on top of each other would be a
 * cut that nobody meant. Removing the last level removes the layer entirely,
 * instead of leaving a filter without a question standing.
 *
 * `0` is a real level (the leaf level), only `null` means "none".
 */
export function setLevelFilter(v: ViewState, level: number | null): ViewState {
  const isLevel = (i: Intent): boolean => i.kind === 'filter' && i.layer.kind === 'level';
  const index = v.intents.findIndex(isLevel);
  const without = (): ViewState =>
    (index < 0 ? v : { base: v.base, intents: v.intents.filter((_, n) => n !== index) });
  if (level === null) { return without(); }
  const current = currentLevels(v);
  const nextList = current.indexOf(level) >= 0
    ? current.filter((n) => n !== level)
    : current.concat([level]).sort((a, b) => a - b);
  if (!nextList.length) { return without(); }
  const next: Intent = { kind: 'filter', layer: { kind: 'level', levels: nextList } };
  if (index < 0) { return pushIntent(v, next); }
  const intents = v.intents.slice();
  intents[index] = next;
  return { base: v.base, intents };
}

/** Which sort currently applies - `null` if none is in place. */
export function currentSort(v: ViewState): 'hierarchy' | 'hier-asc' | 'hier-desc' | 'asc' | 'desc' | 'index-asc' | 'index-desc' | null {
  const i = v.intents.find((x) => x.kind === 'sort');
  return i && i.kind === 'sort' ? i.mode : null;
}

/** Which levels currently apply - empty if no layer is in place. */
export function currentLevels(v: ViewState): number[] {
  const i = v.intents.find((x) => x.kind === 'filter' && x.layer.kind === 'level');
  return i && i.kind === 'filter' && i.layer.kind === 'level' ? i.layer.levels.slice() : [];
}

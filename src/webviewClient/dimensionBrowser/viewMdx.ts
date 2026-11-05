export {};

import type { ViewState } from './intents';
import type { FilterLayer } from './filterPredicate';
import { escapeMdx, escapeMdxString, memberOccurrencesMdx } from '../../utils/odataKey';

function member(dim: string, hier: string, name: string): string {
  return `[${escapeMdx(dim)}].[${escapeMdx(hier)}].[${escapeMdx(name)}]`;
}

/** TM1's `ELEMENT_TYPE` as a string — 1 = Numeric, 2 String, 3 = Consolidated. */
const ELEMENT_TYPE_CODE: Record<'N' | 'S' | 'C', string> = { N: '1', S: '2', C: '3' };

/** `]` is also doubled in the PATTERN — it sits in the same MDX string. */
function layerMdx(layer: FilterLayer, inner: string, h: string): string {
  switch (layer.kind) {
    case 'pattern': {
      // Third argument = attribute name. Measured live (2026-08-23): then
      // ONLY that attribute is searched, wildcards behave as on the name, and an
      // attribute that does not exist falls back SILENTLY to the name —
      // so `attr` may only come from `attrDefs` (see `viewControls.ts`).
      const wo = layer.attr ? `, "${escapeMdxString(layer.attr)}"` : '';
      return `{TM1FILTERBYPATTERN(${inner}, "${escapeMdxString(layer.pattern)}"${wo})}`;
    }
    case 'level':
      // No level is no question.
      if (!layer.levels.length) { return inner; }
      // `TM1FILTERBYLEVEL` is VARIADIC (hint from flameY3T1, 2026-08-23; re-measured
      // live). The tower of `UNION` + `INTERSECT` built here earlier
      // — needed because `UNION` appends instead of sorting in and the
      // indentation needs the tree order — yields exactly the same characters,
      // but on 1.63 million costs 1416 ms against 296 ms. The argument order
      // does not matter, and a level that does not exist is simply ignored.
      return `{TM1FILTERBYLEVEL(${inner}, ${layer.levels.join(', ')})}`;
    // `UCASE` on BOTH sides, because `INSTR` compares case-sensitively and the
    // name filter next to it does not — two search fields with different
    // upper/lower-case rules would be impossible to explain. Measured live
    // (2026-08-23): the form returns 200 and cuts 1,634,905 down to 2,404,
    // but costs ~1.4 s in the process — `Properties()` per occurrence.
    case 'attr': {
      const needle = `UCASE("${escapeMdxString(layer.value)}")`;
      const terms: string[] = [];
      // The name only if NO attribute was chosen: whoever chooses one means
      // that one, and name hits would be an extra they did not order.
      if (layer.withName) { terms.push(`INSTR(UCASE(${h}.CurrentMember.Name), ${needle}) > 0`); }
      for (const a of layer.attrs) {
        terms.push(`INSTR(UCASE(${h}.CurrentMember.Properties("${escapeMdxString(a)}")), ${needle}) > 0`);
      }
      // Nothing to ask means do not filter — `FILTER(set, )` would not be MDX.
      if (!terms.length) { return inner; }
      return `{FILTER(${inner}, ${terms.join(' OR ')})}`;
    }
    case 'type': {
      // OR, not AND: "only N and C" means "N OR C". An empty type list
      // would yield an empty condition — the caller then creates no layer.
      const anyOf = layer.types
        .map((t) => `${h}.CurrentMember.Properties("ELEMENT_TYPE") = "${ELEMENT_TYPE_CODE[t]}"`)
        .join(' OR ');
      return `{FILTER(${inner}, ${anyOf})}`;
    }
    default: {
      const unreachable: never = layer;
      throw new Error(`unbekannte Filterschicht: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * The expression that describes the SET — what appears in the MDX bar and what
 * a subset save writes. The window is NOT part of it (see `fetchMdx`).
 */
export function storedMdx(v: ViewState, dim: string, hier: string): string {
  const h = `[${escapeMdx(dim)}].[${escapeMdx(hier)}]`;
  let mdx: string;
  switch (v.base.kind) {
    case 'set': mdx = `{TM1SUBSETALL(${h})}`; break;
    case 'tree': mdx = `{${h}.Members}`; break;
    // Verbatim. It is the answer, not an ingredient of it — every bracket
    // we put around it would be a claim about a foreign expression.
    case 'mdx': mdx = v.base.expr; break;
    // `IsNull(Parent)` is MDX error 501; the root test goes through the
    // empty parent name (live 11.8).
    case 'roots': mdx = `{FILTER({${h}.Members}, ${h}.CurrentMember.Parent.Name = "")}`; break;
    default: mdx = `{${v.base.names.map((n) => member(dim, hier, n)).join(',')}}`; break;
  }
  // Is a TREE WALK underneath everything, or a foreign set?
  //
  // `DRILL*MEMBER` presupposes a tree walk (`.Members`, `TM1SUBSETALL`,
  // a filter on those). Over the list of a saved MDX view or
  // a frozen manual list it is NOT suitable — measured live (11.8,
  // `Cube A/Default`, 14 rows, 2026-08-23):
  //
  //   DRILLDOWNMEMBER(list, {Total})   14 → 24, the 10 children TWICE
  //   DRILLUPMEMBER(list, {Total})     14 → 14, a silent no-op
  //
  // Both for the same reason: the children are already in the list, just not as a
  // block behind their parent. Over the `roots` base (filter on
  // `.Members`) it is, by contrast, correct AND round-trip capable (42 → 52 → 42),
  // so it stays there. The drill target is every occurrence of the name
  // (`memberOccurrencesMdx`): the bare reference hits only the one under the
  // first parent, so a child drilled in under its second parent stayed shut.
  const foreignSet = v.base.kind === 'mdx' || v.base.kind === 'explicit';
  /** All descendants of the member removed — the row itself stays. */
  const withoutDescendants = (set: string, m: string): string =>
    `{EXCEPT(${set}, EXCEPT(DESCENDANTS(${m}), {${m}}, ALL), ALL)}`;

  for (const i of v.intents) {
    switch (i.kind) {
      case 'collapse':
        mdx = foreignSet
          ? withoutDescendants(mdx, member(dim, hier, i.member))
          : `{DRILLUPMEMBER(${mdx}, ${memberOccurrencesMdx(h, i.member)})}`;
        break;
      case 'expand': {
        // Clear away first, then drill: otherwise the children appear twice —
        // once at their list position, once behind the parent
        // (click test flameY3T1 2026-08-23, re-measured live).
        // "Expand fully" needs TWO ingredients, not one.
        //
        // `RECURSIVE` alone does NOT do it: it repeats the drill only for
        // elements that are in the SECOND argument. If only `{d}` is there,
        // exactly one level expands — measured live on a test dimension
        // (dimExpandFullyDepthProbe2.js, subtree of 6 levels,
        // 53 leaves): with and without the flag an identical 18 rows, whereas
        // drilling by hand gives 22. Only the descendants AS TARGETS plus
        // `RECURSIVE` expand all the way through (110 rows, 5 ms).
        //
        // `SELF_AND_BEFORE`, not `SELF_AND_AFTER`: in TM1 level 0 is the
        // LEAF and the level rises upward, so the descendants lie
        // "before". `AFTER`/`SELF_AND_AFTER` silently return 0 — no error,
        // just an empty set that renders the whole form ineffective.
        //
        // BUT: `DESCENDANTS` as the target set PLUS `RECURSIVE` makes TM1 drill
        // recursively over a set that already contains the result. On
        // the small subtree on which the form was measured, that costs
        // nothing (5 ms). On an alternate hierarchy with 42,033
        // descendants the same expression ran into the abort — 18.9 s without
        // an answer, measured 2026-08-30 (expandFullyCostProbe.js).
        //
        // The descendant set IS the result: `DESCENDANTS(…, SELF_AND_BEFORE)`
        // returns the element and the subtree in tree order, 42,033 rows in
        // 88 ms. It is therefore united directly into the set instead of being passed
        // as a drill target; `HIERARCHIZE` places the block at the position of the
        // element instead of appending it at the end. Measured 300 ms on a
        // 483-row base — versus the abort before.
        //
        // Price, deliberate: `HIERARCHIZE` forces tree order. A view sorted
        // by hand loses its sorting when it is fully expanded. This
        // concerns only `recursive`; single-level expansion runs
        // unchanged via `DRILLDOWNMEMBER` and inserts in place.
        //
        // The set is SUPPLEMENTED, not replaced: `EXCEPT(descendants, base)`
        // leaves only what is not there yet. Two attempts before this
        // were wrong, both noticed live:
        //
        //  1. `UNION(base, descendants, ALL)` — the element appeared twice,
        //     because `SELF_AND_BEFORE` brings it along and the base set also
        //     has it (42,034 instead of 42,033 rows).
        //  2. `UNION(EXCEPT(base, descendants, ALL), descendants, ALL)` — on
        //     a base set that already contains the subtree (`.Members`
        //     after a collapse, report from flameY3T1), 120,000
        //     rows were lost: `EXCEPT` with `ALL` clears EVERY occurrence of
        //     the descendants, including those under other parents, and `UNION` brings
        //     only one back.
        //
        // The direction is therefore reversed. Re-measured live (2026-08-30,
        // expandFullyCostProbe.js): base set `.Members`
        // (contains everything) 295,090 rows in 752 ms — i.e. unchanged, as it
        // must be; base set only the element 42,033 in 111 ms. The `ALL` in the
        // outer `UNION` keeps the remaining multiple occurrences: a child
        // under several parents is drawn under each, that is on purpose
        // (23,057 such names in this dimension).
        const mem = member(dim, hier, i.member);
        const base = foreignSet ? withoutDescendants(mdx, mem) : mdx;
        const descendants = `{DESCENDANTS({${mem}}, 99, SELF_AND_BEFORE)}`;
        mdx = i.recursive
          ? `{HIERARCHIZE({UNION(${base}, {EXCEPT(${descendants}, ${base}, ALL)}, ALL)})}`
          : `{DRILLDOWNMEMBER(${base}, ${memberOccurrencesMdx(h, i.member)})}`;
        break;
      }
      case 'filter':
        mdx = layerMdx(i.layer, mdx, h);
        break;
      case 'keep':
        mdx = `{INTERSECT(${mdx}, {${i.names.map((n) => member(dim, hier, n)).join(',')}}, ALL)}`;
        break;
      // `ALL` is NOT optional: without the flag EXCEPT and INTERSECT
      // deduplicate the occurrences, and "remove b" silently takes the second
      // `a` and the second `x` row with it (measured live). No error, no
      // message — just fewer rows than the user wanted.
      case 'sort': {
        // Four forms, measured live on `aa` (2026-08-23):
        //   HIERARCHIZE(set)            tree order, without sorting
        //   ORDER(set, x, ASC|DESC)     sorts AND keeps the tree
        //   ORDER(set, x, BASC|BDESC)   sorts FLAT  (= TM1SORT)
        // `TM1SORT` knows only element names — to order by an alias only
        // `ORDER` over `Properties()` works.
        if (i.mode === 'hierarchy') { mdx = `{HIERARCHIZE(${mdx})}`; break; }
        // `HIERARCHIZE(set, POST)` exists too (children before parents, measured
        // live) — deliberately NOT offered: without indentation and without
        // sorting the result is a flat list in twisted
        // order, and whoever wants to read from the bottom up takes
        // `ORDER(..., DESC)` (decision flameY3T1, 2026-08-23).
        // The index is not a label — an alias is irrelevant here.
        // `TM1SORTBYINDEX` instead of `ORDER(..., Properties("ELEMENT_INDEX"), ...)`:
        // the latter sorts LEXICOGRAPHICALLY (index 10 before index 2) and is correct
        // only up to nine elements; a `* 1`, on the other hand, makes `ORDER` SILENTLY
        // return the input unchanged (measured live 2026-08-23).
        if (i.mode === 'index-asc' || i.mode === 'index-desc') {
          mdx = `{TM1SORTBYINDEX(${mdx}, ${i.mode === 'index-asc' ? 'ASC' : 'DESC'})}`;
          break;
        }
        const sortBy = i.attr
          ? `${h}.CurrentMember.Properties("${escapeMdxString(i.attr)}")`
          : `${h}.CurrentMember.Name`;
        const DIRECTION = {
          'hier-asc': 'ASC', 'hier-desc': 'DESC', asc: 'BASC', desc: 'BDESC',
        } as const;
        // ALWAYS `ORDER`, even flat without an alias, where `TM1SORT(set, ASC)` yields the same
        // order (measured on all 621 rows of a dimension,
        // both directions identical character for character). The reason is the label:
        // the menu names the directions by their MDX names, and an entry
        // `BASC` that writes `TM1SORT` would be a label that does not mean
        // the expression next to it.
        mdx = `{ORDER(${mdx}, ${sortBy}, ${DIRECTION[i.mode]})}`;
        break;
      }
      case 'add':
        // Empty list = no intent; `UNION(x, {}, ALL)` would not be MDX either.
        if (i.names.length) {
          mdx = `{UNION(${mdx}, {${i.names.map((n) => member(dim, hier, n)).join(',')}}, ALL)}`;
        }
        break;
      case 'rollup':
        mdx = rollupMdx(mdx, i.member, i.ancestors, dim, hier);
        break;
      case 'pick-parent':
        mdx = pickParentMdx(mdx, i.parent, i.at, dim, hier);
        break;
      case 'remove':
        mdx = `{EXCEPT(${mdx}, {${i.names.map((n) => member(dim, hier, n)).join(',')}}, ALL)}`;
        break;
      default: {
        const unreachable: never = i;
        throw new Error(`unbekannte Absicht: ${JSON.stringify(unreachable)}`);
      }
    }
  }
  return mdx;
}

/**
 * The expression used to FETCH: the stored form plus window.
 *
 * The window belongs only here, never in the stored form — otherwise a
 * saved subset would carry the scroll position.
 *
 * `top + 1`, because at the lower window edge it would otherwise be undecidable whether the
 * last node is expanded: its children would lie outside.
 */
export function fetchMdx(
  v: ViewState, dim: string, hier: string, skip: number, top: number,
): string {
  return `{SUBSET(${storedMdx(v, dim, hier)}, ${skip}, ${top + 1})}`;
}

/**
 * The expressions of the PAfE drill actions. Measured live on `aa`
 * (2026-08-23), tree `sum->a | d->c,a,x,b | xxx->x,xx`:
 *
 *   leaves            DESCENDANTS({d}, 99, LEAVES)              c a x b
 *   elem-plus-leaves  UNION({d}, DESCENDANTS(...), ALL)         d c a x b
 *   show-parents      FILTER(SUBSETALL, CHILDREN ∩ {d})         all direct parents
 *
 * "Expand fully" is NO LONGER here: it is a fold layer
 * (`Intent.expand` with `recursive`), not a base — see `expandFully` in
 * `intents.ts`.
 *
 * Pitfalls, both silent: the empty argument form `DESCENDANTS({d}, , LEAVES)` is
 * a syntax error, and `{d}.Parent` returns only the FIRST parent (1 ms)
 * instead of all (3318 ms on 1.63 million) — an element can hang
 * under several, and "show parents" means them.
 */
export function drillMdx(
  action: 'leaves' | 'elem-plus-leaves',
  member: string, dim: string, hier: string,
): string {
  const m = `{${member2(dim, hier, member)}}`;
  const leaves = `{DESCENDANTS(${m}, 99, LEAVES)}`;
  switch (action) {
    case 'leaves': return leaves;
    case 'elem-plus-leaves': return `{UNION(${m}, ${leaves}, ALL)}`;
    default: {
      const unreachable: never = action;
      throw new Error(`unbekannte Drillaktion: ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Like `member`, but exportable for `drillMdx`. */
function member2(dim: string, hier: string, name: string): string {
  return member(dim, hier, name);
}

/**
 * "Show all parents" — `TM1ROLLUP(<set>, <hit>)`.
 *
 * TM1 puts in front of EVERY occurrence from the set that is named in the hit ALL
 * its parents in index order; the element STAYS and the rest remains
 * untouched (decision flameY3T1, 2026-08-23: "the variant that leaves the element
 * in place and shows all the others above it").
 *
 * Measured live on `aa`: `TM1ROLLUP({M}, {[a]})` returns
 * `sum sum d a d c a x b xxx x xx` in 1 ms. The form built here earlier,
 * `FILTER(SUBSETALL, CHILDREN ∩ {a})`, returns the same parent set, but on
 * 1.63 million costs 3.3 s — and left the element out.
 *
 * THE PITFALL: the hit goes by the OCCURRENCE, not by the name. An
 * element under a parent is called `[dim].[hier].[parent^element]`
 * (deeper: `A^B^C^leaf`). A name that does not hit makes the expression
 * do nothing SILENTLY — no error, no row. That is why the
 * occurrence path of the clicked row travels along.
 */
export function rollupMdx(
  inner: string, member: string, ancestors: readonly string[], dim: string, hier: string,
): string {
  const path = ancestors.concat([member]).map((n) => escapeMdx(n)).join('^');
  return `{TM1ROLLUP(${inner}, {[${escapeMdx(dim)}].[${escapeMdx(hier)}].[${path}]})}`;
}

/**
 * "Show parents" — the ONE chosen parent, above its
 * occurrence.
 *
 * `TM1ROLLUP` cannot do that: it ALWAYS puts ALL parents of the hit. Measured live on
 * `aa` (2026-08-25), M = `sum a d c a x b xxx x xx`:
 *
 *   TM1ROLLUP(M, {d^a})             -> sum a d c [sum d] a x b xxx x xx
 *   TM1ROLLUP(M, {sum^a})           -> sum [sum d] a d c a x b xxx x xx
 *   TM1ROLLUP({sum^a}, {sum^a})     -> sum d a          (both single-element too)
 *   TM1ROLLUP(M, {d^a}, {sum})      -> HTTP 400/501     (no third argument)
 *   GENERATE(M, IIF(...), ALL)      -> HTTP 400/501
 *   RANK(d^a, M) as position        -> SILENTLY empty, no error
 *   EXCEPT(ROLLUP(M,{d^a}), {sum})  -> also tears out the real root `sum`
 *
 * The last point is no coincidence: the parents inserted by `TM1ROLLUP`
 * come back as BARE `[sum]`/`[d]` (UniqueNames measured), not as
 * occurrences — they cannot be told apart from a real root.
 *
 * What holds up is the CUT: `HEAD` up to the position, parent, `SUBSET` from
 * the position on. 6/6 edge cases green live — first row, last row, second
 * occurrence of the same name, count check 10 in / 11 out.
 *
 * `at === 0` gets the short form: `HEAD(M, 0)` is the EMPTY set (measured
 * live), and `UNION` with it would be a detour around nothing.
 */
export function pickParentMdx(
  inner: string, parent: string, at: number, dim: string, hier: string,
): string {
  const p = `{${member2(dim, hier, parent)}}`;
  if (at <= 0) { return `{UNION(${p}, ${inner}, ALL)}`; }
  // `1000000` means "from k to the end" for `SUBSET` (spec block A).
  return `{UNION({UNION({HEAD(${inner}, ${at})}, ${p}, ALL)}, {SUBSET(${inner}, ${at}, 1000000)}, ALL)}`;
}

/**
 * "Expand to level" — the clicked element AND everything below it up to the
 * chosen level. The intermediate steps stay in place (flameY3T1, 2026-08-31);
 * before, only the target level was left over, and the tree tore open in between.
 *
 * `depth` is the distance downward, not the target level: the caller
 * computes it from the level of the clicked row (`setToLevelBase`).
 *
 * `SELF_AND_BEFORE` takes the element and EVERY step up to the distance with it —
 * a set, not a filter, and in hierarchy order. The route via
 * `TM1FILTERBYLEVEL` per level would work too, but would line the answer up by LEVEL
 * (`UNION` appends): first all leaves, then the level above.
 *
 * Edge case, deliberate: in a RAGGED hierarchy the distance is not
 * the level difference. A branch that ends earlier comes along completely; a
 * deeper-hanging branch is cut off at the distance, even if its
 * elements have not yet reached the target level.
 */
export function toLevelMdx(member: string, depth: number, dim: string, hier: string): string {
  const n = Math.max(0, Math.floor(depth));
  return `{DESCENDANTS(${member2(dim, hier, member)}, ${n}, SELF_AND_BEFORE)}`;
}

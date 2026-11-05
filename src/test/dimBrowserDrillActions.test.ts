import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
    vwBaseMdx: 'MDX', vwBaseMembers: 'Tree',
  };
});
vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import { planCtxAction } from '../webviewClient/dimensionBrowser/ctxIntents';
import type { CtxAction } from '../webviewClient/dimensionBrowser/ctxIntents';
import { trailHtml } from '../webviewClient/dimensionBrowser/viewTrail';
import { mdxBase, initialView, expandFully, toggleDrill } from '../webviewClient/dimensionBrowser/intents';
import {
  startView, applyCtxAction, onViewRows, currentMdx, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { toggleAt } from '../webviewClient/dimensionBrowser/viewActions';

/** Feed rows in so that `TM1ROLLUP` finds the occurrence path. */
function antworteMit(namen: string[], vorfahren: string[] = []): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa', ok: true,
    rows: namen.map((n) => ({
      name: n, caption: n, type: 'N', level: 0, parent: null,
      ancestors: vorfahren.map((v) => ({ name: v, type: 'N', level: 0 })), drilled: false,
    })),
    cardinality: namen.length, hasMore: false,
  } as never);
}

const ctx = (marked: string[] = []) => ({ member: 'd', marked });
let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };

const H = '[aa].[aa]';

/**
 * The PAfE drill actions of the context menu. All forms measured live on `aa`
 * (2026-08-23), tree `sum->a | d->c,a,x,b | xxx->x,xx`:
 *
 *   DESCENDANTS({d}, 99, LEAVES)              c a x b
 *   UNION({d}, DESCENDANTS(...), ALL)         d c a x b
 *   HIERARCHIZE(UNION(basis, EXCEPT(DESCENDANTS(d), basis)))  adds what is missing
 *
 * Until 2026-08-30 this read `DRILLDOWNMEMBER(basis, DESCENDANTS(d), RECURSIVE)`.
 * The form is logically correct and fast on small trees (5 ms), but it makes TM1
 * drill recursively over a set that already contains the result. On
 * `stations_all`/`CC2026_SuBST_C` (42,033 descendants) it ran into the abort:
 * 18.9 s without a reply, while the descendant set itself comes back in 88 ms
 * (expandFullyCostProbe.js).
 *   FILTER(SUBSETALL, COUNT(INTERSECT(CHILDREN,{x}))>0)   ALL direct parents
 *
 * The empty-argument form `DESCENDANTS({d}, , LEAVES)` is a syntax error,
 * and `DESCENDANTS` INSIDE a `FILTER` silently returns 0 — that is why
 * "all parents" (ancestors) stays out for now.
 */
// At file level, not in the first `describe`: the later blocks call
// `applyCtxAction` on the same module state and were otherwise only green
// as long as this block ran before them.
beforeEach(() => {
  posted = [];
  _resetViewPathForTest();
  (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
  startView('aa', 'aa', post);
});

describe('drill actions as base', () => {

  it('leaves', () => {
    expect(applyCtxAction('leaves', 'd')).toBe(true);
    expect(currentMdx()).toBe(`{DESCENDANTS({${H}.[d]}, 99, LEAVES)}`);
  });

  it('element and leaves', () => {
    applyCtxAction('elem-plus-leaves', 'd');
    expect(currentMdx()).toBe(`{UNION({${H}.[d]}, {DESCENDANTS({${H}.[d]}, 99, LEAVES)}, ALL)}`);
  });

  it('"expand fully" is a LAYER and leaves the view in place', () => {
    // Change by flameY3T1, 2026-08-26: "if others are still standing next to it,
    // they should stay there." So NOT `{[d]}` as the new base (then only the
    // subtree would remain) and also not the drill built earlier over
    // `{H}.Members` (it changed nothing at all, because `Members` shows everything
    // anyway). The base stays in place underneath the layer; measured live in
    // dimExpandFullyLayerProbe.js.
    applyCtxAction('expand-all', 'd');
    expect(currentMdx()).toBe(`{HIERARCHIZE({UNION({${H}.Members}, {EXCEPT({DESCENDANTS({${H}.[d]}, 99, SELF_AND_BEFORE)}, {${H}.Members}, ALL)}, ALL)})}`);
  });

  it('… and names the DESCENDANTS as targets, not just the element', () => {
    // The bug this form avoids: `DRILLDOWNMEMBER(basis, {d},
    // RECURSIVE)` expands only ONE level despite the flag. `RECURSIVE`
    // repeats the drill only for elements that are in the second
    // argument — if that holds just `{d}`, it stops after its children.
    // Live on a test dimension (subtree 6 levels, 53 leaves):
    // identical 18 rows with and without the flag.
    applyCtxAction('expand-all', 'd');
    expect(currentMdx()).toContain('DESCENDANTS(');
    expect(currentMdx()).toContain('SELF_AND_BEFORE');
    // Specifically SELF_AND_BEFORE: in TM1 level 0 is the leaf, so the descendants
    // lie "before" it. `SELF_AND_AFTER` silently returns 0 live — the form
    // would have no effect without an error showing up anywhere.
    expect(currentMdx()).not.toContain('SELF_AND_AFTER');
  });

  it('… and can be COLLAPSED again afterwards', () => {
    // Click test by flameY3T1, 2026-08-26: "then the tree is frozen". The cause was
    // the shortcut in `toggleDrill`: it removed the `expand` layer instead
    // of collapsing. Over `.Members` the subtree is there anyway, though
    // — the removal changed NOTHING, the triangle seemed dead.
    applyCtxAction('expand-all', 'd');
    toggleAt('d', true);
    expect(currentMdx()).toBe(`{DRILLUPMEMBER({${H}.Members}, {FILTER({TM1FILTERBYPATTERN({${H}.Members}, "d")}, ${H}.CurrentMember.Name = "d")})}`);
  });

  it('… and open again afterwards without the stack growing', () => {
    applyCtxAction('expand-all', 'd');
    toggleAt('d', true);
    toggleAt('d', false);
    // No `DRILLUPMEMBER(DRILLDOWNMEMBER(…))` tower: the collapse consumed the
    // recursive layer, the expand removes its own one again.
    // What remains is the bare base.
    expect(currentMdx()).toBe(`{${H}.Members}`);
  });

  it('… and stacks on top of what is already there', () => {
    // Another element's collapse intent stays in place — that is the difference to
    // a base, which would clear the stack.
    toggleAt('sum', true);
    const vorher = currentMdx();
    applyCtxAction('expand-all', 'd');
    expect(vorher).toBe(`{DRILLUPMEMBER({${H}.Members}, {FILTER({TM1FILTERBYPATTERN({${H}.Members}, "sum")}, ${H}.CurrentMember.Name = "sum")})}`);
    expect(currentMdx()).toBe(`{HIERARCHIZE({UNION(${vorher}, {EXCEPT({DESCENDANTS({${H}.[d]}, 99, SELF_AND_BEFORE)}, ${vorher}, ALL)}, ALL)})}`);
  });

  it('… and undoes a collapse of the SAME element', () => {
    // The actual use case: fully opening up a collapsed row.
    // If the `DRILLUPMEMBER` stayed in place, it would collapse again at once — measured
    // live: the drill on top of the `DRILLUPMEMBER` does return all 10 rows,
    // but only because the two layers cancel each other out;
    // as a trail it is unreadable.
    toggleAt('d', true);
    expect(currentMdx()).toBe(`{DRILLUPMEMBER({${H}.Members}, {FILTER({TM1FILTERBYPATTERN({${H}.Members}, "d")}, ${H}.CurrentMember.Name = "d")})}`);
    applyCtxAction('expand-all', 'd');
    expect(currentMdx()).toBe(`{HIERARCHIZE({UNION({${H}.Members}, {EXCEPT({DESCENDANTS({${H}.[d]}, 99, SELF_AND_BEFORE)}, {${H}.Members}, ALL)}, ALL)})}`);
  });

  it('… and replaces an existing collapse/expand intent for the same element', () => {
    // Otherwise `DRILLUPMEMBER` would sit underneath the `DRILLDOWNMEMBER` and the trail
    // would read as "collapsed, then expanded".
    applyCtxAction('expand-all', 'd');
    applyCtxAction('expand-all', 'd');
    expect(currentMdx()).toBe(`{HIERARCHIZE({UNION({${H}.Members}, {EXCEPT({DESCENDANTS({${H}.[d]}, 99, SELF_AND_BEFORE)}, {${H}.Members}, ALL)}, ALL)})}`);
  });

  it('"all parents" KEEPS the element and puts them above it', () => {
    // `TM1ROLLUP(<set>, <hits>)`: TM1 puts all of its parents in front of EVERY
    // matched occurrence, the element stays, the rest stays untouched. Live
    // on `aa`: `TM1ROLLUP({M}, {[a]})` -> `sum sum d a d c a x b xxx x xx`, 1 ms.
    //
    // The form built here earlier, `FILTER(SUBSETALL, CHILDREN ∩ {a})`, returns
    // the same parent set, but costs 3.3 s on 1.63 million — and it DROPPED the
    // element (click test by flameY3T1, 2026-08-23).
    antworteMit(['sum', 'a', 'd']);
    applyCtxAction('show-all-parents', 'a');
    expect(currentMdx()).toBe(`{TM1ROLLUP({${H}.Members}, {${H}.[a]})}`);
  });

  it('the hit goes through the OCCURRENCE — otherwise the expression silently does nothing', () => {
    // An element under a parent is called `[dim].[hier].[Parent^Element]`.
    // A bare name that does not match leaves `TM1ROLLUP` silently unchanged.
    antworteMit(['a'], ['d']);
    applyCtxAction('show-all-parents', 'a');
    expect(currentMdx()).toBe(`{TM1ROLLUP({${H}.Members}, {${H}.[d^a]})}`);
  });

  it('doubles `]` in the element name', () => {
    applyCtxAction('leaves', 'a]b');
    expect(currentMdx()).toContain('[a]]b]');
  });

  it('the trail names the action, not just "MDX"', () => {
    applyCtxAction('leaves', 'd');
    expect(trailHtml(mdxBase('{x}', 'Blaetter von d'))).toContain('Blaetter von d');
  });
});

describe('every menu entry actually does something', () => {
  /**
   * "Alias" was the last action that could not be expressed — dropped on 2026-08-25.
   *
   * It was guarded twice: `viewControls.ts#ALTE` hid the entry
   * (`display: none`), and `planCtxAction` returned `unsupported`. So the
   * user never saw it; what remained was hidden markup, two
   * CSS rules and an action without effect. The alias is chosen in the select
   * box of the header bar (decision by flameY3T1, 2026-08-23).
   *
   * With it, `kind: 'unsupported'` lost its only producer and was dropped as
   * well, along with the banner branch and the greying out. If an inexpressible
   * action were added, both belong back — until then it would be code that nothing
   * reaches.
   */
  it('no drill action falls into a non-plan', () => {
    for (const a of ['leaves', 'elem-plus-leaves', 'expand-all', 'show-all-parents',
      'expand-to-level'] as CtxAction[]) {
      expect(planCtxAction(a, ctx()).kind, a).not.toBe('unsupported');
    }
  });
});

/**
 * Regression guard for the finding of 2026-08-30.
 *
 * `DRILLDOWNMEMBER(basis, {DESCENDANTS(…)}, RECURSIVE)` looks harmless and is
 * even fast on small trees — that is exactly why the form originally got
 * in and stayed for a quarter of a year. The price only shows on
 * a real dimension: 42,033 descendants, 18.9 s without a reply, while
 * the same set can be had in 88 ms.
 *
 * That is why the test checks not only the result but the ABSENCE of the
 * expensive part: `RECURSIVE` must no longer appear in the generated
 * expression.
 */
describe('expand fully — cost shape', () => {
  it('no longer generates RECURSIVE', () => {
    applyCtxAction('expand-all', 'd');
    expect(currentMdx()).not.toContain('RECURSIVE');
  });

  it('takes the descendant set itself as the result', () => {
    applyCtxAction('expand-all', 'd');
    expect(currentMdx()).toContain('DESCENDANTS');
    expect(currentMdx()).toContain('UNION');
    // The EXCEPT wraps the DESCENDANTS, not the base set: only what is missing
    // gets added. The other way round, on a base set that already contains the
    // subtree, 120,000 rows were dropped (live, 2026-08-30).
    expect(currentMdx()).toContain('EXCEPT');
    expect(currentMdx()).toContain('{EXCEPT({DESCENDANTS(');
  });

  // The SINGLE-LEVEL expand runs through the arrow in the row, not through the
  // context menu ('expand' is not a context action) — it stays unchanged at
  // `DRILLDOWNMEMBER` without `RECURSIVE` and so keeps inserting in place.
});

/**
 * The sequence from flameY3T1's report of 2026-08-30, step by step:
 * base `TM1SUBSETALL`, expand one element fully, then collapse it.
 *
 * Before, this took TWO clicks: the first one merely removed the `expand` layer
 * without setting a `collapse` — because `baseShowsDescendants` considered the base
 * `set` flat. On a flat dimension that is true; on one
 * with consolidations, `DRILLUPMEMBER(TM1SUBSETALL, {d})` does remove
 * 42,856 of 171,322 rows (subsetAllCollapseProbe.js).
 */
describe('TM1SUBSETALL — expand and collapse again', () => {
  it('one click is enough to collapse again after expanding fully', () => {
    const basis = initialView('set');
    const offen = expandFully(basis, 'd');
    expect(offen.intents).toEqual([{ kind: 'expand', member: 'd', recursive: true }]);

    // The triangle reports "open" — the click must restore the starting state.
    const zu = toggleDrill(offen, 'd', true);
    expect(zu.intents.some((i) => i.kind === 'expand' && i.member === 'd')).toBe(false);
    expect(zu.intents).toContainEqual({ kind: 'collapse', member: 'd' });
  });

  it('on a base that does NOT show the descendants, it stays a removal', () => {
    const offen = expandFully(initialView('roots'), 'd');
    const zu = toggleDrill(offen, 'd', true);
    expect(zu.intents).toEqual([]);
  });
});

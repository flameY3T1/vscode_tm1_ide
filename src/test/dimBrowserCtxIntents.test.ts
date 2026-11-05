import { describe, it, expect } from 'vitest';
import { planCtxAction, type CtxAction } from '../webviewClient/dimensionBrowser/ctxIntents';

/**
 * The ONE place that turns a menu entry into an intent.
 *
 * Why it exists (decision flameY3T1, 2026-08-22): the old
 * menu handlers write state — delete list, drill token, `compose.expanded` —,
 * and the new load path reads none of it. A merely "connected" handler
 * would write into a state that nobody displays.
 */
describe('planCtxAction', () => {
  const ctx = (marked: string[] = []) => ({ member: 'd', marked });

  it('"only this element" becomes the new BASE, not a layer on top of it', () => {
    // Measured live (`dimOnlyThisFormProbe.js`): an INTERSECT layer returns
    // every OCCURRENCE (`a | a`), the set literal returns every ELEMENT once.
    // Decision flameY3T1: set literal, because it is shorter and more intuitive.
    expect(planCtxAction('only-this', ctx())).toEqual({ kind: 'freeze', names: ['d'] });
  });

  it('with marks it means the MARKS, not the clicked row', () => {
    // The same rule as in the old path (`ctxActions.ts#onlyThisCount`): whoever
    // marks six rows and then chooses "only these" means the six.
    expect(planCtxAction('only-this', ctx(['a', 'b'])))
      .toEqual({ kind: 'freeze', names: ['a', 'b'] });
  });

  it('copies the names instead of keeping the marks in the plan', () => {
    // Otherwise the intent would carry a LIVE list: a later `clearMarks`
    // would empty the layer retroactively.
    const marks = ['a'];
    const plan = planCtxAction('only-this', ctx(marks)) as { names: string[] };
    marks.length = 0;
    expect(plan.names).toEqual(['a']);
  });

  it('"Clear filter/selection" empties the stack without switching the base', () => {
    expect(planCtxAction('clear-all', ctx())).toEqual({ kind: 'reset' });
  });

  it('"collapse all" IS the root base, not a stack of collapses', () => {
    expect(planCtxAction('collapse-all', ctx())).toEqual({ kind: 'base', base: 'roots' });
  });

  it('"Copy names" is not a set operation and stays direct', () => {
    expect(planCtxAction('copy-name', ctx())).toEqual({ kind: 'direct', action: 'copy-name' });
  });

  /**
   * There is no inexpressible action anymore.
   *
   * "Alias" was the last one — it was dropped from the menu on 2026-08-25 because
   * the entry in truth never even reached the banner: `ENTRIES` in
   * `viewCtx.ts` never bound it, the submenu still opened via CSS and
   * stayed empty. The alias is chosen in the selection field of the header bar
   * (decision flameY3T1, 2026-08-23), and a second way there would be a
   * second state.
   *
   * With that, `kind: 'unsupported'` has no producer anymore either and has been
   * dropped — together with the banner branch and the greying out. If an inexpressible
   * action were added, both belong back; until then it would be unreachable
   * code.
   */
  it('every menu action has a plan — none is mere decoration', () => {
    for (const a of ['only-this', 'clear-all', 'collapse-all', 'copy-name',
      'insert-above', 'insert-below',
      'leaves', 'elem-plus-leaves', 'expand-all', 'show-all-parents',
      'show-parents', 'expand-to-level'] as CtxAction[]) {
      expect(planCtxAction(a, ctx()).kind, a).not.toBe('unsupported');
    }
  });

  it('insert says WHERE — the caller fetches the clipboard itself', () => {
    // No plan with names in it: reading the clipboard is asynchronous,
    // and `planCtxAction` decides synchronously.
    expect(planCtxAction('insert-above', ctx())).toEqual({ kind: 'insert', below: false });
    expect(planCtxAction('insert-below', ctx())).toEqual({ kind: 'insert', below: true });
  });

  it('throws on an unknown action instead of silently swallowing it', () => {
    expect(() => planCtxAction('gibt-es-nicht' as CtxAction, ctx())).toThrow(/unbekannte Kontextaktion/);
  });
});

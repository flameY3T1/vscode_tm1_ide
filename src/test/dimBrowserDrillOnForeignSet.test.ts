import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {};
});
vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import { initialView, mdxBase, freezeOrder, pushIntent } from '../webviewClient/dimensionBrowser/intents';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';

/**
 * Expanding and collapsing over a FOREIGN set.
 *
 * `DRILL*MEMBER` presupposes a tree walk. Over the list of a
 * saved MDX view it is no good — measured live (11.8,
 * `Reporting/Default`, row axis = `EXCEPT` list with 14 rows,
 * 2026-08-23):
 *
 *   DRILLDOWNMEMBER(Liste, {P Ergebnis})   14 → 24, the 10 children DUPLICATED
 *   DRILLUPMEMBER(Liste, {P Ergebnis})     14 → 14, a silent no-op
 *
 * Both for the same reason: the children already stand in the list, just not
 * behind their parent, and `DRILL*MEMBER` sees no block there.
 *
 * Over a tree walk, on the other hand, it is correct and round-trippable (measured on
 * the `roots` base: 42 → 52 → 42) — there it stays, along with its
 * per-occurrence precision.
 *
 * The replacement form says the same thing with set algebra:
 *   collapse  EXCEPT(set, EXCEPT(DESCENDANTS(m), {m}, ALL), ALL)
 *   expand    DRILLDOWNMEMBER(<collapsed>, {m})
 * First all existing descendants go away, then the children go behind the parent
 * — measured 14 → 14, every child exactly once.
 */
describe('Collapsing over a foreign set', () => {
  const LISTE = '{EXCEPT({[K].[K].[Erg],[K].[K].[a]}, {[K].[K].[x]}, ALL)}';
  const OHNE_NACHFAHREN = '{EXCEPT(' + LISTE
    + ', EXCEPT(DESCENDANTS([K].[K].[Erg]), {[K].[K].[Erg]}, ALL), ALL)}';

  it('collapsing removes the descendants via set algebra', () => {
    const v = pushIntent(mdxBase(LISTE), { kind: 'collapse', member: 'Erg' });
    expect(storedMdx(v, 'K', 'K')).toBe(OHNE_NACHFAHREN);
  });

  it('expanding first clears away, then drills — otherwise the children stand twice', () => {
    const v = pushIntent(mdxBase(LISTE), { kind: 'expand', member: 'Erg' });
    expect(storedMdx(v, 'K', 'K')).toBe(`{DRILLDOWNMEMBER(${OHNE_NACHFAHREN}, {FILTER({TM1FILTERBYPATTERN({[K].[K].Members}, "Erg")}, [K].[K].CurrentMember.Name = "Erg")})}`);
  });

  it('also applies to a frozen manual list', () => {
    const v = pushIntent(freezeOrder(initialView('tree'), ['Erg', 'a']), { kind: 'collapse', member: 'Erg' });
    expect(storedMdx(v, 'K', 'K')).toContain('DESCENDANTS([K].[K].[Erg])');
    expect(storedMdx(v, 'K', 'K')).not.toContain('DRILLUPMEMBER');
  });

  it('over a tree walk it stays with DRILL*MEMBER — there it hits EVERY occurrence', () => {
    const zu = pushIntent(initialView('tree'), { kind: 'collapse', member: 'Erg' });
    expect(storedMdx(zu, 'K', 'K')).toBe('{DRILLUPMEMBER({[K].[K].Members}, {FILTER({TM1FILTERBYPATTERN({[K].[K].Members}, "Erg")}, [K].[K].CurrentMember.Name = "Erg")})}');
    const auf = pushIntent(initialView('set'), { kind: 'expand', member: 'Erg' });
    expect(storedMdx(auf, 'K', 'K')).toBe('{DRILLDOWNMEMBER({TM1SUBSETALL([K].[K])}, {FILTER({TM1FILTERBYPATTERN({[K].[K].Members}, "Erg")}, [K].[K].CurrentMember.Name = "Erg")})}');
  });

  it('the roots base also stays with drilling — live 42 → 52 → 42', () => {

    const v = pushIntent(initialView('roots'), { kind: 'expand', member: 'Erg' });
    expect(storedMdx(v, 'K', 'K')).toContain('DRILLDOWNMEMBER');
    expect(storedMdx(v, 'K', 'K')).not.toContain('DESCENDANTS');
  });
});

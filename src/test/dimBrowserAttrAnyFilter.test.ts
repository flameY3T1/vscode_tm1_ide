import { describe, it, expect } from 'vitest';
import { matchesLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import type { FilterLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { chainFor } from '../webviewClient/dimensionBrowser/viewTrail';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';

const mit = (layer: FilterLayer) => pushIntent(initialView('tree'), { kind: 'filter', layer });

/**
 * If the attribute selection stands on "none", the value should still filter —
 * then simply over ALL attributes and the name (decision flameY3T1,
 * 2026-08-23; the old path, `composeMdx.ts`, handled it that way too).
 *
 * Measured live (2026-08-23): on `Stations` (621) the disjunction costs
 * 3 ms, on `AllocStations` (1.63 million) 2283–2406 ms against 890 ms
 * for a single attribute. Expensive, but it stands behind "Apply".
 */
describe('filtering without a chosen attribute', () => {
  const alle: FilterLayer = {
    kind: 'attr', attrs: ['SITENAME', 'SITE+Name'], value: 'north', withName: true,
  };
  const eins: FilterLayer = { kind: 'attr', attrs: ['SITENAME'], value: 'north' };

  it('searches in EVERY attribute and in the name — a disjunction, not a UNION', () => {
    // A `FILTER` stays a predicate; a `UNION` would produce duplicates.
    const mdx = storedMdx(mit(alle), 'aa', 'aa');
    expect(mdx.match(/FILTER\(/g)).toHaveLength(1);
    expect(mdx).toContain('INSTR(UCASE([aa].[aa].CurrentMember.Name), UCASE("north")) > 0');
    expect(mdx).toContain('Properties("SITENAME")');
    expect(mdx).toContain('Properties("SITE]]Name")'.replace(']]', '+'));
    expect(mdx.match(/ OR /g)).toHaveLength(2);
  });

  it('a single attribute does NOT search in the name too', () => {
    // Whoever chooses an attribute means that one — name hits would be an
    // extra they did not order.
    const mdx = storedMdx(mit(eins), 'aa', 'aa');
    expect(mdx).not.toContain('CurrentMember.Name');
    expect(mdx.match(/ OR /g)).toBeNull();
  });

  it('the predicate makes the same decision as the expression', () => {
    const treffer = { name: 'x', type: 'N' as const, level: 0, attrs: { SITENAME: 'North Depot' } };
    const ueberNamen = { name: 'Northport', type: 'N' as const, level: 0, attrs: { SITENAME: 'nix' } };
    const daneben = { name: 'x', type: 'N' as const, level: 0, attrs: { SITENAME: 'nix' } };
    expect(matchesLayer(treffer, alle)).toBe(true);
    expect(matchesLayer(ueberNamen, alle)).toBe(true);
    expect(matchesLayer(daneben, alle)).toBe(false);
    // Without `withName` the name does not count.
    expect(matchesLayer(ueberNamen, { ...eins, attrs: ['SITENAME'] })).toBe(false);
  });

  it('orders ALL named attributes in the chain projection', () => {
    expect(chainFor(mit(alle))).toEqual({ kind: 'name', attrs: ['SITENAME', 'SITE+Name'] });
  });

  it('an empty attribute list without a name search hits nothing', () => {
    // Otherwise it would be a filter without a question — and `FILTER(set, )` no MDX.
    const leer: FilterLayer = { kind: 'attr', attrs: [], value: 'north' };
    expect(matchesLayer({ name: 'north', type: 'N', level: 0, attrs: {} }, leer)).toBe(false);
    expect(storedMdx(mit(leer), 'aa', 'aa')).toBe('{[aa].[aa].Members}');
  });
});

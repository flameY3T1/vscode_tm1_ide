import { describe, it, expect, vi } from 'vitest';

// `viewTrail` reads `window.__l10n` at module start (`const L = getL10n()`),
// hence BEFORE the imports — `vi.hoisted` runs before them. Without the map
// `fmt` would only return the key and the test would check nothing.
vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
    vwTrailPattern: 'Name {0}', vwTrailPatternAttr: '{0} {1}',
  };
});
import { matchesLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { chainFor } from '../webviewClient/dimensionBrowser/viewTrail';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';
import { buildSetExprQuery } from '../tm1Rest/dimensionSetQueryPure';

import type { FilterLayer } from '../webviewClient/dimensionBrowser/filterPredicate';

const filt = (layer: FilterLayer) =>
  pushIntent(initialView('tree'), { kind: 'filter', layer });

/**
 * Decision flameY3T1, 2026-08-23: "the search should search on the alias that
 * is switched on as display" — so the search hits what is VISIBLE.
 *
 * Measured live (dimAliasPatternProbe.js, 11.8, `Stations`):
 * `TM1FILTERBYPATTERN` takes a THIRD argument, the attribute name, and then searches
 * ONLY there. The counter-check that decides it: `"*_C"` hits 272 names,
 * but 5 aliases — 267 elements drop out with the three-argument form.
 * So one call, instead of the `INSTR` disjunction of the old path (1.4 s).
 */
describe('the search follows the display alias', () => {
  it('writes the attribute name as the third argument', () => {
    const v = filt({ kind: 'pattern', pattern: 'north*', attr: 'SITENAME' });
    expect(storedMdx(v, 'aa', 'aa'))
      .toBe('{TM1FILTERBYPATTERN({[aa].[aa].Members}, "north*", "SITENAME")}');
  });

  it('without an alias the two-argument form stays', () => {
    const v = filt({ kind: 'pattern', pattern: 'north*' });
    expect(storedMdx(v, 'aa', 'aa'))
      .toBe('{TM1FILTERBYPATTERN({[aa].[aa].Members}, "north*")}');
  });

  it('escapes the attribute name as a string literal (" doubled, ] kept)', () => {
    const v = filt({ kind: 'pattern', pattern: 'x', attr: 'a]b"c' });
    expect(storedMdx(v, 'aa', 'aa')).toContain('"a]b""c"');
  });

  it('checks the same value in the client as the server — the ALIAS, not the name', () => {
    // Otherwise the indentation compares something different from the row selection.
    const l = { kind: 'pattern' as const, pattern: '*north*', attr: 'SITENAME' };
    expect(matchesLayer({ name: 'SITE2021_100001_C', type: 'N', level: 0,
      attrs: { SITENAME: 'Site 2021 North Depot' } }, l)).toBe(true);
    // The NAME does not hit along — that is the measured difference (272 vs 5).
    expect(matchesLayer({ name: 'Northport_C', type: 'N', level: 0,
      attrs: { SITENAME: 'Ohne Treffer' } }, l)).toBe(false);
  });

  it('an ancestor without the alias value falls through', () => {
    const l = { kind: 'pattern' as const, pattern: '*north*', attr: 'SITENAME' };
    expect(matchesLayer({ name: 'Northport', type: 'N', level: 0 }, l)).toBe(false);
    expect(matchesLayer({ name: 'Northport', type: 'N', level: 0, attrs: {} }, l)).toBe(false);
  });

  it('orders the alias in the chain projection', () => {
    const v = filt({ kind: 'pattern', pattern: 'x', attr: 'SITENAME' });
    expect(chainFor(v)).toEqual({ kind: 'name', attrs: ['SITENAME'] });
  });

  it('two different attributes in the stack are both ordered', () => {
    let v = filt({ kind: 'pattern', pattern: 'x', attr: 'SITENAME' });
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'attr', attrs: ['5-Stellig'], value: 'q' } });
    expect(chainFor(v)).toEqual({ kind: 'name', attrs: ['SITENAME', '5-Stellig'] });
  });

  it('the same attribute twice is ordered once', () => {
    let v = filt({ kind: 'pattern', pattern: 'x', attr: 'SITENAME' });
    v = pushIntent(v, { kind: 'filter', layer: { kind: 'attr', attrs: ['SITENAME'], value: 'q' } });
    expect(chainFor(v)).toEqual({ kind: 'name', attrs: ['SITENAME'] });
  });

  it('more than one attribute goes to the whole collection — the path form can only take one', () => {
    const q = buildSetExprQuery({ kind: 'name', attrs: ['SITENAME', '5-Stellig'] });
    // The parent expansion falls back to the full collection: Attributes without a path
    expect(q).toContain('$expand=Parent($select=Name,Attributes;');
    // The row selection is independent and still needs Caption
    expect(q).toContain('DisplayInfo,Attributes/Caption;');
  });

  it('exactly one simple identifier keeps the slim path form', () => {
    expect(buildSetExprQuery({ kind: 'name', attrs: ['SITENAME'] }))
      .toContain('$select=Name,Attributes/SITENAME;');
  });
});

// ---------------------------------------------------------------------------

import { layerLabel } from '../webviewClient/dimensionBrowser/viewTrail';

describe('the trail says WHAT was searched in', () => {
  it('names the alias when one was involved', () => {
    // Two searches with the same pattern but a different alias deliver
    // different rows (measured: 272 against 5). They must not look the same
    // in the trail.
    const mit = layerLabel({ kind: 'pattern', pattern: '*_C', attr: 'SITENAME' });
    const ohne = layerLabel({ kind: 'pattern', pattern: '*_C' });
    expect(mit).toContain('SITENAME');
    expect(mit).toContain('*_C');
    expect(mit).not.toBe(ohne);
  });
});

import { describe, it, expect } from 'vitest';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

/**
 * Regression guard for the arities of the `ElementAttr*` family.
 *
 * Trigger (feedback from the team, 2026-08-12): the signature data listed
 * `ElementAttrS(DimensionName, ElementName, AttributeName)` — the hierarchy slot
 * was missing. That is not "one optional parameter too few" but the
 * description of a form that does not exist: on TM1 11.8 the three-argument
 * call aborts with "Unerwartete Klammer" (unexpected bracket). The three-argument form is called `ATTRS`/`ATTRN`.
 *
 * All numbers below were MEASURED with a compile probe against the test server
 * (viewKindAndAttrArityProbe.js, `attrFamilyAndViewCastProbe.js`,
 * `attrArityBoundsProbe.js`, 2026-08-12): the process body sits inside an
 * `IF(1=0)`, so it never runs, but it is compiled completely. The IBM docs say
 * the same (`ElementAttrS(dimension, hierarchy, element, attribute)`).
 *
 * The `Put` functions are the only special case: 5 to 8 arguments all
 * compile. The upper bound here is the documented 7 (value, dim, hier, element,
 * attribute, locale, security flag) — allowing more would mean passing off an
 * undocumented leniency of the server as a signature.
 *
 * What is checked is `KNOWN_SIGNATURES`, i.e. the BUILT `media/tiSignatures.json`
 * (`src/test/setup.ts` loads it) — not the source files under
 * `src/tiLogicVisualizer/signatures/`. This also catches the case where the source
 * was maintained but the artifact was not rebuilt (`npm run build:signatures`).
 */
describe('ElementAttr* family — hierarchy slot (measured live 2026-08-12)', () => {
  const cases: Array<{ fn: string; min: number; max: number; params: string[] }> = [
    { fn: 'ElementAttrS', min: 4, max: 4, params: ['DimensionName', 'HierarchyName', 'ElementName', 'AttributeName'] },
    { fn: 'ElementAttrN', min: 4, max: 4, params: ['DimensionName', 'HierarchyName', 'ElementName', 'AttributeName'] },
    { fn: 'ElementAttrSL', min: 4, max: 5, params: ['DimensionName', 'HierarchyName', 'ElementName', 'AttributeName', 'LocaleCode'] },
    { fn: 'ElementAttrNL', min: 4, max: 5, params: ['DimensionName', 'HierarchyName', 'ElementName', 'AttributeName', 'LocaleCode'] },
    { fn: 'ElementAttrDelete', min: 3, max: 3, params: ['DimensionName', 'HierarchyName', 'AttributeName'] },
    { fn: 'ElementAttrInsert', min: 5, max: 5, params: ['DimensionName', 'HierarchyName', 'PreviousAttributeName', 'AttributeName', 'AttributeType'] },
  ];

  for (const c of cases) {
    it(`${c.fn} carries the hierarchy and allows ${c.min}–${c.max} arguments`, () => {
      const sig = KNOWN_SIGNATURES.get(c.fn.toLowerCase()) ?? KNOWN_SIGNATURES.get(c.fn);
      expect(sig, `${c.fn} fehlt in KNOWN_SIGNATURES`).toBeTruthy();
      expect({ min: sig!.minParams, max: sig!.maxParams }).toEqual({ min: c.min, max: c.max });
      expect((sig!.params ?? []).map((p) => p.name)).toEqual(c.params);
    });
  }

  for (const fn of ['ElementAttrPutS', 'ElementAttrPutN']) {
    it(`${fn} requires at least five arguments, hierarchy in third position`, () => {
      const sig = KNOWN_SIGNATURES.get(fn.toLowerCase()) ?? KNOWN_SIGNATURES.get(fn);
      expect(sig).toBeTruthy();
      expect(sig!.minParams).toBe(5);
      expect(sig!.maxParams).toBe(7);
      expect((sig!.params ?? []).slice(0, 5).map((p) => p.name))
        .toEqual(['Value', 'DimensionName', 'HierarchyName', 'ElementName', 'AttributeName']);
    });
  }

  it('ATTRS/ATTRN stay at three arguments — they are the form WITHOUT a hierarchy', () => {
    for (const fn of ['ATTRS', 'ATTRN']) {
      const sig = KNOWN_SIGNATURES.get(fn.toLowerCase()) ?? KNOWN_SIGNATURES.get(fn);
      expect(sig, `${fn} fehlt`).toBeTruthy();
      expect({ min: sig!.minParams, max: sig!.maxParams }).toEqual({ min: 3, max: 3 });
    }
  });

  /**
   * The `Attr*` side is the counterpart and NEVER carries a hierarchy: live,
   * `AttrInsert` compiles only with four arguments and `AttrDelete` only with two;
   * the form that is one longer is a syntax error in each case. Previously the data
   * listed `AttrInsert` with an optional hierarchy slot (4–5) — an overload
   * that does not exist.
   */
  it('AttrInsert/AttrDelete carry NO hierarchy slot', () => {
    const ins = KNOWN_SIGNATURES.get('attrinsert');
    expect(ins).toBeTruthy();
    expect({ min: ins!.minParams, max: ins!.maxParams }).toEqual({ min: 4, max: 4 });
    expect((ins!.params ?? []).map((p) => p.name))
      .toEqual(['DimensionName', 'PreviousAttributeName', 'AttributeName', 'AttributeType']);

    const del = KNOWN_SIGNATURES.get('attrdelete');
    expect(del).toBeTruthy();
    expect({ min: del!.minParams, max: del!.maxParams }).toEqual({ min: 2, max: 2 });
  });
});

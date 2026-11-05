import { describe, it, expect } from 'vitest';
import { matchesLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { chainFor } from '../webviewClient/dimensionBrowser/viewTrail';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';

const V = (attrs?: Record<string, string>) =>
  ({ name: 'a', type: 'N' as const, level: 0, attrs });

/**
 * The attribute filter is the third filter kind that needs per-ancestor metadata
 * — exactly the case that `viewTrail.ts` predicted.
 *
 * Measured live (2026-08-23, dimAncestorAttrProbe.js, 11.8):
 * `Parent($select=Name,Attributes/<attr>)` returns 200 and carries exactly ONE
 * attribute per ancestor; `Parent($select=Name;$expand=Attributes)` is HTTP 400
 * (complex type). The server filter itself costs ~1.4 s on 1.63 million
 * occurrences and cuts down to 2,404 there.
 */
describe('attribute filter as a layer', () => {
  const schicht = { kind: 'attr' as const, attrs: ['SITENAME'], value: 'depot' };

  it('hits when the attribute value CONTAINS the text — not anchored', () => {
    // Unlike the name filter: `TM1FILTERBYPATTERN` is an anchored
    // pattern match, `INSTR(...) > 0` a substring search. Two forms, two
    // meanings — the client must reproduce the right one per layer.
    expect(matchesLayer(V({ SITENAME: 'Central Depot' }), schicht)).toBe(true);
    expect(matchesLayer(V({ SITENAME: 'Flughafen' }), schicht)).toBe(false);
  });

  it('compares regardless of upper/lower case — like UCASE(INSTR(...))', () => {
    expect(matchesLayer(V({ SITENAME: 'DEPOTHALLE' }), schicht)).toBe(true);
  });

  it('an ancestor WITHOUT the attribute value falls through, instead of staying silent', () => {
    // Live 11.8: `Properties(attr)` returns an empty string when the alias value equals the
    // element name — the server filters such an element OUT. The client
    // must do the same, otherwise it indents an ancestor that does not exist.
    expect(matchesLayer(V({}), schicht)).toBe(false);
    expect(matchesLayer(V(), schicht)).toBe(false);
    expect(matchesLayer(V({ SITENAME: '' }), schicht)).toBe(false);
  });

  it('writes INSTR(UCASE(Properties)) into the expression', () => {
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: schicht });
    expect(storedMdx(v, 'aa', 'aa')).toBe(
      '{FILTER({[aa].[aa].Members}, INSTR(UCASE([aa].[aa].CurrentMember.Properties("SITENAME")), UCASE("depot")) > 0)}',
    );
  });

  it('escapes attribute name AND search value as string literals', () => {
    const v = pushIntent(initialView('tree'),
      { kind: 'filter', layer: { kind: 'attr', attrs: ['a]b'], value: '12" x]y' } });
    expect(storedMdx(v, 'aa', 'aa')).toContain('Properties("a]b")');
    expect(storedMdx(v, 'aa', 'aa')).toContain('UCASE("12"" x]y")');
  });

  it('orders the chain projection WITH the attribute', () => {
    // Without it the ancestor carries no attribute value and `matchesLayer` falls
    // through for EVERY ancestor — the indentation would collapse.
    // It does NOT order type/level along with it: the two axes are
    // independent, and the element projection is expensive (measured 6.72 instead of
    // 2.85 MB per window). An attribute filter does not need it.
    const v = pushIntent(initialView('tree'), { kind: 'filter', layer: schicht });
    expect(chainFor(v)).toEqual({ kind: 'name', attrs: ['SITENAME'] });
  });

  it('without an attribute layer the chain projection stays slim', () => {
    expect(chainFor(initialView('tree'))).toEqual({ kind: 'name' });
    const t = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'type', types: ['N'] } });
    expect(chainFor(t)).toEqual({ kind: 'name+element' });
  });

  it('both axes at once when both layers lie', () => {
    let v = pushIntent(initialView('tree'), { kind: 'filter', layer: { kind: 'level', levels: [0] } });
    v = pushIntent(v, { kind: 'filter', layer: schicht });
    expect(chainFor(v)).toEqual({ kind: 'name+element', attrs: ['SITENAME'] });
  });
});

// ---------------------------------------------------------------------------

import { buildSetExprQuery } from '../tm1Rest/dimensionSetQueryPure';

/**
 * Measured live (2026-08-23, dimAncestorAttrProbe.js, 11.8,
 * dimension `AllocStations`, attribute `SITENAME`):
 *
 *   Parent($select=Name,Attributes)             HTTP 200, all attributes
 *   Parent($select=Name;$expand=Attributes)     HTTP 400 "Syntax error"
 *   Parent($select=Name,Attributes/SITENAME)     HTTP 200, exactly one
 *
 * Window 5000: name 2.85 MB · name+element 6.72 MB · +all attributes 8.04 MB
 * · +one attribute 7.54 MB. Hence the path form with ONE attribute name.
 */
describe('chain projection with attribute', () => {
  it('appends the attribute to the $select of EVERY chain step', () => {
    const q = buildSetExprQuery({ kind: 'name', attrs: ['SITENAME'] });
    expect(q).toContain('$select=Name,Attributes/SITENAME;$expand=Parent(');
    // No type filter was ordered, so the expensive element projection must
    // not stand in the chain either.
    expect(q).not.toContain('$expand=Element($select=Type,Level));');
  });

  it('NEVER the expand form — that is HTTP 400 (complex type)', () => {
    expect(buildSetExprQuery({ kind: 'name', attrs: ['SITENAME'] }))
      .not.toContain('$expand=Attributes');
  });

  it('carries attribute AND element projection when both are ordered', () => {
    const q = buildSetExprQuery({ kind: 'name+element', attrs: ['SITENAME'] });
    expect(q).toContain('$select=Name,Attributes/SITENAME;$expand=Element($select=Type,Level)');
  });

  it('without an attribute unchanged as before', () => {
    // Without parent attributes the parent projection should simply be Name
    expect(buildSetExprQuery({ kind: 'name' }))
      .toContain('$expand=Parent($select=Name;');
    // The member selection still needs Caption, though
    expect(buildSetExprQuery({ kind: 'name' }))
      .toContain('DisplayInfo,Attributes/Caption;');
    expect(buildSetExprQuery({ kind: 'name+element' }))
      .toContain('$select=Name;$expand=Element($select=Type,Level)');
  });
});

// ---------------------------------------------------------------------------

import { parseSetAnswer } from '../tm1Rest/dimensionSetQueryPure';
import { rowsFromAnswer } from '../webviewClient/dimensionBrowser/rowsFromAnswer';

describe('the attribute value reaches the ancestor', () => {
  const antwort = {
    Tuples: [{
      Members: [{
        Name: 'S00102', UniqueName: '[d].[h].[S00102]', DisplayInfo: 0,
        Attributes: { Caption: 'S00102' },
        Parent: {
          Name: 'SITE2022_extern_C', Attributes: { SITENAME: 'Depothalle Nord' },
          Parent: { Name: 'Wurzel_C', Attributes: { SITENAME: 'Flughafen' }, Parent: null },
        },
      }],
    }],
  };

  it('reads attribute values from the chain into AncestorRef.attrs', () => {
    const [r] = parseSetAnswer(antwort);
    expect(r.ancestors.map((a) => [a.name, a.attrs?.SITENAME]))
      .toEqual([['Wurzel_C', 'Flughafen'], ['SITE2022_extern_C', 'Depothalle Nord']]);
  });

  it('does not turn a missing order into an empty object', () => {
    // `attrs: {}` would be a claim ("this ancestor has no attributes"),
    // `undefined` is the truth ("not ordered"). The predicate falls through in
    // both cases, but only one of them could still be told apart
    // later.
    const ohne = { Tuples: [{ Members: [{ Name: 'a', Parent: { Name: 'p', Parent: null } }] }] };
    expect(parseSetAnswer(ohne)[0].ancestors[0].attrs).toBeUndefined();
  });

  it('an ancestor whose attribute value does not match is SKIPPED', () => {
    // The indentation follows the ancestors that survive the layer. Without
    // the values EVERY one would fall through here and everything would stand at depth 0.
    const rows = rowsFromAnswer(parseSetAnswer(antwort), pushIntent(initialView('tree'),
      { kind: 'filter', layer: { kind: 'attr', attrs: ['SITENAME'], value: 'depot' } }));
    expect(rows.map((r) => `${r.depth}:${r.name}`)).toEqual(['1:S00102']);
  });
});

// ---------------------------------------------------------------------------

/**
 * Live 2026-08-23, dimension `Stations`: its attributes are called `SITE+Name`
 * (code point 43 — a real plus IN THE NAME, not an encoded space),
 * `5-Stellig` and `SITENAME`. Measured:
 *
 *   Attributes/SITE+Name                      400 "Unsupported token at: +Name"
 *   Attributes/SITE%2BName (encodeURI)        400 — the same error
 *   Attributes/'SITE+Name' (single quotes)    400 "Syntax error"
 *   Attributes/5-Stellig                     400 "Syntax error"
 *   Attributes            (all)              200 — carries `SITE+Name` cleanly
 *
 * So TM1's OData parser takes ONLY simple identifiers in the path form. For
 * everything else there is no escaping, only the fallback to the
 * whole collection: window 5000 on `Stations` 52 kB against 148 kB.
 */
describe('attribute names that are not OData identifiers', () => {
  it('falls back to the whole collection instead of building a 400', () => {
    const q = buildSetExprQuery({ kind: 'name', attrs: ['SITE+Name'] });
    expect(q).not.toContain('SITE+Name');
    expect(q).toContain('$select=Name,Attributes;$expand=Parent(');
  });

  it('also with a leading digit and a hyphen', () => {
    const q = buildSetExprQuery({ kind: 'name', attrs: ['5-Stellig'] });
    expect(q).not.toContain('5-Stellig');
    expect(q).toContain('$select=Name,Attributes;');
  });

  it('simple identifiers keep the slim path form', () => {
    expect(buildSetExprQuery({ kind: 'name', attrs: ['SITENAME'] }))
      .toContain('$select=Name,Attributes/SITENAME;$expand=Parent(');
    expect(buildSetExprQuery({ kind: 'name', attrs: ['_intern1'] }))
      .toContain('Attributes/_intern1');
  });
});

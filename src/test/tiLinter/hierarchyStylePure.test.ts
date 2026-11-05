import { describe, it, expect } from 'vitest';
import {
  censusHierarchyStyle,
  HIERARCHY_PAIRS,
  OPTIONAL_HIERARCHY_ARG,
  LEGACY_NAMES,
  MODERN_NAMES,
  isBedrockObject,
} from '../../tiLogicVisualizer/tiLinter/hierarchyStylePure';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';

describe('pair table against the signatures', () => {
  it('kennt beide Namen jedes Paares', () => {
    for (const [legacy, modern] of HIERARCHY_PAIRS) {
      expect(KNOWN_SIGNATURES.has(legacy.toLowerCase()), `${legacy} fehlt in den Signaturen`).toBe(true);
      expect(KNOWN_SIGNATURES.has(modern.toLowerCase()), `${modern} fehlt in den Signaturen`).toBe(true);
    }
  });

  it('requires more arguments in the hierarchy form than in the dimension form', () => {
    // Inserted hierarchy argument. If the difference disappears, either
    // the table is wrong or a signature was rewritten.
    for (const [legacy, modern] of HIERARCHY_PAIRS) {
      const l = KNOWN_SIGNATURES.get(legacy.toLowerCase())!;
      const m = KNOWN_SIGNATURES.get(modern.toLowerCase())!;
      expect(m.maxParams, `${legacy} -> ${modern}`).toBeGreaterThan(l.minParams);
    }
  });

  it('lists no name twice', () => {
    expect(LEGACY_NAMES.size).toBe(HIERARCHY_PAIRS.length);
  });

  it('keeps the dimension form out of the set of hierarchy-aware names', () => {
    for (const key of LEGACY_NAMES.keys()) {
      expect(MODERN_NAMES.has(key), `${key} steht auf beiden Seiten`).toBe(false);
    }
  });
});

describe('long forms with an optional hierarchy argument', () => {
  it('carries exactly one optional argument, and it is in second position', () => {
    // The arity alone is not enough: `ElementAttrNL` is also at
    // [4-5], but its optional argument is the locale key at the end.
    // That is why the list is checked against the parameter names here.
    for (const name of OPTIONAL_HIERARCHY_ARG) {
      const sig = KNOWN_SIGNATURES.get(name.toLowerCase());
      expect(sig, `${name} fehlt in den Signaturen`).toBeTruthy();
      expect(sig!.maxParams - sig!.minParams, name).toBe(1);
      expect(sig!.params[1]?.name, name).toBe('HierarchyName');
      // The optional argument is in second position, not at the end — so the
      // parameter list is exactly as long as the maximum count.
      expect(sig!.params.length, name).toBe(sig!.maxParams);
    }
  });
});

describe('censusHierarchyStyle', () => {
  it('counts the pure dimension form without a hierarchy form', () => {
    const c = censusHierarchyStyle(`
nZaehler = DIMSIZ('Kunde');
sEltern = ELPAR('Kunde', sKunde, 1);
`);
    expect(c.modernCount).toBe(0);
    expect(c.legacy.map(h => h.name)).toEqual(['DIMSIZ', 'ELPAR']);
    expect(c.legacy[0].modern).toBe('ElementCount');
    expect(c.legacy[1].modern).toBe('ElementParent');
  });

  it('recognises the hierarchy form by a Hierarchy name', () => {
    const c = censusHierarchyStyle(`nDa = HierarchyElementExists('Kunde', 'Region', sKunde);`);
    expect(c.modernCount).toBe(1);
    expect(c.modernSample).toBe('HierarchyElementExists');
    expect(c.legacy).toEqual([]);
  });

  it('treats a long form WITH a hierarchy argument as hierarchy-aware', () => {
    const c = censusHierarchyStyle(`nDa = ElementIndex('Kunde', 'Region', sKunde);`);
    expect(c.modernCount).toBe(1);
    expect(c.legacy).toEqual([]);
  });

  it('reports the same long form WITHOUT a hierarchy argument as blind', () => {
    const c = censusHierarchyStyle(`nDa = ElementIndex('Kunde', sKunde);`);
    expect(c.modernCount).toBe(0);
    expect(c.legacy).toHaveLength(1);
    expect(c.legacy[0].kind).toBe('missing-hierarchy-arg');
    expect(c.legacy[0].name).toBe('ElementIndex');
  });

  it('counts correctly across a line break inside the call', () => {
    const c = censusHierarchyStyle(`nDa = ElementIndex(
  'Kunde',
  'Region',
  sKunde
);`);
    expect(c.modernCount).toBe(1);
    expect(c.legacy).toEqual([]);
  });

  it('records line and column', () => {
    const c = censusHierarchyStyle(`# Kopf\nnZ = DIMSIZ('Kunde');`);
    expect(c.legacy[0].line).toBe(1);
    expect(c.legacy[0].startCol).toBe(5);
    expect(c.legacy[0].endCol).toBe(11);
  });

  it('ignores names in strings and comments', () => {
    const c = censusHierarchyStyle(`sText = 'DIMSIZ(x)'; # ELPAR('a', 'b', 1)\n`);
    expect(c.legacy).toEqual([]);
    expect(c.modernCount).toBe(0);
  });

  it('does not mistake a variable of the same name without parentheses for a call', () => {
    const c = censusHierarchyStyle(`DIMSIZ = 5;`);
    expect(c.legacy).toEqual([]);
  });

  it('does not confuse partial names', () => {
    // `ElementName` steckt in `SubsetGetElementName`, `ATTRN` in `SubsetAttrN`.
    const c = censusHierarchyStyle(`
sN = SubsetGetElementName('Kunde', 'Alle', 1);
nA = SubsetAttrN('Kunde', 'Alle', 'Farbe');
`);
    expect(c.legacy.map(h => h.name)).toEqual(['SubsetGetElementName', 'SubsetAttrN']);
  });

  it('picks the longer one among similar names', () => {
    const c = censusHierarchyStyle(`DimensionElementDeleteDirect('Kunde', sKunde);`);
    expect(c.legacy).toHaveLength(1);
    expect(c.legacy[0].name).toBe('DimensionElementDeleteDirect');
  });
});

describe('the default hierarchy in long form is NO evidence', () => {
  // Measured on the real model (2026-09-01): all 51 customer findings of the first
  // version traced back to `ElementAttrInsert(csDim, csDim, …)` — the
  // default hierarchy carries the name of its dimension.
  it('does not count hierarchy equal to dimension as hierarchy-aware', () => {
    const c = censusHierarchyStyle(`ElementAttrInsert(csDim, csDim, '', 'SITENAME', 'A');`);
    expect(c.modernCount).toBe(0);
  });

  it('also applies to two identical strings', () => {
    const c = censusHierarchyStyle(`nI = ElementIndex('Stations', 'Stations', '100002');`);
    expect(c.modernCount).toBe(0);
  });

  it('also applies to an empty hierarchy literal', () => {
    const c = censusHierarchyStyle(`nI = ElementIndex(sDim, '', sEl);`);
    expect(c.modernCount).toBe(0);
  });

  it('does NOT apply to the Hierarchy family — whoever types it commits to it', () => {
    // Measured (332 processes): not a single `Hierarchy*(x, x, …)` call in the
    // model, so the exception costs nothing. Whoever writes `HierarchyElementExists`
    // has decided against `DimensionElementExists`.
    const c = censusHierarchyStyle(`nD = HierarchyElementExists('Monate', 'Monate', sK);`);
    expect(c.modernCount).toBe(1);
  });

  it('still counts a DIFFERENT hierarchy', () => {
    const c = censusHierarchyStyle(`nI = ElementIndex(pSrcDim, pSrcHier, sEl);`);
    expect(c.modernCount).toBe(1);
  });

  it('compares the strings on the raw text, not on the mask', () => {
    // Both literals have the same length; in the masked version they would look
    // identical and the hierarchy would wrongly look like the default hierarchy.
    const c = censusHierarchyStyle(`nI = ElementIndex('Kunde', 'Regio', sEl);`);
    expect(c.modernCount).toBe(1);
  });
});

describe('isBedrockObject', () => {
  it('recognises the library by its namespace', () => {
    expect(isBedrockObject('}bedrock.hier.clone')).toBe(true);
    expect(isBedrockObject('}Bedrock.dim.clone')).toBe(true);
    expect(isBedrockObject('00609_Import_DIM')).toBe(false);
    expect(isBedrockObject('}ElementAttributes_Kunde')).toBe(false);
    expect(isBedrockObject(undefined)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import * as odata from '../../../security/api/_odata';
const { encodeKey, elementRef } = odata;

describe('_odata module surface', () => {
  it('exposes encodeKey + elementRef — the quote-doubling-only alias stays gone', () => {
    // Removing `escapeKey` is the point: it had no consumer left and was the
    // only way to reach the wrong grammar from this module by accident. Both
    // survivors encode; neither hands out quote-doubling on its own.
    expect(Object.keys(odata).sort()).toEqual(['elementRef', 'encodeKey']);
  });
});

describe('elementRef', () => {
  it('builds the resource path a `Tuple@odata.bind` member needs', () => {
    expect(elementRef('}Groups', 'ADMIN'))
      .toBe("Dimensions('%7DGroups')/Hierarchies('%7DGroups')/Elements('ADMIN')");
  });
  it('hierarchy defaults to the dimension name and can be overridden', () => {
    expect(elementRef('Region', 'Europe')).toBe("Dimensions('Region')/Hierarchies('Region')/Elements('Europe')");
    expect(elementRef('Region', 'Europe', 'ByMarket'))
      .toBe("Dimensions('Region')/Hierarchies('ByMarket')/Elements('Europe')");
  });
  it('every segment is encoded — a `/` in a name must not split the path', () => {
    expect(elementRef('A/B', "o'brien", 'H#1'))
      .toBe("Dimensions('A%2FB')/Hierarchies('H%231')/Elements('o''brien')");
  });
});

describe('encodeKey', () => {
  it('plain name unchanged', () => {
    expect(encodeKey('admin')).toBe('admin');
  });
  it('quote-doubling still applies, and `\'` itself is not percent-encoded', () => {
    expect(encodeKey("o'brien")).toBe("o''brien");
  });
  it('percent-encodes path-breaking characters', () => {
    expect(encodeKey('A/B')).toBe('A%2FB');
    expect(encodeKey('a b')).toBe('a%20b');
    expect(encodeKey('a#b')).toBe('a%23b');
    expect(encodeKey('a?b')).toBe('a%3Fb');
  });
  it('control-object `}` encodes exactly once (no %257D double-encode)', () => {
    expect(encodeKey('}Groups')).toBe('%7DGroups');
    expect(encodeKey('}Groups')).not.toContain('%257D');
    expect(encodeKey('}ElementSecurity_Region')).toBe('%7DElementSecurity_Region');
  });
  it('empty string', () => {
    expect(encodeKey('')).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { parseSetAnswer } from '../tm1Rest/dimensionSetQueryPure';

const antwort = (attrs: Record<string, string | number | null>) => ({
  Tuples: [{ Members: [{
    Name: 'e1', UniqueName: '[d].[h].[e1]', DisplayInfo: 0,
    Attributes: attrs, Parent: null, Element: { Type: 'Numeric', Level: 0 },
  }] }],
});

describe('parseSetAnswer carries the requested attribute values', () => {
  it('without a request there is no attrs field', () => {
    expect(parseSetAnswer(antwort({ Caption: 'E1', SITENAME: 'Depot' }))[0]!.attrs)
      .toBeUndefined();
  });

  it('carries exactly the requested ones, not everything that arrived', () => {
    const r = parseSetAnswer(antwort({ Caption: 'E1', SITENAME: 'Depot', Rest: 'x' }), '', ['SITENAME']);
    expect(r[0]!.attrs).toEqual({ SITENAME: 'Depot' });
  });

  it('a missing key is EMPTY, not an error', () => {
    // Measured live on 11.8: TM1 omits empty attribute values — of 109
    // defined attributes only 45 keys came back on 300 elements,
    // the same on the MDX path as on the Elements path.
    const r = parseSetAnswer(antwort({ Caption: 'E1' }), '', ['SITENAME']);
    expect(r[0]!.attrs).toEqual({});
  });

  it('turns numbers into strings so the display does not have to guess', () => {
    const r = parseSetAnswer(antwort({ Caption: 'E1', Jahr: 2026 }), '', ['Jahr']);
    expect(r[0]!.attrs).toEqual({ Jahr: '2026' });
  });

  it('null counts as empty and is dropped', () => {
    const r = parseSetAnswer(antwort({ Caption: 'E1', Leer: null }), '', ['Leer']);
    expect(r[0]!.attrs).toEqual({});
  });

  it('the caption stays untouched by the column path', () => {
    const r = parseSetAnswer(antwort({ Caption: 'E1', SITENAME: 'Depot' }), 'SITENAME', ['SITENAME']);
    expect(r[0]!.caption).toBe('Depot');
    expect(r[0]!.attrs).toEqual({ SITENAME: 'Depot' });
  });
});

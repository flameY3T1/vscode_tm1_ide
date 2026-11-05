import { describe, it, expect } from 'vitest';
import { embedDisplayFormats, unwrapDisplayFormats } from '../../cubeViewer/mdxFormatEmbedPure';

const BASE = 'SELECT {[Col].[Col].[Wert],[Col].[Col].[Menge]} ON 0, {[Row].[Row].[K1]} ON 1 FROM [Cube] WHERE ([Year].[Year].[2023])';

describe('embedDisplayFormats', () => {
  it('reads keywords only outside comments and names', () => {
    const commented = '/* saved */ WITH MEMBER [D].[D].[X] AS 1 SELECT {[D].[D].[A]} ON 0 FROM [C]';
    const saved1 = embedDisplayFormats(commented, { D: { A: '0.00' } }).mdx;
    expect(saved1.match(/\bWITH\b/g)).toHaveLength(1);
    // the comment in front of WITH survives save and open
    expect(saved1.startsWith('/* saved */ WITH ')).toBe(true);
    expect(unwrapDisplayFormats(saved1).mdx).toBe('/* saved */ WITH MEMBER [D].[D].[X] AS 1\nSELECT {[D].[D].[A]} ON 0 FROM [C]');
    const onlyOurs = "// report\nWITH MEMBER [D].[D].[A (Format)] AS [D].[D].[A], FORMAT_STRING = '0'\nSELECT {[D].[D].[A (Format)]} ON 0 FROM [C]";
    expect(unwrapDisplayFormats(onlyOurs).mdx).toBe('// report\nSELECT {[D].[D].[A]} ON 0 FROM [C]');
    const named = 'SELECT {[D].[D].[SELECT],[D].[D].[FROM]} ON 0 FROM [C]';
    const saved = embedDisplayFormats(named, { D: { SELECT: '0.00', FROM: '0' } });
    expect(saved.skipped).toEqual([]);
    expect(unwrapDisplayFormats(saved.mdx)).toEqual({ mdx: named, formats: { D: { SELECT: '0.00', FROM: '0' } } });
  });

  it('leaves a real element named "X (Format)" alone and skips a colliding wrap', () => {
    const input = 'SELECT {[D].[D].[A],[D].[D].[A (Format)]} ON 0 FROM [C]';
    const real = embedDisplayFormats(input, { D: { 'A (Format)': '0.00' } });
    expect(real.mdx).toContain('AS [D].[D].[A (Format)]');
    expect(real.mdx).toContain('{[D].[D].[A],');
    expect(embedDisplayFormats(input, { D: { A: '0.00' } })).toEqual({ mdx: input, skipped: [{ dim: 'D', element: 'A' }] });
  });

  it('swaps a plain set item for a reference member with FORMAT_STRING', () => {
    const r = embedDisplayFormats(BASE, { Col: { Wert: '#,##0 "€"' } });
    expect(r.skipped).toEqual([]);
    expect(r.mdx).toBe(
      "WITH MEMBER [Col].[Col].[Wert (Format)] AS [Col].[Col].[Wert], FORMAT_STRING = '#,##0 \"€\"', CAPTION = 'Wert'\n"
      + 'SELECT {[Col].[Col].[Wert (Format)],[Col].[Col].[Menge]} ON 0, {[Row].[Row].[K1]} ON 1 FROM [Cube] WHERE ([Year].[Year].[2023])');
  });

  it('re-saving updates its own member instead of wrapping twice', () => {
    const once = embedDisplayFormats(BASE, { Col: { Wert: '0.0' } }).mdx;
    const again = embedDisplayFormats(once, { Col: { 'Wert (Format)': '0.00' } }).mdx;
    expect(again).toBe(once.replace("'0.0'", "'0.00'"));
    expect(embedDisplayFormats(once, {}).mdx).toBe(once);
  });

  it('keeps foreign WITH definitions and adds its own in front', () => {
    const mdx = 'WITH SET [S] AS {[Row].[Row].[K1]}\n' + BASE.replace('{[Row].[Row].[K1]}', '[S]');
    const r = embedDisplayFormats(mdx, { Col: { Menge: '0' } });
    expect(r.mdx.startsWith("WITH MEMBER [Col].[Col].[Menge (Format)] AS [Col].[Col].[Menge], FORMAT_STRING = '0', CAPTION = 'Menge'\n SET [S] AS")).toBe(true);
    expect(r.mdx).toContain('{[Col].[Col].[Wert],[Col].[Col].[Menge (Format)]}');
  });

  it('skips the slicer, function arguments and elements not in the query', () => {
    const mdx = 'SELECT {DESCENDANTS([Col].[Col].[Wert])} ON 0 FROM [Cube] WHERE ([Year].[Year].[2023])';
    const r = embedDisplayFormats(mdx, { Col: { Wert: '0' }, Year: { '2023': '0' }, Row: { K9: '0' } });
    expect(r.mdx).toBe(mdx);
    expect(r.skipped).toEqual([{ dim: 'Col', element: 'Wert' }, { dim: 'Year', element: '2023' }, { dim: 'Row', element: 'K9' }]);
  });

  it('escapes ] in names and quote in formats', () => {
    const mdx = 'SELECT {[Col].[Col].[a]]b]} ON 0 FROM [Cube]';
    const r = embedDisplayFormats(mdx, { Col: { 'a]b': '0 "it\'s"' } });
    expect(r.mdx).toContain("MEMBER [Col].[Col].[a]]b (Format)] AS [Col].[Col].[a]]b], FORMAT_STRING = '0 \"it''s\"', CAPTION = 'a]b'");
    expect(embedDisplayFormats(r.mdx, {}).mdx).toBe(r.mdx);
  });
});

describe('unwrapDisplayFormats', () => {
  it('is the reverse of embedDisplayFormats', () => {
    const f = { Col: { Wert: '#,##0 "€"' }, Row: { K1: "0 \"it's\"" } };
    const r = unwrapDisplayFormats(embedDisplayFormats(BASE, f).mdx);
    expect(r.mdx).toBe(BASE);
    expect(r.formats).toEqual(f);
  });
  it('keeps foreign WITH definitions', () => {
    const mdx = 'WITH SET [S] AS {[Row].[Row].[K1]}\n' + BASE.replace('{[Row].[Row].[K1]}', '[S]');
    const r = unwrapDisplayFormats(embedDisplayFormats(mdx, { Col: { Menge: '0' } }).mdx);
    expect(r.mdx).toBe(mdx);
    expect(r.formats).toEqual({ Col: { Menge: '0' } });
  });
  it('leaves MDX without own members alone, including foreign calculated members', () => {
    const mdx = "WITH MEMBER [Col].[Col].[X] AS [Col].[Col].[Wert], FORMAT_STRING = '0'\n" + BASE;
    expect(unwrapDisplayFormats(mdx)).toEqual({ mdx, formats: {} });
    expect(unwrapDisplayFormats(BASE)).toEqual({ mdx: BASE, formats: {} });
  });

  it('also rewrites references to our member in the remaining definitions', () => {
    const mdx = "WITH MEMBER [D].[D].[A (Format)] AS [D].[D].[A], FORMAT_STRING = '0.00'\n"
      + ' MEMBER [D].[D].[Double] AS [D].[D].[A (Format)] * 2\n'
      + 'SELECT {[D].[D].[Double],[D].[D].[A (Format)]} ON 0 FROM [C]';
    expect(unwrapDisplayFormats(mdx).mdx).toBe(
      'WITH MEMBER [D].[D].[Double] AS [D].[D].[A] * 2\nSELECT {[D].[D].[Double],[D].[D].[A]} ON 0 FROM [C]');
  });
});

describe('display formats on an alternate hierarchy', () => {
  const ALT = 'SELECT {[Col].[Col].[Wert]} ON 0, {[D].[Alt].[GroupA],[D].[Alt].[GroupB]} ON 1 FROM [Cube]';

  it('embeds under the `dim:hier` key and unwraps back to it', () => {
    const { mdx, skipped } = embedDisplayFormats(ALT, { 'D:Alt': { GroupA: '#,##0.00' } });
    expect(skipped).toEqual([]);
    expect(mdx).toContain('MEMBER [D].[Alt].[GroupA (Format)] AS [D].[Alt].[GroupA]');
    const back = unwrapDisplayFormats(mdx);
    expect(back.formats).toEqual({ 'D:Alt': { GroupA: '#,##0.00' } });
    expect(back.mdx.trim()).toBe(ALT);
  });

  it('does not match the default hierarchy for an alternate key', () => {
    const q = 'SELECT {[D].[D].[GroupA]} ON 0 FROM [Cube]';
    expect(embedDisplayFormats(q, { 'D:Alt': { GroupA: '0' } }).skipped).toEqual([{ dim: 'D:Alt', element: 'GroupA' }]);
  });
});

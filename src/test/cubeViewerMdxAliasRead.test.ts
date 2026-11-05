import { describe, it, expect, vi, beforeEach } from 'vitest';

// `_fetchViewAxisConfig` reaches the network through the `tm1Client` facade, but
// modules underneath it import `tm1Rest/client` directly — mocking only one of
// the two paths lets the other run into the real network (timeouts instead of a
// clear failure). Both are pointed at the same doubles.
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));

// Spy that still runs the REAL parser: the assertions below are about the wiring
// (is it called, with what, and does its result reach `dimAliases`), not about
// re-testing `dimensionPropertiesPure` — that has its own suite.
vi.mock('../mdx/dimensionPropertiesPure', async (orig) => {
  const actual = await orig<typeof import('../mdx/dimensionPropertiesPure')>();
  return { ...actual, detectDimensionProperties: vi.fn(actual.detectDimensionProperties) };
});

import { apiRequest } from '../tm1Client';
import { detectDimensionProperties } from '../mdx/dimensionPropertiesPure';
import { _fetchViewAxisConfig } from '../commands/cubeViewer/fetch';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const mockDetect = detectDimensionProperties as unknown as ReturnType<typeof vi.fn>;

const MDX_TYPE = '#ibm.tm1.api.v1.MDXView';
const NATIVE_TYPE = '#ibm.tm1.api.v1.NativeView';

/** Call 1 of `_fetchViewAxisConfig` is always `?$select=Name` (the type probe). */
function mockTypeProbe(odataType: string): void {
  mockApi.mockResolvedValueOnce({
    statusCode: 200,
    body: JSON.stringify({ '@odata.type': odataType, Name: 'V' }),
  });
}

/** Call 2 on the MDX branch is `?$select=MDX`. */
function mockMdxRead(mdx: string): void {
  mockApi.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ MDX: mdx }) });
}

describe('_fetchViewAxisConfig dimAliases (MDX read path)', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockDetect.mockClear();
  });

  it('picks up a DIMENSION PROPERTIES clause on the row axis', async () => {
    mockTypeProbe(MDX_TYPE);
    mockMdxRead(
      'SELECT {[Konten].MEMBERS} ON 0, '
      + '{[Jahre].MEMBERS} DIMENSION PROPERTIES [Jahre].[Jahre].[ALIAS_TEXT] ON 1 '
      + 'FROM [Planung]',
    );
    const r = await _fetchViewAxisConfig('Planung', 'V', false, undefined as never);
    expect(r?.isMdx).toBe(true);
    expect(r?.dimAliases).toEqual({ Jahre: 'ALIAS_TEXT' });
  });

  it('picks up clauses on both axes', async () => {
    mockTypeProbe(MDX_TYPE);
    mockMdxRead(
      'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[Konten].[ALIAS_KONTO] ON COLUMNS, '
      + '{[Jahre].MEMBERS} DIMENSION PROPERTIES [Jahre].[ALIAS_JAHR] ON ROWS '
      + 'FROM [Planung]',
    );
    const r = await _fetchViewAxisConfig('Planung', 'V', false, undefined as never);
    expect(r?.dimAliases).toEqual({ Konten: 'ALIAS_KONTO', Jahre: 'ALIAS_JAHR' });
  });

  it('returns {} for an MDX view without any clause', async () => {
    mockTypeProbe(MDX_TYPE);
    mockMdxRead('SELECT {[Konten].MEMBERS} ON 0, {[Jahre].MEMBERS} ON 1 FROM [Planung]');
    const r = await _fetchViewAxisConfig('Planung', 'V', false, undefined as never);
    expect(r?.isMdx).toBe(true);
    expect(r?.dimAliases).toEqual({});
  });

  it('returns {} for MDX that is not a parsable SELECT', async () => {
    mockTypeProbe(MDX_TYPE);
    mockMdxRead('not mdx at all');
    const r = await _fetchViewAxisConfig('Planung', 'V', false, undefined as never);
    expect(r?.dimAliases).toEqual({});
  });

  it('parses the MDX text that was actually read back', async () => {
    const mdx = 'SELECT {[Konten].MEMBERS} DIMENSION PROPERTIES [Konten].[ALIAS_KONTO] ON 0 FROM [Planung]';
    mockTypeProbe(MDX_TYPE);
    mockMdxRead(mdx);
    await _fetchViewAxisConfig('Planung', 'V', false, undefined as never);
    expect(mockDetect).toHaveBeenCalledWith(mdx);
  });

  it('returns {} for a native view and never consults the MDX parser', async () => {
    // A native view's alias lives in `Subset.Alias` and is fetched separately by
    // `alias.ts#fetchViewDimAliases`; this path must not duplicate it.
    mockTypeProbe(NATIVE_TYPE);
    // Call 2: suppress flags. The remaining native calls (Rows/Columns expand,
    // Titles) resolve to undefined and are guarded.
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ SuppressEmptyRows: false, SuppressEmptyColumns: false }),
    });
    const r = await _fetchViewAxisConfig('Planung', 'V', false, undefined as never);
    expect(r?.isMdx).toBe(false);
    expect(r?.dimAliases).toEqual({});
    expect(mockDetect).not.toHaveBeenCalled();
  });
});

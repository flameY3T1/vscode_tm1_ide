import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../tm1Client';
import { fetchViewDimAliases } from '../commands/cubeViewer/alias';
import { _fetchViewAxisConfig } from '../commands/cubeViewer/fetch';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const CONFIG = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' };

const ok = (body: unknown) => ({ statusCode: 200, body: JSON.stringify(body) });

/**
 * `Rows`, `Columns` and `Titles` are COMPLEX types on a view. TM1 rejects the
 * `Rows(...)` option syntax on them:
 *
 *   HTTP 400 — "Syntax error at position 4, near "(" for $expand query option:
 *               Expecting '/' after property of complex type in expand path."
 *
 * The path form `Rows/Subset(...)` is the one that answers 200 (verified live
 * against TM1 11.8.02900.8). Both read paths below used the rejected form and
 * silently degraded to "nothing found": the alias of a saved view never came
 * back, and the row/column dimensions were always undefined on open.
 */
describe('view read-back uses the complex-type expand path', () => {
  beforeEach(() => mockApi.mockReset());

  it('fetchViewDimAliases asks for Rows/Subset, never Rows(', async () => {
    mockApi.mockResolvedValue(ok({ Rows: [], Columns: [] }));
    await fetchViewDimAliases('Sales', 'V', false, CONFIG as never);
    const url = decodeURIComponent(String(mockApi.mock.calls[0][1]));
    expect(url).toContain('Rows/Subset(');
    expect(url).toContain('Columns/Subset(');
    expect(url).not.toMatch(/Rows\(\$expand/);
    expect(url).not.toMatch(/Columns\(\$expand/);
  });

  it('fetchViewDimAliases reads the alias out of Subset.Alias', async () => {
    mockApi.mockResolvedValue(ok({
      Rows: [{ Subset: { Alias: 'ALIAS_TEXT', Hierarchy: { Name: 'Konten' } } }],
      Columns: [{ Subset: { Hierarchy: { Name: 'Jahre' } } }],
    }));
    const out = await fetchViewDimAliases('Sales', 'V', false, CONFIG as never);
    expect(out).toEqual({ Konten: 'ALIAS_TEXT' });
  });

  it('_fetchViewAxisConfig asks for Rows/Subset and resolves both axis dims', async () => {
    mockApi.mockImplementation((_m: string, rawUrl?: string) => {
      const url = String(rawUrl ?? '');
      if (url.includes('SuppressEmptyRows,SuppressEmptyColumns')) {
        return Promise.resolve(ok({ SuppressEmptyRows: false, SuppressEmptyColumns: false }));
      }
      if (url.includes('/Titles')) { return Promise.resolve(ok({ value: [] })); }
      if (url.includes('$expand=Rows')) {
        return Promise.resolve(ok({
          Rows: [{ Subset: { Hierarchy: { Name: 'Konten' } } }],
          Columns: [{ Subset: { Hierarchy: { Name: 'Jahre' } } }],
        }));
      }
      return Promise.resolve(ok({ '@odata.type': '#ibm.tm1.api.v1.NativeView' }));
    });

    const cfg = await _fetchViewAxisConfig('Sales', 'V', false, CONFIG as never);
    // Not just "contains Rows" — the suppress-flag URL carries SuppressEmptyRows.
    const axisUrl = String(mockApi.mock.calls.map(c => String(c[1])).find(u => u.includes('$expand=Rows')) ?? '');
    expect(axisUrl).toContain('Rows/Subset(');
    expect(axisUrl).not.toMatch(/Rows\(\$expand/);
    expect(cfg?.rowDim).toBe('Konten');
    expect(cfg?.colDim).toBe('Jahre');
  });

  // The alias belongs to the view, so opening a saved view straight from the
  // tree has to carry it too. It used to be fetched only on a later view SWITCH
  // (messaging.ts#viewSwitched), so a freshly opened view never showed one —
  // even once the read itself worked.
  it('the first open asks for the view aliases, not just a later view switch', async () => {
    const seen: string[] = [];
    mockApi.mockImplementation((_m: string, rawUrl?: string) => {
      const url = String(rawUrl ?? '');
      seen.push(url);
      if (url.includes('Rows/Subset($select=Alias')) {
        return Promise.resolve(ok({
          Rows: [{ Subset: { Alias: 'ALIAS_TEXT', Hierarchy: { Name: 'Konten' } } }],
          Columns: [],
        }));
      }
      return Promise.resolve(ok({ value: [] }));
    });

    await fetchViewDimAliases('Sales', 'V', false, CONFIG as never);
    expect(seen.some(u => decodeURIComponent(u).includes('Rows/Subset($select=Alias'))).toBe(true);
  });
});

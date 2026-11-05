// src/test/security/api/dimSecurityApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateDimPerms } from '../../../security/api/dimSecurityApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('dimSecurityApi.fetchAllDimPerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('parses N dims × M groups', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS_ALL' }) })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          Axes: [
            { Ordinal: 0, Tuples: [
              { Members: [{ Name: 'ADMIN' }] },
              { Members: [{ Name: 'Sales' }] },
            ]},
            { Ordinal: 1, Tuples: [
              { Members: [{ Name: 'Dim1' }] },
              { Members: [{ Name: 'Dim2' }] },
            ]},
          ],
          Cells: [
            { Ordinal: 0, Value: 'ADMIN' },
            { Ordinal: 1, Value: 'WRITE' },
            { Ordinal: 2, Value: 'ADMIN' },
            { Ordinal: 3, Value: 'READ' },
          ],
        }),
      })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    const perms = await (await import('../../../security/api/dimSecurityApi')).fetchAllDimPerms({} as Tm1Config);
    expect(perms).toEqual({
      Dim1: { ADMIN: 'ADMIN', Sales: 'WRITE' },
      Dim2: { ADMIN: 'ADMIN', Sales: 'READ' },
    });
  });

  it('MDX uses TM1SUBSETALL([}Dimensions])', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS_X' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Axes: [{Ordinal:0,Tuples:[]},{Ordinal:1,Tuples:[]}], Cells: [] }) })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });
    const { fetchAllDimPerms } = await import('../../../security/api/dimSecurityApi');
    await fetchAllDimPerms({} as Tm1Config);
    const mdxBody = vi.mocked(apiRequest).mock.calls[0][2] as string;
    expect(mdxBody).toContain('TM1SUBSETALL([}Dimensions])');
    expect(mdxBody).toContain('[}DimensionSecurity]');
  });
});

describe('dimSecurityApi.updateDimPerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('batch 2 changes → POSTs to }DimensionSecurity', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateDimPerms(cfg, 'Region', [
      { group: 'Sales', level: 'WRITE' },
      { group: 'Finance', level: 'READ' },
    ]);
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    const call0 = vi.mocked(apiRequest).mock.calls[0];
    expect(call0[0]).toBe('POST');
    expect(call0[1]).toBe("Cubes('%7DDimensionSecurity')/tm1.Update");
    const body0 = JSON.parse(call0[2] as string);
    expect(body0).toEqual({
      Cells: [{
        'Tuple@odata.bind': [
          "Dimensions('%7DDimensions')/Hierarchies('%7DDimensions')/Elements('Region')",
          "Dimensions('%7DGroups')/Hierarchies('%7DGroups')/Elements('Sales')",
        ],
      }],
      Value: 'WRITE',
    });
  });

  it('partial fail', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 204, body: '' })
      .mockResolvedValueOnce({ statusCode: 500, body: '{"error":{"message":"boom"}}' });
    const result = await updateDimPerms(cfg, 'Region', [
      { group: 'Sales', level: 'WRITE' },
      { group: 'Finance', level: 'READ' },
    ]);
    expect(result.ok).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('empty changes → no calls', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateDimPerms(cfg, 'Region', []);
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(0);
    expect(result.ok).toHaveLength(0);
  });
});

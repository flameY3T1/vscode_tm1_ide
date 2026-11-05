// src/test/security/api/cubeSecurityApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateCubePerms } from '../../../security/api/cubeSecurityApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('cubeSecurityApi.fetchAllCubePerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('parses N cubes × M groups', async () => {
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
              { Members: [{ Name: 'Cube1' }] },
              { Members: [{ Name: 'Cube2' }] },
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

    const perms = await (await import('../../../security/api/cubeSecurityApi')).fetchAllCubePerms({} as Tm1Config);
    expect(perms).toEqual({
      Cube1: { ADMIN: 'ADMIN', Sales: 'WRITE' },
      Cube2: { ADMIN: 'ADMIN', Sales: 'READ' },
    });
  });

  it('MDX uses TM1SUBSETALL([}Cubes])', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS_X' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Axes: [{Ordinal:0,Tuples:[]},{Ordinal:1,Tuples:[]}], Cells: [] }) })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });
    const { fetchAllCubePerms } = await import('../../../security/api/cubeSecurityApi');
    await fetchAllCubePerms({} as Tm1Config);
    const mdxBody = vi.mocked(apiRequest).mock.calls[0][2] as string;
    expect(mdxBody).toContain('TM1SUBSETALL([}Cubes])');
    expect(mdxBody).toContain('[}CubeSecurity]');
  });
});

describe('cubeSecurityApi.updateCubePerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('batch: 2 changes → 2 POSTs, alle ok', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateCubePerms(cfg, 'SalesCube', [
      { group: 'Sales', level: 'WRITE' },
      { group: 'Finance', level: 'READ' },
    ]);
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(2);

    const call0 = vi.mocked(apiRequest).mock.calls[0];
    expect(call0[0]).toBe('POST');
    expect(call0[1]).toBe("Cubes('%7DCubeSecurity')/tm1.Update");
    const body0 = JSON.parse(call0[2] as string);
    // `Tuple` as a plain string array is rejected by TM1 with HTTP 400
    // ("Expecting either type Object or EntityBind but was String") — every
    // coordinate must be a resource path. Live-verified on 11.8, 2026-07-26.
    expect(body0).toEqual({
      Cells: [{
        'Tuple@odata.bind': [
          "Dimensions('%7DCubes')/Hierarchies('%7DCubes')/Elements('SalesCube')",
          "Dimensions('%7DGroups')/Hierarchies('%7DGroups')/Elements('Sales')",
        ],
      }],
      Value: 'WRITE',
    });
  });

  it('partial fail: 1 ok + 1 error', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 204, body: '' })
      .mockResolvedValueOnce({ statusCode: 500, body: '{"error":{"message":"boom"}}' });
    const result = await updateCubePerms(cfg, 'SalesCube', [
      { group: 'Sales', level: 'WRITE' },
      { group: 'Finance', level: 'READ' },
    ]);
    expect(result.ok).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].group).toBe('Finance');
    expect(result.errors[0].reason).toMatch(/500|boom/);
  });

  it('empty changes → no calls', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateCubePerms(cfg, 'SalesCube', []);
    expect(result.ok).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(0);
  });
});

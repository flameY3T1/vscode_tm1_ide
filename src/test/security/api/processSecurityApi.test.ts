import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateProcessPerms } from '../../../security/api/processSecurityApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('processSecurityApi.updateProcessPerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('batch 2 changes -> 2 POSTs to }ProcessSecurity', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateProcessPerms(cfg, 'LoadSales', [
      { group: 'Sales', level: 'READ' },
      { group: 'Finance', level: 'NONE' },
    ]);
    expect(result.ok).toHaveLength(2);
    expect(result.errors).toHaveLength(0);

    const call0 = vi.mocked(apiRequest).mock.calls[0];
    expect(call0[0]).toBe('POST');
    expect(call0[1]).toBe("Cubes('%7DProcessSecurity')/tm1.Update");
    const body0 = JSON.parse(call0[2] as string);
    expect(body0).toEqual({
      Cells: [{
        'Tuple@odata.bind': [
          "Dimensions('%7DProcesses')/Hierarchies('%7DProcesses')/Elements('LoadSales')",
          "Dimensions('%7DGroups')/Hierarchies('%7DGroups')/Elements('Sales')",
        ],
      }],
      Value: 'READ',
    });
  });

  it('partial fail', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 204, body: '' })
      .mockResolvedValueOnce({ statusCode: 500, body: '{"error":{"message":"boom"}}' });
    const result = await updateProcessPerms(cfg, 'LoadSales', [
      { group: 'Sales', level: 'READ' },
      { group: 'Finance', level: 'NONE' },
    ]);
    expect(result.ok).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].group).toBe('Finance');
  });

  it('empty changes -> no calls', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateProcessPerms(cfg, 'LoadSales', []);
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(0);
    expect(result.ok).toHaveLength(0);
  });
});

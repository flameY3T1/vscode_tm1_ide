import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));
// The deep layers import the transport directly; anyone who mocks only the
// facade lets them run into the real network.
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));
vi.mock('../../tm1Client', () => ({
  apiRequest: vi.fn(),
  assertOk: (res: { statusCode: number }) => {
    if (res.statusCode < 200 || res.statusCode >= 300) { throw new Error(`HTTP ${res.statusCode}`); }
  },
}));

import { apiRequest } from '../../tm1Client';
import { listClientAliasAttributes, fetchClientAliasValues } from '../../security/api/clientAliasApi';
import { BULK_READ_CAP_MS } from '../../tm1Rest/timeouts';

const cfg = { serverUrl: 'http://tm1:12357', username: 'u', password: 'p', authType: 'basic' } as never;
const mock = vi.mocked(apiRequest);

function ok(body: unknown) {
  return { statusCode: 200, body: JSON.stringify(body) } as never;
}

describe('listClientAliasAttributes', () => {
  beforeEach(() => mock.mockReset());

  it('reads the attributes of }Clients and keeps only those of type Alias', async () => {
    mock.mockResolvedValue(ok({
      value: [
        { Name: 'Caption', Type: 'Alias' },
        { Name: 'Sortierung', Type: 'Numeric' },
        { Name: 'Klarname', Type: 'Alias' },
      ],
    }));
    expect(await listClientAliasAttributes(cfg)).toEqual(['Caption', 'Klarname']);
    const path = String(mock.mock.calls[0][1]);
    expect(path).toContain("Dimensions('%7DClients')");
    expect(path).toContain('ElementAttributes');
  });

  it('reports an empty list instead of throwing when the dimension is not readable', async () => {
    // A missing alias must not hold up the user manager.
    mock.mockResolvedValue({ statusCode: 404, body: '' } as never);
    expect(await listClientAliasAttributes(cfg)).toEqual([]);
  });

  it('reports an empty list instead of throwing when the query fails', async () => {
    mock.mockImplementationOnce(() => Promise.reject(new Error('Verbindung weg')));
    expect(await listClientAliasAttributes(cfg)).toEqual([]);
  });
});

describe('fetchClientAliasValues', () => {
  beforeEach(() => mock.mockReset());

  it('builds the map name → alias from the object form', async () => {
    mock.mockResolvedValue(ok({
      value: [
        { Name: 'CN=4711', Attributes: { Klarname: 'Anna Achterberg' } },
        { Name: 'CN=4712', Attributes: { Klarname: 'Bodo Behrens' } },
      ],
    }));
    expect(await fetchClientAliasValues(cfg, 'Klarname')).toEqual({
      'CN=4711': 'Anna Achterberg',
      'CN=4712': 'Bodo Behrens',
    });
  });

  it('also understands the array form of the attributes', async () => {
    mock.mockResolvedValue(ok({
      value: [{ Name: 'CN=4711', Attributes: [{ Name: 'Klarname', Value: 'Anna' }] }],
    }));
    expect(await fetchClientAliasValues(cfg, 'Klarname')).toEqual({ 'CN=4711': 'Anna' });
  });

  it('leaves out empty and missing values — the user then keeps their name', async () => {
    mock.mockResolvedValue(ok({
      value: [
        { Name: 'CN=4711', Attributes: { Klarname: '' } },
        { Name: 'CN=4712', Attributes: {} },
        { Name: 'CN=4713' },
        { Name: 'CN=4714', Attributes: { Klarname: 'Dora' } },
      ],
    }));
    expect(await fetchClientAliasValues(cfg, 'Klarname')).toEqual({ 'CN=4714': 'Dora' });
  });

  it('follows the nextLink', async () => {
    mock.mockResolvedValueOnce(ok({
      value: [{ Name: 'A', Attributes: { K: 'Anna' } }],
      '@odata.nextLink': 'http://tm1:12357/api/v1/Dimensions(\'%7DClients\')/Hierarchies(\'%7DClients\')/Elements?$skip=1',
    }));
    mock.mockResolvedValueOnce(ok({ value: [{ Name: 'B', Attributes: { K: 'Bodo' } }] }));
    expect(await fetchClientAliasValues(cfg, 'K')).toEqual({ A: 'Anna', B: 'Bodo' });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('stops at a nextLink to a foreign origin and shows no aliases', async () => {
    mock.mockResolvedValueOnce(ok({
      value: [{ Name: 'A', Attributes: { K: 'Anna' } }],
      '@odata.nextLink': 'http://boeser-host/api/v1/Elements?$skip=1',
    }));
    expect(await fetchClientAliasValues(cfg, 'K')).toEqual({});
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('reads every page under the short bulk-read cap, not the 3-minute paging default', async () => {
    // The user picker waits for names and aliases together; a stalled alias
    // read must not keep it closed for minutes.
    mock.mockResolvedValueOnce(ok({
      value: [{ Name: 'A', Attributes: { K: 'Anna' } }],
      '@odata.nextLink': 'http://tm1:12357/api/v1/Dimensions(\'%7DClients\')/Hierarchies(\'%7DClients\')/Elements?$skip=1',
    }));
    mock.mockResolvedValueOnce(ok({ value: [] }));
    await fetchClientAliasValues(cfg, 'K');
    expect(mock.mock.calls.map((c) => c[3])).toEqual([BULK_READ_CAP_MS, BULK_READ_CAP_MS]);
  });

  it('does not even ask when no alias is selected', async () => {
    expect(await fetchClientAliasValues(cfg, '')).toEqual({});
    expect(mock).not.toHaveBeenCalled();
  });
});

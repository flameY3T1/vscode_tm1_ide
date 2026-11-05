import { describe, it, expect, vi, beforeEach } from 'vitest';

// BOTH paths onto the same double: modules under `tm1Rest/` import the
// transport directly, because `no-tm1client-in-deep-layers` forbids them the
// facade. A test that only mocks the facade lets them run into the real
// network and ends in timeouts instead of a clear error (docs/architecture/import-rules.md).
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { fetchViewRows } from '../tm1Rest/dimensionElementsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfg = {
  serverUrl: 'https://example:1', username: 'u', password: 'p', authType: 'basic',
} as unknown as Tm1Config;

describe('fetchViewRows sends odata.metadata=none', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ Cardinality: 1, Tuples: [] }),
    });
  });

  it('sets the Accept header with metadata=none', async () => {
    await fetchViewRows('{[d].[h].Members}', cfg);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    // The header is in the SIXTH argument (method, url, body, timeout, config, headers).
    const headers = vi.mocked(apiRequest).mock.calls[0][5];
    expect(headers).toEqual({ Accept: 'application/json;odata.metadata=none' });
  });

  it('also sets it for the wide chain projection', async () => {

    await fetchViewRows('{[d].[h].Members}', cfg, { kind: 'name+element' });
    const headers = vi.mocked(apiRequest).mock.calls[0][5];
    expect(headers).toEqual({ Accept: 'application/json;odata.metadata=none' });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `tm1Rest/` modules import the transport DIRECTLY — mocking the facade
// is not enough and would let the test run into the real network (see docs/architecture/import-rules.md).
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { fetchViewRows } from '../tm1Rest/dimensionElementsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG = { serverUrl: 'https://x', username: 'u', password: 'p',
  authType: 'Basic', rejectUnauthorized: false } as unknown as Tm1Config;

const KOERPER = JSON.stringify({
  Cardinality: 1,
  Tuples: [{ Members: [{
    Name: 'e1', DisplayInfo: 0, Attributes: { Caption: 'E1', SITENAME: 'Depot' },
    Parent: null, Element: { Type: 'Numeric', Level: 0 },
  }] }],
});

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: KOERPER } as never);
});

describe('fetchViewRows passes the column request through', () => {
  it('the requested names appear in the $select of the URL', async () => {
    await fetchViewRows('{x}', CFG, { kind: 'name' }, '', ['SITENAME']);
    const url = String(vi.mocked(apiRequest).mock.calls[0]![1]);
    expect(url).toContain('Attributes/Caption,Attributes/SITENAME');
  });

  it('without a request only Caption is there — not the whole collection', async () => {
    await fetchViewRows('{x}', CFG);
    const url = String(vi.mocked(apiRequest).mock.calls[0]![1]);
    expect(url).toContain('DisplayInfo,Attributes/Caption;');
  });

  it('the values arrive on the row', async () => {
    const { rows } = await fetchViewRows('{x}', CFG, { kind: 'name' }, '', ['SITENAME']);
    expect(rows[0]!.attrs).toEqual({ SITENAME: 'Depot' });
  });
});

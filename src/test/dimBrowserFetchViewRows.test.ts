import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Put both paths on the same doubles: modules under `tm1Rest/` import
 * the transport directly, because `no-tm1client-in-deep-layers` forbids them the
 * facade. A test that only mocks the facade runs into the real network.
 * (The brief names only `apiRequest` in the mock — `assertOk` is missing there and the
 * import in `dimensionElementsApi.ts` would otherwise fail.)
 */
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { fetchViewRows } from '../tm1Rest/dimensionElementsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG = { serverUrl: 'https://x', username: 'u', password: 'p', authType: 'basic' } as unknown as Tm1Config;

beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

describe('fetchViewRows', () => {
  // The title describes the MAPPING (POST body → rows), not claimed
  // server behaviour. `Attributes.Caption` in the fixture: shape UNVERIFIED,
  // see design (task-5-brief.md) — all that is proven here is that a set
  // `Attributes.Caption` is mapped to `caption`, not that the server
  // actually fills it that way under real alias attributes.
  it('sends the expression as the POST body and maps the answer to rows', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        Cardinality: 10,
        Tuples: [{ Members: [{
          Name: 'a',
          UniqueName: '[aa].[aa].[a]',
          DisplayInfo: 0x10000,
          Attributes: { Caption: 'A' },
          Parent: { Name: 'sum' },
          Element: { Type: 'Numeric', Level: 0 },
        }] }],
      }),
    });

    const result = await fetchViewRows('{[aa].[aa].Members}', CFG);

    expect(result).toEqual({
      cardinality: 10,
      rows: [{
        name: 'a',
        caption: 'A',
        type: 'N',
        level: 0,
        parent: 'sum',
        drilled: true,
        // The fixture `Parent` carries no `Element` (default request 'name') —
        // type/level therefore fall back to 'N'/0.
        ancestors: [{ name: 'sum', type: 'N', level: 0 }],
      }],
    });

    // The body is a finished MDX string — not a chunked POST, otherwise HTTP 400.
    // `odata.metadata=none`: see the comment in `dimensionElementsApi.ts#fetchViewRows`.
    expect(apiRequest).toHaveBeenCalledWith(
      'POST',
      expect.stringContaining('ExecuteMDXSetExpression'),
      JSON.stringify({ MDX: '{[aa].[aa].Members}' }),
      expect.any(Number),
      CFG,
      { Accept: 'application/json;odata.metadata=none' },
    );
  });

  it('throws with the server message on an error status', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 400,
      body: JSON.stringify({ error: { message: 'Formula error: unexpected token' } }),
    });

    await expect(fetchViewRows('{bad mdx}', CFG)).rejects.toThrow('Formula error: unexpected token');
  });

  it('falls back to HTTP <status> when the error body is not an OData error', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 500, body: '' });

    await expect(fetchViewRows('{[aa].[aa].Members}', CFG)).rejects.toThrow('HTTP 500');
  });

  it('encodes a missing `Cardinality` as -1, not as 0 ("empty set")', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ Tuples: [] }),
    });

    const result = await fetchViewRows('{[aa].[aa].Members}', CFG);

    expect(result.cardinality).toBe(-1);
    expect(result.rows).toEqual([]);
  });
});

// src/test/security/api/mdxCellset.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeMdxCellset, cubeExists, SecurityCubeMissingError, SECURITY_CELLSET_EXPAND } from '../../../security/api/mdxCellset';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('mdxCellset.executeMdxCellset', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('POSTs ExecuteMDX, GETs cellset with default expand, returns parsed body, DELETEs in finally', async () => {
    const cellset = {
      Axes: [
        { Ordinal: 0, Tuples: [{ Members: [{ Name: 'ADMIN' }] }] },
        { Ordinal: 1, Tuples: [{ Members: [{ Name: 'Region' }] }] },
      ],
      Cells: [{ Ordinal: 0, Value: 'ADMIN' }],
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS1' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(cellset) })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    const body = await executeMdxCellset(cfg, 'SELECT ...', 'fetchThing');
    expect(body).toEqual(cellset);

    const calls = vi.mocked(apiRequest).mock.calls;
    // POST ExecuteMDX
    expect(calls[0][0]).toBe('POST');
    expect(calls[0][1]).toBe('ExecuteMDX');
    expect(JSON.parse(calls[0][2] as string)).toEqual({ MDX: 'SELECT ...' });
    // GET cellset with default expand
    expect(calls[1][0]).toBe('GET');
    expect(calls[1][1]).toBe(`Cellsets('CS1')?${SECURITY_CELLSET_EXPAND}`);
    // DELETE cleanup in finally
    expect(calls[2][0]).toBe('DELETE');
    expect(calls[2][1]).toBe("Cellsets('CS1')");
  });

  it('uses a caller-supplied expand when provided', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS2' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Axes: [], Cells: [] }) })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    await executeMdxCellset(cfg, 'MDX', 'lbl', '$expand=Cells');
    expect(vi.mocked(apiRequest).mock.calls[1][1]).toBe("Cellsets('CS2')?$expand=Cells");
  });

  it('non-201 POST throws label-prefixed OData error message', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"bad mdx"}}' });
    await expect(executeMdxCellset(cfg, 'MDX', 'fetchThing')).rejects.toThrow('fetchThing: bad mdx');
  });

  it('missing cellset id throws', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({}) });
    await expect(executeMdxCellset(cfg, 'MDX', 'fetchThing')).rejects.toThrow('fetchThing: cellset id missing');
  });

  it('DELETE cleanup still runs when the cellset GET fails', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS3' }) })
      .mockResolvedValueOnce({ statusCode: 500, body: 'boom' })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    await expect(executeMdxCellset(cfg, 'MDX', 'fetchThing')).rejects.toThrow();
    const calls = vi.mocked(apiRequest).mock.calls;
    expect(calls[2][0]).toBe('DELETE');
    expect(calls[2][1]).toBe("Cellsets('CS3')");
  });

  // A missing security control cube is the most common reason these queries
  // fail, and TM1 only reports it as an MDX parse error ("Syntax error at or
  // near '[}DimensionSecurity]'"). The probe turns that into a typed error.
  it('probeCube + cube gone (404) → SecurityCubeMissingError, not the raw MDX error', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"Syntax error at or near: \'[}DimensionSecurity]\'"}}' })
      .mockResolvedValueOnce({ statusCode: 404, body: '{"error":{"message":"not found"}}' });

    const err = await executeMdxCellset(cfg, 'MDX', 'fetchAllDimPerms', undefined, '}DimensionSecurity')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SecurityCubeMissingError);
    expect((err as SecurityCubeMissingError).cubeName).toBe('}DimensionSecurity');
    expect(vi.mocked(apiRequest).mock.calls[1][1]).toBe("Cubes('%7DDimensionSecurity')?$select=Name");
  });

  it('probeCube + cube present → raw MDX error survives (the query itself was bad)', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"bad mdx"}}' })
      .mockResolvedValueOnce({ statusCode: 200, body: '{"Name":"}DimensionSecurity"}' });

    await expect(executeMdxCellset(cfg, 'MDX', 'fetchAllDimPerms', undefined, '}DimensionSecurity'))
      .rejects.toThrow('fetchAllDimPerms: bad mdx');
  });

  it('probeCube inconclusive (probe itself fails) → raw MDX error, never a false "missing"', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"bad mdx"}}' })
      .mockResolvedValueOnce({ statusCode: 503, body: 'server busy' });

    await expect(executeMdxCellset(cfg, 'MDX', 'fetchAllDimPerms', undefined, '}DimensionSecurity'))
      .rejects.toThrow('fetchAllDimPerms: bad mdx');
  });

  it('no probeCube → no extra request', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"bad mdx"}}' });
    await expect(executeMdxCellset(cfg, 'MDX', 'fetchThing')).rejects.toThrow('fetchThing: bad mdx');
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(1);
  });
});

describe('mdxCellset.cubeExists', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('200 → true, 404 → false, anything else throws (a 401/503 is not "not there")', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    await expect(cubeExists(cfg, '}DimensionSecurity')).resolves.toBe(true);
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 404, body: '' });
    await expect(cubeExists(cfg, '}DimensionSecurity')).resolves.toBe(false);
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 401, body: 'nope' });
    await expect(cubeExists(cfg, '}DimensionSecurity')).rejects.toThrow(/401/);
  });

  it('encodes the key exactly once', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    await cubeExists(cfg, "}Element Security_A/B'C");
    expect(vi.mocked(apiRequest).mock.calls[0][1])
      .toBe("Cubes('%7DElement%20Security_A%2FB''C')?$select=Name");
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchElementPerms, updateElementPerms, createElementSecurityCube, cubeExists } from '../../../security/api/elementSecurityApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('elementSecurityApi.fetchElementPerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('parses N rows x M groups → nested Record<element, Record<group, level>>', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS1' }) })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          Axes: [
            { Ordinal: 0, Tuples: [
              { Members: [{ Name: 'ADMIN' }] },
              { Members: [{ Name: 'Sales' }] },
            ]},
            { Ordinal: 1, Tuples: [
              { Members: [{ Name: 'Europe' }] },
              { Members: [{ Name: 'Americas' }] },
            ]},
          ],
          Cells: [
            { Ordinal: 0, Value: 'WRITE' },
            { Ordinal: 1, Value: 'READ' },
            { Ordinal: 2, Value: 'WRITE' },
            { Ordinal: 3, Value: 'NONE' },
          ],
        }),
      })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    const perms = await fetchElementPerms(cfg, 'Region');
    expect(perms).toEqual({
      Europe: { ADMIN: 'WRITE', Sales: 'READ' },
      Americas: { ADMIN: 'WRITE', Sales: 'NONE' },
    });
  });

  it('empty Value → NONE', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS2' }) })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          Axes: [
            { Ordinal: 0, Tuples: [{ Members: [{ Name: 'Sales' }] }] },
            { Ordinal: 1, Tuples: [{ Members: [{ Name: 'Europe' }] }] },
          ],
          Cells: [{ Ordinal: 0, Value: '' }],
        }),
      })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    const perms = await fetchElementPerms(cfg, 'Region');
    expect(perms.Europe.Sales).toBe('NONE');
  });

  it('MDX uses [}ElementSecurity_<dim>] + escape dim AND elements via [<dim>] member axis', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ ID: 'CS3' }) })
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          Axes: [
            { Ordinal: 0, Tuples: [{ Members: [{ Name: 'Sales' }] }] },
            { Ordinal: 1, Tuples: [{ Members: [{ Name: 'Europe' }] }] },
          ],
          Cells: [{ Ordinal: 0, Value: 'READ' }],
        }),
      })
      .mockResolvedValueOnce({ statusCode: 204, body: '' });

    await fetchElementPerms(cfg, 'odd]dim');
    const mdxCall = vi.mocked(apiRequest).mock.calls[0];
    const body = mdxCall[2] as string;
    expect(body).toContain('[}ElementSecurity_odd]]dim]');
    expect(body).toContain('[odd]]dim]');
  });

  it('ExecuteMDX 4xx throws', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"bad mdx"}}' });
    await expect(fetchElementPerms(cfg, 'Region')).rejects.toThrow(/bad mdx/);
  });
});

describe('elementSecurityApi.updateElementPerms', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('batch 3 changes → 3 POSTs to }ElementSecurity_<dim>', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await updateElementPerms(cfg, 'Region', [
      { element: 'Europe', group: 'Sales', level: 'WRITE' },
      { element: 'Europe', group: 'Finance', level: 'READ' },
      { element: 'Americas', group: 'Sales', level: 'NONE' },
    ]);
    expect(result.ok).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    const call0 = vi.mocked(apiRequest).mock.calls[0];
    expect(call0[0]).toBe('POST');
    expect(call0[1]).toBe("Cubes('%7DElementSecurity_Region')/tm1.Update");
    const body0 = JSON.parse(call0[2] as string);
    expect(body0).toEqual({
      Cells: [{
        'Tuple@odata.bind': [
          "Dimensions('Region')/Hierarchies('Region')/Elements('Europe')",
          "Dimensions('%7DGroups')/Hierarchies('%7DGroups')/Elements('Sales')",
        ],
      }],
      Value: 'WRITE',
    });
  });

  it('URL-encode dim name with reserved chars', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await updateElementPerms(cfg, 'odd dim', [
      { element: 'A', group: 'B', level: 'READ' },
    ]);
    const call0 = vi.mocked(apiRequest).mock.calls[0];
    expect(call0[1]).toBe("Cubes('%7DElementSecurity_odd%20dim')/tm1.Update");
  });

  it('pre-encoded %7D prefix stays raw while the dim part is encoded (no %257D)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await updateElementPerms(cfg, "A/B#C?D'E F", [
      { element: 'A', group: 'B', level: 'READ' },
    ]);
    const url = vi.mocked(apiRequest).mock.calls[0][1] as string;
    expect(url).toBe("Cubes('%7DElementSecurity_A%2FB%23C%3FD''E%20F')/tm1.Update");
    expect(url).not.toContain('%257D');
  });

  it('partial fail', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 204, body: '' })
      .mockResolvedValueOnce({ statusCode: 500, body: '{"error":{"message":"boom"}}' });
    const result = await updateElementPerms(cfg, 'Region', [
      { element: 'Europe', group: 'Sales', level: 'WRITE' },
      { element: 'Americas', group: 'Sales', level: 'READ' },
    ]);
    expect(result.ok).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].element).toBe('Americas');
    expect(result.errors[0].group).toBe('Sales');
  });

  it('empty changes → no calls', async () => {
    const result = await updateElementPerms(cfg, 'Region', []);
    expect(vi.mocked(apiRequest).mock.calls).toHaveLength(0);
    expect(result.ok).toHaveLength(0);
  });
});

describe('elementSecurityApi.cubeExists', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  const urlOf = () => vi.mocked(apiRequest).mock.calls[0][1] as string;

  it('200 → true, 404 → false, other → throw', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    await expect(cubeExists(cfg, '}ElementSecurity_Region')).resolves.toBe(true);
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 404, body: '' });
    await expect(cubeExists(cfg, '}ElementSecurity_Region')).resolves.toBe(false);
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 500, body: 'boom' });
    await expect(cubeExists(cfg, '}ElementSecurity_Region')).rejects.toThrow(/500/);
  });

  it('encodes the raw `}` control-cube name exactly once (no %257D)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    // Callers (elementSecurity.ts, registerSecurityCommands.ts) pass the RAW
    // name — never a pre-encoded `%7D…` literal. So one encode pass is correct.
    await cubeExists(cfg, '}ElementSecurity_Region');
    expect(urlOf()).toBe("Cubes('%7DElementSecurity_Region')?$select=Name");
    expect(urlOf()).not.toContain('%257D');
  });

  it('percent-encodes path-breaking chars in the URL key', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    await cubeExists(cfg, "}ElementSecurity_A/B#C?D'E F");
    expect(urlOf()).toBe("Cubes('%7DElementSecurity_A%2FB%23C%3FD''E%20F')?$select=Name");
    expect(urlOf()).not.toContain('%257D');
  });
});

describe('elementSecurityApi.createElementSecurityCube', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  const bodyOf = () => JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string);

  it('plain dim name → bind path + raw Name', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 201, body: '{}' });
    await createElementSecurityCube(cfg, 'Region');
    expect(bodyOf()).toEqual({
      Name: '}ElementSecurity_Region',
      'Dimensions@odata.bind': ["Dimensions('Region')", "Dimensions('%7DGroups')"],
    });
  });

  it('URL-encodes reserved chars and does NOT double-encode }Groups', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 201, body: '{}' });
    const dim = "A/B#C?D'E F";
    await createElementSecurityCube(cfg, dim);
    const body = bodyOf();
    expect(body['Dimensions@odata.bind']).toEqual([
      "Dimensions('A%2FB%23C%3FD''E%20F')",
      "Dimensions('%7DGroups')",
    ]);
    // Guard: the pre-encoded }Groups literal must stay %7D, never %257D
    expect(body['Dimensions@odata.bind'][1]).not.toContain('%257D');
    // Name is a property value, not a resource path → raw
    expect(body.Name).toBe(`}ElementSecurity_${dim}`);
  });
});

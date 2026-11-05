import { describe, it, expect, vi, beforeEach } from 'vitest';

// `defaultMemberApi` imports the transport directly from `tm1Rest/client`
// (rule `no-tm1client-in-deep-layers`), `dimensionElementsApi` likewise. Mocking only the
// facade would let the other path run into the real network — both paths
// point to the same doubles.
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));

import { apiRequest } from '../tm1Rest/client';
import { readDefaultMembers } from '../tm1Rest/defaultMemberApi';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const CFG = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' } as never;

beforeEach(() => { mockApi.mockReset(); });

/** Answer to the collective MDX over `}HierarchyProperties`. */
function mockExplicit(values: string[]): void {
  mockApi.mockResolvedValueOnce({
    statusCode: 201,
    body: JSON.stringify({ Cells: values.map((v, i) => ({ Ordinal: i, Value: v })) }),
  });
}

describe('readDefaultMembers', () => {
  it('separates set from effective', async () => {
    mockExplicit(['', 'A']);
    // one GET .../DefaultMember per hierarchy
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Name: 'Top' }) });
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Name: 'A' }) });

    const states = await readDefaultMembers('D', ['D', 'alt'], CFG);

    expect(states).toEqual([
      { hierarchy: 'D', effective: 'Top', explicit: '' },
      { hierarchy: 'alt', effective: 'A', explicit: 'A' },
    ]);
  });

  it('builds the collective MDX with a bare token for the hierarchy of the same name', async () => {
    mockExplicit(['', '']);
    mockApi.mockResolvedValue({ statusCode: 204, body: '' });

    await readDefaultMembers('D', ['D', 'alt'], CFG);

    const mdx = JSON.parse(mockApi.mock.calls[0][2] as string).MDX as string;
    expect(mdx).toContain('[}Dimensions].[D]');
    expect(mdx).toContain('[}Dimensions].[D:alt]');
  });

  it('reports 204 for the effective value as null, not as an error', async () => {
    mockExplicit(['']);
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' });

    const states = await readDefaultMembers('D', ['D'], CFG);

    expect(states[0].effective).toBeNull();
  });

  it('falls back to empty explicit values on an error in the collective MDX, instead of throwing', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"code":"501"}}' });
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Name: 'Top' }) });

    const states = await readDefaultMembers('D', ['D'], CFG);

    expect(states).toEqual([{ hierarchy: 'D', effective: 'Top', explicit: '' }]);
  });

  it('deletes the cellset that the collective MDX creates', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 201,
      body: JSON.stringify({ ID: 'cs-9', Cells: [{ Ordinal: 0, Value: '' }] }),
    });
    mockApi.mockResolvedValue({ statusCode: 204, body: '' });

    await readDefaultMembers('D', ['D'], CFG);

    expect(mockApi.mock.calls.map(c => `${c[0]} ${c[1]}`)).toContain("DELETE Cellsets('cs-9')");
  });

  it('answers an empty hierarchy list with an empty list, without network traffic', async () => {
    expect(await readDefaultMembers('D', [], CFG)).toEqual([]);
    expect(mockApi).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listGroups, createGroup, deleteGroup } from '../../../security/api/groupsApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;

describe('groupsApi', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('listGroups maps Name + IsSystem + UserCount', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        value: [
          { Name: 'ADMIN', Users: [{}, {}] },
          { Name: 'Sales', Users: [{}] },
        ],
      }),
    });
    const groups = await listGroups(cfg);
    expect(groups).toEqual([
      { name: 'ADMIN', isSystem: true, memberCount: 2 },
      { name: 'Sales', isSystem: false, memberCount: 1 },
    ]);
  });

  it('listGroups detects }-prefixed system groups (e.g. }tp_*)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        value: [
          { Name: '}tp_Everyone', Users: [] },
          { Name: 'Marketing', Users: [{}, {}, {}] },
        ],
      }),
    });
    const groups = await listGroups(cfg);
    expect(groups).toEqual([
      { name: '}tp_Everyone', isSystem: true, memberCount: 0 },
      { name: 'Marketing', isSystem: false, memberCount: 3 },
    ]);
  });

  it('listGroups uses $select=Name without IsSystemEntity (TM1 11.x compat)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [] }),
    });
    await listGroups(cfg);
    const url = vi.mocked(apiRequest).mock.calls[0][1] as string;
    expect(url).not.toMatch(/IsSystemEntity/);
    expect(url).toContain('$select=Name');
  });

  it('createGroup POST Name', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await createGroup(cfg, 'NewGroup');
    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call[0]).toBe('POST');
    expect(call[1]).toBe('Groups');
    expect(JSON.parse(call[2] as string)).toEqual({ Name: 'NewGroup' });
  });

  it('deleteGroup DELETE', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await deleteGroup(cfg, 'Sales');
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe('DELETE');
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("Groups('Sales')");
  });

  it('deleteGroup percent-encodes path-breaking chars in the URL key', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await deleteGroup(cfg, "A/B#C?D'E F");
    const url = vi.mocked(apiRequest).mock.calls[0][1] as string;
    // `/` and `#` are the real defect: WHATWG `new URL()` never repairs them
    // (`/` opens a new path segment, `#` truncates as a fragment).
    expect(url).toBe("Groups('A%2FB%23C%3FD''E%20F')");
  });

  it('deleteGroup encodes a }-group exactly once (no %257D)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await deleteGroup(cfg, '}tp_Everyone');
    const url = vi.mocked(apiRequest).mock.calls[0][1] as string;
    expect(url).toBe("Groups('%7Dtp_Everyone')");
    expect(url).not.toContain('%257D');
  });

  it('error → throws', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 500, body: '{"error":{"message":"boom"}}' });
    await expect(listGroups(cfg)).rejects.toThrow(/500|boom/);
  });
});

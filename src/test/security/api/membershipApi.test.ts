import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getUserGroups, setUserGroups,
} from '../../../security/api/membershipApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;
const noContent = { statusCode: 204, body: '' };

describe('membershipApi', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('getUserGroups GET Users(x)/Groups', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Name: 'Sales' }, { Name: 'Finance' }] }),
    });
    const groups = await getUserGroups(cfg, 'sales01');
    expect(groups).toEqual(['Sales','Finance']);
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("Users('sales01')/Groups?$select=Name");
  });

  it('setUserGroups PATCH Users(x) with Groups@odata.bind (full set)', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await setUserGroups(cfg, 'sales01', ['Sales', 'Finance']);
    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call[0]).toBe('PATCH');
    expect(call[1]).toBe("Users('sales01')");
    expect(JSON.parse(call[2] as string)).toEqual({ 'Groups@odata.bind': ["Groups('Sales')", "Groups('Finance')"] });
    expect(call[5]).toBeUndefined();
  });

  it('setUserGroups with empty list clears all groups', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await setUserGroups(cfg, 'sales01', []);
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string)).toEqual({ 'Groups@odata.bind': [] });
  });

  it('setUserGroups: Groups@odata.bind percent-encodes every entry', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await setUserGroups(cfg, 'sales01', ['A/B', 'C D', "o'brien", '}tp_Admin']);
    const body = vi.mocked(apiRequest).mock.calls[0][2] as string;
    expect(JSON.parse(body)['Groups@odata.bind']).toEqual([
      "Groups('A%2FB')", "Groups('C%20D')", "Groups('o''brien')", "Groups('%7Dtp_Admin')",
    ]);
    expect(body).not.toContain('%257D');
  });

  it('getUserGroups encodes the user key without touching the $select query', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ value: [] }) });
    await getUserGroups(cfg, 'a/b');
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("Users('a%2Fb')/Groups?$select=Name");
  });
});

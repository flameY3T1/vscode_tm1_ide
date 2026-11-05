// src/test/security/api/usersApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listUsers, createUser, deleteUser, setPassword,
} from '../../../security/api/usersApi';
import type { Tm1Config } from '../../../tm1Rest/transport/types';

vi.mock('../../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../tm1Rest/client';

const cfg = {} as Tm1Config;
const ok = (body: string) => ({ statusCode: 200, body });
const noContent = { statusCode: 204, body: '' };

describe('usersApi', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('listUsers parses payload', async () => {
    vi.mocked(apiRequest).mockResolvedValue(ok(JSON.stringify({
      value: [
        { Name: 'admin', Type: 'Admin', IsActive: true, Groups: [{ Name: 'ADMIN' }] },
        { Name: 'sales', Type: 'User', IsActive: false, Groups: [] },
      ],
    })));
    const users = await listUsers(cfg);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ name: 'admin', type: 'Admin', disabled: false, groups: ['ADMIN'] });
    expect(users[1].disabled).toBe(true);
  });

  it('createUser POSTs JSON body', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await createUser(cfg, { name: 'newuser', type: 'User', password: 'secret-pw', groups: ['Sales'] });
    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call[0]).toBe('POST');
    expect(call[1]).toBe('Users');
    const body = JSON.parse(call[2] as string);
    expect(body.Name).toBe('newuser');
    expect(body.Type).toBe('User');
    expect(body.Password).toBe('secret-pw');
    expect(body['Groups@odata.bind']).toEqual(["Groups('Sales')"]);
  });

  it('createUser without groups → no Groups@odata.bind', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await createUser(cfg, { name: 'u', type: 'User', password: 'longenough', groups: [] });
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string);
    expect(body['Groups@odata.bind']).toBeUndefined();
  });

  it('createUser → 409 throws', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 409, body: '{"error":{"message":"exists"}}' });
    await expect(createUser(cfg, { name: 'u', type: 'User', password: 'longenough', groups: [] }))
      .rejects.toThrow(/409|exists/);
  });

  it('setPassword PATCHes only Password', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await setPassword(cfg, 'sales', 'new-secret');
    const call = vi.mocked(apiRequest).mock.calls[0];
    expect(call[0]).toBe('PATCH');
    expect(call[1]).toBe("Users('sales')");
    expect(JSON.parse(call[2] as string)).toEqual({ Password: 'new-secret' });
  });

  it('deleteUser DELETE', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await deleteUser(cfg, 'sales');
    expect(vi.mocked(apiRequest).mock.calls[0][0]).toBe('DELETE');
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("Users('sales')");
  });

  it('OData-Key-Escape: single-quote → doppelt', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await deleteUser(cfg, "o'brien");
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("Users('o''brien')");
  });

  // `Groups@odata.bind` values are RESOURCE PATHS, not OData literals — they need
  // quote-doubling AND percent-encoding, else a `/` in the group name splits the
  // path segment and TM1 resolves the wrong (or no) group.
  it('createUser: Groups@odata.bind percent-encodes path-breaking chars', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await createUser(cfg, { name: 'u', type: 'User', password: 'longenough', groups: ['A/B', 'C D', "o'brien"] });
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string);
    expect(body['Groups@odata.bind']).toEqual([
      "Groups('A%2FB')", "Groups('C%20D')", "Groups('o''brien')",
    ]);
  });

  it('createUser: system group `}` encoded exactly once (no %257D)', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await createUser(cfg, { name: 'u', type: 'User', password: 'longenough', groups: ['}tp_Admin'] });
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string);
    expect(body['Groups@odata.bind']).toEqual(["Groups('%7Dtp_Admin')"]);
    expect(JSON.stringify(body)).not.toContain('%257D');
  });

  it('URL keys percent-encode too (deleteUser / setPassword)', async () => {
    vi.mocked(apiRequest).mockResolvedValue(noContent);
    await deleteUser(cfg, 'a/b');
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe("Users('a%2Fb')");
    await setPassword(cfg, '}tp_svc', 'new-secret');
    expect(vi.mocked(apiRequest).mock.calls[1][1]).toBe("Users('%7Dtp_svc')");
    expect(vi.mocked(apiRequest).mock.calls[1][1]).not.toContain('%257D');
  });
});

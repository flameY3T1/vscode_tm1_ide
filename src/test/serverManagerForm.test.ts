import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as vscode from 'vscode';

// serverManager imports apiRequest/setConfigOverride/closeSession from '../tm1Client'
// and _clearAuthFailed from '../tm1Rest/transport/session' — mock both.
vi.mock('../tm1Client', () => ({
  apiRequest: vi.fn(),
  setConfigOverride: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/transport/session', () => ({
  _clearAuthFailed: vi.fn(),
}));
vi.mock('../commands/serverManager/browserConnect', async (orig) => ({
  ...(await orig<typeof import('../commands/serverManager/browserConnect')>()),
  removeBrowserProfile: vi.fn().mockResolvedValue(undefined),
}));

import { apiRequest } from '../tm1Client';
import { removeBrowserProfile } from '../commands/serverManager/browserConnect';
import {
  testServerConnection,
  saveServerFromForm,
  getServerFormData,
  withStoredPassword,
  deleteServer,
  getAllServers,
  saveServers,
  isConnected,
  type ServerFormData,
} from '../commands/serverManager';

const FORM: ServerFormData = {
  name: 'Prod',
  serverUrl: 'https://localhost:8010',
  username: 'admin',
  password: 'secret',
  authType: 'Basic',
  camNamespace: undefined,
  rejectUnauthorized: false,
};

function makeCtx() {
  const gs = new Map<string, unknown>();
  const sec = new Map<string, string>();
  return {
    globalState: {
      get: (k: string) => gs.get(k),
      update: (k: string, v: unknown) => { gs.set(k, v); return Promise.resolve(); },
    },
    secrets: {
      get: (k: string) => Promise.resolve(sec.get(k)),
      store: (k: string, v: string) => { sec.set(k, v); return Promise.resolve(); },
      delete: (k: string) => { sec.delete(k); return Promise.resolve(); },
    },
    _gs: gs,
    _sec: sec,
  } as unknown as vscode.ExtensionContext & { _gs: Map<string, unknown>; _sec: Map<string, string> };
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});

describe('testServerConnection', () => {
  it('returns ok + version on HTTP 200', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{"ProductVersion":"11.8.00000.123"}' });
    const r = await testServerConnection(FORM);
    expect(r).toEqual({ ok: true, version: '11.8.00000.123' });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe('Configuration?$select=ProductVersion');
  });

  it('validates the URL before the request', async () => {
    const r = await testServerConnection({ ...FORM, serverUrl: '' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/empty/i);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('maps 401 to a login error', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 401, body: '' });
    const r = await testServerConnection(FORM);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Login failed/i);
  });

  it('maps network errors (ENOTFOUND) to plain text', async () => {
    vi.mocked(apiRequest).mockRejectedValue(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }));
    const r = await testServerConnection(FORM);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/unreachable|resolved/i);
  });

  it('maps any other non-2xx to the HTTP status', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 500, body: '{"error":{"message":"boom"}}' });
    const r = await testServerConnection(FORM);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('HTTP 500');
    expect(r.message).toContain('boom');
  });
});

describe('saveServerFromForm', () => {
  it('creates a new profile, stores the password and connects', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const r = await saveServerFromForm(ctx, FORM);
    expect(r.connectError).toBeUndefined();
    const servers = getAllServers(ctx);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'Prod', serverUrl: 'https://localhost:8010', username: 'admin' });
    // Password not in the profile but in SecretStorage
    expect((servers[0] as unknown as Record<string, unknown>).password).toBeUndefined();
    expect((ctx as unknown as { _sec: Map<string, string> })._sec.get(`tm1.pw.${servers[0].id}`)).toBe('secret');
    expect(isConnected(servers[0].id)).toBe(true);
  });

  it('persists the profile even when the connect fails', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 401, body: '' });
    const ctx = makeCtx();
    const r = await saveServerFromForm(ctx, FORM);
    expect(r.connectError).toBeTruthy();
    expect(getAllServers(ctx)).toHaveLength(1);
  });

  it('persists nothing for an invalid URL (no profile, no secret)', async () => {
    const ctx = makeCtx();
    const r = await saveServerFromForm(ctx, { ...FORM, serverUrl: 'not a url' });
    expect(r.urlError).toBeTruthy();
    expect(r.profile).toBeUndefined();
    expect(getAllServers(ctx)).toHaveLength(0);
    expect((ctx as unknown as { _sec: Map<string, string> })._sec.size).toBe(0);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('normalises the URL on save (https:// added, trailing slash removed)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const r = await saveServerFromForm(ctx, { ...FORM, serverUrl: 'localhost:8010/' });
    expect(r.urlError).toBeUndefined();
    expect(r.profile?.serverUrl).toBe('https://localhost:8010');
  });

  it('replaces the existing profile with existingId (edit)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const first = await saveServerFromForm(ctx, FORM);
    const id = first.profile!.id;
    const updated = await saveServerFromForm(ctx, { ...FORM, name: 'Prod-2', username: 'svc' }, id);
    expect(updated.profile!.id).toBe(id);
    const servers = getAllServers(ctx);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'Prod-2', username: 'svc' });
  });

  it('keeps folder assignment + Git on rename (edit)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const first = await saveServerFromForm(ctx, FORM);
    const id = first.profile!.id;
    // Folder + Git are set via other commands, not via the form.
    const seeded = getAllServers(ctx).map(s =>
      s.id === id
        ? { ...s, folder: 'Prod-Ordner', git: { enabled: true, repoPath: '/tmp/r', parallelFetch: 4 } }
        : s,
    );
    await saveServers(ctx, seeded);
    // A rename via the form must not lose folder/git.
    await saveServerFromForm(ctx, { ...FORM, name: 'Prod-Renamed' }, id);
    const after = getAllServers(ctx).find(s => s.id === id);
    expect(after?.name).toBe('Prod-Renamed');
    expect(after?.folder).toBe('Prod-Ordner');
    expect(after?.git).toMatchObject({ enabled: true, repoPath: '/tmp/r' });
  });
});

describe('deleteServer', () => {
  it('disconnects, removes profile and password, returns the name', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const { profile } = await saveServerFromForm(ctx, FORM);
    expect(isConnected(profile!.id)).toBe(true);
    const name = await deleteServer(ctx, profile!.id);
    expect(name).toBe('Prod');
    expect(getAllServers(ctx)).toHaveLength(0);
    expect(isConnected(profile!.id)).toBe(false);
    expect((ctx as unknown as { _sec: Map<string, string> })._sec.has(`tm1.pw.${profile!.id}`)).toBe(false);
  });

  it('returns undefined for an unknown serverId', async () => {
    const ctx = makeCtx();
    expect(await deleteServer(ctx, 'nope')).toBeUndefined();
  });

  // `Workbench.serverId` IS the profile ID: without deleting them along with it,
  // the saved workbenches stayed in `globalState` permanently and invisibly
  // after the profile was removed (review 2026-08-24, H4). Silently — like the
  // password in SecretStorage, which also goes along without comment.
  it('silently deletes the profile workbenches along with it', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const { profile } = await saveServerFromForm(ctx, FORM);
    const fremd = { id: 'w2', serverId: 'anderer', name: 'B', savedAt: 2, windows: [] };
    await ctx.globalState.update('tm1.workbenches.v1', [
      { id: 'w1', serverId: profile!.id, name: 'A', savedAt: 1, windows: [] },
      fremd,
    ]);
    await deleteServer(ctx, profile!.id);
    expect(ctx.globalState.get('tm1.workbenches.v1')).toEqual([fremd]);
  });

  // The browser profile (IdP session on disk) belongs to the host: it goes
  // with the last browser-login profile on that origin, not before.
  it('removes the browser profile only with the last browser server on the host', async () => {
    const ctx = makeCtx();
    const browser = (id: string, url: string) => ({ id, name: id, serverUrl: url, username: '', authType: 'browser' }) as never;
    await saveServers(ctx, [
      browser('a', 'https://eu.example.com/tm1/db1'),
      browser('b', 'https://eu.example.com/tm1/db2'),
    ]);
    await deleteServer(ctx, 'a');
    expect(removeBrowserProfile).not.toHaveBeenCalled();
    await deleteServer(ctx, 'b');
    expect(removeBrowserProfile).toHaveBeenCalledWith('https://eu.example.com/tm1/db2');
  });

  it('an unknown serverId does not touch the workbenches', async () => {
    const ctx = makeCtx();
    const alle = [{ id: 'w1', serverId: 'x', name: 'A', savedAt: 1, windows: [] }];
    await ctx.globalState.update('tm1.workbenches.v1', alle);
    await deleteServer(ctx, 'nope');
    expect(ctx.globalState.get('tm1.workbenches.v1')).toEqual(alle);
  });

  // Until 2026-08-29 `deleteServer` only cleaned up workbenches and attribute
  // columns; linter rules, format rules, MDX history, alias choice and
  // remembered parameters were left behind, unreachable. Now everything goes
  // through the table in `stateKeys.ts`.
  it('also cleans up linter rules, MDX history, alias and remembered parameters', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const { profile } = await saveServerFromForm(ctx, FORM);
    const url = FORM.serverUrl;
    await ctx.globalState.update('tm1.lintConfig', { [url]: { rules: {} } });
    await ctx.globalState.update('tm1.mdx.history', { [url]: [{ mdx: 'SELECT' }] });
    await ctx.globalState.update('tm1.security.userAliasByServer', { [profile!.id]: 'Name' });
    await ctx.globalState.update(
      'tm1.dimBrowser.attrColumns.v1',
      { [`${encodeURIComponent(profile!.id)}::Region`]: { cols: ['a'], widths: {} } },
    );

    await deleteServer(ctx, profile!.id);

    expect(ctx.globalState.get('tm1.lintConfig')).toEqual({});
    expect(ctx.globalState.get('tm1.mdx.history')).toEqual({});
    expect(ctx.globalState.get('tm1.security.userAliasByServer')).toEqual({});
    expect(ctx.globalState.get('tm1.dimBrowser.attrColumns.v1')).toEqual({});
  });

  // Two profiles may point at the same instance with different users
  // (`_sessionCacheKey` carries user and auth type). The url-keyed stores
  // then still belong to the remaining profile.
  it('leaves url-keyed stores in place when a profile keeps the same URL', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const a = await saveServerFromForm(ctx, { ...FORM, name: 'Prod (admin)' }, 'srv-admin');
    // Pass our own id: otherwise `saveServerFromForm` assigns `Date.now()`, and
    // two creations in the same millisecond share the id.
    await saveServerFromForm(ctx, { ...FORM, name: 'Prod (leser)', username: 'leser' }, 'srv-leser');
    const url = FORM.serverUrl;
    await ctx.globalState.update('tm1.lintConfig', { [url]: { rules: {} } });
    await ctx.globalState.update('tm1.security.userAliasByServer', { [a.profile!.id]: 'Name' });

    await deleteServer(ctx, a.profile!.id);

    expect(ctx.globalState.get('tm1.lintConfig')).toEqual({ [url]: { rules: {} } });
    // The id-keyed store hangs on the deleted profile and goes with it.
    expect(ctx.globalState.get('tm1.security.userAliasByServer')).toEqual({});
  });
});

describe('getServerFormData', () => {
  it('loads profile + password for the edit web interface', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const { profile } = await saveServerFromForm(ctx, { ...FORM, authType: 'CAM', camNamespace: 'LDAP' });
    const data = await getServerFormData(ctx, profile!.id);
    expect(data).toMatchObject({
      name: 'Prod',
      username: 'admin',
      password: '',
      hasPassword: true,
      authType: 'CAM',
      camNamespace: 'LDAP',
      rejectUnauthorized: false,
    });
  });

  // The password stays on the host: the webview gets `hasPassword`, and an
  // empty field coming back means "unchanged".
  it('withStoredPassword fills an empty field, keeps a typed one and a set', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const ctx = makeCtx();
    const { profile } = await saveServerFromForm(ctx, FORM);
    const id = profile!.id;
    expect((await withStoredPassword(ctx, id, { ...FORM, password: '' })).password).toBe('secret');
    expect((await withStoredPassword(ctx, id, { ...FORM, password: 'neu' })).password).toBe('neu');
    expect((await withStoredPassword(ctx, id, { ...FORM, password: '', credentialId: 'c1' })).password).toBe('');
  });

  it('returns undefined for an unknown serverId', async () => {
    const ctx = makeCtx();
    expect(await getServerFormData(ctx, 'nope')).toBeUndefined();
  });
});

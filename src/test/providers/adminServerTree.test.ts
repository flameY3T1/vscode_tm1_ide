import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

const listAdminInstancesSpy = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/adminServerApi', () => ({ listAdminInstances: listAdminInstancesSpy }));

const pawTransport = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/pawGatewayApi', () => ({ listPawInstances: pawTransport }));

import * as vscode from 'vscode';
import { Tm1TreeDataProvider } from '../../providers/tm1TreeDataProvider';
import { initServerManager, saveServers, getAllServers, onServerChanged } from '../../serverState/state';
import { saveAdminServer, getAdminServer, removeAdminServer } from '../../serverState/adminServers';
import { _clearInstanceCountsForTest, discoverAndSync } from '../../providers/adminDiscovery';
import type { AdminInstance } from '../../tm1Rest/adminServerApi';
import { PawGatewayError } from '../../tm1Rest/pawGatewayUrl';

function fakeContext() {
  const store = new Map<string, unknown>();
  return {
    extensionUri: vscode.Uri.file('/ext'),
    globalState: {
      get: (k: string, dflt?: unknown) => (store.has(k) ? store.get(k) : dflt),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
    secrets: { get: async () => '', store: async () => {}, delete: async () => {} },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

// Provider takes callbacks, not an ExtensionContext (see task-5-addendum.md) —
// `_getServers` reads back whatever `discoverAndSync` wrote via the fake
// context's globalState, so the test sees the real persistence path.
function makeProvider(): Tm1TreeDataProvider {
  return new Tm1TreeDataProvider(
    () => getAllServers(ctx),
    () => false,
    () => undefined,
  );
}

let ctx: vscode.ExtensionContext;
let provider: Tm1TreeDataProvider;

beforeEach(async () => {
  listAdminInstancesSpy.mockReset();
  pawTransport.mockReset();
  _clearInstanceCountsForTest();
  ctx = fakeContext();
  initServerManager(ctx);
  provider = makeProvider();
  await saveAdminServer({ id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: [] });
});

describe('admin server in the tree', () => {
  it('discovers children without triggering another tree refresh or writing admin metadata', async () => {
    const before = getAdminServer('a1');
    const changed = vi.fn();
    const sub = onServerChanged.event(changed);
    listAdminInstancesSpy.mockResolvedValue([{ name: 'SALES', host: 'https://h:1', acceptingClients: true, usingSSL: true }]);
    try {
      await discoverAndSync('a1');
      expect(getAllServers(ctx).map(s => s.name)).toEqual(['SALES']);
      expect(changed).not.toHaveBeenCalled();
      expect(getAdminServer('a1')).toEqual(before);
    } finally { sub.dispose(); }
  });
  it('uses current hidden instances and credentials after discovery returns', async () => {
    let finish!: (rows: AdminInstance[]) => void;
    listAdminInstancesSpy.mockReturnValueOnce(new Promise<AdminInstance[]>(resolve => { finish = resolve; }));
    const pending = discoverAndSync('a1');
    await saveAdminServer({ ...getAdminServer('a1')!, name: 'Renamed', hidden: ['HIDDEN'], defaultCredentialId: 'new-credentials' });
    finish([
      { name: 'HIDDEN', host: 'https://h:1', acceptingClients: true, usingSSL: true },
      { name: 'VISIBLE', host: 'https://h:2', acceptingClients: true, usingSSL: true },
    ] as AdminInstance[]);
    await pending;
    expect(getAdminServer('a1')).toMatchObject({ name: 'Renamed', hidden: ['HIDDEN'] });
    expect(getAllServers(ctx).map(s => [s.name, s.credentialId])).toEqual([['VISIBLE', 'new-credentials']]);
  });
  it.each(['removed', 'host changed', 'TLS changed'])('discards an obsolete discovery result when the admin is %s', async change => {
    let finish!: (rows: AdminInstance[]) => void;
    listAdminInstancesSpy.mockReturnValueOnce(new Promise<AdminInstance[]>(resolve => { finish = resolve; }));
    const pending = discoverAndSync('a1');
    if (change === 'removed') await removeAdminServer('a1');
    else await saveAdminServer({ ...getAdminServer('a1')!, ...(change === 'host changed' ? { serverUrl: 'http://new-host:5895' } : { rejectUnauthorized: true }) });
    finish([{ name: 'OLD', host: 'https://h:1', acceptingClients: true, usingSSL: true }] as AdminInstance[]);
    expect((await pending).visible).toEqual([]);
    expect(getAllServers(ctx)).toEqual([]);
    if (change === 'removed') expect(getAdminServer('a1')).toBeUndefined();
  });
  it('leaves the admin entry untouched after a failed discovery', async () => {
    const before = getAdminServer('a1');
    listAdminInstancesSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(discoverAndSync('a1')).rejects.toThrow('ECONNREFUSED');
    expect(getAdminServer('a1')).toEqual(before);
  });
  it('shows a profile at the root whose admin server no longer exists', async () => {
    // `parentAdminId` is the ONLY reason to keep a profile away from the
    // root — if it points into the void, the profile and its credentials would
    // no longer be visible anywhere: no error, no message, simply gone.
    await saveServers(ctx, [{
      id: 'srv-1', name: 'Waise', serverUrl: 'https://h:1', username: 'u',
      rejectUnauthorized: false, authType: 'Basic', parentAdminId: 'gibtsnicht',
    }]);
    const roots = await provider.getChildren();
    expect(roots.some(n => n.label === 'Waise')).toBe(true);
  });

  it('keeps a profile away from the root for as long as its admin server is alive', async () => {
    await saveServers(ctx, [{
      id: 'srv-1', name: 'Kind', serverUrl: 'https://h:1', username: '',
      rejectUnauthorized: false, authType: 'Basic', parentAdminId: 'a1',
    }]);
    const roots = await provider.getChildren();
    expect(roots.some(n => n.label === 'Kind')).toBe(false);
  });

  it('shows the admin server at root level, before folders', async () => {
    const roots = await provider.getChildren();
    expect(roots[0].nodeType).toBe('adminServerRoot');
    expect(roots[0].label).toBe('PROD');
  });

  it('names the kind in the tooltip, not behind the label', async () => {
    await saveAdminServer({ ...getAdminServer('a1')!, kind: 'paw' });
    const roots = await provider.getChildren();
    // After the name, the kind stood next to the instance count and was mere
    // repetition there (click test 2026-09-16). The hover text carries it now,
    // and there it must NO longer talk about the admin server.
    expect(roots[0].description).toBeUndefined();
    expect(String(roots[0].tooltip)).toContain('Planning Analytics Workspace');
    expect(String(roots[0].tooltip)).not.toContain('TM1 Admin Server');
  });

  it('needs no login profile for PAW discovery', async () => {
    await saveAdminServer({ ...getAdminServer('a1')!, kind: 'paw' });
    pawTransport.mockResolvedValue([{ name: 'SALES', acceptingClients: true }]);
    const roots = await provider.getChildren();
    const children = await provider.getChildren(roots[0]);
    expect(children.map(c => c.label)).toEqual(['SALES']);
    expect(pawTransport).toHaveBeenCalledWith('http://h:5895', false);
  });

  it('gives newly discovered PAW instances the browser login when the gateway asks for it', async () => {
    await saveAdminServer({ ...getAdminServer('a1')!, kind: 'paw', defaultAuthType: 'browser' });
    pawTransport.mockResolvedValue([{ name: 'SALES', acceptingClients: true }]);
    const roots = await provider.getChildren();
    await provider.getChildren(roots[0]);
    const child = getAllServers(ctx)[0];
    expect(child.authType).toBe('browser');
    expect(child.credentialId).toBeUndefined();
  });

  it('turns a PA SaaS database (isV12) into a v12 SaaS browser profile with the gateway tenant', async () => {
    const saas = 'https://eu-central-1.planninganalytics.saas.ibm.com';
    await saveAdminServer({ ...getAdminServer('a1')!, kind: 'paw', serverUrl: saas, tenant: 'T1' });
    pawTransport.mockResolvedValue([{ name: 'BF', acceptingClients: true, isV12: true }]);
    const roots = await provider.getChildren();
    await provider.getChildren(roots[0]);
    const child = getAllServers(ctx)[0];
    expect(child).toMatchObject({ serverUrl: saas, authType: 'browser', version: 'v12',
      v12: { authMode: 'saas', instance: 'T1', database: 'BF' } });

    // A changed tenant on the gateway reaches the child; the URL alone would not show it.
    await saveAdminServer({ ...getAdminServer('a1')!, tenant: 'T2' });
    await provider.getChildren((await provider.getChildren())[0]);
    expect(getAllServers(ctx)[0].v12?.instance).toBe('T2');
  });

  it('PA SaaS without a browser session (401): keeps the stored children instead of an error', async () => {
    const saas = 'https://eu-central-1.planninganalytics.saas.ibm.com';
    await saveAdminServer({ ...getAdminServer('a1')!, kind: 'paw', serverUrl: saas, tenant: 'T1' });
    pawTransport.mockResolvedValue([{ name: 'BF', acceptingClients: true, isV12: true }]);
    await provider.getChildren((await provider.getChildren())[0]);
    pawTransport.mockRejectedValue(new PawGatewayError('HTTP 401', 'http', 401));
    const kids = await provider.getChildren((await provider.getChildren())[0]);
    expect(kids.map(k => k.label)).toEqual(['BF']);
  });

  it('lists the reported instances as regular server nodes', async () => {
    listAdminInstancesSpy.mockResolvedValue([
      { name: 'SALES', host: 'https://h:12357', acceptingClients: true, usingSSL: true },
    ]);
    const roots = await provider.getChildren();
    const kids = await provider.getChildren(roots[0]);
    expect(kids.map(k => k.nodeType)).toEqual(['serverRoot']);
    expect(kids[0].label).toBe('SALES');
    // And it has become a real profile — everything else depends on that.
    expect(getAllServers(ctx).map(s => s.id)).toEqual(['disc:a1:SALES']);
  });

  it('stores the instance under the admin server host, not the name the instance reports', async () => {
    // The reported `Host` carries the machine name of the TM1 machine; in a
    // corporate network it often does not resolve from the client. The
    // admin server address has just delivered the list, so it is reachable.
    listAdminInstancesSpy.mockResolvedValue([
      {
        name: 'SALES', host: 'https://TM1HOST:12357', acceptingClients: true, usingSSL: true,
        ipAddress: '10.1.2.3', ipv6Address: '', httpPortNumber: 12357,
      },
    ]);
    const roots = await provider.getChildren();
    await provider.getChildren(roots[0]);
    const saved = getAllServers(ctx)[0];
    expect(saved.serverUrl).toBe('https://h:12357');
    expect(saved.discoveredUrl).toBe('https://h:12357');
  });

  it('leaves an instance out that is not accepting clients', async () => {
    listAdminInstancesSpy.mockResolvedValue([
      { name: 'RISK', host: 'https://h:1', acceptingClients: false, usingSSL: true },
    ]);
    const roots = await provider.getChildren();
    expect(await provider.getChildren(roots[0])).toEqual([]);
    expect(getAllServers(ctx)).toEqual([]);
  });

  it('shows an error child and touches no profile when the admin server is down', async () => {
    await saveServers(ctx, [{
      id: 'disc:a1:SALES', name: 'SALES', serverUrl: 'https://h:1', username: '', rejectUnauthorized: false,
      authType: 'Basic', parentAdminId: 'a1', discoveredName: 'SALES', discoveredUrl: 'https://h:1',
    } as never]);
    listAdminInstancesSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const roots = await provider.getChildren();
    const kids = await provider.getChildren(roots[0]);
    expect(kids.map(k => k.nodeType)).toEqual(['error']);
    expect(getAllServers(ctx)).toHaveLength(1);
  });

  it('does not list an instance the user took out of the group', async () => {
    await saveAdminServer({ id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: ['SALES'] });
    listAdminInstancesSpy.mockResolvedValue([
      { name: 'SALES', host: 'https://h:12357', acceptingClients: true, usingSSL: true },
    ]);
    const roots = await provider.getChildren();
    expect(await provider.getChildren(roots[0])).toEqual([]);
  });

  it('carries meta.instanceCount only after an expand has happened', async () => {
    listAdminInstancesSpy.mockResolvedValue([
      { name: 'SALES', host: 'https://h:12357', acceptingClients: true, usingSSL: true },
    ]);
    const before = await provider.getChildren();
    expect(before[0].meta.instanceCount).toBeUndefined();

    await provider.getChildren(before[0]);

    const after = await provider.getChildren();
    expect(after[0].meta.instanceCount).toBe(1);
  });

  it('keeps a URL the user corrected and marks the child as diverged', async () => {
    await saveServers(ctx, [{
      id: 'disc:a1:SALES', name: 'SALES', serverUrl: 'https://fixed:9', username: '', rejectUnauthorized: false,
      authType: 'Basic', parentAdminId: 'a1', discoveredName: 'SALES', discoveredUrl: 'https://old:1',
    } as never]);
    listAdminInstancesSpy.mockResolvedValue([
      { name: 'SALES', host: 'https://new:2', acceptingClients: true, usingSSL: true },
    ]);
    const roots = await provider.getChildren();
    const kids = await provider.getChildren(roots[0]);
    expect(getAllServers(ctx)[0].serverUrl).toBe('https://fixed:9');
    expect(getAllServers(ctx)[0].discoveredUrl).toBe('https://new:2');
    // Check the RENDERED tooltip, not `meta.diverged`: the
    // tooltip is created in the constructor of `Tm1TreeNode`. The old assertion
    // on `meta.diverged` stayed green although the hint never became visible,
    // because the flag was only set after construction
    // (review 2026-08-27, finding 2).
    expect(String(kids[0].tooltip)).toContain('URL differs from what the admin server reports');
  });

  it('shows the stale hint in the tooltip when the instance is no longer reported', async () => {
    await saveServers(ctx, [{
      id: 'disc:a1:GONE', name: 'GONE', serverUrl: 'https://h:1', username: '', rejectUnauthorized: false,
      authType: 'Basic', parentAdminId: 'a1', discoveredName: 'GONE', discoveredUrl: 'https://h:1',
    } as never]);
    listAdminInstancesSpy.mockResolvedValue([]);
    const roots = await provider.getChildren();
    const kids = await provider.getChildren(roots[0]);
    expect(kids).toHaveLength(1);
    expect(String(kids[0].tooltip)).toContain('No longer reported by the admin server');
  });

  it('lists a discovered instance exactly once — under the admin server, not also at root', async () => {
    listAdminInstancesSpy.mockResolvedValue([
      { name: 'SALES', host: 'https://h:12357', acceptingClients: true, usingSSL: true },
    ]);
    const before = await provider.getChildren();
    await provider.getChildren(before[0]);

    // Second pass over the root: the profile exists now. It must NOT show up
    // there — otherwise there are two nodes with the same id `serverRoot:<id>`
    // ("Element with id ... is already registered", finding 1).
    const roots = await provider.getChildren();
    const rootServers = roots.filter(n => n.nodeType === 'serverRoot');
    expect(rootServers).toEqual([]);

    const kids = await provider.getChildren(roots[0]);
    expect(kids.filter(k => k.nodeType === 'serverRoot').map(k => k.label)).toEqual(['SALES']);
  });

  it('still shows a detached profile at root', async () => {
    // Taken out = `parentAdminId` deleted. The filter from finding 1 must
    // not swallow such a profile as well.
    await saveServers(ctx, [{
      id: 'disc:a1:SALES', name: 'SALES', serverUrl: 'https://h:1', username: '', rejectUnauthorized: false,
      authType: 'Basic', discoveredName: 'SALES', discoveredUrl: 'https://h:1',
    } as never]);
    const roots = await provider.getChildren();
    expect(roots.filter(n => n.nodeType === 'serverRoot').map(n => n.label)).toEqual(['SALES']);
  });

  it('gives newly discovered instances the default credential set', async () => {
    // The actual gain: ten instances, one group login, no filling in.
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895',
      rejectUnauthorized: false, hidden: [], defaultCredentialId: 'cred:1',
    });
    listAdminInstancesSpy.mockResolvedValue([
      {
        name: 'SALES', host: 'https://h:12357', acceptingClients: true, usingSSL: true,
        ipAddress: '', ipv6Address: '', httpPortNumber: 12357,
      },
    ]);
    const roots = await provider.getChildren();
    await provider.getChildren(roots[0]);
    expect(getAllServers(ctx)[0].credentialId).toBe('cred:1');
  });

  it('does not touch existing instances when the default changes', async () => {
    // Like `rejectUnauthorized`: only new children inherit. Reaching through would
    // be a silent change to profiles that the user has already set up.
    await saveServers(ctx, [{
      id: 'disc:a1:SALES', name: 'SALES', serverUrl: 'https://h:12357', username: 'eigen',
      rejectUnauthorized: false, authType: 'Basic', parentAdminId: 'a1',
      discoveredName: 'SALES', discoveredUrl: 'https://h:12357',
    }]);
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895',
      rejectUnauthorized: false, hidden: [], defaultCredentialId: 'cred:1',
    });
    listAdminInstancesSpy.mockResolvedValue([
      {
        name: 'SALES', host: 'https://h:12357', acceptingClients: true, usingSSL: true,
        ipAddress: '', ipv6Address: '', httpPortNumber: 12357,
      },
    ]);
    const roots = await provider.getChildren();
    await provider.getChildren(roots[0]);
    expect(getAllServers(ctx)[0].credentialId).toBeUndefined();
  });
});

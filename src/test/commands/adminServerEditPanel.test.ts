// Editing an admin server goes through THE SAME edit view as
// "Edit Server" (`addServerPanel`), no longer through two bare
// `showInputBox` prompts. The test drives the real panel path (mocked
// vscode + WebviewPanelHost) and checks the messages actually posted and
// received.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));
const pawTransport = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/pawGatewayApi', () => ({ listPawInstances: pawTransport }));
const browserLists = vi.hoisted(() => vi.fn());
vi.mock('../../commands/serverManager/browserConnect', () => ({ loadSaasLists: browserLists }));

vi.mock('../../commands/serverManager', () => ({
  testServerConnection: vi.fn(),
  saveServerFromForm: vi.fn(),
  getServerFormData: vi.fn(),
  deleteServer: vi.fn(),
  confirmInsecureSave: vi.fn(async () => true),
}));

import * as vscode from 'vscode';
import type { MockWebviewPanel } from '../__mocks__/vscode';
import {
  initializeAddServerPanel,
  disposeAllAddServerPanels,
  openEditAdminServerPanel,
  openAddAdminServerPanel,
} from '../../commands/serverConfig/addServerPanel';
import { registerAdminServerCommands } from '../../activation/registerAdminServerCommands';
import { initServerManager, saveServers, getAllServers } from '../../serverState/state';
import { saveAdminServer, getAdminServer, removeAdminServer, listAdminServers } from '../../serverState/adminServers';
import { saveCredential } from '../../commands/serverManager/credentials';
import { PawGatewayError } from '../../tm1Rest/pawGatewayUrl';
import { saveServerFromForm } from '../../commands/serverManager';
import type { HostToWebview, ServerFormData } from '../../webviewClient/addServer/protocol';

const EXT_URI = vscode.Uri.file('/ext');

function fakeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string, dflt?: unknown) => (store.has(k) ? store.get(k) : dflt),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
    secrets: { get: async () => '', store: async () => {}, delete: async () => {} },
    subscriptions: [] as { dispose(): void }[],
  } as unknown as vscode.ExtensionContext;
}

function lastPanel(): MockWebviewPanel {
  return (vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock
    .results.at(-1)!.value as MockWebviewPanel;
}

function postedMessages(panel: MockWebviewPanel): HostToWebview[] {
  const post = panel.webview.postMessage as unknown as ReturnType<typeof vi.fn>;
  return post.mock.calls.map((c) => c[0] as HostToWebview);
}

let ctx: vscode.ExtensionContext;

const discovered = () => ({
  id: 'disc:a1:SALES', name: 'SALES', serverUrl: 'https://h:1', username: '',
  rejectUnauthorized: false, authType: 'Basic' as const,
  parentAdminId: 'a1', discoveredName: 'SALES', discoveredUrl: 'https://h:1',
});

beforeEach(async () => {
  // `host` in `addServerPanel.ts` is a module singleton and survives the
  // test — a panel left open would only be revealed on the next `open`
  // instead of being built anew.
  disposeAllAddServerPanels();
  vi.clearAllMocks();
  pawTransport.mockReset();
  ctx = fakeContext();
  initServerManager(ctx);
  initializeAddServerPanel(EXT_URI);
  registerAdminServerCommands({ context: ctx } as never);
  await saveAdminServer({
    id: 'a1', name: 'PROD', serverUrl: 'http://h:5895',
    rejectUnauthorized: false, hidden: ['SALES_ALT'],
  });
  await saveServers(ctx, [discovered()]);
});

describe('openEditAdminServerPanel', () => {
  it('rejects an instance-save message sent from a group edit panel', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({ type: 'save', data: { name: 'Wrong kind', serverUrl: 'https://paw', username: 'user', password: '', authType: 'Basic', rejectUnauthorized: true } });
    await new Promise(r => setImmediate(r));
    expect(saveServerFromForm).not.toHaveBeenCalled();
    expect(postedMessages(panel)).toContainEqual(expect.objectContaining({ type: 'saveResult', ok: false }));
  });
  it('probes PAW anonymously and returns count, names for the tick list and correlation id — no hosts', async () => {
    pawTransport.mockResolvedValue([{ name: 'SALES', acceptingClients: true }, { name: 'HR', acceptingClients: false }]);
    openAddAdminServerPanel(ctx);
    const panel = lastPanel();
    panel.simulateMessage({ type: 'probeAdmin', kind: 'paw', name: 'Workspace', serverUrl: 'https://paw', rejectUnauthorized: true, requestId: 42 });
    await new Promise(r => setImmediate(r));
    expect(postedMessages(panel)).toContainEqual({
      type: 'adminProbeResult', requestId: 42, ok: true, count: 1,
      databases: [{ name: 'SALES', acceptingClients: true }, { name: 'HR', acceptingClients: false }],
    });
    // No third parameter: the list comes without credentials.
    expect(pawTransport).toHaveBeenCalledWith('https://paw', true);
  });

  it('reports PAW HTTP 403 as a gateway failure, not as a login failure', async () => {
    const status = 403;
    pawTransport.mockRejectedValue(new PawGatewayError('HTTP error', 'http', status));
    openAddAdminServerPanel(ctx);
    const panel = lastPanel();
    panel.simulateMessage({ type: 'probeAdmin', kind: 'paw', name: 'Workspace', serverUrl: 'https://paw', rejectUnauthorized: true, requestId: 7 });
    await new Promise(r => setImmediate(r));
    const result = postedMessages(panel).find(m => m.type === 'adminProbeResult');
    expect(result).toMatchObject({ ok: false, requestId: 7, message: expect.stringContaining(`HTTP ${status}`) });
    expect(browserLists).not.toHaveBeenCalled();
  });

  it('answers PAW HTTP 401 with the browser sign-in, then lists with the session — any host, not only PA SaaS', async () => {
    pawTransport.mockReset();
    pawTransport
      .mockRejectedValueOnce(new PawGatewayError('HTTP error', 'http', 401))
      .mockResolvedValueOnce([{ name: 'SALES', acceptingClients: true }]);
    browserLists.mockResolvedValue({ tenants: [], databases: ['SALES'] });
    openAddAdminServerPanel(ctx);
    const panel = lastPanel();
    panel.simulateMessage({ type: 'probeAdmin', kind: 'paw', name: 'Workspace', serverUrl: 'https://paw-local:9443', rejectUnauthorized: true, requestId: 9 });
    await new Promise(r => setTimeout(r, 0));
    expect(browserLists).toHaveBeenCalledWith('https://paw-local:9443', true);
    expect(postedMessages(panel).find(m => m.type === 'adminProbeResult'))
      .toMatchObject({ ok: true, requestId: 9, count: 1, databases: [{ name: 'SALES', acceptingClients: true }] });
  });

  it('validates the PAW probe URL before touching the gateway', async () => {
    openAddAdminServerPanel(ctx);
    const panel = lastPanel();
    panel.simulateMessage({ type: 'probeAdmin', kind: 'paw', name: 'Workspace', serverUrl: 'https://paw/api/v1', rejectUnauthorized: true, requestId: 8 });
    await new Promise(r => setImmediate(r));
    expect(postedMessages(panel)).toContainEqual(expect.objectContaining({ type: 'adminProbeResult', requestId: 8, ok: false }));
    expect(pawTransport).not.toHaveBeenCalled();
  });

  it('saves PAW and restores its kind and login profile when editing', async () => {
    await saveCredential({ id: 'basic', name: 'Basic', username: 'user', authType: 'Basic' }, '');
    openAddAdminServerPanel(ctx);
    const panel = lastPanel();
    panel.simulateMessage({ type: 'saveAdmin', kind: 'paw', name: 'Workspace', serverUrl: 'https://paw:9443///', rejectUnauthorized: true, defaultCredentialId: 'basic' });
    await new Promise(r => setImmediate(r));
    const saved = listAdminServers().find(a => a.name === 'Workspace');
    expect(saved).toMatchObject({ kind: 'paw', serverUrl: 'https://paw:9443', defaultCredentialId: 'basic' });
    await openEditAdminServerPanel(ctx, saved!.id);
    lastPanel().simulateMessage({ type: 'ready' });
    expect(postedMessages(lastPanel()).find(m => m.type === 'init')).toMatchObject({ kind: 'paw', data: { credentialId: 'basic' } });
  });

  it('saves a PAW gateway without a login profile', async () => {
    openAddAdminServerPanel(ctx);
    lastPanel().simulateMessage({ type: 'saveAdmin', kind: 'paw', name: 'Workspace', serverUrl: 'https://paw:9443', rejectUnauthorized: true });
    await new Promise(r => setImmediate(r));
    expect(listAdminServers().find(a => a.name === 'Workspace'))
      .toMatchObject({ kind: 'paw', serverUrl: 'https://paw:9443', defaultCredentialId: undefined });
  });

  it.each(['path', 'query', 'unknown kind', 'change kind'])('rejects invalid PAW save: %s', async mode => {
    await saveCredential({ id: 'basic', name: 'Basic', username: 'user', authType: 'Basic' }, undefined);
    if (mode === 'change kind') await openEditAdminServerPanel(ctx, 'a1');
    else openAddAdminServerPanel(ctx);
    const panel = lastPanel();
    const post = panel.webview.postMessage as unknown as ReturnType<typeof vi.fn>;
    panel.simulateMessage({ type: 'saveAdmin', kind: mode === 'unknown kind' ? 'invalid' : 'paw', name: 'Workspace', serverUrl: mode === 'path' ? 'https://paw/api/v1' : mode === 'query' ? 'https://paw?x=1' : 'https://paw', rejectUnauthorized: true, defaultCredentialId: 'basic' });
    await new Promise(r => setImmediate(r));
    expect(post.mock.calls.map(c => c[0]).find(m => m.type === 'saveResult')).toMatchObject({ ok: false });
    expect(listAdminServers()).toHaveLength(1);
    expect(getAdminServer('a1')?.name).toBe('PROD');
  });

  it('opens the same view as "Edit Server", prefilled and as kind "admin"', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({ type: 'ready' });

    const init = postedMessages(panel).find((m) => m.type === 'init') as
      Extract<HostToWebview, { type: 'init' }> | undefined;
    expect(init).toBeDefined();
    expect(init!.mode).toBe('edit');
    expect(init!.kind).toBe('admin');
    const d = init!.data as ServerFormData;
    expect(d.name).toBe('PROD');
    expect(d.serverUrl).toBe('http://h:5895');
    expect(d.rejectUnauthorized).toBe(false);
  });

  it('saves back into THE SAME profile and keeps the exclusions', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({
      type: 'saveAdmin', name: 'PROD neu', serverUrl: 'http://h2:5895', rejectUnauthorized: true,
    });
    await new Promise((r) => setImmediate(r));

    const admin = getAdminServer('a1');
    expect(admin).toBeDefined();
    expect(admin!.name).toBe('PROD neu');
    expect(admin!.serverUrl).toBe('http://h2:5895');
    expect(admin!.rejectUnauthorized).toBe(true);
    // Without carrying them over, the excluded instances would silently come
    // back on the next discovery.
    expect(admin!.hidden).toEqual(['SALES_ALT']);
  });

  it('does NOT create a second profile when saving', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({
      type: 'saveAdmin', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false,
    });
    await new Promise((r) => setImmediate(r));
    expect(ctx.globalState.get<unknown[]>('tm1.adminServers')).toHaveLength(1);
  });

  it('reports an unusable URL back instead of saving it', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({
      type: 'saveAdmin', name: 'PROD', serverUrl: 'nicht mal eine url', rejectUnauthorized: false,
    });
    await new Promise((r) => setImmediate(r));

    const res = postedMessages(panel).find((m) => m.type === 'saveResult') as
      Extract<HostToWebview, { type: 'saveResult' }> | undefined;
    expect(res?.ok).toBe(false);
    expect(getAdminServer('a1')?.serverUrl).toBe('http://h:5895');
  });

  it('deletes via the admin server path — with a confirmation about the instances', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage')
      .mockResolvedValue('Keep servers' as never);
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({ type: 'delete' });
    await new Promise((r) => setImmediate(r));

    // The confirmation is the admin server's, not the instance profile's.
    expect(warn.mock.calls[0][0]).toBe('Remove admin server "PROD"?');
    expect(getAdminServer('a1')).toBeUndefined();
    // "Keep servers": the discovered instance stays, only the binding goes.
    expect(getAllServers(ctx)).toHaveLength(1);
    expect(getAllServers(ctx)[0].parentAdminId).toBeUndefined();
  });

  it('creates nothing new when the entry is gone in the meantime', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    // While the window is open, the entry disappears elsewhere.
    await ctx.globalState.update('tm1.adminServers', []);
    panel.simulateMessage({
      type: 'saveAdmin', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false,
    });
    await new Promise((r) => setImmediate(r));

    // Without the check, the path falls back to `newAdminServerId()` and
    // silently creates a SECOND entry — the user wanted to edit.
    expect(ctx.globalState.get<unknown[]>('tm1.adminServers')).toEqual([]);
    const res = postedMessages(panel).find((m) => m.type === 'saveResult') as
      Extract<HostToWebview, { type: 'saveResult' }> | undefined;
    expect(res?.ok).toBe(false);
  });

  it('says so when the delete button hits an entry that has disappeared', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage')
      .mockResolvedValue(undefined as never);
    warn.mockClear();
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    await ctx.globalState.update('tm1.adminServers', []);
    panel.simulateMessage({ type: 'delete' });
    await new Promise((r) => setImmediate(r));

    // No silent nothing: the confirmation cannot come at all, so the
    // message has to explain why the button has no effect.
    const res = postedMessages(panel).find((m) => m.type === 'saveResult') as
      Extract<HostToWebview, { type: 'saveResult' }> | undefined;
    expect(res?.ok).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves everything in place when the confirmation is cancelled', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    panel.simulateMessage({ type: 'delete' });
    await new Promise((r) => setImmediate(r));
    expect(getAdminServer('a1')).toBeDefined();
  });
});

describe('window closes when its entry disappears', () => {
  it('when the admin server is deleted in the tree', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    const disposed = vi.spyOn(panel, 'dispose');

    // Like `tm1.adminServer.remove`: entry gone, `onServerChanged` fired.
    await removeAdminServer('a1');
    await new Promise((r) => setImmediate(r));

    expect(disposed).toHaveBeenCalled();
  });

  it('leaves it open as long as the entry lives', async () => {
    await openEditAdminServerPanel(ctx, 'a1');
    const panel = lastPanel();
    const disposed = vi.spyOn(panel, 'dispose');

    // An ordinary save fires the same event — the window must not
    // die from it.
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895',
      rejectUnauthorized: false, hidden: [],
    });
    await new Promise((r) => setImmediate(r));

    expect(disposed).not.toHaveBeenCalled();
  });
});

describe('tm1.adminServer.edit', () => {
  it('opens the panel instead of the input boxes', async () => {
    const inputBox = vi.spyOn(vscode.window, 'showInputBox');
    inputBox.mockClear();
    await vscode.commands.executeCommand('tm1.adminServer.edit', { meta: { adminId: 'a1' } });
    expect(inputBox).not.toHaveBeenCalled();
    const panel = lastPanel();
    panel.simulateMessage({ type: 'ready' });
    const init = postedMessages(panel).find((m) => m.type === 'init') as
      Extract<HostToWebview, { type: 'init' }> | undefined;
    expect(init?.kind).toBe('admin');
    expect((init?.data as ServerFormData).name).toBe('PROD');
  });

  it('does nothing on an unknown admin server', async () => {
    const before = (vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await vscode.commands.executeCommand('tm1.adminServer.edit', { meta: { adminId: 'weg' } });
    expect((vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock.calls.length)
      .toBe(before);
  });
});

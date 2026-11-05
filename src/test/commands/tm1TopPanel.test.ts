import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { Script, createContext } from 'node:vm';
import { openTm1TopPanelForProfile, disposeTm1TopPanelForServer, nativeErrorMessage, getTm1TopHtml, showTm1TopForAdminCommand } from '../../commands/tm1Top';
import { resolveNativeRuntime, Tm1TopUnavailable } from '../../tm1top/discovery';
import { Tm1TopBridgeError } from '../../tm1top/bridge';
import type { ServerProfile } from '../../serverState/state';
import { listWindows } from '../../workbench/windowRegistry';
import { initServerManager, saveServers, _connectedConfigs } from '../../serverState/state';
import { apiRequest } from '../../tm1Rest/client';
import { saveAdminServer, removeAdminServer } from '../../serverState/adminServers';
import { deleteServer } from '../../commands/serverManager/form';
import { loadCredentials } from '../../commands/serverManager/connection';
import { readBuiltBundle } from '../helpers/builtBundle';

const native = vi.hoisted(() => ({ getState: vi.fn(), enumServers: vi.fn(), verifyAdmin: vi.fn(), kill: vi.fn(), dispose: vi.fn() }));
vi.mock('../../tm1top/bridge', async importOriginal => ({ ...await importOriginal<typeof import('../../tm1top/bridge')>(), Tm1TopBridge: class { getState = native.getState; enumServers = native.enumServers; verifyAdmin = native.verifyAdmin; kill = native.kill; dispose = native.dispose; } }));
vi.mock('../../tm1top/discovery', async importOriginal => ({ ...await importOriginal<typeof import('../../tm1top/discovery')>(), resolveNativeRuntime: vi.fn(async () => ({ bin64Dir: 'bin', helperPath: 'helper' })) }));
vi.mock('../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../../commands/serverManager/connection', async importOriginal => ({ ...await importOriginal<typeof import('../../commands/serverManager/connection')>(), loadCredentials: vi.fn(async () => ({ ok: true, authType: 'Basic', username: '', password: '' })) }));
const profile: ServerProfile = { id: 'top-test', name: 'Display label', discoveredName: 'SALES', parentAdminId: 'admin', serverUrl: 'https://server:1234', username: '', rejectUnauthorized: true, authType: 'Basic' };
const store = new Map<string, unknown>();
const context = { subscriptions: [], extensionPath: '/extension', extensionUri: vscode.Uri.file('/extension'), globalStorageUri: { fsPath: '/cache' },
  globalState: { get: (key: string, fallback?: unknown) => store.get(key) ?? fallback, update: async (key: string, value: unknown) => { store.set(key, value); } },
  secrets: { get: async () => undefined, delete: async () => {} },
} as unknown as vscode.ExtensionContext;
type TestPanel = vscode.WebviewPanel & { simulateMessage(msg: unknown): void };
const flush = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); } };
let panel: TestPanel;
let viewChanged: () => void;
const createPanel = vi.mocked(vscode.window.createWebviewPanel).getMockImplementation()!;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(loadCredentials).mockResolvedValue({ ok: true, authType: 'Basic', username: '', password: '' });
  store.clear();
  _connectedConfigs.clear();
  initServerManager(context);
  await saveServers(context, [profile]);
  await saveAdminServer({ id: 'admin', name: 'Admin', serverUrl: 'https://admin-host:5898', rejectUnauthorized: true, hidden: [] });
  native.getState.mockResolvedValue(['42\tTh:Pseudo\t-\tIdle...', '']);
  native.verifyAdmin.mockResolvedValue(true);
  native.kill.mockResolvedValue(undefined);
  vi.mocked(vscode.window.createWebviewPanel).mockReset().mockImplementation((...args) => {
    panel = createPanel(...args) as TestPanel;
    Object.defineProperty(panel, 'visible', { value: true, writable: true });
    Object.defineProperty(panel, 'onDidChangeViewState', { value: (listener: () => void) => { viewChanged = listener; return { dispose() {} }; } });
    return panel;
  });
});
afterEach(() => { for (const w of listWindows()) { if (w.kind === 'tm1Top') (w.panel as vscode.WebviewPanel).dispose(); } vi.useRealTimers(); });

describe('native Top panel', () => {
  it('retries discovery on refresh after a failed directory replacement', async () => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    const oldDialog = vscode.window.showOpenDialog;
    Object.assign(vscode.window, { showOpenDialog: vi.fn().mockResolvedValue([{ fsPath: '/bad-bin' }]) });
    const config = vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({ get: () => undefined, update: async () => {} } as never);
    try {
      vi.mocked(resolveNativeRuntime).mockRejectedValueOnce(new Tm1TopUnavailable('dll-missing'));
      native.getState.mockClear();
      panel.simulateMessage({ command: 'locate' }); await flush();
      expect(native.getState).not.toHaveBeenCalled();
      const calls = vi.mocked(resolveNativeRuntime).mock.calls.length;
      panel.simulateMessage({ command: 'refresh' }); await flush();
      expect(resolveNativeRuntime).toHaveBeenCalledTimes(calls + 1);
      expect(native.getState).toHaveBeenCalledOnce();
    } finally {
      config.mockRestore();
      Object.assign(vscode.window, { showOpenDialog: oldDialog });
    }
  });

  it('closes a disconnected profile panel when its owning profile is deleted', async () => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    await deleteServer(context, profile.id);
    expect(listWindows().some(w => w.panel === panel)).toBe(false);
    expect(native.dispose).toHaveBeenCalledOnce();
    native.getState.mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(native.getState).not.toHaveBeenCalled();
  });
  it('keeps a panel when a different profile with the same URL is deleted', async () => {
    await saveServers(context, [profile, { ...profile, id: 'other' }]);
    await openTm1TopPanelForProfile(context, profile); await flush();
    await deleteServer(context, 'other');
    expect(listWindows().some(w => w.panel === panel)).toBe(true);
  });
  it('closes every panel belonging to a removed admin entry and keeps profile panels', async () => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    const profilePanel = panel;
    native.enumServers.mockResolvedValueOnce(['SALES']);
    await showTm1TopForAdminCommand(context, { meta: { adminId: 'admin' } } as never); await flush();
    const first = panel;
    native.enumServers.mockResolvedValueOnce(['Other']);
    await showTm1TopForAdminCommand(context, { meta: { adminId: 'admin' } } as never); await flush();
    const second = panel;
    expect(first).not.toBe(profilePanel);
    expect(second).not.toBe(first);
    await removeAdminServer('admin');
    expect(listWindows().filter(w => w.kind === 'tm1Top').map(w => w.panel)).toEqual([profilePanel]);
  });
  it.each(['verify', 'kill'])('waits for polling before %s and reserves the next operation', async command => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    panel.simulateMessage({ command: 'verify', username: 'admin', password: 'secret' }); await flush();
    native.verifyAdmin.mockClear();
    let finish!: (rows: string[]) => void;
    native.getState.mockReturnValueOnce(new Promise<string[]>(resolve => { finish = resolve; }));
    panel.simulateMessage({ command: 'refresh' }); await flush();
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, cancel' as never);
    panel.simulateMessage({ command, username: 'admin', password: 'secret', threadId: '42' });
    await flush();
    expect(vi.mocked(panel.webview.postMessage).mock.calls.at(-1)?.[0]).toEqual({ busy: true });
    await vi.advanceTimersByTimeAsync(6000);
    expect(native.getState).toHaveBeenCalledTimes(2);
    expect(native.verifyAdmin).not.toHaveBeenCalled();
    expect(native.kill).not.toHaveBeenCalled();
    finish([]); await flush();
    if (command === 'verify') expect(native.verifyAdmin).toHaveBeenCalledOnce();
    else expect(native.kill).toHaveBeenCalledOnce();
  });
  it.each(['invalidate', 'dispose'])('abandons a queued verification after %s', async action => {
    let finish!: (rows: string[]) => void;
    native.getState.mockReturnValueOnce(new Promise<string[]>(resolve => { finish = resolve; }));
    await openTm1TopPanelForProfile(context, profile);
    panel.simulateMessage({ command: 'verify', username: 'admin', password: 'secret' });
    if (action === 'dispose') panel.dispose();
    else panel.simulateMessage({ command: 'invalidate' });
    finish([]); await flush();
    expect(native.verifyAdmin).not.toHaveBeenCalled();
  });
  it('executes the webview, escapes native row content and gates kill buttons', () => {
    class Element {
      children: Element[] = [];
      textContent = '';
      disabled = false;
      hidden = false;
      onclick?: () => void;
      appendChild(child: Element) { this.children.push(child); }
      replaceChildren() { this.children = []; }
      set innerHTML(_value: string) { throw new Error('Unsafe HTML write'); }
    }
    const elements = new Map<string, Element>();
    const element = (id: string) => { if (!elements.has(id)) { elements.set(id, new Element()); } return elements.get(id)!; };
    let receive!: (event: { data: unknown }) => void;
    const postMessage = vi.fn();
    const sandbox = createContext({
      window: { addEventListener: (_type: string, listener: typeof receive) => { receive = listener; } },
      // querySelectorAll: the column drag script (webviews/columnResize.ts) finds no table here and does nothing.
      document: { getElementById: element, createElement: () => new Element(), querySelectorAll: () => [] },
      acquireVsCodeApi: () => ({ postMessage }),
    });
    const html = getTm1TopHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { user: '', saved: false }, 'tm1Top.js');
    // Globals, then the built bundle where its src tag sits, then the inline column script.
    for (const [, tag, source] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      new Script(tag.includes('src=') ? readBuiltBundle('tm1Top', ['src/webviewClient/tm1Top/index.ts', 'src/webviewClient/tm1Top/protocol.ts']) : source).runInContext(sandbox);
    }
    const hostile = '<img src=x onerror=alert(1)>';
    receive({ data: { rows: [{ threadId: '42', session: '538', principal: hostile, context: '-', state: 'Idle', details: [], elapsed: '0', stateClass: 's-idle' }] } });
    const button = () => element('rows').children[0].children[7].children[0];
    expect(element('rows').children[0].children[2].textContent).toBe(hostile);
    expect(button().disabled).toBe(true);
    receive({ data: { verified: true } });
    expect(button().disabled).toBe(false);
    button().onclick!();
    expect(postMessage).toHaveBeenCalledWith({ command: 'kill', threadId: '42' });
    receive({ data: { busy: true } });
    expect(button().disabled).toBe(true);
    receive({ data: { busy: false, verified: false } });
    expect(button().disabled).toBe(true);
    // The locate button only appears for errors a directory can repair.
    receive({ data: { error: 'no dll', locate: true } });
    expect(element('locate').hidden).toBe(false);
    element('locate').onclick!();
    expect(postMessage).toHaveBeenCalledWith({ command: 'locate' });
    receive({ data: { error: 'timeout' } });
    expect(element('locate').hidden).toBe(true);
  });
  it('emits syntactically valid scripts with a nonce-based CSP', () => {
    const html = getTm1TopHtml({ cspSource: 'vscode-webview:' } as vscode.Webview, { user: '', saved: false }, 'tm1Top.js');
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, source] of scripts) { expect(() => new Script(source)).not.toThrow(); }
    expect(html).toContain("script-src 'nonce-");
    expect(html).not.toContain('killBlockers');
  });
  it('retries startup discovery after configuration repair and names errors', async () => {
    vi.mocked(resolveNativeRuntime).mockRejectedValueOnce(new Tm1TopUnavailable('dll-missing'));
    await openTm1TopPanelForProfile(context, profile);
    expect(native.getState).not.toHaveBeenCalled();
    expect(vi.mocked(panel.webview.postMessage).mock.calls.some(([m]) => String(m.error).includes('tm1.nativeApiPath'))).toBe(true);
    panel.simulateMessage({ command: 'refresh' }); await flush();
    expect(native.getState).toHaveBeenCalledOnce();
    expect(nativeErrorMessage(new Tm1TopBridgeError('native-error', 84))).toContain('84');
  });
  it('asks the connected server for its own name instead of the picker', async () => {
    _connectedConfigs.set(profile.id, { serverUrl: profile.serverUrl } as never);
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ ServerName: 'SALES' }) } as never);
    await openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined }); await flush();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(native.enumServers).not.toHaveBeenCalled();
    expect(native.getState).toHaveBeenCalledWith('admin-host', 'SALES');
  });
  it('takes a display label that matches a registration, and asks only otherwise', async () => {
    native.enumServers.mockResolvedValue(['HRPlan', 'sales']);
    await openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined, name: ' SALES ' }); await flush();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(native.getState).toHaveBeenCalledWith('admin-host', 'sales');
    disposeTm1TopPanelForServer(profile.serverUrl);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('HRPlan' as never);
    await openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined, name: 'Test (11.8)' }); await flush();
    expect(vscode.window.showQuickPick).toHaveBeenCalledOnce();
    expect(native.getState).toHaveBeenCalledWith('admin-host', 'HRPlan');
  });
  it('resolves a manual profile through the sole native registration', async () => {
    native.enumServers.mockResolvedValueOnce(['NativeName']);
    await openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined }); await flush();
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
    expect(native.enumServers).toHaveBeenCalledWith('admin-host');
    expect(native.getState).toHaveBeenCalledWith('admin-host', 'NativeName');
  });
  it('opens disconnected with admin registration, registers and disposes its window', async () => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    expect(native.getState).toHaveBeenCalledWith('admin-host', 'SALES');
    expect(listWindows().some(w => w.kind === 'tm1Top' && w.panel === panel)).toBe(true);
    disposeTm1TopPanelForServer(profile.serverUrl);
    expect(native.dispose).toHaveBeenCalledOnce();
    expect(listWindows().some(w => w.panel === panel)).toBe(false);
  });
  it('rejects v12 before creating a panel', async () => {
    await expect(openTm1TopPanelForProfile(context, { ...profile, version: 'v12' })).rejects.toThrow('v11');
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });
  it('pauses hidden polling and preserves manual pause when revealed', async () => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    native.getState.mockClear();
    Object.assign(panel, { visible: false }); viewChanged();
    await vi.advanceTimersByTimeAsync(6000);
    expect(native.getState).not.toHaveBeenCalled();
    panel.simulateMessage({ command: 'pause', paused: true });
    Object.assign(panel, { visible: true }); viewChanged();
    await vi.advanceTimersByTimeAsync(6000);
    expect(native.getState).not.toHaveBeenCalled();
  });
  it('blocks overlapping polls and never posts a response after disposal', async () => {
    let finish!: (rows: string[]) => void;
    native.getState.mockReturnValue(new Promise<string[]>(resolve => { finish = resolve; }));
    await openTm1TopPanelForProfile(context, profile);
    await vi.advanceTimersByTimeAsync(6000);
    expect(native.getState).toHaveBeenCalledOnce();
    // Live spy before dispose: afterwards `panel.webview` is the silent replacement.
    const post = vi.mocked(panel.webview.postMessage);
    panel.dispose();
    const posts = post.mock.calls.length;
    finish([]); await flush();
    expect(post.mock.calls).toHaveLength(posts);
  });
  it('cannot post an old response into a replacement panel with the same URL', async () => {
    let finish!: (rows: string[]) => void;
    native.getState.mockReturnValueOnce(new Promise<string[]>(resolve => { finish = resolve; }));
    await openTm1TopPanelForProfile(context, profile);
    const old = panel;
    const oldPost = vi.mocked(old.webview.postMessage);
    old.dispose();
    await openTm1TopPanelForProfile(context, profile); await flush();
    const posts = vi.mocked(panel.webview.postMessage).mock.calls.length;
    const oldPosts = oldPost.mock.calls.length;
    finish(['999\told response\t-\tIdle']); await flush();
    expect(vi.mocked(panel.webview.postMessage).mock.calls).toHaveLength(posts);
    expect(oldPost.mock.calls).toHaveLength(oldPosts);
  });
  it('requires verification and confirmation, clears credentials when input changes', async () => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    panel.simulateMessage({ command: 'kill', threadId: '42' }); await flush();
    expect(native.kill).not.toHaveBeenCalled();
    panel.simulateMessage({ command: 'verify', username: 'admin', password: 'secret' }); await flush();
    expect(native.verifyAdmin).toHaveBeenCalledWith('admin-host', 'SALES', 'admin', 'secret');
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Yes, cancel' as never);
    panel.simulateMessage({ command: 'kill', threadId: '42' }); await flush();
    expect(native.kill).toHaveBeenCalledWith('admin-host', 'SALES', '42', 'admin', 'secret');
    panel.simulateMessage({ command: 'invalidate' });
    panel.simulateMessage({ command: 'kill', threadId: '42' }); await flush();
    expect(native.kill).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(panel.webview.postMessage).mock.calls)).not.toContain('secret');
  });
  it('selects the native server when a manual profile has several registrations', async () => {
    native.enumServers.mockResolvedValue(['SALES', 'Another']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce('Another' as never);
    await openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined }); await flush();
    expect(vscode.window.showQuickPick).toHaveBeenCalledOnce();
    expect(native.getState).toHaveBeenCalledWith('admin-host', 'Another');
  });
  it('does not open a panel when native server selection is cancelled', async () => {
    native.enumServers.mockResolvedValueOnce(['A', 'B']);
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
    await openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined });
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(native.dispose).toHaveBeenCalledOnce();
  });
  it('reports an empty native registration list without opening a panel', async () => {
    native.enumServers.mockResolvedValueOnce([]);
    await expect(openTm1TopPanelForProfile(context, { ...profile, discoveredName: undefined })).rejects.toThrow('No native TM1 servers');
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(native.dispose).toHaveBeenCalledOnce();
  });
  it('reveals an existing manual-profile panel without enumerating again', async () => {
    native.enumServers.mockResolvedValueOnce(['NativeName']);
    const manual = { ...profile, discoveredName: undefined };
    await openTm1TopPanelForProfile(context, manual); await flush();
    await openTm1TopPanelForProfile(context, manual);
    expect(native.enumServers).toHaveBeenCalledOnce();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
  });
  it('passes an unbracketed IPv6 admin host to the native API', async () => {
    await saveAdminServer({ id: 'admin', name: 'Admin', serverUrl: 'https://[::1]:5898', rejectUnauthorized: true, hidden: [] });
    await openTm1TopPanelForProfile(context, profile); await flush();
    expect(native.getState).toHaveBeenCalledWith('::1', 'SALES');
  });
  it.each(['Basic', 'CAM'] as const)('only prefills resolved Basic credentials (%s)', async authType => {
    vi.mocked(loadCredentials).mockResolvedValueOnce({ ok: true, authType, username: 'saved-user', password: 'saved-password' });
    await openTm1TopPanelForProfile(context, profile); await flush();
    panel.simulateMessage({ command: 'verify', username: '', password: '' }); await flush();
    if (authType === 'Basic') expect(native.verifyAdmin).toHaveBeenCalledWith('admin-host', 'SALES', 'saved-user', 'saved-password');
    else {
      expect(native.verifyAdmin).not.toHaveBeenCalled();
      expect(panel.webview.html).not.toContain('saved-user');
      panel.simulateMessage({ command: 'verify', username: 'native-admin', password: 'native-password' }); await flush();
      expect(native.verifyAdmin).toHaveBeenCalledWith('admin-host', 'SALES', 'native-admin', 'native-password');
    }
  });
  it.each(['kill-rejected', 'native-api', 'timeout', 'verify-failed'])('handles %s without dropping unrelated authorization', async reason => {
    await openTm1TopPanelForProfile(context, profile); await flush();
    panel.simulateMessage({ command: 'verify', username: 'admin', password: 'pw' }); await flush();
    native.kill.mockRejectedValueOnce(new Tm1TopBridgeError(reason));
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Yes, cancel' as never);
    panel.simulateMessage({ command: 'kill', threadId: '42' }); await flush();
    panel.simulateMessage({ command: 'kill', threadId: '43' }); await flush();
    expect(native.kill).toHaveBeenCalledTimes(reason === 'verify-failed' ? 1 : 2);
  });
  it('gives an actionable rejection message without installation advice', () => {
    expect(nativeErrorMessage(new Tm1TopBridgeError('kill-rejected'))).toContain('may have already finished');
  });
  it('does not authorize an outdated verification after the user edits credentials', async () => {
    let verify!: (ok: boolean) => void;
    native.verifyAdmin.mockReturnValueOnce(new Promise<boolean>(resolve => { verify = resolve; }));
    await openTm1TopPanelForProfile(context, profile); await flush();
    panel.simulateMessage({ command: 'verify', username: 'admin', password: 'secret' });
    panel.simulateMessage({ command: 'invalidate' });
    verify(true); await flush();
    panel.simulateMessage({ command: 'kill', threadId: '42' }); await flush();
    expect(native.kill).not.toHaveBeenCalled();
    expect(vi.mocked(panel.webview.postMessage).mock.calls.some(([message]) => message.verified === true)).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakePanel = () => {
  const panel: any = {
    // `onDidReceiveMessage` returns a Disposable like the real API — the
    // panel host unsubscribes the subscriber on close (B14).
    webview: { html: '', onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._dispose = cb; }),
    reveal: vi.fn(),
    dispose: vi.fn(() => panel._dispose?.()),
  };
  return panel;
};

vi.mock('vscode', async () => {
  const real = await vi.importActual<any>('vscode');
  return {
    ...real,
    window: { ...real.window, createWebviewPanel: vi.fn() },
  };
});

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn().mockResolvedValue({ statusCode: 200, body: '{}' }),
  getConfig: vi.fn(() => ({ serverUrl: 'http://x', username:'u', password:'p', rejectUnauthorized:true })),
}));

import * as vscode from 'vscode';
import { openServerConfigEditor, _resetForTest, disposeServerConfigPanelsForServer } from '../../commands/serverConfig/serverConfigEditor';

const cfg = { serverUrl:'http://x', username:'u', password:'p', rejectUnauthorized:true } as any;

beforeEach(() => { _resetForTest(); vi.mocked(vscode.window.createWebviewPanel).mockReset(); });

describe('serverConfigEditor', () => {
  it('creates one webview panel per server key', async () => {
    const p = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(p as any);

    await openServerConfigEditor(cfg, 'My Server');
    await openServerConfigEditor(cfg, 'My Server');

    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(1);
    expect(p.reveal).toHaveBeenCalled();
  });

  it('disconnecting closes only the windows of THIS server', async () => {
    // The reason for the key `${serverUrl}::<benutzer>|…`: on disconnect the host
    // only finds a window if the key is the URL or starts with
    // `${url}::`. Previously this used `|` throughout — the window stayed
    // open on disconnect and held on to its Tm1Config.
    const a = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(a as any);
    await openServerConfigEditor(cfg, 'A');

    const b = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(b as any);
    await openServerConfigEditor({ ...cfg, serverUrl: 'http://y' } as any, 'B');

    disposeServerConfigPanelsForServer('http://x');

    expect(a.dispose).toHaveBeenCalled();
    expect(b.dispose).not.toHaveBeenCalled();
  });

  it('two logins on the SAME url are two windows', async () => {
    const a = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(a as any);
    await openServerConfigEditor(cfg, 'A');

    const b = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(b as any);
    await openServerConfigEditor({ ...cfg, username: 'u2' } as any, 'A2');

    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(2);
    // ... and disconnecting the instance takes both along.
    disposeServerConfigPanelsForServer('http://x');
    expect(a.dispose).toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalled();
  });

  it('disposes panel cleanly removes manager entry', async () => {
    const p = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(p as any);

    await openServerConfigEditor(cfg, 'My Server');
    p.dispose();

    const p2 = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(p2 as any);
    await openServerConfigEditor(cfg, 'My Server');

    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(2);
  });
});

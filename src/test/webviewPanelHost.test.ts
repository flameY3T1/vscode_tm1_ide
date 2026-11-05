import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { WebviewPanelHost, muteWebviewOnDispose } from '../webviews/webviewPanelHost';
import type { MockWebviewPanel } from './__mocks__/vscode';

const EXT_URI = vscode.Uri.file('/ext');

function makeHost(opts?: { retainContextWhenHidden?: boolean }) {
  const host = new WebviewPanelHost<{ type: string }>('tm1.test', 'TestHost', opts);
  host.initialize(EXT_URI);
  return host;
}

describe('WebviewPanelHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('errors and returns null when not initialized', () => {
    const host = new WebviewPanelHost('tm1.test', 'TestHost');
    const panel = host.open({ key: 'k', title: 'T', html: () => '<x>', onMessage: () => {} });
    expect(panel).toBeNull();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('TestHost not initialized');
  });

  it('creates panel with standard options and renders html', () => {
    const host = makeHost();
    const html = vi.fn(() => '<html-x>');
    const panel = host.open({ key: 'k', title: 'My Title', html, onMessage: () => {} }) as unknown as MockWebviewPanel;
    expect(panel).not.toBeNull();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      'tm1.test', 'My Title', expect.anything(),
      expect.objectContaining({ enableScripts: true, retainContextWhenHidden: true }),
    );
    expect(panel.webview.html).toBe('<html-x>');
    expect(html).toHaveBeenCalledWith(panel.webview, EXT_URI);
    const roots = (panel.options as { localResourceRoots: Array<{ fsPath: string }> }).localResourceRoots;
    expect(roots.map(r => r.fsPath)).toEqual(['/ext/out', '/ext/media']);
    expect(host.get('k')).toBe(panel as unknown as vscode.WebviewPanel);
  });

  it('honors retainContextWhenHidden=false', () => {
    const host = makeHost({ retainContextWhenHidden: false });
    host.open({ key: 'k', title: 'T', html: () => '', onMessage: () => {} });
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.objectContaining({ retainContextWhenHidden: false }),
    );
  });

  it('reveals existing panel instead of creating a second one', () => {
    const host = makeHost();
    const first = host.open({ key: 'k', title: 'T', html: () => '', onMessage: () => {} }) as unknown as MockWebviewPanel;
    const revealSpy = vi.spyOn(first, 'reveal');
    const second = host.open({ key: 'k', title: 'T', html: () => '', onMessage: () => {} });
    expect(second).toBeNull();
    expect(revealSpy).toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('reveal() returns false for unknown key, true for existing', () => {
    const host = makeHost();
    expect(host.reveal('nope')).toBe(false);
    host.open({ key: 'k', title: 'T', html: () => '', onMessage: () => {} });
    expect(host.reveal('k')).toBe(true);
  });

  it('removes panel from map and calls onDispose on dispose', () => {
    const host = makeHost();
    const onDispose = vi.fn();
    const panel = host.open({ key: 'k', title: 'T', html: () => '', onMessage: () => {}, onDispose }) as unknown as MockWebviewPanel;
    panel.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(host.get('k')).toBeUndefined();
    // after dispose, open() creates a fresh panel
    const fresh = host.open({ key: 'k', title: 'T', html: () => '', onMessage: () => {} });
    expect(fresh).not.toBeNull();
  });

  it('disposeAll disposes every panel and clears the map', () => {
    const host = makeHost();
    const p1 = host.open({ key: 'a', title: 'T', html: () => '', onMessage: () => {} }) as unknown as MockWebviewPanel;
    const p2 = host.open({ key: 'b', title: 'T', html: () => '', onMessage: () => {} }) as unknown as MockWebviewPanel;
    const d1 = vi.spyOn(p1, 'dispose');
    const d2 = vi.spyOn(p2, 'dispose');
    host.disposeAll();
    expect(d1).toHaveBeenCalled();
    expect(d2).toHaveBeenCalled();
    expect(host.get('a')).toBeUndefined();
    expect(host.get('b')).toBeUndefined();
  });

  it('routes messages to onMessage with panel', async () => {
    const host = makeHost();
    const onMessage = vi.fn();
    const panel = host.open({ key: 'k', title: 'T', html: () => '', onMessage }) as unknown as MockWebviewPanel;
    panel.simulateMessage({ type: 'ready' });
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledWith({ type: 'ready' }, panel));
  });

  it('shows default error toast with the panel title, not the internal label (A10)', async () => {
    const host = makeHost();
    const panel = host.open({
      key: 'k', title: 'Process Run Analysis', html: () => '',
      onMessage: () => { throw new Error('boom'); },
    }) as unknown as MockWebviewPanel;
    panel.simulateMessage({ type: 'x' });
    await vi.waitFor(() =>
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Process Run Analysis: boom'));
  });

  // --- B14: a closed panel must no longer let running handlers throw ---
  // Reported as three times "Webview is disposed" on disconnect (2026-08-30). The
  // dummy throws here on its own (`postMessage` checks `_disposed`), so the test
  // checks behavior, not politeness.

  it('a running handler posts into the void after closing instead of throwing', async () => {
    const host = makeHost();
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });
    let posted: unknown;
    let thrown: unknown;

    const panel = host.open({
      key: 'k', title: 'T', html: () => '',
      onMessage: async (_msg, p) => {
        await gate;
        try { posted = await p.webview.postMessage({ type: 'done' }); }
        catch (e) { thrown = e; }
      },
    }) as unknown as MockWebviewPanel;

    panel.simulateMessage({ type: 'load' });
    panel.dispose();          // in the middle of the handler, as on disconnect
    release();
    await vi.waitFor(() => expect(posted !== undefined || thrown !== undefined).toBe(true));

    expect(thrown).toBeUndefined();
    expect(posted).toBe(false);   // "not delivered", no silent success
  });

  it('the message subscriber is unsubscribed on close', () => {
    const host = makeHost();
    const onMessage = vi.fn();
    const panel = host.open({ key: 'k', title: 'T', html: () => '', onMessage }) as unknown as MockWebviewPanel;
    panel.dispose();
    panel.simulateMessage({ type: 'spaet' });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('an error AFTER closing is no longer reported', async () => {
    const host = makeHost();
    const onError = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });
    let done = false;

    const panel = host.open({
      key: 'k', title: 'T', html: () => '',
      onMessage: async () => { await gate; done = true; throw new Error('abgebrochen'); },
      onError,
    }) as unknown as MockWebviewPanel;

    panel.simulateMessage({ type: 'load' });
    panel.dispose();
    release();
    await vi.waitFor(() => expect(done).toBe(true));

    expect(onError).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('uses onError override instead of toast, also for async rejections', async () => {
    const host = makeHost();
    const onError = vi.fn();
    const panel = host.open({
      key: 'k', title: 'T', html: () => '',
      onMessage: async () => { throw new Error('async-boom'); },
      onError,
    }) as unknown as MockWebviewPanel;
    panel.simulateMessage({ type: 'save' });
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith('async-boom', { type: 'save' }, panel));
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});

describe('muteWebviewOnDispose — the same guard for panels without a host', () => {
  it('postMessage after closing returns false instead of throwing', async () => {
    const panel = vscode.window.createWebviewPanel('t', 'T', vscode.ViewColumn.Active, {});
    muteWebviewOnDispose(panel);
    (panel as unknown as MockWebviewPanel).dispose();
    // Without the guard the dummy throws "Webview is disposed" here, like VS Code.
    await expect(panel.webview.postMessage({ type: 'late' })).resolves.toBe(false);
  });

  it('before closing the real webview stays on the panel', async () => {
    const panel = vscode.window.createWebviewPanel('t', 'T', vscode.ViewColumn.Active, {});
    muteWebviewOnDispose(panel);
    await expect(panel.webview.postMessage({ type: 'live' })).resolves.toBe(true);
  });
});


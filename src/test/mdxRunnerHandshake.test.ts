import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Keep mocks vscode-free and side-effect-free; mirrors dimensionBrowserMessaging.test.ts.
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../commands/mdx/mdxRunnerWebview', () => ({ getMdxRunnerHtml: vi.fn(() => '<html></html>') }));

import * as vscode from 'vscode';
import { MdxRunnerManager } from '../commands/mdx/mdxRunner';

const CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', rejectUnauthorized: false, authType: 'Basic' as const };

function fakeContext(): any {
  const store: Record<string, unknown> = {};
  return {
    extensionUri: { fsPath: '/ext' },
    globalState: {
      get: (key: string, def: unknown) => (store[key] !== undefined ? store[key] : def),
      update: (key: string, val: unknown) => { store[key] = val; return Promise.resolve(); },
    },
  };
}

/** Last panel created via vscode.window.createWebviewPanel — untyped, mock's
 *  MockWebviewPanel shape (webview.postMessage, simulateMessage, dispose). */
function lastPanel(): any {
  const calls = (vscode.window.createWebviewPanel as any).mock.results;
  return calls[calls.length - 1].value;
}

describe('MdxRunnerManager webviewReady handshake (P1-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (MdxRunnerManager as any)._panels?.clear?.();
    // _pendingMdx is a WeakMap<panel, string> (P1-8 review) — no .clear() to
    // call; each test's panels are fresh objects so nothing to reset anyway.
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resends the initial history payload on webviewReady, with no setTimeout involved', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const ctx = fakeContext();
    MdxRunnerManager.open(ctx, 'srv-1', CONFIG, 'Srv1');
    const panel = lastPanel();

    // Eager post happened synchronously during open() — no timer needed.
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'historyUpdate', entries: [] }),
    );
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'historyUpdate', entries: [] }),
    );
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    MdxRunnerManager.disposeAll();
  });

  it('resends the stashed prefill MDX on webviewReady when Monaco is not ready yet, with no timer', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const ctx = fakeContext();
    MdxRunnerManager.initialize(ctx);
    const mdx = 'SELECT {[Measures].members} ON 0 FROM [Cube]';
    MdxRunnerManager.openWithMdx(CONFIG, 'Srv2', mdx);

    const panel = lastPanel();
    // Eager attempt fired synchronously.
    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'loadMdx', mdx }),
    );
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    // Simulate slow Monaco cold-start: webview only signals ready afterwards.
    panel.webview.postMessage.mockClear();
    panel.simulateMessage({ type: 'webviewReady' });

    expect(panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'loadMdx', mdx }),
    );
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    MdxRunnerManager.disposeAll();
  });

  it('does not throw when webviewReady arrives after the panel was disposed', () => {
    const ctx = fakeContext();
    MdxRunnerManager.open(ctx, 'srv-3', CONFIG, 'Srv3');
    const panel = lastPanel();

    panel.dispose();
    expect(() => panel.simulateMessage({ type: 'webviewReady' })).not.toThrow();
  });

  it('never replays stale prefill MDX into a new panel reusing the same server key (WeakMap<panel> keying, P1-8)', () => {
    const ctx = fakeContext();
    MdxRunnerManager.initialize(ctx);
    const mdx = 'SELECT {[Measures].members} ON 0 FROM [Cube]';
    MdxRunnerManager.openWithMdx(CONFIG, 'Srv4', mdx);

    const firstPanel = lastPanel();
    firstPanel.dispose();

    // A brand-new panel for the same server key, opened WITHOUT openWithMdx.
    // With the old string-keyed Map this relied on an explicit
    // `_pendingMdx.delete(key)` in the dispose handler; with a
    // WeakMap<WebviewPanel, string> it is impossible by construction — the
    // new panel is a distinct object identity, so `.get(secondPanel)` can
    // never resolve firstPanel's entry even if a future edit dropped the
    // (now-removed) explicit delete.
    MdxRunnerManager.open(ctx, 'Srv4', CONFIG, 'Srv4');
    const secondPanel = lastPanel();
    expect(secondPanel).not.toBe(firstPanel);

    secondPanel.webview.postMessage.mockClear();
    secondPanel.simulateMessage({ type: 'webviewReady' });

    expect(secondPanel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'loadMdx' }),
    );
  });
});

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';

// Locks the mock's post-dispose contract: real VS Code throws
// "Webview is disposed" on postMessage / html-set after dispose. If this
// regressed to a silent no-op, the poller post-after-dispose bug class
// (threads/messageLog) would pass green in the whole suite.
describe('MockWebviewPanel post-dispose contract', () => {
  function makePanel() {
    return vscode.window.createWebviewPanel('tm1.test', 'T', 1 as any, {});
  }

  it('postMessage resolves true while alive', async () => {
    const panel = makePanel();
    await expect(panel.webview.postMessage({ type: 'x' })).resolves.toBe(true);
  });

  it('postMessage throws after dispose', () => {
    const panel = makePanel();
    panel.dispose();
    expect(() => panel.webview.postMessage({ type: 'x' })).toThrow(/disposed/i);
  });

  it('setting html throws after dispose', () => {
    const panel = makePanel();
    panel.webview.html = '<p>ok</p>';
    expect(panel.webview.html).toBe('<p>ok</p>');
    panel.dispose();
    expect(() => { panel.webview.html = '<p>late</p>'; }).toThrow(/disposed/i);
  });
});

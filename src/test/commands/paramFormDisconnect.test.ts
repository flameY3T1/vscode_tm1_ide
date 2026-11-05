// What happens on disconnect with a waiting wizard (lever B).
//
// The parameter form is not a window you leave standing on the side: a
// caller hangs in `await` and only gets an answer once the form is
// submitted or closed. Before the rework there was no way to close it from
// outside — on disconnect it stayed open, with the server URL in
// the closure, and the caller kept waiting.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakePanel = () => {
  const panel: any = {
    title: '',
    webview: {
      html: '', cspSource: 'vscode-webview:', asWebviewUri: (u: unknown) => u,
      // Returns a Disposable like the real API: the panel host unsubscribes
      // the subscriber on close (B14).
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })), postMessage: vi.fn(),
    },
    onDidDispose: vi.fn((cb) => { panel._dispose = cb; }),
    reveal: vi.fn(),
    dispose: vi.fn(() => panel._dispose?.()),
  };
  return panel;
};

vi.mock('vscode', async () => {
  const real = await vi.importActual<any>('vscode');
  return { ...real, window: { ...real.window, createWebviewPanel: vi.fn() } };
});

import * as vscode from 'vscode';
import { showServerParameterForm, disposeParamFormsForServer } from '../../commands/processEditor/processParams';

const PARAMS = [{ Name: 'pDim', Type: 'String', Value: 'x', Prompt: 'Dimension' }];

beforeEach(() => { vi.mocked(vscode.window.createWebviewPanel).mockReset(); });

describe('parameter form — disconnecting ends the wait', () => {
  it('closing by the server disconnect resolves with undefined', async () => {
    const p = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(p as never);

    const pending = showServerParameterForm('proc', PARAMS, 'Run', 'http://x');
    disposeParamFormsForServer('http://x');

    await expect(pending).resolves.toBeUndefined();
    expect(p.dispose).toHaveBeenCalled();
  });

  it('a form on a different server stays open', async () => {
    const p = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(p as never);

    const pending = showServerParameterForm('proc', PARAMS, 'Run', 'http://x');
    disposeParamFormsForServer('http://y');
    expect(p.dispose).not.toHaveBeenCalled();

    // Clean up so the promise does not stay pending.
    disposeParamFormsForServer('http://x');
    await expect(pending).resolves.toBeUndefined();
  });

  it('two forms at the same time are two windows, not a reused one', async () => {
    // The reason for the running number in the key: with a fixed
    // key per process the host would only have let the second call bring the first
    // window to the front — and the second caller would hang forever.
    const a = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(a as never);
    const first = showServerParameterForm('proc', PARAMS, 'Run', 'http://x');

    const b = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(b as never);
    const second = showServerParameterForm('proc', PARAMS, 'Run', 'http://x');

    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(2);

    disposeParamFormsForServer('http://x');
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });
});

describe('parameter form — bundle root', () => {
  // Regression 2026-10-28: both form hosts were initialized with '/', so the
  // bundle tag pointed at /out/webview/paramForm.js, nothing loaded, and
  // neither Enter, Execute nor Cancel did anything. Only a click showed it.
  it('loads its script from the extension root, not from /', async () => {
    const { setExtensionContext } = await import('../../utils/extensionContext');
    setExtensionContext({ extensionUri: vscode.Uri.file('/ext'), globalState: { get: () => undefined, update: async () => {} } } as never);
    const p = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(p as never);

    const pending = showServerParameterForm('proc', PARAMS, 'Run', 'http://root');
    await vi.waitFor(() => expect(p.webview.html).not.toBe(''));
    expect(p.webview.html).toContain('src="/ext/out/webview/paramForm.js"');

    disposeParamFormsForServer('http://root');
    await expect(pending).resolves.toBeUndefined();
    setExtensionContext(undefined as never);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../webviews/renderSummaryHtml', () => ({
  renderSummaryHtml: vi.fn(() => '<html></html>'),
}));

import { TiTestSummaryWebviewManager } from '../webviews/tiTestSummaryWebview';

function fakePanel(): any {
  const panel: any = {
    title: '',
    viewColumn: 1,
    webview: { html: '', asWebviewUri: (u: unknown) => u, onDidReceiveMessage: vi.fn(), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._dispose = cb; }),
    reveal: vi.fn(),
    dispose: vi.fn(() => panel._dispose?.()),
  };
  return panel;
}

/** Pull the message router registered via onDidReceiveMessage. */
function capturedRouter(panel: any): (msg: unknown) => void {
  return panel.webview.onDidReceiveMessage.mock.calls[0][0];
}

const ROWS = [{ id: 't1', name: 'Test 1', status: 'pass' }] as never;

beforeEach(() => {
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
});

describe('TiTestSummaryWebviewManager — message router', () => {
  function setup() {
    const panel = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    const handlers = {
      onShowDiff: vi.fn(),
      onRerunAll: vi.fn(),
      onRerunFailed: vi.fn(),
    };
    const mgr = new TiTestSummaryWebviewManager();
    mgr.show('folderA', 'Folder A', ROWS, handlers);
    return { panel, handlers, mgr, route: capturedRouter(panel) };
  }

  it('showDiff — forwards folder to onShowDiff', () => {
    const { handlers, route } = setup();
    route({ type: 'showDiff', folder: 'sub/x' });
    expect(handlers.onShowDiff).toHaveBeenCalledWith('sub/x');
  });

  it('showDiff — ignored when folder missing', () => {
    const { handlers, route } = setup();
    route({ type: 'showDiff' });
    expect(handlers.onShowDiff).not.toHaveBeenCalled();
  });

  it('rerunAll — invokes onRerunAll', () => {
    const { handlers, route } = setup();
    route({ type: 'rerunAll' });
    expect(handlers.onRerunAll).toHaveBeenCalledTimes(1);
  });

  it('rerunFailed — invokes onRerunFailed', () => {
    const { handlers, route } = setup();
    route({ type: 'rerunFailed' });
    expect(handlers.onRerunFailed).toHaveBeenCalledTimes(1);
  });

  it('unknown type — no handler fired', () => {
    const { handlers, route } = setup();
    route({ type: 'bogus' });
    expect(handlers.onShowDiff).not.toHaveBeenCalled();
    expect(handlers.onRerunAll).not.toHaveBeenCalled();
    expect(handlers.onRerunFailed).not.toHaveBeenCalled();
  });

  it('reuses one panel per folderKey (second show reveals, no new panel)', () => {
    const { mgr, handlers, panel } = setup();
    mgr.show('folderA', 'Folder A', ROWS, handlers);
    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(1);
    expect(panel.reveal).toHaveBeenCalled();
  });
});

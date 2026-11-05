import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { listWindows, clearWindowsForTest } from '../../workbench/windowRegistry';

describe('WebviewPanelHost registers its panels', () => {
  beforeEach(() => { clearWindowsForTest(); vi.restoreAllMocks(); });

  it('registers on open with viewType as kind and the raw key', () => {
    const host = new WebviewPanelHost('tm1.demoPanel', 'Demo');
    host.initialize(vscode.Uri.file('/ext'));
    host.open({
      key: 'http://s::Reporting',
      title: 'Demo',
      html: () => '<html></html>',
      onMessage: () => undefined,
    });
    expect(listWindows()).toHaveLength(1);
    expect(listWindows()[0].kind).toBe('tm1.demoPanel');
    expect(listWindows()[0].rawKey).toBe('http://s::Reporting');
  });

  it('unregisters when the panel is disposed', () => {
    const host = new WebviewPanelHost('tm1.demoPanel', 'Demo');
    host.initialize(vscode.Uri.file('/ext'));
    const panel = host.open({
      key: 'http://s::Reporting',
      title: 'Demo',
      html: () => '<html></html>',
      onMessage: () => undefined,
    });
    panel?.dispose();
    expect(listWindows()).toHaveLength(0);
  });
});

// Column choice when opening the Dimension Browser.
//
// Background: if you drag an editor via "Move Editor into New Window" into a
// VS Code window of its own (auxiliary window), a panel opened from there should
// appear in the SAME window. According to `@types/vscode`, `ViewColumn.One` is an
// ABSOLUTE value ("The first editor column") and therefore always points to the
// main window; `ViewColumn.Active` (= -1) is symbolic ("the currently
// active column"). The browser passed a hard-coded `One` and therefore always landed
// in the main window — that is what this file guards against.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// As in dimensionBrowserMessaging.test.ts: the deep tm1Rest layers import
// the transport DIRECTLY (`no-tm1client-in-deep-layers`). Point both paths at the same
// doubles, otherwise the tests hit the real network and end in a timeout.
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../commands/dimension/dimensionBrowserWebview', () => ({ getHtml: vi.fn(() => '<html></html>') }));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));
vi.mock('../commands/mdx/mdxRunner', () => ({ MdxRunnerManager: { openWithMdx: vi.fn() } }));
vi.mock('../tm1Rest/dimensionApi', () => ({
  listDimensionNames: vi.fn(),
  listHierarchyNames: vi.fn(),
}));
vi.mock('../tm1Rest/cubeApi', () => ({ getCube: vi.fn() }));
vi.mock('../tm1Rest/subsetApi', () => ({
  listSubsetNames: vi.fn(),
  listSubsetInfos: vi.fn(),
  subsetExists: vi.fn(),
  deleteSubset: vi.fn(),
  createSubset: vi.fn(),
  updateSubset: vi.fn(),
  clearSubsetElements: vi.fn(),
  subsetElementCount: vi.fn(),
  listSubsetElementNames: vi.fn(),
  getSubset: vi.fn(),
}));

import * as vscode from 'vscode';
import {
  openDimensionBrowser, initializeDimensionBrowser, disposeDimensionBrowserForServer,
} from '../commands/dimension/dimensionBrowser';
import { listDimensionNames, listHierarchyNames } from '../tm1Rest/dimensionApi';

const CONFIG = {
  serverUrl: 'http://tm1:8001',
  username: 'admin',
  password: 'p',
  rejectUnauthorized: false,
  authType: 'Basic' as const,
};

/** The `showOptions` argument (3rd parameter) of the most recently created panel. */
function lastShowOptions(): unknown {
  const calls = (vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][2];
}

function lastPanel(): { reveal: ReturnType<typeof vi.fn> } {
  const results = (vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock.results;
  return results[results.length - 1].value;
}

describe('dimension browser — column choice', () => {
  beforeEach(() => {
    disposeDimensionBrowserForServer(CONFIG.serverUrl);
    vi.clearAllMocks();
    (listDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D']);
    (listHierarchyNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D']);
    initializeDimensionBrowser(vscode.Uri.file('/ext'));
  });

  it('opens in the symbolic active column, NOT in hard-coded column One', async () => {
    await openDimensionBrowser('D', CONFIG);
    // `Active` follows the window from which it was opened; `One` forces
    // the panel into the main window — exactly the reported bug.
    expect(lastShowOptions()).toBe(vscode.ViewColumn.Active);
    expect(lastShowOptions()).not.toBe(vscode.ViewColumn.One);
  });

  it('selection-mode picker also avoids the hard-coded column One', async () => {
    await openDimensionBrowser('D', CONFIG, { mode: 'selection', multiSelect: false } as never);
    expect(lastShowOptions()).toBe(vscode.ViewColumn.Active);
    expect(lastShowOptions()).not.toBe(vscode.ViewColumn.One);
  });

  it('honors a caller-supplied column (cube viewer in an auxiliary window)', async () => {
    await openDimensionBrowser('D', CONFIG, {
      mode: 'selection', multiSelect: false, viewColumn: vscode.ViewColumn.Three,
    } as never);
    expect(lastShowOptions()).toBe(vscode.ViewColumn.Three);
  });

  it('forwards column Two as well — the caller decides, not the browser', async () => {
    await openDimensionBrowser('D', CONFIG, {
      mode: 'selection', multiSelect: false, viewColumn: vscode.ViewColumn.Two,
    } as never);
    expect(lastShowOptions()).toBe(vscode.ViewColumn.Two);
  });

  it('an explicitly undefined caller column falls back to the host default, not to One', async () => {
    await openDimensionBrowser('D', CONFIG, {
      mode: 'selection', multiSelect: false, viewColumn: undefined,
    } as never);
    expect(lastShowOptions()).toBe(vscode.ViewColumn.Active);
    expect(lastShowOptions()).not.toBe(vscode.ViewColumn.One);
  });

  it('reveals an already open standalone panel WITHOUT moving it to another column', async () => {
    await openDimensionBrowser('D', CONFIG);
    const panel = lastPanel();
    panel.reveal.mockClear();

    await openDimensionBrowser('D', CONFIG);

    // No second panel …
    expect((vscode.window.createWebviewPanel as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    // … and `reveal()` without an argument: according to the d.ts "Shows in the current
    // WebviewPanel.viewColumn if undefined" — the panel stays where the user
    // dragged it.
    expect(panel.reveal).toHaveBeenCalled();
    expect(panel.reveal.mock.calls[0]).toEqual([]);
  });
});

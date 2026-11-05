import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as vscode from 'vscode';

// Click test 2026-09-14: view A opened, view B loaded in the same panel
// (or B created via "Save As") — the tab was still called "A", and the
// workbench also saved the window as "A". `panel.title` was only set
// in `createWebviewPanel`, and `captureCubeViewerState` cut the
// name out of the immutable panel key instead of out of the mirror
// `_panelViewState`, which had long known the current view.

vi.mock('../../commands/cubeViewer/state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commands/cubeViewer/state')>()),
  runSerializedRefresh: vi.fn((_key: string, task: () => Promise<void>) => task()),
}));
vi.mock('../../commands/cubeViewer/fetch', () => ({
  _fetchViewAxisConfig: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../commands/cubeViewer/alias', () => ({
  fetchViewDimAliases: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../commands/cubeViewer/view', () => ({
  _readExistingView: vi.fn().mockResolvedValue(undefined),
  _saveView: vi.fn().mockResolvedValue('saved'),
  saveMdxView: vi.fn().mockResolvedValue('saved'),
  _viewAxisBaseline: vi.fn().mockResolvedValue({}),
  clearViewAxisWarnings: vi.fn(),
  refreshCurrentLayout: vi.fn().mockResolvedValue(undefined),
}));
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../../serverState/state', async () => await import('../../commands/serverManager'));
vi.mock('../../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(),
  formatServerLabel: vi.fn(() => 'Srv'),
}));
vi.mock('../../commands/workbench/askPanelState', () => ({
  askPanelState: vi.fn().mockResolvedValue({}),
}));

import { _handleMessage, clearPanelMessagingState, getPanelViewState } from '../../commands/cubeViewer/messaging';
import { captureCubeViewerState } from '../../commands/workbench/captureCubeViewer';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CONFIG = { serverUrl: 'https://h:12354', authType: 'Basic', username: 'u', password: 'p' } as unknown as Tm1Config;
const CUBE = 'Reporting';
// The key as `manager.ts#open` builds it for view A — and never changes it.
const KEY = `${CONFIG.serverUrl}:${CUBE}:ViewA`;

function makePanel(): vscode.WebviewPanel {
  return {
    title: 'Srv : Reporting / ViewA',
    webview: { postMessage: vi.fn().mockResolvedValue(true) },
  } as unknown as vscode.WebviewPanel;
}

function call(panel: vscode.WebviewPanel, msg: Record<string, unknown>) {
  return _handleMessage(KEY, panel, msg as never, CUBE, 'ViewA', false, CONFIG);
}

const SAVE = {
  type: 'saveView', viewName: 'ViewB', isPrivate: false, overwrite: false,
  rowDims: ['Region'], colDims: ['Month'], titleAssignments: {}, dimSubsets: {},
  suppressRows: false, suppressCols: false, dimAliases: {}, titleSubsets: {},
};

beforeEach(() => { clearPanelMessagingState(KEY); });

describe('cube viewer: tab title and workbench view follow the CURRENT view', () => {
  it.each([
    { type: 'switchView', viewName: 'ViewB', isPrivate: true },
    { ...SAVE, isPrivate: true },
    { type: 'saveMdxView', viewName: 'ViewB', isPrivate: true, overwrite: false, mdx: 'SELECT ...' },
  ])('retains the current view after a pivot following $type', async message => {
    const panel = makePanel();
    await call(panel, message);
    await call(panel, { type: 'refreshData', existingViewName: null, rowDims: ['Region'], colDims: ['Month'] });
    expect(getPanelViewState(KEY)?.viewName).toBeUndefined();
    expect(await captureCubeViewerState(panel, KEY, CUBE)).toMatchObject({ viewName: 'ViewB', isPrivate: true });
    clearPanelMessagingState(KEY);
    expect(await captureCubeViewerState(panel, KEY, CUBE)).toMatchObject({ viewName: 'ViewA', isPrivate: undefined });
  });

  it('switchView sets the tab title to the loaded view', async () => {
    const panel = makePanel();
    await call(panel, { type: 'switchView', viewName: 'ViewB', isPrivate: true });
    expect(panel.title).toBe('Srv : Reporting / ViewB');
    expect(getPanelViewState(KEY)).toEqual({ viewName: 'ViewB', isPrivate: true, titleOverride: false });
  });

  it('saveView ("Save As") sets title and mirror to the saved view', async () => {
    const panel = makePanel();
    await call(panel, SAVE);
    expect(panel.title).toBe('Srv : Reporting / ViewB');
    expect(getPanelViewState(KEY)?.viewName).toBe('ViewB');
  });

  it('saveMdxView sets title and mirror likewise', async () => {
    const panel = makePanel();
    await call(panel, { type: 'saveMdxView', viewName: 'MdxB', isPrivate: false, overwrite: false, mdx: 'SELECT ...' });
    expect(panel.title).toBe('Srv : Reporting / MdxB');
    expect(getPanelViewState(KEY)?.viewName).toBe('MdxB');
  });

  it('a failed save leaves title and mirror in place', async () => {
    const { _saveView } = await import('../../commands/cubeViewer/view');
    (_saveView as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const panel = makePanel();
    await call(panel, SAVE);
    expect(panel.title).toBe('Srv : Reporting / ViewA');
    expect(getPanelViewState(KEY)).toBeUndefined();
  });

  it('the workbench saves the window under the CURRENT view, not the one from opening', async () => {
    const panel = makePanel();
    await call(panel, { type: 'switchView', viewName: 'ViewB', isPrivate: true });
    const state = await captureCubeViewerState(panel, KEY, CUBE);
    expect(state.viewName).toBe('ViewB');
    expect(state.isPrivate).toBe(true);
  });

  it('without a view in the mirror (pivot) the key stays authoritative', async () => {
    const panel = makePanel();
    // A pivot leaves view mode (`existingViewName: null`) — the name
    // is still the identity of the window and must not get lost.
    await call(panel, { type: 'refreshData', existingViewName: null, rowDims: ['Region'], colDims: ['Month'] });
    expect(getPanelViewState(KEY)?.viewName).toBeUndefined();
    const state = await captureCubeViewerState(panel, KEY, CUBE);
    expect(state.viewName).toBe('ViewA');
  });
});

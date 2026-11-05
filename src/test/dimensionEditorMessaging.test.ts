import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// Shared DimensionApi instance methods, controllable per-test.
const api = vi.hoisted(() => ({
  fetchHierarchyList: vi.fn(),
  fetchSnapshot: vi.fn(),
  fetchHierarchyContent: vi.fn(),
}));

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn().mockResolvedValue({ statusCode: 200, body: '{}' }) }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/dimensionApi', () => ({
  DimensionApi: class {
    fetchHierarchyList = api.fetchHierarchyList;
    fetchSnapshot = api.fetchSnapshot;
    fetchHierarchyContent = api.fetchHierarchyContent;
  },
  apiFetch: vi.fn(),
}));
vi.mock('../providers/fetchNames', () => ({
  fetchNames: vi.fn().mockResolvedValue([]),
  invalidateCache: vi.fn(),
}));
vi.mock('../tm1Rest/cubeApi', () => ({ getCube: vi.fn(), listCubes: vi.fn() }));
vi.mock('../tm1Rest/subsetApi', () => ({ listSubsetsWithElements: vi.fn() }));
vi.mock('../dimensionEditor/diff', () => ({ computeDiff: vi.fn() }));
vi.mock('../dimensionEditor/commitPlanner', () => ({ planCommit: vi.fn() }));
vi.mock('../dimensionEditor/restEditCommitter', () => ({ commitChanges: vi.fn() }));
vi.mock('../dimensionEditor/restCreateCommitter', () => ({ commitNewDimension: vi.fn() }));
vi.mock('../usageCheck/elementUsage', () => ({ findElementReferences: vi.fn() }));
vi.mock('../references/referenceIndexService', () => ({ getOrBuildIndex: vi.fn() }));
vi.mock('../commands/cubeViewer/manager', () => ({ CubeViewerManager: { open: vi.fn() } }));
vi.mock('../commands/dimension/dimensionEditorWebview', () => ({ getDimensionEditorHtml: vi.fn(() => '<html></html>') }));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));

import { DimensionEditorManager } from '../commands/dimension/dimensionEditor';
import { getCube, listCubes } from '../tm1Rest/cubeApi';
import { computeDiff } from '../dimensionEditor/diff';
import { planCommit } from '../dimensionEditor/commitPlanner';
import { commitChanges } from '../dimensionEditor/restEditCommitter';
import { commitNewDimension } from '../dimensionEditor/restCreateCommitter';
import { findElementReferences } from '../usageCheck/elementUsage';
import { getOrBuildIndex } from '../references/referenceIndexService';
import { CubeViewerManager } from '../commands/cubeViewer/manager';

const CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', rejectUnauthorized: false, authType: 'Basic' as const };
const SNAP = { dimName: 'D', hierarchies: ['D'], perHier: { D: { elements: [], edges: [], attrDefs: [] } } };

function fakePanel(): any {
  const panel: any = {
    title: '', viewColumn: 1,
    webview: { html: '', onDidReceiveMessage: vi.fn(), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._dispose = cb; }),
    reveal: vi.fn(), dispose: vi.fn(() => panel._dispose?.()),
  };
  return panel;
}
const router = (p: any) => p.webview.onDidReceiveMessage.mock.calls[0][0];
const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
  (vscode.window.showWarningMessage as any) = vi.fn();
  (vscode.window.showErrorMessage as any) = vi.fn();
  DimensionEditorManager.initialize(vscode.Uri.file('/ext'));
  (DimensionEditorManager as any)._panels?.clear?.();
});

async function setup() {
  const panel = fakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
  await DimensionEditorManager.open('D', CONFIG);
  return { panel, route: router(panel) };
}

describe('DimensionEditorManager — message router', () => {
  it('ready — loads default hier and posts initData', async () => {
    api.fetchHierarchyList.mockResolvedValue(['D']);
    api.fetchSnapshot.mockResolvedValue(SNAP);
    (getCube as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { panel, route } = await setup();
    await route({ type: 'ready' });
    expect(posted(panel).some((m: any) => m.type === 'initData')).toBe(true);
  });

  it('ready — posts loadError when snapshot fetch throws', async () => {
    api.fetchHierarchyList.mockResolvedValue(['D']);
    api.fetchSnapshot.mockRejectedValue(new Error('boom'));
    const { panel, route } = await setup();
    await route({ type: 'ready' });
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'loadError', message: 'boom' }));
  });

  it('fetchHier — posts mergeHier with content on success', async () => {
    api.fetchHierarchyContent.mockResolvedValue({ elements: [] });
    const { panel, route } = await setup();
    await route({ type: 'fetchHier', hier: 'Alt' });
    expect(posted(panel)).toContainEqual({ type: 'mergeHier', hier: 'Alt', content: { elements: [] } });
  });

  it('fetchHier — posts mergeHier with error on failure', async () => {
    api.fetchHierarchyContent.mockRejectedValue(new Error('nope'));
    const { panel, route } = await setup();
    await route({ type: 'fetchHier', hier: 'Alt' });
    expect(posted(panel)).toContainEqual({ type: 'mergeHier', hier: 'Alt', error: 'nope' });
  });

  it('fetchHier — no-op when hier missing', async () => {
    const { panel, route } = await setup();
    await route({ type: 'fetchHier' });
    expect(api.fetchHierarchyContent).not.toHaveBeenCalled();
    expect(posted(panel)).not.toContainEqual(expect.objectContaining({ type: 'mergeHier' }));
  });

  it('checkUsage — posts confirmDelete with usages', async () => {
    (getOrBuildIndex as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (listCubes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (findElementReferences as ReturnType<typeof vi.fn>).mockResolvedValue([{ kind: 'cube', name: 'C' }]);
    const { panel, route } = await setup();
    await route({ type: 'checkUsage', elements: ['E'] });
    expect(posted(panel)).toContainEqual({
      type: 'confirmDelete', elements: ['E'], usages: [{ kind: 'cube', name: 'C', element: 'E' }],
    });
  });

  it('checkUsage — posts empty usages and warns on error', async () => {
    (getOrBuildIndex as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('idx fail'));
    const { panel, route } = await setup();
    await route({ type: 'checkUsage', elements: ['E'] });
    expect(posted(panel)).toContainEqual({ type: 'confirmDelete', elements: ['E'], usages: [] });
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('saveAsNew — builds a full-state draft targeting the new dim and commits via commitNewDimension', async () => {
    (vscode.window.showInputBox as any) = vi.fn().mockResolvedValue('NewDim');
    (vscode.window.showInformationMessage as any) = vi.fn();
    (commitNewDimension as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, errors: [], serverMayHaveChanged: true });
    const { route } = await setup();
    await route({
      type: 'saveAsNew',
      state: {
        dimName: 'D', hierName: 'D', hierarchies: ['D'], attrDefs: [],
        elements: { A: { name: 'A', type: 'N', attrs: {}, marked: 'clean' } },
        edges: [], snapshot: SNAP, dirty: false,
      },
    });
    expect(commitNewDimension).toHaveBeenCalledTimes(1);
    const [stateArg, dimArg, hierArg] = (commitNewDimension as ReturnType<typeof vi.fn>).mock.calls[0];
    // A full draft targets the new dim completely (empty snapshot → everything is adds
    // via commitNewDimension, no detour via diff/plan anymore).
    expect(dimArg).toBe('NewDim');
    expect(hierArg).toBe('NewDim');
    expect(stateArg.dimName).toBe('NewDim');
    expect(stateArg.hierName).toBe('NewDim');
    expect(stateArg.snapshot.perHier.NewDim).toEqual({ elements: [], edges: [], attrDefs: [] });
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it('saveAsNew — cancelled name prompt creates nothing', async () => {
    (vscode.window.showInputBox as any) = vi.fn().mockResolvedValue(undefined);
    const { route } = await setup();
    await route({
      type: 'saveAsNew',
      state: { dimName: 'D', hierName: 'D', hierarchies: ['D'], attrDefs: [], elements: {}, edges: [], snapshot: SNAP, dirty: false },
    });
    expect(commitNewDimension).not.toHaveBeenCalled();
  });

  it('commit — posts commitResult ok=false when diff computation throws', async () => {
    (computeDiff as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('diff fail'); });
    const { panel, route } = await setup();
    await route({ type: 'commit', state: { dimName: 'D', hierName: 'D', attrDefs: [], elements: [], edges: [] } });
    expect(posted(panel)).toContainEqual({
      type: 'commitResult', ok: false, errors: [{ message: 'diff fail' }],
    });
  });

  it('commit — success posts commitResult ok and reloads initData', async () => {
    (computeDiff as ReturnType<typeof vi.fn>).mockReturnValue({});
    (planCommit as ReturnType<typeof vi.fn>).mockReturnValue({ orderedChanges: [] });
    (commitChanges as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, errors: [], serverMayHaveChanged: true });
    api.fetchSnapshot.mockResolvedValue(SNAP);
    const { panel, route } = await setup();
    await route({ type: 'commit', state: { dimName: 'D', hierName: 'D', attrDefs: [], elements: [], edges: [] } });
    expect(posted(panel)).toContainEqual({ type: 'commitResult', ok: true, errors: [] });
    expect(posted(panel).some((m: any) => m.type === 'initData')).toBe(true);
  });

  it('commit — partial failure (some applied) re-bases the snapshot and keeps the working state', async () => {
    (computeDiff as ReturnType<typeof vi.fn>).mockReturnValue({});
    (planCommit as ReturnType<typeof vi.fn>).mockReturnValue({ orderedChanges: [] });
    (commitChanges as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      errors: [{ message: 'elem 30 failed' }],
      serverMayHaveChanged: true,
    });
    api.fetchSnapshot.mockResolvedValue(SNAP);
    const { panel, route } = await setup();
    await route({ type: 'commit', state: { dimName: 'D', hierName: 'D', attrDefs: [], elements: [], edges: [] } });
    expect(posted(panel).some((m: any) => m.type === 'commitResult' && m.ok === false)).toBe(true);
    // New baseline from the server (no double apply on retry), but the working
    // state stays — initData would discard the changes that were not applied.
    expect(posted(panel).some((m: any) => m.type === 'rebaseSnapshot' && m.snapshot === SNAP)).toBe(true);
    expect(posted(panel).some((m: any) => m.type === 'initData')).toBe(false);
  });

  it('commit — total failure (none applied) keeps draft, no reload', async () => {
    (computeDiff as ReturnType<typeof vi.fn>).mockReturnValue({});
    (planCommit as ReturnType<typeof vi.fn>).mockReturnValue({ orderedChanges: [] });
    (commitChanges as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      errors: [{ message: 'first change failed' }],
      serverMayHaveChanged: false,
    });
    api.fetchSnapshot.mockResolvedValue(SNAP);
    const { panel, route } = await setup();
    await route({ type: 'commit', state: { dimName: 'D', hierName: 'D', attrDefs: [], elements: [], edges: [] } });
    expect(posted(panel).some((m: any) => m.type === 'commitResult' && m.ok === false)).toBe(true);
    // Nothing applied → the draft is kept, no loss of work.
    expect(posted(panel).some((m: any) => m.type === 'initData')).toBe(false);
  });

  it('openAttrCube — opens cube viewer when attr cube exists', async () => {
    (getCube as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const { route } = await setup();
    await route({ type: 'openAttrCube' });
    expect(CubeViewerManager.open).toHaveBeenCalledWith('}ElementAttributes_D', CONFIG);
  });

  it('openAttrCube — warns and skips when attr cube missing', async () => {
    (getCube as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('404'));
    const { route } = await setup();
    await route({ type: 'openAttrCube' });
    expect(CubeViewerManager.open).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  it('discard — reloads active hier into initData', async () => {
    api.fetchSnapshot.mockResolvedValue(SNAP);
    const { panel, route } = await setup();
    await route({ type: 'discard', hier: 'D' });
    expect(posted(panel).some((m: any) => m.type === 'initData')).toBe(true);
  });

  it('dirtyState — sets dirty so dispose warns about unsaved changes', async () => {
    const { panel, route } = await setup();
    await route({ type: 'dirtyState', dirty: true });
    panel.dispose();
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });
});

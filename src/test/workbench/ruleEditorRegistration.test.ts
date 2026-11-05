/**
 * Regression test for Finding 1 (Task 3 review): the Rule Editor was left out
 * of the brief's manager list and never called `registerWindow`/`unregisterWindow`,
 * even though Task 2's `windowKinds.ts` already carries a full `tm1RuleEditor`
 * row — that row was dead code. Mirrors the style of `hostRegistration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));
vi.mock('../../tm1Rest/cubeApi', () => ({
  getCubeRules: vi.fn(),
  updateCubeRules: vi.fn(),
  getCubeDimensionNames: vi.fn(),
  listCubes: vi.fn(),
}));
vi.mock('../../commands/rule/ruleEditorMonacoWebview', () => ({ getRuleEditorMonacoHtml: vi.fn(() => '<html></html>') }));
vi.mock('../../tiLogicVisualizer/rulesLinter', () => ({
  lintRules: vi.fn(() => []),
  lintRulesServer: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../providers/fetchNames', () => ({ fetchNames: vi.fn() }));
vi.mock('../../elementQualifier/qualifyElements', () => ({ qualifyElements: vi.fn() }));
vi.mock('../../elementQualifier/cubeElementIndex', () => ({
  buildCubeElementIndex: vi.fn(), invalidateCubeIndex: vi.fn(),
}));
vi.mock('../../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
  getServerIdByUrl: vi.fn(() => ''),
}));
vi.mock('../../tm1Rest/dimensionApi', () => ({ listElementAttributeNames: vi.fn() }));
vi.mock('../../commands/git/mirror', () => ({ mirrorRulesAfterSave: vi.fn() }));
vi.mock('../../tm1Rest/rulesCompile', () => ({ checkRules: vi.fn().mockResolvedValue([]) }));

import { RuleEditorManager } from '../../commands/rule/ruleEditor';
import { getCubeRules, getCubeDimensionNames } from '../../tm1Rest/cubeApi';
import { lintRules } from '../../tiLogicVisualizer/rulesLinter';
import { listWindows, clearWindowsForTest } from '../../workbench/windowRegistry';
import type { DraftMemento } from '../../utils/draftStore';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

function fakePanel(): any {
  const panel: any = {
    title: '', viewColumn: 1, visible: true,
    webview: { html: '', onDidReceiveMessage: vi.fn(), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._disposers = [...(panel._disposers ?? []), cb]; }),
    reveal: vi.fn(), dispose: vi.fn(() => panel._disposers?.forEach((d: () => void) => d())),
  };
  return panel;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearWindowsForTest();
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
  (vscode.window.showWarningMessage as any) = vi.fn();
  (vscode.window.showErrorMessage as any) = vi.fn();
  (lintRules as ReturnType<typeof vi.fn>).mockReturnValue([]);
  (getCubeRules as ReturnType<typeof vi.fn>).mockResolvedValue('SERVER RULES');
  (getCubeDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D1']);

  const raw: Record<string, unknown> = {};
  const mem: DraftMemento = {
    get: <T,>(k: string, d: T) => (raw[k] as T) ?? d,
    update: async (k: string, v: unknown) => { raw[k] = v; },
  };
  RuleEditorManager.initialize(vscode.Uri.file('/ext'), { globalState: mem } as never);
  (RuleEditorManager as any)._panels?.clear?.();
});

describe('RuleEditorManager registers its panels', () => {
  it('registers on open with kind tm1RuleEditor and the server/cube-shaped key', async () => {
    const panel = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);

    await RuleEditorManager.open('Sales', CONFIG as never);

    expect(listWindows()).toHaveLength(1);
    expect(listWindows()[0].kind).toBe('tm1RuleEditor');
    // URL first, then the identity tag (two profiles on one URL get two panels).
    expect(listWindows()[0].rawKey).toMatch(/^http:\/\/tm1:8001:@[0-9a-f]{12}:Sales$/);
    expect(listWindows()[0]).toMatchObject({ serverId: 'http://tm1:8001', target: 'Sales' });
  });

  it('unregisters when the panel is disposed', async () => {
    const panel = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);

    await RuleEditorManager.open('Sales', CONFIG as never);
    panel.dispose();

    expect(listWindows()).toHaveLength(0);
  });
});

// Two profiles may share a serverUrl (other user, other v12 database). B's
// open must not reveal A's panel, whose closure keeps saving as A.
describe('RuleEditorManager — two identities on the same URL', () => {
  const A = { ...CONFIG, username: 'alice' };
  const B = { ...CONFIG, username: 'bob' };

  it('opens a separate panel per identity', async () => {
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValueOnce(fakePanel() as never).mockReturnValueOnce(fakePanel() as never);
    await RuleEditorManager.open('Sales', A as never);
    await RuleEditorManager.open('Sales', B as never);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it('deleting the cube closes the panels of both identities', async () => {
    const pa = fakePanel(); const pb = fakePanel(); const other = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel)
      .mockReturnValueOnce(pa as never).mockReturnValueOnce(pb as never).mockReturnValueOnce(other as never);
    await RuleEditorManager.open('Sales', A as never);
    await RuleEditorManager.open('Sales', B as never);
    await RuleEditorManager.open('Sales2', A as never);
    RuleEditorManager.disposePanelForCube('Sales', CONFIG.serverUrl);
    expect(pa.dispose).toHaveBeenCalledTimes(1);
    expect(pb.dispose).toHaveBeenCalledTimes(1);
    expect(other.dispose).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

/**
 * Regression guard for the formerly SILENT `checkRules` failure in the rule
 * editor's `save` branch (src/commands/rule/ruleEditor.ts).
 *
 * Unlike processes, rules can be pre-validated without deploying: `tm1.CheckRules`
 * accepts the new text. But when that endpoint is unreachable (missing on the
 * server version, connection dropped) the old `catch {}` fell through to
 * `saveRules` without a word — the user got a plain "saved", indistinguishable
 * from a save the server had actually checked.
 *
 * Saving anyway stays the right call (refusing would block every save on a
 * server without the endpoint), so these tests pin: warn AND still save.
 */

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/cubeApi', () => ({
  getCubeRules: vi.fn(),
  updateCubeRules: vi.fn(),
  getCubeDimensionNames: vi.fn(),
  listCubes: vi.fn(),
}));
vi.mock('../commands/rule/ruleEditorMonacoWebview', () => ({ getRuleEditorMonacoHtml: vi.fn(() => '<html></html>') }));
vi.mock('../tiLogicVisualizer/rulesLinter', () => ({
  lintRules: vi.fn(() => []),
  lintRulesServer: vi.fn().mockResolvedValue([]),
}));
vi.mock('../providers/fetchNames', () => ({ fetchNames: vi.fn() }));
vi.mock('../elementQualifier/qualifyElements', () => ({ qualifyElements: vi.fn() }));
vi.mock('../elementQualifier/cubeElementIndex', () => ({
  buildCubeElementIndex: vi.fn(),
  invalidateCubeIndex: vi.fn(),
}));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
  getServerIdByUrl: vi.fn(() => ''),
}));
vi.mock('../tm1Rest/dimensionApi', () => ({ listElementAttributeNames: vi.fn() }));
vi.mock('../commands/git/mirror', () => ({ mirrorRulesAfterSave: vi.fn() }));
vi.mock('../tm1Rest/rulesCompile', () => ({ checkRules: vi.fn().mockResolvedValue([]) }));

import { RuleEditorManager } from '../commands/rule/ruleEditor';
import { getCubeRules, updateCubeRules, getCubeDimensionNames } from '../tm1Rest/cubeApi';
import { lintRules } from '../tiLogicVisualizer/rulesLinter';
import { checkRules } from '../tm1Rest/rulesCompile';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

function fakePanel(): any {
  const panel: any = {
    title: '', viewColumn: 1, visible: true,
    webview: { html: '', onDidReceiveMessage: vi.fn(), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._dispose = cb; }),
    reveal: vi.fn(), dispose: vi.fn(() => panel._dispose?.()),
  };
  return panel;
}
const router = (p: any) => p.webview.onDidReceiveMessage.mock.calls[0][0];
const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);
const warningTexts = (): string[] =>
  vi.mocked(vscode.window.showWarningMessage).mock.calls.map(c => String(c[0]));
const errorTexts = (): string[] =>
  vi.mocked(vscode.window.showErrorMessage).mock.calls.map(c => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
  (vscode.window.showWarningMessage as any) = vi.fn();
  (vscode.window.showErrorMessage as any) = vi.fn();
  vi.mocked(lintRules).mockReturnValue([]);
  vi.mocked(getCubeRules).mockResolvedValue('OLD RULES');
  vi.mocked(getCubeDimensionNames).mockResolvedValue(['D1']);
  vi.mocked(checkRules).mockResolvedValue([]);
  RuleEditorManager.initialize(vscode.Uri.file('/ext'));
  (RuleEditorManager as any)._panels?.clear?.();
});

async function setup(): Promise<{ panel: any; route: (msg: any) => Promise<void> }> {
  const panel = fakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
  await RuleEditorManager.open('Sales', CONFIG);
  return { panel, route: router(panel) };
}

describe('RuleEditorManager save — CheckRules unreachable', () => {
  beforeEach(() => {
    vi.mocked(checkRules).mockRejectedValue(new Error('HTTP 404 tm1.CheckRules'));
  });

  it('warns that the rules were saved without the server check', async () => {
    const { route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    const msg = warningTexts().join('|');
    expect(msg).toMatch(/without the server check/);
    expect(msg).toMatch(/HTTP 404 tm1\.CheckRules/);
  });

  it('still saves the rules', async () => {
    const { route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    expect(updateCubeRules).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateCubeRules).mock.calls[0][2]).toBe('NEW');
  });

  it('reports the save as successful (no saveError, no compile markers)', async () => {
    const { panel, route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    const types = posted(panel).map((m: any) => m?.type);
    expect(types).toContain('saveSuccess');
    expect(types).not.toContain('saveError');
    expect(types).not.toContain('compileResults');
    expect(errorTexts()).toEqual([]);
  });

  it('invokes the onSaved callback like any other successful save', async () => {
    const onSaved = vi.fn();
    const panel = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    await RuleEditorManager.open('Sales', CONFIG, undefined, onSaved);
    await router(panel)({ type: 'save', rulesText: 'NEW' });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe('RuleEditorManager save — CheckRules reachable', () => {
  it('clean check saves without any warning', async () => {
    const { panel, route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    expect(warningTexts()).toEqual([]);
    expect(updateCubeRules).toHaveBeenCalledTimes(1);
    expect(posted(panel).map((m: any) => m?.type)).toContain('saveSuccess');
  });

  it('compile errors block the save and warn about nothing (they are errors, not warnings)', async () => {
    vi.mocked(checkRules).mockResolvedValue([{ Message: 'syntax', LineNumber: 2 }]);
    const { panel, route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    expect(updateCubeRules).not.toHaveBeenCalled();
    expect(warningTexts()).toEqual([]);
    expect(errorTexts().join('|')).toMatch(/Compile error/);
    expect(posted(panel).map((m: any) => m?.type)).toContain('compileResults');
  });
});

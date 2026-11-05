import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

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
  buildCubeElementIndex: vi.fn(), invalidateCubeIndex: vi.fn(),
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
import { getCubeRules, getCubeDimensionNames } from '../tm1Rest/cubeApi';
import { lintRules } from '../tiLogicVisualizer/rulesLinter';
import { hasRuleDraft, loadRuleDraft } from '../commands/rule/ruleDraftStore';
import type { DraftMemento } from '../utils/draftStore';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};
const KEY = 'http://tm1:8001:Sales';

function fakePanel(): any {
  const panel: any = {
    title: '', viewColumn: 1, visible: true,
    webview: { html: '', onDidReceiveMessage: vi.fn(), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._disposers = [...(panel._disposers ?? []), cb]; }),
    reveal: vi.fn(), dispose: vi.fn(() => panel._disposers?.forEach((d: () => void) => d())),
  };
  return panel;
}
const router = (p: any) => p.webview.onDidReceiveMessage.mock.calls[0][0];
const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);

let mem: DraftMemento;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
  (vscode.window.showWarningMessage as any) = vi.fn();
  (vscode.window.showErrorMessage as any) = vi.fn();
  (lintRules as ReturnType<typeof vi.fn>).mockReturnValue([]);
  (getCubeRules as ReturnType<typeof vi.fn>).mockResolvedValue('SERVER RULES');
  (getCubeDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D1']);

  const raw: Record<string, unknown> = {};
  mem = {
    get: <T,>(k: string, d: T) => (raw[k] as T) ?? d,
    update: async (k: string, v: unknown) => { raw[k] = v; },
  };
  RuleEditorManager.initialize(vscode.Uri.file('/ext'), { globalState: mem } as never);
  (RuleEditorManager as any)._panels?.clear?.();
});

async function openEditor() {
  const panel = fakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
  await RuleEditorManager.open('Sales', CONFIG);
  return { panel, route: router(panel) };
}

describe('rule editor draft wiring', () => {
  it('parks the edited text when a dirty panel is closed', async () => {
    const { panel, route } = await openEditor();
    await route({ type: 'codeChanged', code: "['Sales'] = N: 99;" });
    panel.dispose();
    await vi.waitFor(() => expect(hasRuleDraft(mem, KEY)).toBe(true));

    expect(loadRuleDraft(mem, KEY)?.rulesText).toBe("['Sales'] = N: 99;");
  });

  it('parks nothing when the panel was never edited', async () => {
    const { panel } = await openEditor();
    panel.dispose();
    await Promise.resolve();

    expect(hasRuleDraft(mem, KEY)).toBe(false);
  });

  it('offers the parked text on reopen and hydrates the editor with it', async () => {
    const first = await openEditor();
    await first.route({ type: 'codeChanged', code: 'RECOVERED RULES' });
    first.panel.dispose();
    await vi.waitFor(() => expect(hasRuleDraft(mem, KEY)).toBe(true));

    (RuleEditorManager as any)._panels?.clear?.();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Restore');

    const second = await openEditor();
    await second.route({ type: 'monacoReady' });

    expect(posted(second.panel)).toContainEqual(expect.objectContaining({
      type: 'initData', rulesText: 'RECOVERED RULES',
    }));
    // Consumed — reopening a third time must not ask again.
    expect(hasRuleDraft(mem, KEY)).toBe(false);
  });

  it('uses the server text when the user discards the draft', async () => {
    const first = await openEditor();
    await first.route({ type: 'codeChanged', code: 'ABANDONED' });
    first.panel.dispose();
    await vi.waitFor(() => expect(hasRuleDraft(mem, KEY)).toBe(true));

    (RuleEditorManager as any)._panels?.clear?.();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Discard');

    const second = await openEditor();
    await second.route({ type: 'monacoReady' });

    expect(posted(second.panel)).toContainEqual(expect.objectContaining({
      type: 'initData', rulesText: 'SERVER RULES',
    }));
    expect(hasRuleDraft(mem, KEY)).toBe(false);
  });

  it('a restored panel that is closed again parks the text once more', async () => {
    const first = await openEditor();
    await first.route({ type: 'codeChanged', code: 'ROUND ONE' });
    first.panel.dispose();
    await vi.waitFor(() => expect(hasRuleDraft(mem, KEY)).toBe(true));

    (RuleEditorManager as any)._panels?.clear?.();
    (vscode.window.showWarningMessage as ReturnType<typeof vi.fn>).mockResolvedValue('Restore');
    const second = await openEditor();
    // Closed without touching a key: the restored text is still unsaved work.
    second.panel.dispose();
    await vi.waitFor(() => expect(hasRuleDraft(mem, KEY)).toBe(true));

    expect(loadRuleDraft(mem, KEY)?.rulesText).toBe('ROUND ONE');
  });
});

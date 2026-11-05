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
  buildCubeElementIndex: vi.fn(),
  invalidateCubeIndex: vi.fn(),
}));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
  getServerIdByUrl: vi.fn(() => ''),
}));
vi.mock('../tm1Rest/dimensionApi', () => ({ listElementAttributeNames: vi.fn() }));
vi.mock('../commands/git/mirror', () => ({
  mirrorRulesAfterSave: vi.fn(),
}));
vi.mock('../tm1Rest/rulesCompile', () => ({ checkRules: vi.fn().mockResolvedValue([]) }));

import { RuleEditorManager } from '../commands/rule/ruleEditor';
import { getCubeRules, updateCubeRules, getCubeDimensionNames } from '../tm1Rest/cubeApi';
import { lintRules, lintRulesServer } from '../tiLogicVisualizer/rulesLinter';
import { fetchNames } from '../providers/fetchNames';
import { qualifyElements } from '../elementQualifier/qualifyElements';
import { buildCubeElementIndex } from '../elementQualifier/cubeElementIndex';
import { checkRules } from '../tm1Rest/rulesCompile';

const CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', rejectUnauthorized: false, authType: 'Basic' as const };

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

// `resetAllMocks` instead of `clearAllMocks`: `clear` only deletes the call lists
// and leaves return values set per test in place — that way `checkRules` from the
// compile-error test leaked into every save test that ran later. Reset restores
// the implementation passed to `vi.fn(impl)`, but NOT chained `mockResolvedValue`
// defaults from the factories: that is why those are set here.
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
  (vscode.window.showWarningMessage as any) = vi.fn();
  (vscode.window.showErrorMessage as any) = vi.fn();
  (vscode.env.clipboard.readText as any) = vi.fn().mockResolvedValue('clip');
  (vscode.env.clipboard.writeText as any) = vi.fn().mockResolvedValue(undefined);
  (lintRules as ReturnType<typeof vi.fn>).mockReturnValue([]);
  (lintRulesServer as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (checkRules as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getCubeRules as ReturnType<typeof vi.fn>).mockResolvedValue('RULES');
  (getCubeDimensionNames as ReturnType<typeof vi.fn>).mockResolvedValue(['D1']);
  RuleEditorManager.initialize(vscode.Uri.file('/ext'));
  (RuleEditorManager as any)._panels?.clear?.();
});

async function setup() {
  const panel = fakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
  await RuleEditorManager.open('Sales', CONFIG);
  return { panel, route: router(panel) };
}

describe('RuleEditorManager — message router', () => {
  it('monacoReady — posts initData with rules + dims', async () => {
    const { panel, route } = await setup();
    await route({ type: 'monacoReady' });
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'initData', cubeName: 'Sales', rulesText: 'RULES', cubeDimensions: ['D1'],
    }));
  });

  it('monacoReady re-hydrates on a webview reload (second monacoReady re-posts initData)', async () => {
    // Regression: the rulesInitSent guard must not suppress the re-hydrate when
    // the webview reloads (re-fires monacoReady) without disposing the panel.
    const { panel, route } = await setup();
    await route({ type: 'monacoReady' });
    (panel.webview.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await route({ type: 'monacoReady' });
    expect(posted(panel)).toContainEqual(expect.objectContaining({
      type: 'initData', cubeName: 'Sales', rulesText: 'RULES', cubeDimensions: ['D1'],
    }));
  });

  it('getCompletions — dimensions context posts dimension names', async () => {
    (fetchNames as ReturnType<typeof vi.fn>).mockResolvedValue(['DimA', 'DimB']);
    const { panel, route } = await setup();
    await route({ type: 'getCompletions', context: 'dimensions' });
    expect(posted(panel)).toContainEqual({ type: 'completions', context: 'dimensions', items: ['DimA', 'DimB'] });
  });

  it('getCompletions — cubes context posts cube names', async () => {
    (fetchNames as ReturnType<typeof vi.fn>).mockResolvedValue(['C1']);
    const { panel, route } = await setup();
    await route({ type: 'getCompletions', context: 'cubes' });
    expect(posted(panel)).toContainEqual({ type: 'completions', context: 'cubes', items: ['C1'] });
  });

  it('requestPaste — posts clipboard text', async () => {
    const { panel, route } = await setup();
    await route({ type: 'requestPaste' });
    expect(posted(panel)).toContainEqual({ type: 'pasteText', text: 'clip' });
  });

  it('save — clean rules persist and post saveSuccess', async () => {
    const { panel, route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    expect(updateCubeRules).toHaveBeenCalled();
    expect(posted(panel)).toContainEqual({ type: 'saveSuccess' });
  });

  it('save — lint errors prompt modal; cancel posts saveCancelled and skips persist', async () => {
    (lintRules as ReturnType<typeof vi.fn>).mockReturnValue([{ severity: 'error', message: 'bad', line: 0, ruleId: 'x' }]);
    (vscode.window.showWarningMessage as any).mockResolvedValue(undefined); // user dismissed
    const { panel, route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    expect(posted(panel)).toContainEqual({ type: 'saveCancelled' });
    expect(updateCubeRules).not.toHaveBeenCalled();
  });

  it('save — compile errors block save', async () => {
    (checkRules as ReturnType<typeof vi.fn>).mockResolvedValue([{ Message: 'syntax', LineNumber: 2 }]);
    const { panel, route } = await setup();
    await route({ type: 'save', rulesText: 'NEW' });
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'compileResults' }));
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'saveError' }));
    expect(updateCubeRules).not.toHaveBeenCalled();
  });

  it('qualifyElements — posts qualifyResult ok with text + warnings', async () => {
    (buildCubeElementIndex as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (qualifyElements as ReturnType<typeof vi.fn>).mockReturnValue({ text: 'QUAL', warnings: ['w1'] });
    const { panel, route } = await setup();
    await route({ type: 'qualifyElements', code: 'CODE' });
    expect(posted(panel)).toContainEqual({ type: 'qualifyResult', ok: true, text: 'QUAL', warnings: ['w1'] });
  });

  it('qualifyElements — posts qualifyResult not-ok on failure', async () => {
    (buildCubeElementIndex as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('idx'));
    const { panel, route } = await setup();
    await route({ type: 'qualifyElements', code: 'CODE' });
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'qualifyResult', ok: false, message: 'idx' }));
  });

  it('codeChanged — posts synchronous lintResults', async () => {
    (lintRules as ReturnType<typeof vi.fn>).mockReturnValue([{ severity: 'warning', message: 'w', line: 1, ruleId: 'y' }]);
    const { panel, route } = await setup();
    await route({ type: 'codeChanged', code: 'X' });
    expect(posted(panel)).toContainEqual(expect.objectContaining({ type: 'lintResults' }));
  });
});

/**
 * A rule editor holds the rules text it loaded when it opened. Left open after its
 * cube is deleted, a Save writes that old text onto whatever answers to the name —
 * recreate a cube under the same name and the stale panel overwrites it, git mirror
 * included. Deleting a cube therefore has to close its rule editor.
 */
describe('RuleEditorManager.disposePanelForCube', () => {
  async function openFor(cube: string, serverUrl: string): Promise<any> {
    const panel = fakePanel();
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
    await RuleEditorManager.open(cube, { ...CONFIG, serverUrl });
    return panel;
  }

  it('closes the panel of exactly that cube on that server', async () => {
    const target = await openFor('Sales', 'http://srv-a:8000');
    const otherCube = await openFor('Costs', 'http://srv-a:8000');
    const otherServer = await openFor('Sales', 'http://srv-b:8000');

    RuleEditorManager.disposePanelForCube('Sales', 'http://srv-a:8000');

    expect(target.dispose).toHaveBeenCalledTimes(1);
    expect(otherCube.dispose).not.toHaveBeenCalled();
    expect(otherServer.dispose).not.toHaveBeenCalled();
  });

  it('does nothing when no panel is open for that cube', async () => {
    const other = await openFor('Costs', 'http://srv-a:8000');
    expect(() => RuleEditorManager.disposePanelForCube('Sales', 'http://srv-a:8000')).not.toThrow();
    expect(other.dispose).not.toHaveBeenCalled();
  });

  it('does not close everything when the server url is empty', async () => {
    const p = await openFor('Sales', 'http://srv-a:8000');
    RuleEditorManager.disposePanelForCube('Sales', '');
    expect(p.dispose).not.toHaveBeenCalled();
  });
});

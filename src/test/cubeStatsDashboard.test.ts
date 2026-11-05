import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../mdx/executeMdx', () => ({ executeMdx: vi.fn() }));
vi.mock('../cubeStats/cubeStatsApi', () => ({
  buildCubeStatsMdx: vi.fn(() => 'MDX'),
  parseCubeStats: vi.fn(() => []),
  statsToCsv: vi.fn(() => 'a,b\n1,2'),
}));
vi.mock('../cubeStats/cubeStatsWebview', () => ({ getCubeStatsHtml: vi.fn(() => '<html></html>') }));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));

import { CubeStatsDashboardManager } from '../commands/cubeViewer/cubeStatsDashboard';
import { apiRequest } from '../tm1Rest/client';
import { statsToCsv } from '../cubeStats/cubeStatsApi';

const CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', rejectUnauthorized: false, authType: 'Basic' as const };

function fakePanel(): any {
  const panel: any = {
    title: '', viewColumn: 1,
    webview: { html: '', cspSource: 'csp:', asWebviewUri: (u: unknown) => u, onDidReceiveMessage: vi.fn(), postMessage: vi.fn() },
    onDidDispose: vi.fn((cb) => { panel._dispose = cb; }),
    reveal: vi.fn(), dispose: vi.fn(() => panel._dispose?.()),
  };
  return panel;
}
const router = (p: any) => p.webview.onDidReceiveMessage.mock.calls[0][0];
const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
  vi.mocked(vscode.window.createWebviewPanel).mockReset();
  (vscode.window as any).showSaveDialog = vi.fn().mockResolvedValue(undefined);
  (vscode.window.showWarningMessage as any) = vi.fn();
  (vscode.workspace as any).fs = { writeFile: vi.fn().mockResolvedValue(undefined) };
});

async function setup() {
  const panel = fakePanel();
  vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never);
  const mgr = new CubeStatsDashboardManager(vscode.Uri.file('/ext'));
  await mgr.open(CONFIG);
  return { panel, mgr, route: router(panel) };
}

describe('CubeStatsDashboardManager — message router', () => {
  it('ready — routes to _loadStats (posts loading:true)', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const { panel, route } = await setup();
    await route({ type: 'ready' });
    expect(posted(panel)).toContainEqual({ type: 'loading', value: true });
    expect(posted(panel)).toContainEqual({ type: 'loading', value: false }); // finally
  });

  it('refresh — also routes to _loadStats', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    const { route } = await setup();
    await route({ type: 'refresh' });
    expect(apiRequest).toHaveBeenCalled();
  });

  it('exportCsv — warns and skips dialog when stats empty', async () => {
    const { route } = await setup();
    await route({ type: 'exportCsv', stats: [] });
    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
  });

  it('exportCsv — opens save dialog for non-empty stats', async () => {
    const { route } = await setup();
    await route({ type: 'exportCsv', stats: [{ cube: 'A', mem: 1 }] });
    expect(vscode.window.showSaveDialog).toHaveBeenCalled();
  });

  it('exportCsv — writes CSV when a path is chosen', async () => {
    (vscode.window.showSaveDialog as any).mockResolvedValue({ fsPath: '/tmp/x.csv' });
    const { route } = await setup();
    await route({ type: 'exportCsv', stats: [{ cube: 'A', mem: 1 }] });
    expect(statsToCsv).toHaveBeenCalled();
    expect((vscode.workspace as any).fs.writeFile).toHaveBeenCalled();
  });

  it('unknown type — no work done', async () => {
    const { panel, route } = await setup();
    panel.webview.postMessage.mockClear();
    (apiRequest as ReturnType<typeof vi.fn>).mockClear();
    await route({ type: 'nope' });
    expect(apiRequest).not.toHaveBeenCalled();
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it('open — reuses one panel per server (reveal, no second create)', async () => {
    const { mgr, panel } = await setup();
    await mgr.open(CONFIG);
    expect(vi.mocked(vscode.window.createWebviewPanel).mock.calls.length).toBe(1);
    expect(panel.reveal).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../../commands/serverManager', async () => {
  const { serverManagerMock } = await import('../helpers/serverManagerMock');
  return serverManagerMock();
});

vi.mock('../../providers/fetchNames', () => ({
  invalidateCache: vi.fn(),
}));

import { getServerConfig } from '../../commands/serverManager';
import { invalidateCache } from '../../providers/fetchNames';
import { confirmAndRun } from '../../commands/confirmAndRun';

const FAKE_CFG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'basic' } as any;

beforeEach(() => {
  vi.mocked(getServerConfig).mockReset().mockReturnValue(FAKE_CFG);
  vi.mocked(invalidateCache).mockReset();
  (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue(undefined);
  (vscode.window as any).showInformationMessage = vi.fn().mockResolvedValue(undefined);
  (vscode.window as any).showErrorMessage = vi.fn().mockResolvedValue(undefined);
});

describe('confirmAndRun', () => {
  it('does not run, refresh or toast when the user dismisses the confirm dialog (undefined answer)', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh,
    });

    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('does not run, refresh or toast when the user picks a different button/string than the confirm label', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Cancel');
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh,
    });

    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('runs, shows the success toast and then refreshes when the user confirms', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();
    const callOrder: string[] = [];
    run.mockImplementation(async () => { callOrder.push('run'); });
    (vscode.window.showInformationMessage as any).mockImplementation((msg: string) => {
      callOrder.push(`toast:${msg}`);
      return Promise.resolve(undefined);
    });
    refresh.mockImplementation(() => { callOrder.push('refresh'); });

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Cube deleted.');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['run', 'toast:Cube deleted.', 'refresh']);
  });

  it('runs directly without a dialog when confirm is omitted (create case)', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();

    await confirmAndRun({
      serverId: 's1',
      run,
      success: 'Hierarchy created.',
      failure: (d) => `Could not create hierarchy: ${d}`,
      refresh,
    });

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Hierarchy created.');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not run when no server config is available, calls failure and does not refresh', async () => {
    vi.mocked(getServerConfig).mockReturnValue(undefined as any);
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();
    const failure = vi.fn((d: string) => `Could not delete cube: ${d}`);

    await confirmAndRun({
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure,
      refresh,
    });

    expect(run).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toBeTruthy();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(failure.mock.results[0].value);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces the verbatim TM1 server message from a thrown error and does not refresh', async () => {
    const serverMessage = "Cannot delete dimension 'Region': referenced by cube 'Sales'.";
    const run = vi.fn().mockRejectedValue(new Error(serverMessage));
    const refresh = vi.fn();

    await confirmAndRun({
      serverId: 's1',
      run,
      success: 'Dimension deleted.',
      failure: (d) => `Could not delete dimension: ${d}`,
      refresh,
    });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    const shownText = (vscode.window.showErrorMessage as any).mock.calls[0][0] as string;
    expect(shownText).toContain(serverMessage);
    expect(refresh).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('defaults the confirm button label to "Delete" and shows the dialog modally', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh,
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Delete cube Sales?',
      { modal: true },
      'Delete',
    );
  });

  it('reports a missing tree-node server reference instead of claiming no server is connected', async () => {
    // The server IS connected — only the tree node lacks meta.serverId. Looking
    // that up would be a Map miss and produce the wrong ("not connected") text.
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn();
    const failure = vi.fn((d: string) => `Could not delete cube: ${d}`);

    await confirmAndRun({
      serverId: undefined,
      run,
      success: 'Cube deleted.',
      failure,
      refresh,
    });

    expect(getServerConfig).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).not.toMatch(/no server connected/i);
    expect(failure.mock.calls[0][0]).toMatch(/server/i);
  });

  it('still reports "no server connected" when the serverId is known but not connected', async () => {
    vi.mocked(getServerConfig).mockReturnValue(undefined as any);
    const run = vi.fn().mockResolvedValue(undefined);
    const failure = vi.fn((d: string) => `Could not delete cube: ${d}`);

    await confirmAndRun({
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure,
      refresh: vi.fn(),
    });

    expect(getServerConfig).toHaveBeenCalledWith('s1');
    expect(run).not.toHaveBeenCalled();
    expect(failure.mock.calls[0][0]).toMatch(/no server connected/i);
  });

  it('drops the stale fetchNames entries for this server after a successful run', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const run = vi.fn().mockResolvedValue(undefined);

    await confirmAndRun({
      confirm: 'Delete dimension Region?',
      serverId: 's1',
      invalidate: ['Dimensions', 'Hierarchies'],
      run,
      success: 'Dimension deleted.',
      failure: (d) => `Could not delete dimension: ${d}`,
      refresh: vi.fn(),
    });

    expect(invalidateCache).toHaveBeenCalledTimes(2);
    expect(invalidateCache).toHaveBeenCalledWith('Dimensions', FAKE_CFG.serverUrl);
    expect(invalidateCache).toHaveBeenCalledWith('Hierarchies', FAKE_CFG.serverUrl);
  });

  it('does not drop the name cache when the run failed', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const run = vi.fn().mockRejectedValue(new Error('still referenced'));

    await confirmAndRun({
      confirm: 'Delete dimension Region?',
      serverId: 's1',
      invalidate: ['Dimensions'],
      run,
      success: 'Dimension deleted.',
      failure: (d) => `Could not delete dimension: ${d}`,
      refresh: vi.fn(),
    });

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it('leaves the name cache alone when no endpoints were requested', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run: vi.fn().mockResolvedValue(undefined),
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh: vi.fn(),
    });

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it('a failing tree refresh does not turn a successful run into an error toast', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const run = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn(() => { throw new Error('tree refresh boom'); });

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Cube deleted.');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('runs afterSuccess with the resolved config once the call succeeded', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const afterSuccess = vi.fn();

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run: vi.fn().mockResolvedValue(undefined),
      afterSuccess,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh: vi.fn(),
    });

    expect(afterSuccess).toHaveBeenCalledTimes(1);
    expect(afterSuccess).toHaveBeenCalledWith(FAKE_CFG);
  });

  it('does not run afterSuccess when the call failed — the object is still there', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const afterSuccess = vi.fn();

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run: vi.fn().mockRejectedValue(new Error('cube is used by a rule')),
      afterSuccess,
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh: vi.fn(),
    });

    expect(afterSuccess).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('a throwing afterSuccess does not turn a successful run into an error toast', async () => {
    (vscode.window as any).showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const refresh = vi.fn();

    await confirmAndRun({
      confirm: 'Delete cube Sales?',
      serverId: 's1',
      run: vi.fn().mockResolvedValue(undefined),
      afterSuccess: () => { throw new Error('panel dispose boom'); },
      success: 'Cube deleted.',
      failure: (d) => `Could not delete cube: ${d}`,
      refresh,
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Cube deleted.');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});

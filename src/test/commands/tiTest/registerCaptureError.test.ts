import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { registerTiTestCommands } from '../../../commands/tiTest/register';
import * as capture from '../../../commands/tiTest/capture';
import type { CommandDeps } from '../../../commands/tiTest/types';

/**
 * L11 — a safeChildPath (or any) throw inside captureProcess must NOT reach the
 * command boundary unhandled: the handler surfaces an error toast AND still
 * refreshes the tree (finally) so the UI isn't left stale.
 */
describe('tm1.tiTest.captureProcess — error boundary', () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const deps = {
    treeProvider: { refresh },
    getActiveConfig: () => ({ cfg: {} as never, serverName: 'S' }),
    getConfigByServerId: () => ({ cfg: {} as never, serverName: 'S' }),
    extensionVersion: '0.0.0',
  } as unknown as CommandDeps;

  function getHandler(): (arg?: unknown) => Promise<void> {
    registerTiTestCommands(deps);
    const call = vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.find((c) => c[0] === 'tm1.tiTest.captureProcess');
    return call![1] as (arg?: unknown) => Promise<void>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows an error toast and still refreshes when captureProcess throws', async () => {
    vi.spyOn(capture, 'captureProcess').mockRejectedValueOnce(
      new Error('unsafe process name: ../evil'),
    );
    const handler = getHandler();

    await expect(handler('MyProc')).resolves.toBeUndefined();

    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0];
    expect(msg).toContain('unsafe process name');
    // Tree refresh runs in finally even though capture threw.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes exactly once on the success path too', async () => {
    vi.spyOn(capture, 'captureProcess').mockResolvedValueOnce(undefined);
    const handler = getHandler();

    await handler('MyProc');

    expect(vi.mocked(vscode.window.showErrorMessage)).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

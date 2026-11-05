import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

import * as vscode from 'vscode';
import { registerServerCommands } from '../../activation/registerServerCommands';
import { initServerManager, saveServers, getAllServers, pwKey } from '../../serverState/state';

let secretDelete: ReturnType<typeof vi.fn>;

function fakeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  secretDelete = vi.fn(async () => {});
  return {
    globalState: {
      get: (k: string, dflt?: unknown) => (store.has(k) ? store.get(k) : dflt),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
    secrets: { get: async () => '', store: async () => {}, delete: secretDelete },
    subscriptions: [] as { dispose(): void }[],
  } as unknown as vscode.ExtensionContext;
}

const profil = (id: string, name: string) => ({
  id, name, serverUrl: 'https://h:1', username: '', rejectUnauthorized: false,
  authType: 'Basic' as const,
});

const node = (serverId: string) => ({ meta: { serverId } } as never);

let ctx: vscode.ExtensionContext;

beforeEach(async () => {
  ctx = fakeContext();
  initServerManager(ctx);
  registerServerCommands({ context: ctx, treeDataProvider: { refreshNode: () => {} } } as never);
  await saveServers(ctx, [profil('s1', 'Alpha'), profil('s2', 'Beta')]);
  vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as never);
});

// The mocks of the vscode mock are module-wide: without this,
// `toHaveBeenCalledTimes` also counts the calls of earlier tests.
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('tm1.server.delete', () => {
  it('asks modally and deletes nothing when the confirmation prompt is dismissed', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    await vscode.commands.executeCommand('tm1.server.delete', node('s1'));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Alpha');
    expect((warn.mock.calls[0][1] as { modal?: boolean }).modal).toBe(true);
    expect(getAllServers(ctx).map(s => s.id)).toEqual(['s1', 's2']);
    expect(secretDelete).not.toHaveBeenCalled();
  });

  it('after confirmation deletes exactly this profile including its password', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as never);
    await vscode.commands.executeCommand('tm1.server.delete', node('s1'));
    expect(getAllServers(ctx).map(s => s.id)).toEqual(['s2']);
    expect(secretDelete).toHaveBeenCalledWith(pwKey('s1'));
  });

  it('deletes the whole multi-selection after ONE confirmation prompt', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as never);
    await vscode.commands.executeCommand('tm1.server.delete', node('s1'), [node('s1'), node('s2')]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Alpha');
    expect(warn.mock.calls[0][0]).toContain('Beta');
    expect(getAllServers(ctx)).toHaveLength(0);
    expect(secretDelete).toHaveBeenCalledWith(pwKey('s1'));
    expect(secretDelete).toHaveBeenCalledWith(pwKey('s2'));
  });

  it('does nothing without a server node', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as never);
    warn.mockClear();
    await vscode.commands.executeCommand('tm1.server.delete', undefined);
    expect(getAllServers(ctx)).toHaveLength(2);
    // At most the "no server selected" message comes, no confirmation prompt
    // with a delete button.
    expect(warn.mock.calls.every(c => c.length === 1)).toBe(true);
  });
});

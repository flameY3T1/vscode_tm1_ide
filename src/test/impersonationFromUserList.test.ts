// Impersonation from the user list of the security manager.
//
// The button there must NOT open a second path into impersonation: it calls
// the same command, only with the user as the second argument. This test checks
// exactly that — that the command takes the preset name and the picker then
// does not open at all (it would be a second question about a choice that has
// already been made).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';

const listUsers = vi.fn(async () => [{ name: 'reader', disabled: false, groups: [] }]);
const setImpersonation = vi.fn(async () => {});

vi.mock('../security/api/usersApi', () => ({ listUsers: () => listUsers() }));
// CAM: the readable name is a }Clients alias; the picker shows it and still
// hands the real name to the server.
const aliasValues = vi.fn(async (): Promise<Record<string, string>> => ({}));
vi.mock('../security/api/clientAliasApi', () => ({
  listClientAliasAttributes: async () => ['}TM1_DefaultDisplayValue'],
  fetchClientAliasValues: () => aliasValues(),
}));
vi.mock('../commands/security/userGroupManager', () => ({ storedAlias: () => '' }));
vi.mock('../commands/serverManager/impersonation', () => ({
  setImpersonation: (...a: unknown[]) => setImpersonation(...(a as [])),
  getImpersonation: () => undefined,
  listImpersonations: () => [],
}));
vi.mock('../serverState/state', () => ({
  getServerConfig: (id: string) => (id === 's1'
    ? { serverUrl: 'http://h', username: 'admin', password: 'pw', authType: 'Basic' }
    : undefined),
  getAllServers: () => [{ id: 's1', name: 'PROD' }],
  onServerChanged: { event: () => ({ dispose: () => {} }) },
}));

import { registerImpersonationUi } from '../commands/serverManager/impersonationUi';

const win = vscode.window as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ctx = { subscriptions: [], globalState: { get: () => undefined } } as never;

beforeEach(() => {
  listUsers.mockClear();
  setImpersonation.mockClear();
  win.showQuickPick.mockReset();
  win.showInformationMessage.mockReset();
  registerImpersonationUi(ctx);
});

describe('tm1.impersonate.start with a preset user', () => {
  it('takes the name and does not ask', async () => {
    await vscode.commands.executeCommand('tm1.impersonate.start', { meta: { serverId: 's1' } }, 'reader');
    expect(setImpersonation).toHaveBeenCalledWith(ctx, 's1', 'reader');
    expect(win.showQuickPick).not.toHaveBeenCalled();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('still asks when there is no preset', async () => {
    win.showQuickPick.mockResolvedValue({ label: 'reader', user: 'reader' });
    await vscode.commands.executeCommand('tm1.impersonate.start', { meta: { serverId: 's1' } });
    expect(listUsers).toHaveBeenCalled();
    expect(setImpersonation).toHaveBeenCalledWith(ctx, 's1', 'reader');
  });

  it('shows the alias as label and impersonates the real name', async () => {
    aliasValues.mockResolvedValueOnce({ reader: 'Anna Muster' });
    win.showQuickPick.mockImplementationOnce(async (items: Array<{ label: string }>) => items[0]);
    await vscode.commands.executeCommand('tm1.impersonate.start', { meta: { serverId: 's1' } });
    const items = win.showQuickPick.mock.calls[0][0] as Array<{ label: string; description: string }>;
    expect(items[0]).toMatchObject({ label: 'Anna Muster', description: 'reader' });
    expect(setImpersonation).toHaveBeenCalledWith(ctx, 's1', 'reader');
    expect(String(win.showInformationMessage.mock.calls[0][0])).toContain('Anna Muster');
  });

  it('a preset label from the security manager reaches the message, the real name the server', async () => {
    await vscode.commands.executeCommand('tm1.impersonate.start', { meta: { serverId: 's1' } }, 'reader', 'Anna Muster');
    expect(setImpersonation).toHaveBeenCalledWith(ctx, 's1', 'reader');
    expect(String(win.showInformationMessage.mock.calls[0][0])).toContain('Anna Muster');
  });
});

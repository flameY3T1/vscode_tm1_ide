// Review 2026-09-26 #8: clicking a recent entry whose profile exists but is not
// connected said "no longer available" — the normal case right after startup.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

const connected = new Map<string, unknown>();
// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../../serverState/state', async () => await import('../../commands/serverManager'));
vi.mock('../../commands/serverManager', () => ({
  getServerConfig: (id: string) => connected.get(id),
  getAllServers: () => [{ id: 'srv1', name: 'Dev' }],
}));
vi.mock('../../commands/rule/ruleEditor', () => ({ RuleEditorManager: { open: vi.fn() } }));
vi.mock('../../commands/threads', () => ({ openThreadsPanelForConfig: vi.fn() }));

import * as vscode from 'vscode';
import { registerRecentCommands } from '../../activation/registerRecentCommands';

const openProcess = vi.fn();
const addRecent = vi.fn();

function open(serverId: string) {
  return vscode.commands.executeCommand('tm1.recent.open', { kind: 'process', serverId, serverName: 'Dev', name: 'p1', ts: 0 });
}

describe('tm1.recent.open on a disconnected server', () => {
  beforeEach(() => {
    connected.clear();
    openProcess.mockReset();
    vi.mocked(vscode.window.showWarningMessage).mockReset();
    registerRecentCommands({
      context: { subscriptions: [] },
      processEditorManager: { openProcess },
      recentProvider: { addRecent },
      resolveServerName: () => 'Dev',
      treeDataProvider: {},
    } as never);
  });

  it('says "not connected", not "no longer available", and connects on request', async () => {
    const cfg = { serverUrl: 'https://dev:1' };
    vscode.commands.registerCommand('tm1.server.connect', (node: { meta: { serverId: string } }) => {
      connected.set(node.meta.serverId, cfg);
    });
    vi.mocked(vscode.window.showWarningMessage).mockImplementation(async (_msg: string, ...items: unknown[]) => items[0] as never);

    await open('srv1');

    const msg = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0];
    expect(msg).toBe("TM1: Server 'Dev' is not connected.");
    expect(openProcess).toHaveBeenCalledWith('p1', undefined, cfg);
  });

  it('keeps "no longer available" for a deleted profile', async () => {
    await open('gone');
    expect(vi.mocked(vscode.window.showWarningMessage).mock.calls[0][0]).toBe("TM1: Server 'Dev' is no longer available.");
    expect(openProcess).not.toHaveBeenCalled();
  });
});

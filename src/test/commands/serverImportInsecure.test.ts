import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

import * as vscode from 'vscode';
import { registerServerCommands } from '../../activation/registerServerCommands';
import { initServerManager, getAllServers } from '../../serverState/state';
import { EXCHANGE_FORMAT } from '../../commands/serverManager/serverExchangePure';

/**
 * Regression: the server form asks before saving a plain-HTTP or
 * no-certificate-check profile; importing a team file skipped that question.
 */

function fakeContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string, dflt?: unknown) => (store.has(k) ? store.get(k) : dflt),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
    secrets: { get: async () => '', store: async () => {}, delete: async () => {} },
    subscriptions: [] as { dispose(): void }[],
  } as unknown as vscode.ExtensionContext;
}

const file = {
  format: EXCHANGE_FORMAT,
  servers: [
    { name: 'Safe', serverUrl: 'https://safe:1' },
    { name: 'Clear', serverUrl: 'http://clear:1' },
  ],
};

let ctx: vscode.ExtensionContext;

beforeEach(() => {
  ctx = fakeContext();
  initServerManager(ctx);
  registerServerCommands({ context: ctx, treeDataProvider: { refreshNode: () => {} } } as never);
  (vscode.window as any).showOpenDialog = vi.fn(async () => [vscode.Uri.file('/tmp/servers.json')]);
  (vscode.workspace as any).fs = { readFile: vi.fn(async () => Buffer.from(JSON.stringify(file))) };
  vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as never);
});

// The vscode mock's fakes are module-wide; reset so call counts start at zero.
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('tm1.server.importList — insecure entries', () => {
  it('asks once, naming the insecure server, and imports nothing when declined', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    await vscode.commands.executeCommand('tm1.server.importList');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Clear');
    expect(warn.mock.calls[0][0]).not.toContain('Safe');
    expect((warn.mock.calls[0][1] as { modal?: boolean }).modal).toBe(true);
    expect(getAllServers(ctx)).toHaveLength(0);
  });

  it('imports all entries after confirmation', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Import' as never);
    await vscode.commands.executeCommand('tm1.server.importList');
    expect(getAllServers(ctx).map(s => s.name)).toEqual(['Safe', 'Clear']);
  });
});

// Keyboard shortcuts arrive without a tree node: then the connection state decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { readFileSync } from 'fs';

const configs = new Map<string, { serverUrl: string }>();
const profileNames = new Map<string, string>();
vi.mock('../../serverState/state', () => ({
  _ctx: {},
  getServer: (_ctx: unknown, id: string) => (profileNames.has(id) ? { name: profileNames.get(id) } : undefined),
  getConnectedIds: () => [...configs.keys()],
  getConnectedIdsRestored: async () => [...configs.keys()],
  getServerConfig: (id: string) => configs.get(id),
  getServerNameByUrl: (url: string) => (url === 'http://b:2' ? 'Prod' : undefined),
}));

import { serverIdForCommand } from '../../serverState/requireServerConfig';

beforeEach(() => {
  configs.clear();
  profileNames.clear();
  vi.mocked(vscode.window.showQuickPick).mockReset();
  vi.mocked(vscode.window.showErrorMessage).mockReset();
});

describe('serverIdForCommand', () => {
  it('takes the tree node without asking', async () => {
    configs.set('a', { serverUrl: 'http://a:1' });
    configs.set('b', { serverUrl: 'http://b:2' });
    expect(await serverIdForCommand({ meta: { serverId: 'b' } })).toBe('b');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('without a node: the only connected server, else a pick, else a message', async () => {
    expect(await serverIdForCommand()).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);

    configs.set('a', { serverUrl: 'http://a:1' });
    expect(await serverIdForCommand()).toBe('a');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();

    configs.set('b', { serverUrl: 'http://b:2' });
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (items as unknown as Array<{ id: string }>)[1] as never);
    expect(await serverIdForCommand()).toBe('b');
    const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as Array<{ label: string }>;
    expect(offered.map(i => i.label)).toEqual(['a', 'Prod']);
  });

  it('names two profiles on the same URL by their own profile names', async () => {
    configs.set('x', { serverUrl: 'http://b:2' });
    configs.set('y', { serverUrl: 'http://b:2' });
    profileNames.set('x', 'Prod admin');
    profileNames.set('y', 'Prod reader');
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async () => undefined);
    await serverIdForCommand();
    const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0][0] as Array<{ label: string }>;
    expect(offered.map(i => i.label)).toEqual(['Prod admin', 'Prod reader']);
  });
});

describe('serverIdForCommand — alwaysAsk', () => {
  it('asks even with one connected server, and shows the caller\'s placeholder', async () => {
    configs.set('b', { serverUrl: 'http://b:2' });
    await serverIdForCommand(undefined, { alwaysAsk: true, placeHolder: 'gone' });
    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0][1]).toMatchObject({ placeHolder: 'gone' });
  });
});

describe('keybindings', () => {
  const kb = JSON.parse(readFileSync('package.json', 'utf8')).contributes.keybindings as Array<{ key: string; command: string }>;
  // Ctrl+Alt+J: another TM1 extension holds Ctrl+Alt+F/N/P/L/T/D/C globally; Y/Z swap on German
  // keyboards (Y did not fire there); Q/E/M collide with AltGr on Windows.
  // Each command also takes the second key with Ctrl+Alt still held: people
  // keep the modifiers down, and Ctrl+Alt+O alone opens VS Code's remote menu.
  it('all sit behind the Ctrl+Alt+J chord — single Ctrl+Alt+<letter> keys are taken elsewhere', () => {
    expect(kb.length).toBeGreaterThan(0);
    for (const k of kb) { expect(k.key, k.command).toMatch(/^ctrl\+alt\+j (ctrl\+alt\+)?[a-z]$/); }
    expect(new Set(kb.map(k => k.key)).size).toBe(kb.length);
  });
});

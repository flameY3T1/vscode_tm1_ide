// Deploying rules and chores from the tree to another server.
//
// What is checked is what the command decides itself — not the write path
// (`deployOne`, shared with the bulk page) and not the menu `when`s:
//   1. a rule without its cube over there aborts BEFORE writing,
//   2. something existing asks for confirmation, and a No writes nothing,
//   3. a chore that does not exist over there yet goes through without confirmation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../serverState/state', async () => await import('../commands/serverManager'));
vi.mock('../commands/serverManager', () => ({
  getServerConfig: vi.fn(),
  getConnectedIds: vi.fn(),
  getServerNameByUrl: vi.fn(() => undefined),
}));
vi.mock('../commands/deploy/deployCheck', () => ({ readTargetInventory: vi.fn() }));
vi.mock('../commands/deploy/deployWrite', () => ({ deployOne: vi.fn() }));

import { getServerConfig, getConnectedIds } from '../commands/serverManager';
import { readTargetInventory } from '../commands/deploy/deployCheck';
import { deployOne } from '../commands/deploy/deployWrite';
import { deployNodeToServerCommand } from '../commands/deploy/deployNodeToServer';

const win = vscode.window as unknown as Record<string, ReturnType<typeof vi.fn>>;
const SRC = { serverUrl: 'http://src' } as never;
const TGT = { serverUrl: 'http://tgt' } as never;

/** A target inventory with exactly the filled lists the case needs. */
function inventory(over: Partial<Record<'cubes' | 'rules' | 'chores', string[]>> = {}) {
  return {
    cubes: new Set(over.cubes ?? []), dims: new Set<string>(), hiers: new Set<string>(),
    processes: new Set<string>(), chores: new Set(over.chores ?? []),
    rules: new Set(over.rules ?? []), views: new Set<string>(), subsets: new Set<string>(),
    failed: [],
  };
}

const ruleNode = { nodeType: 'cubeRule', meta: { cubeName: 'Sales', serverId: 's1' } } as never;
const choreNode = { nodeType: 'chore', meta: { choreName: 'Nightly', serverId: 's1' } } as never;

beforeEach(() => {
  vi.mocked(getConnectedIds).mockReturnValue(['s1', 's2']);
  vi.mocked(getServerConfig).mockImplementation((id: string) => (id === 's1' ? SRC : TGT));
  vi.mocked(deployOne).mockReset().mockResolvedValue('written');
  vi.mocked(readTargetInventory).mockReset().mockResolvedValue(inventory({ cubes: ['sales'] }));
  win.showQuickPick.mockReset().mockResolvedValue({ id: 's2', label: 'TGT' });
  win.showWarningMessage.mockReset().mockResolvedValue(undefined);
  win.showErrorMessage.mockReset();
  win.showInformationMessage.mockReset();
  win.withProgress.mockReset().mockImplementation(
    (_o: unknown, task: () => Promise<unknown>) => task());
});

describe('tm1.deployToServer', () => {
  it('writes a rule onto a cube that has no rules over there — without confirmation', async () => {
    await deployNodeToServerCommand(ruleNode);
    expect(win.showWarningMessage).not.toHaveBeenCalled();
    expect(vi.mocked(deployOne).mock.calls[0][0]).toEqual({ kind: 'rule', name: 'Sales', parent: 'Sales' });
    expect(vi.mocked(deployOne).mock.calls[0][3]).toBe(false);
  });

  it('aborts when the cube does not exist over there', async () => {
    vi.mocked(readTargetInventory).mockResolvedValue(inventory());
    await deployNodeToServerCommand(ruleNode);
    expect(deployOne).not.toHaveBeenCalled();
    expect(win.showErrorMessage).toHaveBeenCalled();
  });

  it('does not write when the rule list over there was not readable', async () => {
    // Follow-up review 09-23 F2: an empty rule set from a read error meant "no rules" — overwritten without confirmation.
    vi.mocked(readTargetInventory).mockResolvedValue({ ...inventory({ cubes: ['sales'] }), failed: ['rule'] } as never);
    await deployNodeToServerCommand(ruleNode);
    expect(deployOne).not.toHaveBeenCalled();
    expect(win.showErrorMessage).toHaveBeenCalled();
  });

  it('asks when rule text exists and writes nothing on No', async () => {
    vi.mocked(readTargetInventory).mockResolvedValue(inventory({ cubes: ['sales'], rules: ['sales'] }));
    await deployNodeToServerCommand(ruleNode);
    expect(win.showWarningMessage).toHaveBeenCalled();
    expect(deployOne).not.toHaveBeenCalled();
  });

  it('reports a partial success as a warning, not as a success', async () => {
    vi.mocked(deployOne).mockResolvedValue({ warn: 'nur 2 von 3 Aufgaben' });
    await deployNodeToServerCommand(choreNode);
    expect(win.showWarningMessage).toHaveBeenCalledWith('nur 2 von 3 Aufgaben');
    expect(win.showInformationMessage).not.toHaveBeenCalled();
  });

  it('takes a chore that does not exist over there yet without confirmation', async () => {
    await deployNodeToServerCommand(choreNode);
    expect(win.showWarningMessage).not.toHaveBeenCalled();
    expect(vi.mocked(deployOne).mock.calls[0][0]).toEqual({ kind: 'chore', name: 'Nightly' });
    expect(vi.mocked(deployOne).mock.calls[0][3]).toBe(false);
  });

  it('rejects every other node', async () => {
    await deployNodeToServerCommand({ nodeType: 'cube', meta: { serverId: 's1' } } as never);
    expect(deployOne).not.toHaveBeenCalled();
    expect(win.showErrorMessage).toHaveBeenCalled();
  });
});

// Menu wiring fails SILENTLY on a typo — the entry
// simply never appears. That is why it is checked against `package.json`, not on the running tree.
describe('menu wiring', () => {
  it('hangs on rule nodes AND on chores', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const entries = (pkg.contributes.menus['view/item/context'] as { command?: string; when?: string }[])
      .filter(m => m.command === 'tm1.deployToServer');
    expect(entries).toHaveLength(3);
    expect(entries.some(e => /cubeRule/.test(e.when ?? ''))).toBe(true);
    expect(entries.some(e => /recent\\.rule/.test(e.when ?? ''))).toBe(true);
    expect(entries.some(e => /chore/.test(e.when ?? ''))).toBe(true);
    expect(pkg.contributes.commands.some((c: { command: string }) => c.command === 'tm1.deployToServer')).toBe(true);
  });
});

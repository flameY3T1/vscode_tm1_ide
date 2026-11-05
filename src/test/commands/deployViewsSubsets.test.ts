import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// State now lives in `serverState/`; the code under test imports it there.
vi.mock('../../serverState/state', async () => await import('../../commands/serverManager'));
vi.mock('../../commands/serverManager', async () => {
  const { serverManagerMock } = await import('../helpers/serverManagerMock');
  const { vi: v } = await import('vitest');
  return serverManagerMock({
    getConnectedIds: v.fn(),
    getServerNameByUrl: v.fn(() => undefined),
  });
});
vi.mock('../../tm1Rest/cubeApi', () => ({
  probeViewKind: vi.fn(),
  cubeExists: vi.fn().mockResolvedValue(true),
  deleteView: vi.fn().mockResolvedValue(true),
  // Only for the axis test below, which loads the real `writeViewCopy`: without
  // these names, even its import fails on the mock.
  createView: vi.fn().mockResolvedValue(undefined),
  updateView: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../tm1Rest/viewCopyApi', () => ({
  readViewForCopy: vi.fn(),
  writeViewCopy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../tm1Rest/subsetApi', () => ({
  getSubset: vi.fn(),
  listSubsetElementNames: vi.fn(),
  subsetExists: vi.fn().mockResolvedValue(false),
  deleteSubset: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../commands/dimension/dimensionSubsetSave', () => ({
  saveSubset: vi.fn().mockResolvedValue('ok'),
  saveExpressionSubset: vi.fn().mockResolvedValue('ok'),
  SAVE_CANCELLED: Symbol('save-cancelled'),
}));
vi.mock('../../tm1Rest/choreApi', () => ({
  deleteChore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../tm1Rest/processApi', () => ({
  deleteProcess: vi.fn().mockResolvedValue(undefined),
}));

import { getServerConfig, getConnectedIds } from '../../commands/serverManager';
import { probeViewKind, cubeExists, deleteView, createView, updateView } from '../../tm1Rest/cubeApi';
import { readViewForCopy, writeViewCopy } from '../../tm1Rest/viewCopyApi';
import { getSubset, listSubsetElementNames, subsetExists, deleteSubset } from '../../tm1Rest/subsetApi';
import { saveSubset, saveExpressionSubset, SAVE_CANCELLED } from '../../commands/dimension/dimensionSubsetSave';
import { deleteChore } from '../../tm1Rest/choreApi';
import { deleteProcess } from '../../tm1Rest/processApi';
import { deployViewsToServerCommand, deploySubsetsToServerCommand } from '../../commands/tree/deployViewsSubsets';
import {
  deleteCubeViewsCommand, deleteSubsetsCommand, deleteChoresCommand, deleteProcessesCommand,
} from '../../commands/tree/deleteViewsSubsets';

const win = vscode.window as any;

const SRC = { serverUrl: 'http://src', username: 'u', password: '', authType: 'basic' } as any;
const DST = { serverUrl: 'http://dst', username: 'u', password: '', authType: 'basic' } as any;

function viewNode(cube: string, view: string, serverId = 'A'): any {
  return { nodeType: 'cubeView', meta: { cubeName: cube, viewName: view, serverId, isPrivate: false } };
}
function subsetNode(dim: string, name: string, serverId = 'A'): any {
  return { nodeType: 'subset', meta: { dimName: dim, subsetName: name, serverId, isPrivate: false } };
}
function choreNode(name: string, serverId = 'A'): any {
  return { nodeType: 'chore', meta: { choreName: name, serverId } };
}
function processNode(name: string, serverId = 'A'): any {
  return { nodeType: 'process', meta: { processName: name, serverId } };
}

/**
 * Simulates the progress display. `cancelAfter` = after this many
 * `report` messages the token signals cancellation (just as when the user
 * presses "Cancel" while writing is already under way).
 */
function progressMock(cancelAfter = Infinity) {
  let reports = 0;
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* noop */ } }) };
  const opts: any[] = [];
  const fn = vi.fn(async (o: any, task: any) => {
    opts.push(o);
    return task({
      report: () => { reports++; if (reports >= cancelAfter) { token.isCancellationRequested = true; } },
    }, token);
  });
  return Object.assign(fn, { opts });
}

/** Confirms the target server selection. */
function pickTarget() {
  vi.mocked(getConnectedIds).mockReturnValue(['A', 'B']);
  vi.mocked(getServerConfig).mockImplementation((id: any) => (id === 'A' ? SRC : DST));
  win.showQuickPick = vi.fn().mockResolvedValue({ id: 'B', label: 'dst' });
}

beforeEach(() => {
  // `resetAllMocks` instead of `clearAllMocks`: `clear` only deletes the call lists
  // and leaves configured return values in place — `subsetExists -> true` leaked
  // into every test that ran later this way. Reset restores the implementations
  // passed to `vi.fn(impl)`, but NOT chained `mockResolvedValue` presets from
  // the factories: that is why they are
  // all here.
  vi.resetAllMocks();
  win.showErrorMessage = vi.fn().mockResolvedValue(undefined);
  win.showInformationMessage = vi.fn().mockResolvedValue(undefined);
  win.showWarningMessage = vi.fn().mockResolvedValue(undefined);
  win.showQuickPick = vi.fn().mockResolvedValue(undefined);
  win.withProgress = progressMock();
  vi.mocked(cubeExists).mockResolvedValue(true);
  vi.mocked(deleteView).mockResolvedValue(undefined as never);
  vi.mocked(createView).mockResolvedValue(undefined as never);
  vi.mocked(updateView).mockResolvedValue(undefined as never);
  vi.mocked(readViewForCopy).mockResolvedValue({ kind: 'native', plan: { body: {}, namedSubsets: [], oversized: [], unreadable: 0 } } as any);
  vi.mocked(writeViewCopy).mockResolvedValue(undefined);
  vi.mocked(subsetExists).mockResolvedValue(false);
  vi.mocked(deleteSubset).mockResolvedValue(true);
  vi.mocked(saveSubset).mockResolvedValue('ok' as never);
  vi.mocked(saveExpressionSubset).mockResolvedValue('ok' as never);
  vi.mocked(deleteChore).mockResolvedValue(undefined);
  vi.mocked(deleteProcess).mockResolvedValue(undefined);
});

describe('deployViewsToServerCommand', () => {
  it('reports when nothing suitable is selected', async () => {
    await deployViewsToServerCommand(undefined, []);
    expect(win.showErrorMessage).toHaveBeenCalledWith('No views selected.');
  });

  it('rejects a selection spanning two source servers', async () => {
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v', 'A'), viewNode('c', 'v2', 'B')]);
    expect(win.showErrorMessage).toHaveBeenCalledWith('All selected objects must come from the same source server.');
  });

  it('says so when there is no second connected server', async () => {
    vi.mocked(getConnectedIds).mockReturnValue(['A']);
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v')]);
    expect(win.showInformationMessage)
      .toHaveBeenCalledWith('No other connected servers. Connect a target server first.');
  });

  it('writes every selected view to the target server', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null); // nothing exists over there
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2')]);
    expect(writeViewCopy).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeViewCopy).mock.calls[0][0]).toBe(DST);
    expect(win.showInformationMessage).toHaveBeenCalledWith('2 deployed to "dst".');
  });

  it('asks ONCE when something already exists over there — not per item', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue('native' as any);
    win.showWarningMessage = vi.fn().mockResolvedValue('Overwrite');
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2'), viewNode('c', 'v3')]);
    expect(win.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(win.showWarningMessage.mock.calls[0][0]).toBe('3 of the selected objects already exist on "dst":');
    expect(writeViewCopy).toHaveBeenCalledTimes(3);
  });

  it('skips the existing ones when the user chooses that', async () => {
    pickTarget();
    // v1 exists over there, v2 does not.
    vi.mocked(probeViewKind).mockImplementation(async (_cfg: any, _c: any, v: any) =>
      (v === 'v1' ? ('native' as any) : null));
    win.showWarningMessage = vi.fn().mockResolvedValue('Skip these');
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2')]);
    expect(writeViewCopy).toHaveBeenCalledTimes(1);
    expect(win.showInformationMessage).toHaveBeenCalledWith('1 deployed to "dst", 1 skipped.');
  });

  it('writes nothing at all when the confirmation prompt is cancelled', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue('native' as any);
    win.showWarningMessage = vi.fn().mockResolvedValue(undefined);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1')]);
    expect(writeViewCopy).not.toHaveBeenCalled();
  });

  it('names the missing cube instead of producing a bare 404', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null);
    vi.mocked(cubeExists).mockResolvedValue(false);
    await deployViewsToServerCommand(undefined, [viewNode('Sales', 'v1')]);
    expect(writeViewCopy).not.toHaveBeenCalled();
    expect(win.showWarningMessage.mock.calls[0][0])
      .toContain('Cube "Sales" does not exist on the target server.');
  });

  it('refuses an axis that is too large instead of writing it truncated', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null);
    vi.mocked(readViewForCopy).mockResolvedValue(
      { kind: 'native', plan: { body: {}, namedSubsets: [], oversized: ['Konto'], unreadable: 0 } } as any);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1')]);
    expect(writeViewCopy).not.toHaveBeenCalled();
    expect(win.showWarningMessage.mock.calls[0][0]).toContain('too many members');
  });

  it('requires the named Subset on the target server', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null);
    vi.mocked(readViewForCopy).mockResolvedValue({
      kind: 'native',
      plan: { body: {}, namedSubsets: [{ dim: 'Konto', hier: 'Konto', name: 'Top10' }], oversized: [], unreadable: 0 },
    } as any);
    vi.mocked(subsetExists).mockResolvedValue(false);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1')]);
    expect(writeViewCopy).not.toHaveBeenCalled();
    expect(win.showWarningMessage.mock.calls[0][0]).toContain('Subset "Top10"');
  });

  it('can be cancelled and counts the rest as skipped', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null);
    // 3 lookup messages, then the first write message — cancellation after that.
    win.withProgress = progressMock(4);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2'), viewNode('c', 'v3')]);
    expect(win.withProgress.opts[0].cancellable).toBe(true);
    expect(writeViewCopy).toHaveBeenCalledTimes(1);
    expect(win.showInformationMessage).toHaveBeenCalledWith('1 deployed to "dst", 2 skipped.');
  });

  it('only checks what exists over there INSIDE the progress display', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1')]);
    // The existence check used to run before `withProgress` — with a large selection
    // the UI hung during it without any explanation.
    expect(vi.mocked(probeViewKind).mock.invocationCallOrder[0])
      .toBeGreaterThan(win.withProgress.mock.invocationCallOrder[0]);
  });

  it('continues after an error and reports it at the end', async () => {
    pickTarget();
    vi.mocked(probeViewKind).mockResolvedValue(null);
    vi.mocked(writeViewCopy)
      .mockRejectedValueOnce(new Error('kaputt'))
      .mockResolvedValueOnce(undefined);
    await deployViewsToServerCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2')]);
    expect(writeViewCopy).toHaveBeenCalledTimes(2);
    expect(win.showWarningMessage.mock.calls[0][0]).toContain('1 deployed, 1 failed:');
  });
});

describe('deploySubsetsToServerCommand', () => {
  it('writes a static Subset as an element list', async () => {
    pickTarget();
    vi.mocked(getSubset).mockResolvedValue({ ok: true, Name: 's', Expression: '', Alias: 'Klar' } as any);
    vi.mocked(listSubsetElementNames).mockResolvedValue({ elements: ['a', 'b'], complete: true } as any);
    await deploySubsetsToServerCommand(undefined, [subsetNode('Konto', 's')]);
    // `'ask'` at the end: the SINGLE command asks per item about flattening —
    // only the bulk run decides once up front (B6).
    expect(saveSubset).toHaveBeenCalledWith(
      'Konto', 'Konto', 's', false, ['a', 'b'], false, DST, 'Klar', 'ask');
    expect(saveExpressionSubset).not.toHaveBeenCalled();
  });

  it('keeps a dynamic Subset dynamic', async () => {
    // Computing the members and writing them as a list turned a
    // rule into a snapshot.
    pickTarget();
    vi.mocked(getSubset).mockResolvedValue({ ok: true, Name: 's', Expression: '{TM1SUBSETALL([K])}', Alias: '' } as any);
    await deploySubsetsToServerCommand(undefined, [subsetNode('K', 's')]);
    expect(saveExpressionSubset).toHaveBeenCalledWith('K', 'K', 's', false, '{TM1SUBSETALL([K])}', false, DST, null);
    expect(saveSubset).not.toHaveBeenCalled();
    expect(listSubsetElementNames).not.toHaveBeenCalled();
  });

  it('writes nothing when the members were only half read', async () => {
    pickTarget();
    vi.mocked(getSubset).mockResolvedValue({ ok: true, Name: 's', Expression: '', Alias: '' } as any);
    vi.mocked(listSubsetElementNames).mockResolvedValue({ elements: ['a'], complete: false } as any);
    await deploySubsetsToServerCommand(undefined, [subsetNode('K', 's')]);
    expect(saveSubset).not.toHaveBeenCalled();
    expect(win.showWarningMessage.mock.calls[0][0]).toContain('could not be read completely');
  });

  it('does NOT count a cancelled save as a success', async () => {
    // `saveSubset` asks back for a subset that has to be written flat; a
    // No there writes nothing.
    pickTarget();
    vi.mocked(getSubset).mockResolvedValue({ ok: true, Name: 's', Expression: '', Alias: '' } as any);
    vi.mocked(listSubsetElementNames).mockResolvedValue({ elements: ['a'], complete: true } as any);
    vi.mocked(saveSubset).mockResolvedValue(SAVE_CANCELLED as any);
    await deploySubsetsToServerCommand(undefined, [subsetNode('K', 's')]);
    expect(win.showInformationMessage).toHaveBeenCalledWith('0 deployed to "dst", 1 skipped.');
  });

  it('passes the overwrite Yes through to the write path', async () => {
    pickTarget();
    vi.mocked(subsetExists).mockResolvedValue(true);
    win.showWarningMessage = vi.fn().mockResolvedValue('Overwrite');
    vi.mocked(getSubset).mockResolvedValue({ ok: true, Name: 's', Expression: 'x', Alias: '' } as any);
    await deploySubsetsToServerCommand(undefined, [subsetNode('K', 's')]);
    expect(vi.mocked(saveExpressionSubset).mock.calls[0][5]).toBe(true); // overwrite
  });
});

describe('writeViewCopy: a body without axes is never written', () => {
  // The REAL `writeViewCopy` runs here (the rest of the file mocks it away).
  // Reason: an empty plan — for instance from broken JSON — is not nothing when
  // overwriting, it is data loss; `updateView` REPLACES the axes.
  async function real() {
    return await vi.importActual<typeof import('../../tm1Rest/viewCopyApi')>('../../tm1Rest/viewCopyApi');
  }
  const emptyPlan = { body: { Rows: [], Columns: [], Titles: [] }, namedSubsets: [], oversized: [], unreadable: 0 };

  it('does not empty the existing target view but throws', async () => {
    const { writeViewCopy: w } = await real();
    await expect(w(DST, 'c', 'v', false, { kind: 'native', plan: emptyPlan } as any, 'native', 'schreibfehler', 'leer'))
      .rejects.toThrow('leer');
    expect(updateView).not.toHaveBeenCalled();
  });

  it('does not create an empty new view either', async () => {
    const { writeViewCopy: w } = await real();
    await expect(w(DST, 'c', 'v', false, { kind: 'native', plan: undefined } as any, null, 'schreibfehler', 'leer'))
      .rejects.toThrow('leer');
    expect(createView).not.toHaveBeenCalled();
  });

  it('lets a view with an axis through and passes the error text on to the create call', async () => {
    const { writeViewCopy: w } = await real();
    const plan = { ...emptyPlan, body: { '@odata.type': '#x', Rows: [{ a: 1 }], Columns: [], Titles: [] } };
    await w(DST, 'c', 'v', false, { kind: 'native', plan } as any, null, 'schreibfehler', 'leer');
    // N11: `createView` used to not receive the localized text.
    expect(vi.mocked(createView).mock.calls[0][5]).toBe('schreibfehler');
  });
});

describe('deleteCubeViewsCommand', () => {
  it('asks with the name when there is exactly one', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteCubeViewsCommand(viewNode('Sales', 'Standard'), undefined, () => { /* noop */ });
    expect(win.showWarningMessage.mock.calls[0][0]).toBe('Delete View "Standard" (Cube "Sales")?');
    expect(deleteView).toHaveBeenCalledTimes(1);
  });

  it('asks with the count when there are several, and deletes all of them', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteCubeViewsCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2')], () => { /* noop */ });
    expect(win.showWarningMessage.mock.calls[0][0]).toBe('Really delete 2 objects?');
    expect(deleteView).toHaveBeenCalledTimes(2);
  });

  it('deletes nothing without confirmation', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue(undefined);
    await deleteCubeViewsCommand(undefined, [viewNode('c', 'v1')], () => { /* noop */ });
    expect(deleteView).not.toHaveBeenCalled();
  });

  it('rebuilds the tree exactly ONCE per affected server', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const refreshed: string[] = [];
    await deleteCubeViewsCommand(
      undefined, [viewNode('c', 'v1'), viewNode('c', 'v2'), viewNode('c', 'v3')],
      id => refreshed.push(id));
    expect(refreshed).toEqual(['A']);
  });

  it('does not stop after an error', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    vi.mocked(deleteView).mockRejectedValueOnce(new Error('in Benutzung'));
    await deleteCubeViewsCommand(undefined, [viewNode('c', 'v1'), viewNode('c', 'v2')], () => { /* noop */ });
    expect(deleteView).toHaveBeenCalledTimes(2);
    expect(win.showWarningMessage.mock.calls[1][0]).toContain('1 deleted, 1 failed:');
  });
});

describe('deleteSubsetsCommand', () => {
  it('deletes the whole selection under the default hierarchy', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteSubsetsCommand(undefined, [subsetNode('Konto', 's1'), subsetNode('Konto', 's2')], () => { /* noop */ });
    expect(deleteSubset).toHaveBeenCalledTimes(2);
    // Dimension twice: the tree lists subsets under the default hierarchy,
    // and that one is named like the dimension.
    expect(vi.mocked(deleteSubset).mock.calls[0].slice(0, 5)).toEqual([SRC, 'Konto', 'Konto', 's1', false]);
  });

  it('ignores nodes that are not subsets', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteSubsetsCommand(undefined, [viewNode('c', 'v'), subsetNode('Konto', 's1')], () => { /* noop */ });
    expect(deleteSubset).toHaveBeenCalledTimes(1);
  });
});

describe('deleteChoresCommand', () => {
  // Regression: until 2026-09-02, `tm1.deleteChore` only took the first command
  // argument (the clicked node) — with several selected chores +
  // Delete, only the clicked one disappeared.
  it('deletes the whole selection, not just the clicked node', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteChoresCommand(choreNode('c1'), [choreNode('c1'), choreNode('c2')], () => { /* noop */ });
    expect(deleteChore).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deleteChore).mock.calls[0]).toEqual([SRC, 'c1']);
    expect(vi.mocked(deleteChore).mock.calls[1]).toEqual([SRC, 'c2']);
  });

  it('asks with the name when there is exactly one', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteChoresCommand(choreNode('c1'), undefined, () => { /* noop */ });
    expect(win.showWarningMessage.mock.calls[0][0]).toContain('c1');
  });

  it('deletes nothing without confirmation', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue(undefined);
    await deleteChoresCommand(undefined, [choreNode('c1')], () => { /* noop */ });
    expect(deleteChore).not.toHaveBeenCalled();
  });

  it('ignores nodes that are not chores', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    await deleteChoresCommand(undefined, [viewNode('c', 'v'), choreNode('c1')], () => { /* noop */ });
    expect(deleteChore).toHaveBeenCalledTimes(1);
  });
});

describe('deleteProcessesCommand', () => {
  it('deletes the whole selection and reports every successful process for follow-up maintenance', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const deleted: Array<{ name: string; serverId: string }> = [];

    await deleteProcessesCommand(
      processNode('p1'), [processNode('p1'), processNode('p2')],
      () => { /* noop */ },
      (name, serverId) => deleted.push({ name, serverId }),
    );

    expect(vi.mocked(deleteProcess).mock.calls).toEqual([[SRC, 'p1'], [SRC, 'p2']]);
    expect(deleted).toEqual([
      { name: 'p1', serverId: 'A' },
      { name: 'p2', serverId: 'A' },
    ]);
  });

  it('keeps the previous success message for a single process', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');

    await deleteProcessesCommand(processNode('p1'), undefined, () => { /* noop */ }, () => { /* noop */ });

    expect(win.showInformationMessage).toHaveBeenCalledWith('TM1: Process "p1" was deleted.');
  });

  it('keeps the previous error message for a single failed process', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    vi.mocked(deleteProcess).mockRejectedValueOnce(new Error('gesperrt'));
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');

    await deleteProcessesCommand(processNode('p1'), undefined, () => { /* noop */ }, () => { /* noop */ });

    expect(win.showErrorMessage).toHaveBeenCalledWith('TM1 Process error: gesperrt');
  });

  it('continues after an error, follows up only on successes and refreshes each server once', async () => {
    vi.mocked(getServerConfig).mockReturnValue(SRC);
    vi.mocked(deleteProcess).mockRejectedValueOnce(new Error('gesperrt'));
    win.showWarningMessage = vi.fn().mockResolvedValue('Delete');
    const deleted: string[] = [];
    const refreshed: string[] = [];

    await deleteProcessesCommand(
      undefined, [processNode('p1'), processNode('p2'), processNode('p3')],
      serverId => refreshed.push(serverId),
      name => deleted.push(name),
    );

    expect(deleteProcess).toHaveBeenCalledTimes(3);
    expect(deleted).toEqual(['p2', 'p3']);
    expect(refreshed).toEqual(['A']);
    expect(win.showWarningMessage.mock.calls[1][0]).toContain('2 deleted, 1 failed:');
  });
});

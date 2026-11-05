import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

import * as vscode from 'vscode';
import { registerAdminServerCommands } from '../../activation/registerAdminServerCommands';
import { initServerManager, saveServers, getAllServers, pwKey } from '../../serverState/state';
import { saveAdminServer, getAdminServer, listAdminServers } from '../../serverState/adminServers';
import * as adminApi from '../../tm1Rest/adminServerApi';

// `secrets.delete` is deliberately a spy and not a stub — finding 3 of the review
// demands proof that the password is actually deleted along with it.
let secretDelete: ReturnType<typeof vi.fn>;

function fakeContext() {
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

const discovered = () => ({
  id: 'disc:a1:SALES', name: 'SALES', serverUrl: 'https://h:1', username: '',
  rejectUnauthorized: false, authType: 'Basic' as const,
  parentAdminId: 'a1', discoveredName: 'SALES', discoveredUrl: 'https://h:1',
});

// Like `discovered()`, but the user has already put them into a folder via
// `tm1.server.moveToFolder` (also available on discovered nodes).
const discoveredInFolder = () => ({
  id: 'disc:a1:MUC', name: 'MUC', serverUrl: 'https://h:2', username: '',
  rejectUnauthorized: false, authType: 'Basic' as const,
  parentAdminId: 'a1', discoveredName: 'MUC', discoveredUrl: 'https://h:2', folder: 'Finanzen',
});

let ctx: vscode.ExtensionContext;
const node = (adminId: string) => ({ meta: { adminId } } as never);
const childNode = () => ({ meta: { serverId: 'disc:a1:SALES' } } as never);

beforeEach(async () => {
  ctx = fakeContext();
  initServerManager(ctx);
  registerAdminServerCommands({ context: ctx } as never);
  await saveAdminServer({ id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: [] });
  await saveServers(ctx, [discovered()]);
});

// Without this, a second `vi.spyOn` on the same method returns THE SAME
// mock including its call counter: `mock.calls[0]` would be the call of an
// earlier test, and with a shuffled order a different one than yesterday.
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

describe('tm1.adminServer.restore: reconciliation with the running state', () => {
  it('marks what the server does NOT report — and offers it anyway', async () => {
    await saveAdminServer({ ...getAdminServer('a1')!, hidden: ['WEG', 'SALES'] });
    await saveServers(ctx, []);
    // `hidden` are mere names and age along; the server does not report 'WEG'.
    // That must NOT block the way back: a stopped instance is not
    // in the list either, and its name would otherwise stay stuck until the next
    // start.
    vi.spyOn(adminApi, 'listAdminInstances').mockResolvedValue([
      { name: 'SALES', host: 'https://h:1', acceptingClients: true, usingSSL: true,
        ipAddress: '', ipv6Address: '', httpPortNumber: 1 },
    ] as never);
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);

    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));

    const items = pick.mock.calls[0][0] as { label: string; description: string }[];
    // Reported ones first, even though 'WEG' comes first in `hidden`.
    expect(items.map(i => i.label)).toEqual(['SALES', 'WEG']);
    expect(items[1].description).toBe('not currently reported by "PROD"');
  });

  it('does NOT count a stopped instance as reported', async () => {
    await saveAdminServer({ ...getAdminServer('a1')!, hidden: ['STOP', 'SALES'] });
    await saveServers(ctx, []);
    // Both fetches include stopped instances (`acceptingClients: false`),
    // but the tree filters them. Without the filter, the column here would promise a
    // rediscovery that does not happen until the next start.
    vi.spyOn(adminApi, 'listAdminInstances').mockImplementation(async () => [
      { name: 'SALES', host: 'https://h:1', acceptingClients: true, usingSSL: true,
        ipAddress: '', ipv6Address: '', httpPortNumber: 1 },
      { name: 'STOP', host: 'https://h:2', acceptingClients: false, usingSSL: true,
        ipAddress: '', ipv6Address: '', httpPortNumber: 2 },
    ] as never);
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);

    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));

    const items = pick.mock.calls[0][0] as { label: string; description: string }[];
    expect(items.map(i => i.label)).toEqual(['SALES', 'STOP']);
    expect(items[1].description).toBe('not currently reported by "PROD"');
  });

  it('marks nothing at all when the server is unreachable', async () => {
    await saveAdminServer({ ...getAdminServer('a1')!, hidden: ['SALES', 'WEG'] });
    await saveServers(ctx, []);
    vi.spyOn(adminApi, 'listAdminInstances').mockRejectedValue(new Error('ECONNREFUSED'));
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);

    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));

    // Undoing must not fail because of a network error.
    const items = pick.mock.calls[0][0] as { label: string; description: string }[];
    expect(items.map(i => i.label)).toEqual(['SALES', 'WEG']);
    // Without a fetch there is nothing to mark — the column again says what is
    // known from the profile.
    expect(items.every(i => i.description !== 'not currently reported by "PROD"')).toBe(true);
  });
});

describe('tm1.adminServer.hide', () => {
  it('removes the profile AND puts the name on the hide list', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ label: 'SALES', id: 'disc:a1:SALES' }] as never);
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Hide instances' as never);

    await vscode.commands.executeCommand('tm1.adminServer.hide', node('a1'));

    // Both together is the point: deleting alone lets the next discovery recreate it
    // right away, hiding alone leaves the profile visible.
    expect(getAllServers(ctx)).toHaveLength(0);
    expect(getAdminServer('a1')!.hidden).toEqual(['SALES']);
    expect(secretDelete).toHaveBeenCalledWith(pwKey('disc:a1:SALES'));
  });

  it('leaves everything in place when the confirmation prompt is declined', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ label: 'SALES', id: 'disc:a1:SALES' }] as never);
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);

    await vscode.commands.executeCommand('tm1.adminServer.hide', node('a1'));

    expect(getAllServers(ctx)).toHaveLength(1);
    expect(getAdminServer('a1')!.hidden).toEqual([]);
  });

  it('only offers children of THIS group', async () => {
    await saveServers(ctx, [discovered(), {
      id: 'disc:a2:FOO', name: 'FOO', serverUrl: 'https://h:9', username: '',
      rejectUnauthorized: false, authType: 'Basic' as const,
      parentAdminId: 'a2', discoveredName: 'FOO',
    }]);
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);

    await vscode.commands.executeCommand('tm1.adminServer.hide', node('a1'));

    const angeboten = (pick.mock.calls[0][0] as { label: string }[]).map(i => i.label);
    expect(angeboten).toEqual(['SALES']);
  });
});

describe('tm1.adminServer.detach', () => {
  it('turns the instance into a standalone profile in the chosen folder', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue({ label: 'Finanzen' } as never);
    await vscode.commands.executeCommand('tm1.adminServer.detach', childNode());
    const s = getAllServers(ctx)[0];
    expect(s.parentAdminId).toBeUndefined();
    expect(s.folder).toBe('Finanzen');
    // Otherwise the next discovery recreates them right away.
    expect(getAdminServer('a1')?.hidden).toEqual(['SALES']);
  });

  it('explains itself when invoked on a server that has no admin server', async () => {
    // The menu entry hangs on the general serverRoot contextValue (the 19
    // menu conditions in package.json must not be rewired), so
    // the command itself has to explain instead of silently returning.
    await saveServers(ctx, [{ ...discovered(), parentAdminId: undefined }]);
    const info = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as never);
    const pick = vi.spyOn(vscode.window, 'showQuickPick');
    await vscode.commands.executeCommand('tm1.adminServer.detach', childNode());
    expect(info).toHaveBeenCalledWith('This server does not come from an admin server.');
    expect(pick).not.toHaveBeenCalled();
  });

  it('does nothing when the folder pick is cancelled', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);
    await vscode.commands.executeCommand('tm1.adminServer.detach', childNode());
    expect(getAllServers(ctx)[0].parentAdminId).toBe('a1');
    expect(getAdminServer('a1')?.hidden).toEqual([]);
  });
});

describe('tm1.adminServer.remove', () => {
  it('keeps the discovered profiles as standalone servers when asked to', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Keep servers' as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    expect(listAdminServers()).toEqual([]);
    const s = getAllServers(ctx)[0];
    expect(s.parentAdminId).toBeUndefined();
    expect(s.name).toBe('SALES');
  });

  it('deletes the discovered profiles when asked to', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete servers too' as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    expect(listAdminServers()).toEqual([]);
    expect(getAllServers(ctx)).toEqual([]);
  });

  it('deletes the stored password along with the profile', async () => {
    // Runs through `deleteServer` — the same pipeline that also disconnects and
    // cleans up the workbenches/attribute columns (finding 3). The key is
    // NO LONGER built by hand here (finding 5).
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete servers too' as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    expect(secretDelete).toHaveBeenCalledWith(pwKey('disc:a1:SALES'));
    expect(getAllServers(ctx).find(s => s.id === 'disc:a1:SALES')).toBeUndefined();
  });

  it('does nothing when the confirmation is dismissed', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    expect(listAdminServers()).toHaveLength(1);
    expect(getAllServers(ctx)).toHaveLength(1);
  });

  it('spares a child that sits in a folder when deleting servers too, and only clears its parentAdminId', async () => {
    await saveServers(ctx, [discovered(), discoveredInFolder()]);
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete servers too' as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    // Folderless child ran through the real deletion pipeline (secret gone too).
    expect(secretDelete).toHaveBeenCalledWith(pwKey('disc:a1:SALES'));
    expect(getAllServers(ctx).find(s => s.id === 'disc:a1:SALES')).toBeUndefined();
    // Foldered child survives, only loses parentAdminId.
    const kept = getAllServers(ctx).find(s => s.id === 'disc:a1:MUC');
    expect(kept).toBeDefined();
    expect(kept?.parentAdminId).toBeUndefined();
    expect(kept?.folder).toBe('Finanzen');
  });

  it('offers only one action — not a delete that deletes nothing — when every child sits in a folder', async () => {
    await saveServers(ctx, [discoveredInFolder()]);
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Keep servers' as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    const buttons = warn.mock.calls[0].slice(2);
    expect(buttons).toEqual(['Keep servers']);
    const kept = getAllServers(ctx).find(s => s.id === 'disc:a1:MUC');
    expect(kept?.parentAdminId).toBeUndefined();
    expect(kept?.folder).toBe('Finanzen');
  });

  it('offers only one action when the admin server has no children at all', async () => {
    await saveServers(ctx, []);
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Keep servers' as never);
    await vscode.commands.executeCommand('tm1.adminServer.remove', node('a1'));
    const buttons = warn.mock.calls[0].slice(2);
    expect(buttons).toEqual(['Keep servers']);
  });
});

describe('tm1.adminServer.restore', () => {
  it('shows an information message and no quick pick when nothing was taken out', async () => {
    const info = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as never);
    const pick = vi.spyOn(vscode.window, 'showQuickPick');
    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));
    expect(info).toHaveBeenCalledWith('Nothing has been taken out of "PROD" yet.');
    expect(pick).not.toHaveBeenCalled();
  });

  it('takes a still-existing profile back into the group and clears its folder', async () => {
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: ['SALES'],
    });
    await saveServers(ctx, [{ ...discovered(), parentAdminId: undefined, folder: 'Finanzen' }]);
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ label: 'SALES' }] as never);
    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));

    // Description told the user it still exists (vs. "long gone").
    const items = pick.mock.calls[0][0] as { label: string; description: string }[];
    expect(items[0].description).toContain('still exists');

    const s = getAllServers(ctx).find(x => x.id === 'disc:a1:SALES');
    expect(s?.parentAdminId).toBe('a1');
    expect(s?.folder).toBeUndefined();
    expect(getAdminServer('a1')?.hidden).toEqual([]);
  });

  it('removes a name from hidden even when its profile no longer exists, without crashing', async () => {
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: ['GONE'],
    });
    await saveServers(ctx, []);
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ label: 'GONE' }] as never);
    const items = () => (pick.mock.calls[0]?.[0] as { label: string; description: string }[] | undefined);
    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));
    expect(items()?.[0].description).not.toContain('still exists');
    expect(getAdminServer('a1')?.hidden).toEqual([]);
    expect(getAllServers(ctx)).toEqual([]);
  });

  it('never steals a profile that currently belongs to a different admin server', async () => {
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: ['SALES'],
    });
    await saveAdminServer({
      id: 'a2', name: 'OTHER', serverUrl: 'http://h2:5895', rejectUnauthorized: false, hidden: [],
    });
    // Same reported name, but this profile belongs to a2 (its own deterministic
    // id namespace) — no `disc:a1:SALES` profile exists at all, so the fallback
    // name-based match is the only candidate, and it must be skipped.
    await saveServers(ctx, [{
      id: 'disc:a2:SALES', name: 'SALES', serverUrl: 'https://h:9', username: '',
      rejectUnauthorized: false, authType: 'Basic' as const,
      parentAdminId: 'a2', discoveredName: 'SALES', discoveredUrl: 'https://h:9',
    }]);
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ label: 'SALES' }] as never);
    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));
    const s = getAllServers(ctx).find(x => x.id === 'disc:a2:SALES');
    expect(s?.parentAdminId).toBe('a2'); // untouched — not stolen
    expect(getAdminServer('a1')?.hidden).toEqual([]); // still removed from a1's hidden list
  });

  it('never steals a profile that was detached from a different admin server', async () => {
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: ['SALES'],
    });
    await saveAdminServer({
      id: 'a2', name: 'OTHER', serverUrl: 'http://h2:5895', rejectUnauthorized: false, hidden: [],
    });
    // Detached from a2: no parentAdminId (like a truly orphaned profile), but
    // still carries a2's namespaced id and now sits in a folder. a1's fallback
    // must not mistake it for its own — the namespace check has to catch this,
    // not just the (already-cleared) parentAdminId.
    await saveServers(ctx, [{
      id: 'disc:a2:SALES', name: 'SALES', serverUrl: 'https://h:9', username: '',
      rejectUnauthorized: false, authType: 'Basic' as const,
      discoveredName: 'SALES', discoveredUrl: 'https://h:9', folder: 'Woanders',
    }]);
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ label: 'SALES' }] as never);
    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));
    const s = getAllServers(ctx).find(x => x.id === 'disc:a2:SALES');
    expect(s?.parentAdminId).toBeUndefined(); // still not claimed by a1
    expect(s?.folder).toBe('Woanders'); // untouched — not stolen
    expect(getAdminServer('a1')?.hidden).toEqual([]); // still removed from a1's hidden list
  });

  it('changes nothing when the quick pick is cancelled', async () => {
    await saveAdminServer({
      id: 'a1', name: 'PROD', serverUrl: 'http://h:5895', rejectUnauthorized: false, hidden: ['SALES'],
    });
    await saveServers(ctx, [{ ...discovered(), parentAdminId: undefined, folder: 'Finanzen' }]);
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined as never);
    await vscode.commands.executeCommand('tm1.adminServer.restore', node('a1'));
    expect(getAdminServer('a1')?.hidden).toEqual(['SALES']);
    const s = getAllServers(ctx)[0];
    expect(s.parentAdminId).toBeUndefined();
    expect(s.folder).toBe('Finanzen');
  });
});

// Since 2026-08-28, `tm1.adminServer.edit` opens the same edit view
// as "Edit Server" instead of two input lines; the path including saving
// and deleting is in `adminServerEditPanel.test.ts`.

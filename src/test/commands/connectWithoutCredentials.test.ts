// src/test/commands/connectWithoutCredentials.test.ts
//
// A freshly discovered admin server profile has no credentials yet
// (`username: ''`, no stored password). The first connection attempt
// must no longer fire a doomed request, but has to open the prefilled
// server form. The guard logic sits as the pure predicate
// `needsInitialCredentials` in `connection.ts` and is applied by the THREE callers
// of `connect()`:
//   1. the predicate itself (pure, checked directly)
//   2. the tree "Connect" command path (`registerServerCommands.ts`) — already imports
//      `openEditServerPanel` directly, no cycle
//   3. the Quick Pick "Connect" path (`serverManager/form.ts`) — must NOT import
//      `addServerPanel.ts` (the same cycle as point 2, mirrored)
//      and therefore detours via `vscode.commands.executeCommand('tm1.server.editById', …)`.
//      Exactly this spot is checked here literally against the command name —
//      a typo there would otherwise not be noticeable by any test.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', async () => {
  const actual = await import('../__mocks__/vscode');
  return {
    ...actual,
    // form.ts#showServerManagerCommand builds the QuickPick items with
    // `vscode.QuickPickItemKind.Separator` — not present in the shared mock.
    QuickPickItemKind: { Separator: -1 },
  };
});

// connection.ts (via form.ts AND via the mocked facade below) reaches the
// network through the tm1Client facade — cut off here so that no real call
// goes out and a "connects normally" test does not hang on the real transport.
vi.mock('../../tm1Client', () => ({
  apiRequest: vi.fn(),
  setConfigOverride: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));

const connectSpy = vi.hoisted(() => vi.fn());
const getAllServersSpy = vi.hoisted(() => vi.fn());
const needsInitialCredentialsSpy = vi.hoisted(() => vi.fn());
const loadCredentialsSpy = vi.hoisted(() => vi.fn());

// needsInitialCredentials and loadCredentials are NOT rebuilt by hand —
// the mock facade delegates to the real implementation from
// connection.ts, so that a change in behaviour of the predicate or the resolution
// actually comes through here instead of going unnoticed.
vi.mock('../../commands/serverManager', async () => {
  const actualConnection = await vi.importActual<typeof import('../../commands/serverManager/connection')>(
    '../../commands/serverManager/connection',
  );
  needsInitialCredentialsSpy.mockImplementation(actualConnection.needsInitialCredentials);
  loadCredentialsSpy.mockImplementation(actualConnection.loadCredentials);
  return {
    showServerManagerCommand: vi.fn(),
    getAllServers: getAllServersSpy,
    getServerConfig: vi.fn(),
    connect: connectSpy,
    disconnect: vi.fn(),
    _connectFailureMessage: vi.fn(() => ''),
    needsInitialCredentials: needsInitialCredentialsSpy,
    loadCredentials: loadCredentialsSpy,
  };
});

const openEditServerPanelSpy = vi.hoisted(() => vi.fn());
vi.mock('../../commands/serverConfig/addServerPanel', () => ({
  openAddServerPanel: vi.fn(),
  openEditServerPanel: openEditServerPanelSpy,
  openAddAdminServerPanel: vi.fn(),
}));

vi.mock('../../commands/serverConfig/serverConfigEditor', () => ({
  openServerConfigEditor: vi.fn(),
}));

vi.mock('../../commands/serverConfig/v12ManageDatabases', () => ({
  manageV12Databases: vi.fn(),
}));

import * as vscode from 'vscode';
import { apiRequest } from '../../tm1Client';
import { registerServerCommands } from '../../activation/registerServerCommands';
import { needsInitialCredentials } from '../../commands/serverManager/connection';
import { showServerManagerCommand } from '../../commands/serverManager/form';
import type { ServerProfile } from '../../serverState/state';
import type { ActivationContext } from '../../activation/context';

function fakeContext(): vscode.ExtensionContext {
  const secretStore = new Map<string, string>();
  return {
    subscriptions: [],
    secrets: {
      get: async (k: string) => secretStore.get(k),
      store: async (k: string, v: string) => { secretStore.set(k, v); },
      delete: async (k: string) => { secretStore.delete(k); },
    },
    globalState: {
      get: (_k: string, dflt?: unknown) => dflt,
      update: async () => {},
    },
  } as unknown as vscode.ExtensionContext;
}

// ── 1. The pure predicate directly ──────────────────────────────────────────
describe('needsInitialCredentials (pure predicate)', () => {
  it('is true for a discovered profile with empty username and no password', () => {
    const p = { id: 'x', parentAdminId: 'a1', username: '' } as ServerProfile;
    expect(needsInitialCredentials(p, undefined)).toBe(true);
    expect(needsInitialCredentials(p, '')).toBe(true);
  });

  it('is false once the discovered profile has a username', () => {
    const p = { id: 'x', parentAdminId: 'a1', username: 'admin' } as ServerProfile;
    expect(needsInitialCredentials(p, undefined)).toBe(false);
    expect(needsInitialCredentials(p, '')).toBe(false);
  });

  it('is false for a hand-made profile (no parentAdminId) even with an empty username — deliberate setting', () => {
    const p = { id: 'x', username: '' } as ServerProfile;
    expect(needsInitialCredentials(p, undefined)).toBe(false);
  });

  it('is false once a password is stored, even for a discovered profile without username', () => {
    const p = { id: 'x', parentAdminId: 'a1', username: '' } as ServerProfile;
    expect(needsInitialCredentials(p, 'secret')).toBe(false);
  });
});

// ── 2. The tree "Connect" command path end-to-end: no doomed request ──────
describe('tm1.server.connect on a credential-less discovered profile fires no doomed request', () => {
  const discovered: ServerProfile = {
    id: 'disc:a1:SALES',
    name: 'SALES',
    serverUrl: 'https://h:1',
    username: '',
    rejectUnauthorized: false,
    authType: 'Basic',
    parentAdminId: 'a1',
    discoveredName: 'SALES',
    discoveredUrl: 'https://h:1',
  };

  let ctx: vscode.ExtensionContext;

  beforeEach(() => {
    ctx = fakeContext();
    connectSpy.mockReset();
    openEditServerPanelSpy.mockReset();
    getAllServersSpy.mockReset();
    needsInitialCredentialsSpy.mockClear(); // Delegate (real predicate) is kept, only clear the call list.
    loadCredentialsSpy.mockClear(); // same for the resolution.

    getAllServersSpy.mockReturnValue([discovered]);

    registerServerCommands({
      context: ctx,
      treeDataProvider: { setSessionIdle: () => {} },
    } as unknown as ActivationContext);
  });

  it('opens the server form instead of connecting — connect() is never called', async () => {
    await vscode.commands.executeCommand('tm1.server.connect', { meta: { serverId: discovered.id } });

    expect(connectSpy).not.toHaveBeenCalled();
    expect(openEditServerPanelSpy).toHaveBeenCalledWith(ctx, discovered.id);
  });

  it('connects normally once a username is present (discovered profile, credentials filled in)', async () => {
    const withUser: ServerProfile = { ...discovered, username: 'admin' };
    getAllServersSpy.mockReturnValue([withUser]);
    connectSpy.mockResolvedValue(undefined);

    await vscode.commands.executeCommand('tm1.server.connect', { meta: { serverId: withUser.id } });

    expect(openEditServerPanelSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith(ctx, withUser);
  });

  it('connects normally for a hand-made profile with an empty username (no parentAdminId)', async () => {
    const handMade: ServerProfile = { ...discovered, id: 'hand:1', parentAdminId: undefined };
    getAllServersSpy.mockReturnValue([handMade]);
    connectSpy.mockResolvedValue(undefined);

    await vscode.commands.executeCommand('tm1.server.connect', { meta: { serverId: handMade.id } });

    expect(openEditServerPanelSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith(ctx, handMade);
  });
});

// ── 3. The Quick Pick "Connect" path (form.ts): the same guard, a different detour ─
// form.ts must not import addServerPanel.ts (cycle via the facade,
// see the module comment at the top of connection.ts / form.ts). The way out is
// `vscode.commands.executeCommand('tm1.server.editById', …)` — exactly the
// pattern form.ts already uses for 'add' (`tm1.addServer`). These tests
// do NOT run through the mocked facade (point 2), but import
// `showServerManagerCommand` directly from the real `form.ts`, so that a
// typo in the command name or a removed guard is actually
// noticed here instead of only testing the facade (mocked in point 2).
describe('showServerManagerCommand quick-pick connect on a credential-less discovered profile', () => {
  const discovered: ServerProfile = {
    id: 'qp:disc:a1:SALES',
    name: 'SALES-QP',
    serverUrl: 'https://h:2',
    username: '',
    rejectUnauthorized: false,
    authType: 'Basic',
    parentAdminId: 'a1',
    discoveredName: 'SALES-QP',
    discoveredUrl: 'https://h:2',
  };

  let ctx: vscode.ExtensionContext;

  beforeEach(() => {
    ctx = fakeContext();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(vscode.commands.executeCommand).mockClear();
    vi.mocked(vscode.window.showQuickPick).mockReset();
  });

  it('routes through tm1.server.editById instead of firing a doomed connect request', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({ action: 'toggle', profile: discovered } as never);

    await showServerManagerCommand(ctx);

    expect(apiRequest).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('tm1.server.editById', discovered.id);
  });

  it('connects normally once a username is present — does NOT route through tm1.server.editById', async () => {
    const withUser: ServerProfile = { ...discovered, id: 'qp:disc:a1:SALES-user', username: 'admin' };
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({ action: 'toggle', profile: withUser } as never);

    await showServerManagerCommand(ctx);

    expect(apiRequest).toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('tm1.server.editById', expect.anything());
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

import { initServerManager } from '../../serverState/state';
import {
  listAdminServers, getAdminServer, saveAdminServer, removeAdminServer,
  hideDiscovered, unhideDiscovered, newAdminServerId, KEY_ADMIN_SERVERS,
  type AdminServerProfile,
} from '../../serverState/adminServers';

function fakeContext() {
  const store = new Map<string, unknown>();
  return {
    globalState: {
      get: (k: string, dflt?: unknown) => (store.has(k) ? store.get(k) : dflt),
      update: async (k: string, v: unknown) => { store.set(k, v); },
    },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    _store: store,
  } as unknown as import('vscode').ExtensionContext & { _store: Map<string, unknown> };
}

const base = (id: string): AdminServerProfile => ({
  id, name: `Admin ${id}`, serverUrl: 'http://host:5895', rejectUnauthorized: false, hidden: [],
});

let ctx: ReturnType<typeof fakeContext>;

beforeEach(() => {
  ctx = fakeContext();
  initServerManager(ctx);
});

describe('admin server store', () => {
  it('starts empty', () => {
    expect(listAdminServers()).toEqual([]);
  });

  it('saves and reads an entry back', async () => {
    await saveAdminServer(base('a1'));
    expect(listAdminServers()).toHaveLength(1);
    expect(getAdminServer('a1')?.name).toBe('Admin a1');
  });

  it('replaces an entry with the same id instead of adding a second', async () => {
    await saveAdminServer(base('a1'));
    await saveAdminServer({ ...base('a1'), name: 'Neu' });
    expect(listAdminServers()).toHaveLength(1);
    expect(getAdminServer('a1')?.name).toBe('Neu');
  });

  it('removes an entry', async () => {
    await saveAdminServer(base('a1'));
    await removeAdminServer('a1');
    expect(listAdminServers()).toEqual([]);
  });

  it('keeps admin servers OUT of the regular server list', async () => {
    // The whole design depends on this: `getAllServers()` must never return an
    // entry that cannot be connected to.
    await saveAdminServer(base('a1'));
    expect(ctx._store.get('tm1.servers')).toBeUndefined();
    expect(ctx._store.get(KEY_ADMIN_SERVERS)).toHaveLength(1);
  });

  it('adds a hidden instance name once', async () => {
    await saveAdminServer(base('a1'));
    await hideDiscovered('a1', 'SALES');
    await hideDiscovered('a1', 'SALES');
    expect(getAdminServer('a1')?.hidden).toEqual(['SALES']);
  });

  it('ignores hiding for an unknown admin server', async () => {
    await expect(hideDiscovered('nope', 'SALES')).resolves.toBeUndefined();
  });

  it('unhides a hidden instance name', async () => {
    await saveAdminServer(base('a1'));
    await hideDiscovered('a1', 'SALES');
    await hideDiscovered('a1', 'MUC');
    await unhideDiscovered('a1', 'SALES');
    expect(getAdminServer('a1')?.hidden).toEqual(['MUC']);
  });

  it('is a no-op when the name is not hidden', async () => {
    await saveAdminServer(base('a1'));
    await hideDiscovered('a1', 'SALES');
    await unhideDiscovered('a1', 'NOPE');
    expect(getAdminServer('a1')?.hidden).toEqual(['SALES']);
  });

  it('ignores unhiding for an unknown admin server', async () => {
    await expect(unhideDiscovered('nope', 'SALES')).resolves.toBeUndefined();
  });

  it('hands out distinct ids even when called in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newAdminServerId()));
    expect(ids.size).toBe(50);
  });
});

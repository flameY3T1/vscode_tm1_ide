import { describe, it, expect } from 'vitest';
import * as sm from '../commands/serverManager';

function makeCtx(servers: any[]) {
  const store = new Map<string, unknown>();
  store.set('tm1.servers', servers);
  return {
    _store: store,
    globalState: {
      get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
      update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
    },
  } as any;
}

const base = (id: string) => ({ id, name: id, serverUrl: 'http://' + id, username: 'u', rejectUnauthorized: true, authType: 'basic' });

describe('migrateGlobalGitSettings', () => {
  it('copies global values into every profile without git, sets flag', async () => {
    const ctx = makeCtx([base('s1'), base('s2')]);
    sm.initServerManager(ctx);
    await sm.migrateGlobalGitSettings({ enabled: true, repoPath: '/g', parallelFetch: 6 });
    expect(sm.getGitProfile('s1')).toEqual({ enabled: true, repoPath: '/g', parallelFetch: 6 });
    expect(sm.getGitProfile('s2')).toEqual({ enabled: true, repoPath: '/g', parallelFetch: 6 });
    expect(ctx._store.get('tm1.git.migrated')).toBe(true);
  });

  it('does not overwrite a profile that already has git', async () => {
    const s1 = { ...base('s1'), git: { enabled: false, repoPath: '/own', parallelFetch: 2 } };
    const ctx = makeCtx([s1]);
    sm.initServerManager(ctx);
    await sm.migrateGlobalGitSettings({ enabled: true, repoPath: '/g', parallelFetch: 6 });
    expect(sm.getGitProfile('s1')).toEqual({ enabled: false, repoPath: '/own', parallelFetch: 2 });
  });

  it('second run is a no-op (flag set)', async () => {
    const ctx = makeCtx([base('s1')]);
    sm.initServerManager(ctx);
    await sm.migrateGlobalGitSettings({ enabled: true, repoPath: '/g', parallelFetch: 6 });
    await sm.migrateGlobalGitSettings({ enabled: false, repoPath: '/other', parallelFetch: 1 });
    expect(sm.getGitProfile('s1')).toEqual({ enabled: true, repoPath: '/g', parallelFetch: 6 });
  });
});

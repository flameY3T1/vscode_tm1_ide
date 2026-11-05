import { describe, it, expect } from 'vitest';
import * as sm from '../commands/serverManager';

function makeCtx(initial: any[] = []) {
  const store = new Map<string, unknown>();
  store.set('tm1.servers', initial);
  return {
    globalState: {
      get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
      update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
    },
  } as any;
}

describe('serverManager git profile', () => {

  it('getGitProfile returns undefined when profile has no git field', () => {
    const ctx = makeCtx([{ id: 's1', name: 'A', serverUrl: 'http://a', username: 'u', rejectUnauthorized: true, authType: 'basic' }]);
    sm.initServerManager(ctx);
    expect(sm.getGitProfile('s1')).toBeUndefined();
  });

  it('updateServerGit persists git field round-trip', async () => {
    const ctx = makeCtx([{ id: 's1', name: 'A', serverUrl: 'http://a', username: 'u', rejectUnauthorized: true, authType: 'basic' }]);
    sm.initServerManager(ctx);
    await sm.updateServerGit('s1', { enabled: true, repoPath: '/r', parallelFetch: 4 });
    expect(sm.getGitProfile('s1')).toEqual({ enabled: true, repoPath: '/r', parallelFetch: 4 });
  });

  it('updateServerGit on unknown serverId is a no-op (no throw)', async () => {
    const ctx = makeCtx([]);
    sm.initServerManager(ctx);
    await expect(sm.updateServerGit('nope', { enabled: true, repoPath: '/r', parallelFetch: 4 })).resolves.toBeUndefined();
  });
});

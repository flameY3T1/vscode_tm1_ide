import { describe, it, expect, vi } from 'vitest';

// Two connected servers, each with a git folder; the second one nested in the
// first, so the deepest folder has to win. "a2" shares a's URL under another
// user and has git off — it must neither borrow a's folder nor be mirrored.
const configs: Record<string, { serverUrl: string; username: string }> = {
  a: { serverUrl: 'https://a', username: 'u' },
  b: { serverUrl: 'https://b', username: 'u' },
  a2: { serverUrl: 'https://a', username: 'other' },
  // Same URL AND same user as "a": only object identity tells them apart.
  a3: { serverUrl: 'https://a', username: 'u' },
};
const names: Record<string, string> = { a: 'A', b: 'B', a2: 'A2', a3: 'A3' };
const repos: Record<string, string> = { a: '/repo', b: '/repo/A' };

vi.mock('../serverState/state', () => ({
  getConnectedIds: () => ['a', 'b', 'a2', 'a3'],
  getServerConfig: (id: string) => configs[id],
}));
vi.mock('../serverState/profiles', () => ({
  getServerProfile: (id: string) => ({
    id, name: names[id],
    git: { enabled: id !== 'a2' && id !== 'a3', repoPath: repos[id] ?? '/repo', parallelFetch: 1 },
  }),
}));
vi.mock('../tm1Client', () => ({ getConfig: () => ({ serverUrl: 'https://active' }) }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { resolveDir, serverConfigForFile, serverConfigForFileStrict, serverConfigForUri } from '../providers/serverConfigForFile';

describe('serverConfigForFile', () => {
  it('picks the server whose git folder holds the file, deepest folder first', () => {
    expect(serverConfigForFile('/repo/A/processes/x.pro').serverUrl).toBe('https://a');
    expect(serverConfigForFile('/repo/A/B/processes/x.pro').serverUrl).toBe('https://b');
  });

  it('matches Windows paths case-insensitively', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    repos.a = 'C:\\Repo';
    try {
      expect(serverConfigForFile('c:\\repo\\a\\x.pro').serverUrl).toBe('https://a');
    } finally {
      repos.a = '/repo';
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('keeps case apart on Linux', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    repos.a = '/Repo';
    try {
      expect(serverConfigForFile('/repo/a/x.pro').serverUrl).toBe('https://active');
      expect(serverConfigForFile('/Repo/A/x.pro').serverUrl).toBe('https://a');
    } finally {
      repos.a = '/repo';
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('falls back to the active connection outside every git folder', () => {
    expect(serverConfigForFile('/elsewhere/x.pro').serverUrl).toBe('https://active');
    expect(serverConfigForFile('/repo/Ax/x.pro').serverUrl).toBe('https://active');
    expect(serverConfigForFile(undefined).serverUrl).toBe('https://active');
  });

  it('strict lookup never falls back to the active connection', () => {
    expect(serverConfigForFileStrict('/repo/A/B/processes/x.ti')?.serverUrl).toBe('https://b');
    expect(serverConfigForFileStrict('/repo/A/processes/x.ti')?.serverUrl).toBe('https://a');
    expect(serverConfigForFileStrict('/elsewhere/x.ti')).toBeUndefined();
  });

  it('resolves the git folder per profile, not per URL', () => {
    expect(resolveDir(configs.a as never)?.serverName).toBe('A');
    expect(resolveDir(configs.a2 as never)).toBeNull();
    expect(resolveDir(configs.a3 as never)).toBeNull();
    expect(resolveDir({ ...configs.a } as never)?.serverName).toBe('A');
  });

  // The server side of a git diff lies in no git folder: without its own
  // lookup it fell back to the active connection and linted against it.
  it('takes the server of a git diff from the URI', () => {
    const uri = (p: string, scheme = 'tm1-server') => ({ scheme, path: p, fsPath: p }) as never;
    expect(serverConfigForUri(uri('/b/processes/x.ti')).serverUrl).toBe('https://b');
    expect(serverConfigForUri(uri('/repo/A/processes/x.ti', 'file')).serverUrl).toBe('https://a');
    expect(serverConfigForUri(uri('/gone/processes/x.ti')).serverUrl).toBe('https://active');
  });
});

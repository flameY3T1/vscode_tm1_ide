import { describe, it, expect } from 'vitest';
import { resolveServerGitDir } from '../providers/serverConfigForFile';

describe('resolveServerGitDir', () => {
  it('uses the profile repoPath, expands ${workspaceFolder}, appends server subdir', () => {
    const dir = resolveServerGitDir(
      { enabled: true, repoPath: '${workspaceFolder}/tm1', parallelFetch: 8 },
      'MyServer',
      '/ws',
    );
    expect(dir).toBe('/ws/tm1/MyServer');
  });

  it('returns null when ${workspaceFolder} used but no workspace', () => {
    const dir = resolveServerGitDir(
      { enabled: true, repoPath: '${workspaceFolder}/tm1', parallelFetch: 8 },
      'MyServer',
      '',
    );
    expect(dir).toBeNull();
  });

  it('supports an absolute repoPath without workspace', () => {
    const dir = resolveServerGitDir(
      { enabled: true, repoPath: '/abs/repo', parallelFetch: 8 },
      'Srv',
      '',
    );
    expect(dir).toBe('/abs/repo/Srv');
  });

  it('omits the server subfolder when includeServerFolder is false', () => {
    const dir = resolveServerGitDir(
      { enabled: true, repoPath: '${workspaceFolder}/tm1', parallelFetch: 8, includeServerFolder: false },
      'MyServer',
      '/ws',
    );
    expect(dir).toBe('/ws/tm1');
  });

  it('appends the server subfolder when includeServerFolder is explicitly true', () => {
    const dir = resolveServerGitDir(
      { enabled: true, repoPath: '/abs/repo', parallelFetch: 8, includeServerFolder: true },
      'Srv',
      '',
    );
    expect(dir).toBe('/abs/repo/Srv');
  });
});

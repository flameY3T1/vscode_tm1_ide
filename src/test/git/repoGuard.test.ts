import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { isInsideGitWorkTree } from '../../git/repoGuard';

describe('isInsideGitWorkTree', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'repoguard-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('true when a .git directory exists at the start dir', async () => {
    await mkdir(path.join(root, '.git'));
    expect(await isInsideGitWorkTree(root)).toBe(true);
  });

  it('true when a .git lives in an ancestor (nested mirror dir)', async () => {
    await mkdir(path.join(root, '.git'));
    const nested = path.join(root, 'ServerA', 'processes');
    await mkdir(nested, { recursive: true });
    expect(await isInsideGitWorkTree(nested)).toBe(true);
  });

  it('true when .git is a file (worktree/submodule)', async () => {
    await writeFile(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x');
    expect(await isInsideGitWorkTree(root)).toBe(true);
  });

  it('false for a plain (non-git) folder', async (ctx) => {
    // The walk up must reach the fs root without a .git; a TMPDIR inside a repo makes that impossible.
    if (await isInsideGitWorkTree(tmpdir())) { ctx.skip(); }
    const plain = path.join(root, 'plain');
    await mkdir(plain);
    // tmpdir is not inside a git repo → walk up hits fs root and returns false
    expect(await isInsideGitWorkTree(plain)).toBe(false);
  });
});

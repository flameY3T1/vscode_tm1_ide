import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

// Only the root resolution is a mock. The file system is NOT: a
// `node:fs` mock whose `stat` resolves instead of throwing leaks into other
// tests when the file order is mixed (`isInsideGitWorkTree` then takes
// every directory for a repository). Real files in a dedicated
// temp directory also check what really happens — and the symlink
// can only be reproduced honestly this way.
let ROOT = '';
vi.mock('../../views/tiTestTreeProvider', () => ({ resolveRootFolder: () => process.env.__TM1_TEST_ROOT__ }));

import * as vscode from 'vscode';
import { deleteTestOrFolder } from '../../commands/tiTest/actions';
import type { CommandDeps } from '../../commands/tiTest/types';

function deps(): CommandDeps {
  return {
    lastRun: { delete: vi.fn() },
    treeProvider: { clearLastRun: vi.fn(), refresh: vi.fn(async () => undefined) },
  } as unknown as CommandDeps;
}
function item(fullPath: string) {
  return { node: { fullPath, kind: 'folder' }, label: path.basename(fullPath) } as never;
}
const exists = async (p: string) => !!(await stat(p).catch(() => null));

/**
 * `deleteTestOrFolder` deletes recursively with `force`. `tm1.tests.rootFolder`
 * carries no `scope`, is therefore window-wide and can come from the
 * `.vscode/settings.json` of a foreign workspace; an absolute
 * value is taken over unchanged, a relative one may contain `..`, and a
 * symlink in the tree can point outside. The confirmation dialog, on the other hand, is no
 * protection — it only shows the path it is going to delete anyway.
 */
describe('deleteTestOrFolder — only inside the test directory', () => {
  let sandbox: string;
  let outside: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'titest-del-'));
    ROOT = path.join(sandbox, 'tm1tests');
    outside = path.join(sandbox, 'private');
    process.env.__TM1_TEST_ROOT__ = ROOT;
    await mkdir(path.join(ROOT, 'suite'), { recursive: true });
    await mkdir(outside, { recursive: true });
    vi.mocked(vscode.window.showWarningMessage).mockReset().mockResolvedValue('Delete' as never);
    vi.mocked(vscode.window.showErrorMessage).mockReset();
  });
  afterEach(async () => {
    delete process.env.__TM1_TEST_ROOT__;
    await rm(sandbox, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('deletes a folder inside the test root', async () => {
    await deleteTestOrFolder(deps(), item(path.join(ROOT, 'suite')));
    expect(await exists(path.join(ROOT, 'suite'))).toBe(false);
  });

  // Neither delete NOR ask: asking for confirmation of something we
  // reject anyway only invites the user to click it away.
  it('refuses a path outside the root without even asking', async () => {
    await deleteTestOrFolder(deps(), item(outside));
    expect(await exists(outside)).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('refuses an escape through ..', async () => {
    await deleteTestOrFolder(deps(), item(path.join(ROOT, '..', 'private')));
    expect(await exists(outside)).toBe(true);
  });

  // The reason why `realpath` runs before the check: the path LOOKS
  // contained, but the target lies outside.
  it('refuses a symlink that points out of the tree', async () => {
    await symlink(outside, path.join(ROOT, 'linked'), 'dir');
    await deleteTestOrFolder(deps(), item(path.join(ROOT, 'linked')));
    expect(await exists(outside)).toBe(true);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('refuses the test root itself', async () => {
    await deleteTestOrFolder(deps(), item(ROOT));
    expect(await exists(ROOT)).toBe(true);
  });
});

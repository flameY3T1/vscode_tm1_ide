import { stat } from 'fs/promises';
import * as path from 'path';

/**
 * True if `startDir` or any of its ancestors contains a `.git` entry, i.e. the
 * directory lives inside a real git working tree. `.git` may be a directory
 * (normal repo) or a file (worktree/submodule) — presence is enough.
 *
 * Read by "Pull All" before it overwrites local mirror files: without git
 * history there is no safety net for uncommitted local changes. The answer
 * shapes the confirmation dialog (extra detail line, "Pull anyway" button) —
 * it does NOT veto the pull. A mirror outside a repository is a legitimate
 * setup, only an unprotected one, and refusing it left no way forward.
 */
export async function isInsideGitWorkTree(startDir: string): Promise<boolean> {
  let dir = path.resolve(startDir);
  for (;;) {
    try {
      await stat(path.join(dir, '.git'));
      return true;
    } catch {
      /* no .git here — keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) { return false; }
    dir = parent;
  }
}

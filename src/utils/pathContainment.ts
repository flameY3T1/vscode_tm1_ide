import * as path from 'node:path';

/**
 * Is `target` TRULY below `root`?
 *
 * Both paths must already be absolute and resolved (`fs.realpath`) — the
 * function does not touch the file system and therefore cannot detect a symlink
 * itself. Resolving belongs at the call site, immediately before
 * the dangerous operation; a path that is swapped between check and operation
 * is otherwise not covered.
 *
 * Equality does NOT count as contained: a caller that wants to delete children
 * must not delete the root itself along with them.
 *
 * Windows compares paths without regard to upper and lower case; on that
 * platform the comparison is therefore additionally done in lower case. Without it
 * the check would reject `C:\\Tm1Tests\\x` under `c:\\tm1tests`, although it is
 * the same place.
 */
export function isContainedIn(root: string, target: string): boolean {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(root), norm(target));
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

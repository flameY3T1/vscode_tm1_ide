import * as path from 'node:path';
import { readManifest } from '../../tiTestFramework/storage/manifestIo';

/**
 * Detect whether `folder` is a sub-test (real on-disk manifest or virtual
 * folder declared in its parent root manifest.subs[]). Returns parent +
 * sub-name when it is, otherwise null.
 */
export async function detectSubMode(folder: string): Promise<
  | { parentFolder: string; subName: string }
  | null
> {
  // Real on-disk sub manifest
  try {
    const m = await readManifest(folder);
    if ('kind' in m && m.kind === 'ti-test-sub') {
      return {
        parentFolder: path.dirname(path.dirname(folder)),
        subName: (m as { name: string }).name,
      };
    }
    return null;
  } catch {
    /* No manifest — try virtual sub detection */
  }
  const parent = path.dirname(path.dirname(folder));
  const subName = path.basename(folder);
  if (path.basename(path.dirname(folder)) !== 'subs') return null;
  try {
    const pm = await readManifest(parent);
    if ('kind' in pm && pm.kind === 'ti-test') {
      const declared = (pm as { subs?: string[] }).subs ?? [];
      if (declared.includes(subName)) {
        return { parentFolder: parent, subName };
      }
    }
  } catch {
    /* parent missing too — not a sub */
  }
  return null;
}

export function emptyDiffSummary() {
  return {
    pass: false,
    totalDiffs: 0,
    cellDiffs: 0,
    dimDiffs: 0,
    attrDiffs: 0,
    subsetDiffs: 0,
    viewDiffs: 0,
    cubeDiffs: 0,
    tranDiffs: 0,
    metaDiffs: 0,
    statusDiff: false,
  };
}

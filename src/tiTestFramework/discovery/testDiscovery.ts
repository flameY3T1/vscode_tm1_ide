/**
 * Recursively discover test-folders under a root by walking the directory
 * tree and treating any folder containing `manifest.json` as a test case.
 * Skips dotfile directories and noise so the discovery stays cheap on a
 * typical repo. Folders that fail manifest validation are surfaced as
 * warnings (not thrown) so a single broken test can't break the TreeView.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { readManifest, type Manifest, MANIFEST_FILENAME } from '../storage/manifestIo';

export type TestEntry = {
  folder: string;
  relativePath: string;
  manifest: Manifest;
};

export type DiscoveryWarning = {
  folder: string;
  message: string;
};

export type DiscoveryResult = {
  entries: TestEntry[];
  /** Relative paths of container folders that exist on disk but have no test descendants. */
  emptyFolders: string[];
  warnings: DiscoveryWarning[];
};

const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'out',
  'dist',
  'build',
  '.next',
  '.turbo',
]);

function relForward(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join('/');
}

async function isManifestFolder(folder: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(folder, MANIFEST_FILENAME));
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function discoverTests(root: string): Promise<DiscoveryResult> {
  const entries: TestEntry[] = [];
  const warnings: DiscoveryWarning[] = [];
  const emptyFolders: string[] = [];

  try {
    await fs.access(root);
  } catch {
    return { entries, emptyFolders, warnings };
  }

  async function walk(dir: string): Promise<boolean> {
    if (await isManifestFolder(dir)) {
      try {
        const manifest = await readManifest(dir);
        entries.push({
          folder: dir,
          relativePath: relForward(root, dir),
          manifest,
        });
      } catch (e) {
        warnings.push({ folder: dir, message: (e as Error).message });
      }
      return true;
    }

    let dirents: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[] = [];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      warnings.push({ folder: dir, message: `readdir failed: ${(e as Error).message}` });
      return false;
    }

    let hasTestDescendant = false;
    for (const e of dirents) {
      if (!e.isDirectory()) continue;
      if (e.isSymbolicLink()) continue;
      if (e.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const found = await walk(path.join(dir, e.name));
      if (found) hasTestDescendant = true;
    }

    if (!hasTestDescendant && dir !== root) {
      emptyFolders.push(relForward(root, dir));
    }
    return hasTestDescendant;
  }

  await walk(root);

  entries.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0,
  );
  emptyFolders.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  warnings.sort((a, b) => (a.folder < b.folder ? -1 : 1));

  return { entries, emptyFolders, warnings };
}

export type TreeNode = {
  kind: 'folder' | 'test' | 'sub';
  label: string;
  fullPath: string;
  relativePath: string;
  children: TreeNode[];
  manifest?: Manifest;
};

export function buildTreeFromDiscovery(
  root: string,
  entries: TestEntry[],
  emptyFolders: string[] = [],
): TreeNode {
  const rootNode: TreeNode = {
    kind: 'folder',
    label: path.basename(root) || root,
    fullPath: root,
    relativePath: '',
    children: [],
  };

  function ensureFolderPath(segments: string[]): TreeNode {
    let current = rootNode;
    let acc = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      acc = acc ? `${acc}/${seg}` : seg;
      let next = current.children.find((c) => c.kind === 'folder' && c.label === seg);
      if (!next) {
        next = {
          kind: 'folder',
          label: seg,
          fullPath: path.join(root, ...segments.slice(0, i + 1)),
          relativePath: acc,
          children: [],
        };
        current.children.push(next);
      }
      current = next;
    }
    return current;
  }

  for (const e of entries) {
    const segments = e.relativePath.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    const parent = ensureFolderPath(segments.slice(0, -1));
    const leafSeg = segments[segments.length - 1];
    parent.children.push({
      kind: 'test',
      label: leafSeg,
      fullPath: e.folder,
      relativePath: e.relativePath,
      children: [],
      manifest: e.manifest,
    });
  }

  for (const rel of emptyFolders) {
    const segments = rel.split('/').filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    ensureFolderPath(segments);
  }

  function sortChildren(node: TreeNode): void {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });
    for (const c of node.children) sortChildren(c);
  }
  sortChildren(rootNode);

  return rootNode;
}

export function collectTests(node: TreeNode): TestEntry[] {
  const out: TestEntry[] = [];
  function walk(n: TreeNode): void {
    if ((n.kind === 'test' || n.kind === 'sub') && n.manifest) {
      out.push({
        folder: n.fullPath,
        relativePath: n.relativePath,
        manifest: n.manifest,
      });
      // Still descend into children so nested subs are collected too.
      for (const c of n.children) walk(c);
      return;
    }
    for (const c of n.children) walk(c);
  }
  walk(node);
  return out;
}

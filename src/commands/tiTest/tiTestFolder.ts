/**
 * TI-Test-Folder management: validation, listing, creation, capture-time picker.
 * Folders mirror on-disk layout under `tm1.tests.rootFolder`. A "folder" here
 * is any directory under root that does NOT contain a `manifest.json` (i.e.
 * is a container, not a test leaf).
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';

const FOLDER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-.]{0,127}$/;

export function validateFolderName(raw: string, siblings: string[] = []): string | undefined {
  const name = (raw ?? '').trim();
  if (!name) return 'Name must not be empty.';
  if (name === '.' || name === '..') return 'Invalid name.';
  if (name.length > 128) return 'Name is too long (max. 128 characters).';
  if (/[\\/]/.test(name)) return 'Slash/backslash not allowed — create subfolders separately.';
  if (!FOLDER_NAME_RE.test(name)) {
    return 'Name may only contain letters, digits, spaces, dot, underscore or hyphen.';
  }
  const lower = name.toLowerCase();
  if (siblings.some((s) => s.toLowerCase() === lower)) {
    return `Folder "${name}" already exists.`;
  }
  return undefined;
}

async function isManifestFolder(absPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(absPath, 'manifest.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks rootFolder and returns relative paths of all sub-directories that are
 * NOT test leaves (i.e. don't contain manifest.json). Empty string represents
 * the root itself. Sorted alphabetically. Stops descending into a directory
 * once a manifest.json is found there.
 */
export async function listExistingTiTestFolders(rootFolder: string): Promise<string[]> {
  const out: string[] = [''];
  async function walk(absDir: string, rel: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const sub = path.join(absDir, e.name);
      const subRel = rel ? `${rel}/${e.name}` : e.name;
      if (await isManifestFolder(sub)) continue;
      out.push(subRel);
      await walk(sub, subRel);
    }
  }
  try {
    await fs.access(rootFolder);
  } catch {
    return out;
  }
  await walk(rootFolder, '');
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function listSiblings(parentAbs: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(parentAbs, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function createTiTestFolder(opts: {
  rootFolder: string;
  parentRel: string;
  name: string;
}): Promise<string> {
  const cleanName = opts.name.trim();
  const parentAbs = opts.parentRel
    ? path.join(opts.rootFolder, opts.parentRel)
    : opts.rootFolder;
  const target = path.join(parentAbs, cleanName);
  await fs.mkdir(target, { recursive: true });
  return target;
}

/**
 * UI command: prompt for folder name, create dir, refresh tree.
 * `parentItem` may be a TiTestTreeItem of kind=folder (subfolder) or undefined (root).
 */
export async function createFolderCommand(
  parentItem: { node?: { kind?: string; relativePath?: string; fullPath?: string } } | undefined,
  rootFolder: string | undefined,
  refreshTree: () => void,
): Promise<string | undefined> {
  if (!rootFolder) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('TM1: Open a workspace folder before creating TI test folders (tm1.tests.rootFolder).'),
    );
    return undefined;
  }
  const parentRel = parentItem?.node?.kind === 'folder'
    ? (parentItem.node.relativePath ?? '')
    : '';
  const parentAbs = parentRel ? path.join(rootFolder, parentRel) : rootFolder;
  await fs.mkdir(parentAbs, { recursive: true });
  const siblings = await listSiblings(parentAbs);

  const name = await vscode.window.showInputBox({
    title: parentRel ? vscode.l10n.t('New folder under {0}', parentRel) : vscode.l10n.t('New test folder (root)'),
    prompt: vscode.l10n.t('Folder name'),
    placeHolder: 'SmokeTests',
    ignoreFocusOut: true,
    validateInput: (v) => validateFolderName(v, siblings),
  });
  if (!name) return undefined;

  const target = await createTiTestFolder({ rootFolder, parentRel, name: name.trim() });
  refreshTree();
  vscode.window.showInformationMessage(vscode.l10n.t('TM1: Test folder "{0}" created.', path.relative(rootFolder, target)));
  return target;
}

/**
 * QuickPick used during capture: lists existing test folders + first item
 * "$(plus) Neuer Ordner…" which triggers an inline create. Returns the
 * absolute path of the picked (or newly-created) folder.
 */
export async function pickFolderForCapture(
  rootFolder: string,
  refreshTree: () => void,
): Promise<string | undefined> {
  const folders = await listExistingTiTestFolders(rootFolder);

  type Item = vscode.QuickPickItem & { _kind: 'new' | 'folder'; _rel?: string };
  const items: Item[] = [
    { label: vscode.l10n.t('$(plus) New folder…'), description: vscode.l10n.t('Create new test folder'), _kind: 'new' },
    ...folders.map<Item>((rel) => ({
      label: rel === '' ? '/ (Root)' : rel,
      _kind: 'folder',
      _rel: rel,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Select test folder'),
    placeHolder: vscode.l10n.t('Select an existing folder or create a new one'),
    ignoreFocusOut: true,
  });
  if (!pick) return undefined;
  if (pick._kind === 'new') {
    return await createFolderCommand(undefined, rootFolder, refreshTree);
  }
  return pick._rel ? path.join(rootFolder, pick._rel) : rootFolder;
}

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { collect, confirmDelete, runDelete } from './tree/deleteViewsSubsets';
import { getDocumentContent, createFolder, createLink, deleteApplication, uploadDocument, createReference, moveApplication, listApplications, type RefType } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { encodeODataKey } from '../utils/odataKey';
import { errMsg } from '../utils/errMsg';
import { sanitizeFilename } from '../git/sanitize';

/** Minimal extension → MIME map (no extra deps); default binary octet-stream. */
const MIME_BY_EXT: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
};

function mimeForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

// An `@odata.bind` value is a RESOURCE PATH (URI reference), not an OData literal:
// each key segment needs quote-doubling AND percent-encoding, otherwise a name
// containing `/` splits the path and `#`/`?`/space break the reference. Same
// grammar as `applicationsApi.ts#appFolderRef`, which encodes per segment.
/** OData key escape (quote-double + percent-encode) for one @odata.bind segment. */
function esc(s: string): string { return encodeODataKey(s); }

/** The @odata.bind path plus the raw leaf name (used as the default entry name). */
interface BindInfo { bind: string; name: string }

/** Prompt the object name(s) needed to build the @odata.bind for a reference type. */
async function promptBind(refType: RefType): Promise<BindInfo | undefined> {
  const ask = (prompt: string) => vscode.window.showInputBox({ prompt, ignoreFocusOut: true });
  switch (refType) {
    case 'Cube': {
      const c = await ask(vscode.l10n.t('Cube name'));
      return c ? { bind: `Cubes('${esc(c)}')`, name: c } : undefined;
    }
    case 'View': {
      const c = await ask(vscode.l10n.t('Cube name'));
      if (!c) { return undefined; }
      const v = await ask(vscode.l10n.t('View name'));
      return v ? { bind: `Cubes('${esc(c)}')/Views('${esc(v)}')`, name: v } : undefined;
    }
    case 'Dimension': {
      const d = await ask(vscode.l10n.t('Dimension name'));
      return d ? { bind: `Dimensions('${esc(d)}')`, name: d } : undefined;
    }
    case 'Subset': {
      const d = await ask(vscode.l10n.t('Dimension name'));
      if (!d) { return undefined; }
      const h = await ask(vscode.l10n.t('Hierarchy name'));
      if (!h) { return undefined; }
      const s = await ask(vscode.l10n.t('Subset name'));
      return s ? { bind: `Dimensions('${esc(d)}')/Hierarchies('${esc(h)}')/Subsets('${esc(s)}')`, name: s } : undefined;
    }
    case 'Process': {
      const p = await ask(vscode.l10n.t('Process name'));
      return p ? { bind: `Processes('${esc(p)}')`, name: p } : undefined;
    }
    case 'Chore': {
      const c = await ask(vscode.l10n.t('Chore name'));
      return c ? { bind: `Chores('${esc(c)}')`, name: c } : undefined;
    }
    default:
      return undefined;
  }
}

interface AppCmdDeps {
  getConfig: (serverId?: string) => Tm1Config | undefined;
  refreshNode: (node: Tm1TreeNode) => void;
  /** Full-tree refresh (used after delete — application nodes carry no parentNode). */
  refresh?: () => void;
}

/** Ask whether a new entry should be public or private. */
async function pickScope(): Promise<'public' | 'private'> {
  const pub = vscode.l10n.t('Public');
  const priv = vscode.l10n.t('Private');
  const pick = await vscode.window.showQuickPick([pub, priv], { title: vscode.l10n.t('Visibility') });
  return pick === priv ? 'private' : 'public';
}

interface DocInfo {
  serverId: string;
  appPath: string[];
  appId: string;
  name: string;
  isPrivate: boolean;
}

function docMeta(node: Tm1TreeNode | undefined): DocInfo | null {
  const m = node?.meta;
  if (!m || !m.appId) { return null; }
  return {
    serverId: m.serverId as string,
    appPath: (m.appPath ?? []) as string[],
    appId: m.appId as string,
    name: (m.name ?? node?.label ?? m.appId) as string,
    isPrivate: !!m.isPrivate,
  };
}

/** Resolve the container folder path + entry key for any application node. */
function entryLocation(node: Tm1TreeNode): { parentPath: string[]; id: string; isFolder: boolean } {
  const m = node.meta ?? {};
  const appPath = (m.appPath ?? []) as string[];
  const isFolder = node.nodeType === 'applicationFolder';
  return isFolder
    ? { parentPath: appPath.slice(0, -1), id: appPath[appPath.length - 1], isFolder }
    : { parentPath: appPath, id: m.appId as string, isFolder };
}

/** Walk the whole Applications tree, collecting folder paths of the given visibility. */
async function collectFolders(cfg: Tm1Config, isPrivate: boolean, path: string[], acc: string[][]): Promise<string[][]> {
  const entries = await listApplications(path, cfg);
  for (const e of entries) {
    if (e.type === 'folder' && e.isPrivate === isPrivate) {
      const fp = [...path, e.name];
      acc.push(fp);
      await collectFolders(cfg, isPrivate, fp, acc);
    }
  }
  return acc;
}

/** true if `candidate` equals or is nested under `ancestor` (used to block moving a folder into itself). */
function isSelfOrDescendant(candidate: string[], ancestor: string[]): boolean {
  if (candidate.length < ancestor.length) { return false; }
  return ancestor.every((seg, i) => candidate[i] === seg);
}

const pathEq = (a: string[], b: string[]): boolean => a.length === b.length && a.every((s, i) => s === b[i]);

/** Extensions handed straight to the OS. The name (and so the extension) comes from the server,
 *  so anything else (`.hta`, `.bat`, `.lnk`, …) would run with the user's rights on one click. */
const OPENABLE_EXT = new Set(['.xlsx', '.xlsm', '.xlsb', '.xls', '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.csv', '.txt']);

/** Opens a downloaded application document: known office/text types via the OS from a private
 *  temp dir, everything else only through a save dialog. */
export async function openAppDocument(name: string, buf: Buffer): Promise<void> {
  const file = sanitizeFilename(name);
  if (!OPENABLE_EXT.has(path.extname(file).toLowerCase())) {
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(file),
      title: vscode.l10n.t('"{0}" is not a known document type and will not be opened. Save as…', name),
    });
    if (!target) { return; }
    await fs.writeFile(target.fsPath, buf);
    vscode.window.showInformationMessage(vscode.l10n.t('Saved to {0}.', target.fsPath));
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm1-app-'));
  const tmp = path.join(dir, file);
  await fs.writeFile(tmp, buf, { mode: 0o600 });
  await vscode.env.openExternal(vscode.Uri.file(tmp));
}

export function registerApplicationCommands(ctx: vscode.ExtensionContext, deps: AppCmdDeps): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('tm1.app.openDocument', async (node: Tm1TreeNode) => {
      const info = docMeta(node);
      if (!info) { return; }
      const cfg = deps.getConfig(info.serverId);
      if (!cfg) { return; }
      try {
        const buf = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Opening "{0}"…', info.name) },
          () => getDocumentContent(info.appPath, info.appId, info.isPrivate, cfg),
        );
        await openAppDocument(info.name, buf);
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.downloadDocument', async (node: Tm1TreeNode) => {
      const info = docMeta(node);
      if (!info) { return; }
      const cfg = deps.getConfig(info.serverId);
      if (!cfg) { return; }
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(info.name),
        title: vscode.l10n.t('Save "{0}" as…', info.name),
      });
      if (!target) { return; }
      try {
        const buf = await getDocumentContent(info.appPath, info.appId, info.isPrivate, cfg);
        await fs.writeFile(target.fsPath, buf);
        vscode.window.showInformationMessage(vscode.l10n.t('Saved to {0}.', target.fsPath));
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.openLink', async (node: Tm1TreeNode) => {
      const url = node?.meta?.url as string | undefined;
      if (!url) { return; }
      if (!/^https?:\/\//i.test(url)) {
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: refusing to open non-web link: {0}', url));
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand('tm1.app.createFolder', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string;
      const parentPath = (node?.meta?.appPath ?? []) as string[];
      const cfg = deps.getConfig(serverId);
      if (!cfg) { return; }
      const name = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('New folder name') });
      if (!name) { return; }
      const isPrivate = (await pickScope()) === 'private';
      try {
        await createFolder(parentPath, name, isPrivate, cfg);
        deps.refreshNode(node);
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.createLink', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string;
      const parentPath = (node?.meta?.appPath ?? []) as string[];
      const cfg = deps.getConfig(serverId);
      if (!cfg) { return; }
      const name = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('Link name') });
      if (!name) { return; }
      const url = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: 'URL', value: 'https://' });
      if (!url) { return; }
      const isPrivate = (await pickScope()) === 'private';
      try {
        await createLink(parentPath, name, url, isPrivate, cfg);
        deps.refreshNode(node);
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.uploadDocument', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string;
      const parentPath = (node?.meta?.appPath ?? []) as string[];
      const cfg = deps.getConfig(serverId);
      if (!cfg) { return; }
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        title: vscode.l10n.t('Select a document to upload'),
        openLabel: vscode.l10n.t('Upload'),
      });
      if (!picked || picked.length === 0) { return; }
      const fsPath = picked[0].fsPath;
      const name = path.basename(fsPath);
      const isPrivate = (await pickScope()) === 'private';
      try {
        const buf = await fs.readFile(fsPath);
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Uploading "{0}"…', name) },
          () => uploadDocument(parentPath, name, buf, mimeForFile(name), isPrivate, cfg),
        );
        deps.refreshNode(node);
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.createReference', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string;
      const parentPath = (node?.meta?.appPath ?? []) as string[];
      const cfg = deps.getConfig(serverId);
      if (!cfg) { return; }
      const refType = (await vscode.window.showQuickPick(
        ['Cube', 'View', 'Dimension', 'Subset', 'Process', 'Chore'],
        { title: vscode.l10n.t('Reference type') },
      )) as RefType | undefined;
      if (!refType) { return; }
      const picked = await promptBind(refType);
      if (!picked) { return; }
      // `Name` is a plain property value — the RAW leaf name, never the encoded bind.
      const name = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('Reference name'), value: picked.name });
      if (!name) { return; }
      const isPrivate = (await pickScope()) === 'private';
      try {
        await createReference(parentPath, name, refType, picked.bind, isPrivate, cfg);
        deps.refreshNode(node);
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.rename', async (node: Tm1TreeNode) => {
      const m = node?.meta;
      if (!m) { return; }
      const cfg = deps.getConfig(m.serverId as string);
      if (!cfg) { return; }
      const { parentPath, id } = entryLocation(node);
      const current = (m.name ?? id) as string;
      const name = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('New name'),
        value: current,
        ignoreFocusOut: true,
      });
      if (!name || name === current) { return; }
      try {
        await moveApplication(parentPath, id, !!m.isPrivate, { name }, cfg);
        if (deps.refresh) { deps.refresh(); } else { deps.refreshNode(node); }
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.move', async (node: Tm1TreeNode) => {
      const m = node?.meta;
      if (!m) { return; }
      const cfg = deps.getConfig(m.serverId as string);
      if (!cfg) { return; }
      const { parentPath, id, isFolder } = entryLocation(node);
      const isPrivate = !!m.isPrivate;
      const selfPath = isFolder ? ((m.appPath ?? []) as string[]) : null;
      let folders: string[][];
      try {
        folders = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Loading folders…') },
          () => collectFolders(cfg, isPrivate, [], []),
        );
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
        return;
      }
      const targets = folders.filter((f) =>
        !pathEq(f, parentPath) &&                          // skip the current parent (no-op move)
        !(selfPath && isSelfOrDescendant(f, selfPath)),    // a folder can't move into itself/descendant
      );
      const items: { label: string; description?: string; path: string[] }[] = [];
      if (parentPath.length > 0) {
        items.push({ label: `$(home) ${vscode.l10n.t('Applications (root)')}`, path: [] });
      }
      for (const f of targets) {
        items.push({ label: `$(folder) ${f[f.length - 1]}`, description: '/' + f.join('/'), path: f });
      }
      if (items.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No other folder to move to.'));
        return;
      }
      const pick = await vscode.window.showQuickPick(items, {
        title: vscode.l10n.t('Move "{0}" to…', (m.name ?? id) as string),
        matchOnDescription: true,
      });
      if (!pick) { return; }
      try {
        await moveApplication(parentPath, id, isPrivate, { targetFolderPath: pick.path }, cfg);
        if (deps.refresh) { deps.refresh(); } else { deps.refreshNode(node); }
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.app.togglePrivate', async (node: Tm1TreeNode) => {
      const m = node?.meta;
      if (!m) { return; }
      const cfg = deps.getConfig(m.serverId as string);
      if (!cfg) { return; }
      const { parentPath, id } = entryLocation(node);
      const isPrivate = !!m.isPrivate;
      try {
        await moveApplication(parentPath, id, isPrivate, { makePrivate: !isPrivate }, cfg);
        vscode.window.showInformationMessage(
          isPrivate
            ? vscode.l10n.t('"{0}" is now public.', (m.name ?? id) as string)
            : vscode.l10n.t('"{0}" is now private.', (m.name ?? id) as string),
        );
        if (deps.refresh) { deps.refresh(); } else { deps.refreshNode(node); }
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
      }
    }),

    // One works like many: the Explorer passes the whole selection as the second argument.
    vscode.commands.registerCommand('tm1.app.delete',
      async (node: Tm1TreeNode, selection?: Tm1TreeNode[]) => {
        const nodes = collect(node, selection).filter(n => !!n?.meta);
        if (nodes.length === 0) { return; }
        const items = nodes.map(n => ({
          node: n,
          name: String(n.meta.name ?? entryLocation(n).id),
        }));
        const ok = await confirmDelete(
          items.map(i => i.name),
          vscode.l10n.t('Delete "{0}"?', items[0].name),
        );
        if (!ok) { return; }
        await runDelete(items, async (n, cfg) => {
          const loc = entryLocation(n);
          await deleteApplication(loc.parentPath, loc.id, !!n.meta.isPrivate, cfg);
        }, () => {
          // Application nodes carry no `parentNode` — refresh the whole tree
          // so that the entry disappears from its container.
          if (deps.refresh) { deps.refresh(); } else { deps.refreshNode(nodes[0]); }
        }, vscode.l10n.t('entries'));
      }),
  );
}

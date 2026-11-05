import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { downloadFile, uploadFile, replaceFile, deleteFile } from '../tm1Rest/filesApi';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { errMsg } from '../utils/errMsg';
import { collect, confirmDelete, runDelete } from './tree/deleteViewsSubsets';

interface FileCmdDeps {
  getConfig: (serverId?: string) => Tm1Config | undefined;
  refreshNode: (node: Tm1TreeNode) => void;
}

function fileNode(node: Tm1TreeNode | undefined): { fileName: string; serverId: string; folder: string[] } | null {
  if (!node?.meta?.fileName) { return null; }
  return { fileName: node.meta.fileName as string, serverId: node.meta.serverId as string, folder: node.meta.folderPath ?? [] };
}

export function registerFileCommands(ctx: vscode.ExtensionContext, deps: FileCmdDeps): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('tm1.uploadFile', async (root: Tm1TreeNode) => {
      const serverId = root?.meta?.serverId as string | undefined;
      if (!serverId) { vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server context.')); return; }
      const cfg = deps.getConfig(serverId);
      if (!cfg) { return; }
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: false,
        title: vscode.l10n.t('Select file to upload'),
      });
      if (!picks || picks.length === 0) { return; }
      const localPath = picks[0].fsPath;
      const targetName = path.basename(localPath);
      try {
        const content = await fs.readFile(localPath);
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('TM1: Uploading file "{0}"…', targetName) },
          () => uploadFile(targetName, content, cfg, root.meta.folderPath ?? []),
        );
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: File "{0}" uploaded.', targetName));
        deps.refreshNode(root);
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 upload failed: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.downloadFile', async (node: Tm1TreeNode) => {
      const info = fileNode(node);
      if (!info) { return; }
      const cfg = deps.getConfig(info.serverId);
      if (!cfg) { return; }
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(info.fileName),
        title: vscode.l10n.t('Save file "{0}" as…', info.fileName),
      });
      if (!target) { return; }
      try {
        const buf = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('TM1: Downloading file "{0}"…', info.fileName) },
          () => downloadFile(info.fileName, cfg, info.folder),
        );
        await fs.writeFile(target.fsPath, buf);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: File "{0}" saved to {1}.', info.fileName, target.fsPath));
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 download failed: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.replaceFile', async (node: Tm1TreeNode) => {
      const info = fileNode(node);
      if (!info) { return; }
      const cfg = deps.getConfig(info.serverId);
      if (!cfg) { return; }
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: false,
        title: vscode.l10n.t('Select new content for "{0}"', info.fileName),
      });
      if (!picks || picks.length === 0) { return; }
      try {
        const content = await fs.readFile(picks[0].fsPath);
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('TM1: Replacing file "{0}"…', info.fileName) },
          () => replaceFile(info.fileName, content, cfg, info.folder),
        );
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: File "{0}" replaced.', info.fileName));
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 replace failed: {0}', errMsg(err)));
      }
    }),

    // One like many: the explorer passes the whole selection as the second argument.
    vscode.commands.registerCommand('tm1.deleteFile',
      async (node: Tm1TreeNode, selection?: Tm1TreeNode[]) => {
        const nodes = collect(node, selection).filter(n => n?.meta?.fileName);
        if (nodes.length === 0) { return; }
        const items = nodes.map(n => ({ node: n, name: n.meta.fileName as string }));
        const ok = await confirmDelete(
          items.map(i => i.name),
          vscode.l10n.t('Delete file "{0}" on the TM1 server?', items[0].name),
        );
        if (!ok) { return; }
        // All marked files hang under the same node; refreshing once is
        // enough, and `runDelete` only passes the server id in.
        const parent = nodes[0].meta?.parentNode as Tm1TreeNode | undefined;
        await runDelete(items, async (n, cfg) => {
          await deleteFile(n.meta.fileName as string, cfg, n.meta.folderPath ?? []);
        }, () => { if (parent) { deps.refreshNode(parent); } }, vscode.l10n.t('files'), {
          success: name => vscode.l10n.t('TM1: File "{0}" deleted.', name),
          failure: reason => vscode.l10n.t('TM1 delete failed: {0}', reason),
        });
      }),
  );
}

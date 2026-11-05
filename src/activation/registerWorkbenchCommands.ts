import * as vscode from 'vscode';
import { getServerConfig } from '../serverState/state';
import { openWorkbenchPicker } from '../commands/workbench/saveFlow';
import { restoreWorkbench } from '../commands/workbench/restoreFlow';
import type { WorkbenchStore } from '../commands/workbench/workbenchStore';
import type { Tm1TreeNode } from '../providers/tm1TreeNodes';
import type { ActivationContext } from './context';

export function registerWorkbenchCommands(ctx: ActivationContext, store: WorkbenchStore): void {
  const { context, resolveServerName } = ctx;

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.workbench.save', (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId;
      if (!serverId) { return; }
      // `serverId` here is the profile ID (`tm1TreeDataProvider.ts`'s
      // `serverRoot` node meta), not the URL the managers register their
      // panels under — see the comment in `collectWindows.ts#collectCandidates`.
      // Resolve the config first so the picker gets the URL too, and so a
      // disconnected server never silently opens an empty picker instead of
      // telling the user why. No self-connect — same rule the restore command
      // already follows.
      const cfg = getServerConfig(serverId);
      if (!cfg) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t('TM1: server "{0}" is not connected.', resolveServerName(serverId) ?? serverId),
        );
        return;
      }
      // `void` as in the edit branch below: `openWorkbenchPicker` can throw
      // (uninitialized picker window), and an unbound promise would turn
      // that into an unhandled rejection instead of a message.
      void openWorkbenchPicker(serverId, resolveServerName(serverId) ?? serverId, store, cfg.serverUrl);
    }),

    // Edit: the same window, but with the existing state as the preset.
    // The node carries the `workbenchId`, not the `serverId` — that comes from
    // the workbench itself, so that an entry does not end up on the wrong server.
    vscode.commands.registerCommand('tm1.workbench.edit', (node: Tm1TreeNode) => {
      const wb = store.get(node?.meta?.workbenchId);
      if (!wb) { return; }
      const cfg = getServerConfig(wb.serverId);
      // No self-initiated connection — the same rule as for
      // saving and restoring. Without a connection the state
      // of the open windows could not be queried anyway.
      if (!cfg) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t('TM1: server "{0}" is not connected.', resolveServerName(wb.serverId) ?? wb.serverId),
        );
        return;
      }
      void openWorkbenchPicker(
        wb.serverId, resolveServerName(wb.serverId) ?? wb.serverId, store, cfg.serverUrl,
        { id: wb.id, name: wb.name },
      );
    }),

    vscode.commands.registerCommand('tm1.workbench.restore', async (node: Tm1TreeNode) => {
      const wb = store.get(node?.meta?.workbenchId);
      if (!wb) { return; }
      const cfg = getServerConfig(wb.serverId);
      // No self-initiated connection — project rule. A restore
      // that triggers a login on the side would be overreach.
      if (!cfg) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t('TM1: server "{0}" is not connected.', resolveServerName(wb.serverId) ?? wb.serverId),
        );
        return;
      }
      await restoreWorkbench(wb, cfg, {
        serverId: wb.serverId,
        serverLabel: resolveServerName(wb.serverId) ?? wb.serverId,
        extensionContext: context,
        refreshTree: () => ctx.treeDataProvider.refresh(),
      });
    }),

    vscode.commands.registerCommand('tm1.workbench.rename', async (node: Tm1TreeNode) => {
      const wb = store.get(node?.meta?.workbenchId);
      if (!wb) { return; }
      const name = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('Workbench name'), value: wb.name });
      if (!name) { return; }
      await store.rename(wb.id, name);
    }),

    vscode.commands.registerCommand('tm1.workbench.delete', async (node: Tm1TreeNode) => {
      const wb = store.get(node?.meta?.workbenchId);
      if (!wb) { return; }
      const del = vscode.l10n.t('Delete');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete workbench "{0}"?', wb.name), { modal: true }, del,
      );
      if (answer !== del) { return; }
      await store.remove(wb.id);
    }),
  );
}

import * as vscode from 'vscode';
import {
  executeChore as executeChoreApi,
  setChoreActive,
} from '../tm1Rest/choreApi';
import { getServerConfig, requireServerConfig } from '../commands/serverManager';
import { runCancellableExecution } from '../runState/runCancellableProcess';
import { manageChoresCommand } from '../commands/chore/chores';
import { ChoreEditorManager } from '../commands/chore/choreEditor';
import { ChoreOverviewManager } from '../commands/chore/choreOverview';
import { deleteChoresCommand } from '../commands/tree/deleteViewsSubsets';
import { deployNodeToServerCommand } from '../commands/deploy/deployNodeToServer';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { wrap } from './wrap';
import { errMsg } from '../utils/errMsg';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import type { ActivationContext } from './context';

/**
 * Registers chore commands:
 *   manageChores / executeChoreFromTree / activateChore / deactivateChore
 *   createChore / editChore / deleteChore
 */
export function registerChoreCommands(ctx: ActivationContext): void {
  const { context, treeDataProvider } = ctx;

  const overviewManager = new ChoreOverviewManager(
    (name, cfg) => { if (!cfg) { return; } void ChoreEditorManager.open(name, cfg, () => treeDataProvider.refresh()); },
    context.extensionUri,
  );
  // Close the Chore Overview panel when its server disconnects (like every other webview manager).
  registerServerDisposer('choreOverview', (url) => overviewManager.disposePanelsForServer(url));

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.manageChores', wrap('Chores', () => manageChoresCommand())),
    // Applies to chores AND rules: the same command, the same write path as on
    // the bulk page. Registered here because the chore is the more frequent case;
    // the rule hangs on the cube rule node via `when`.
    vscode.commands.registerCommand('tm1.deployToServer',
      wrap(vscode.l10n.t('Deploy to server'), (node?: Tm1TreeNode) => deployNodeToServerCommand(node))),
    vscode.commands.registerCommand('tm1.executeChoreFromTree', (node: Tm1TreeNode) => {
      const name = node?.meta?.choreName as string;
      if (!name) { return; }
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      void (async () => {
        try {
          const { cancelled } = await runCancellableExecution(
            vscode.l10n.t('TM1: Running Chore "{0}"…', name), 'Chores', name, cfg,
            () => executeChoreApi(cfg, name),
          );
          vscode.window.showInformationMessage(
            cancelled
              ? vscode.l10n.t('TM1: Chore "{0}" was cancelled.', name)
              : vscode.l10n.t('TM1: Chore "{0}" was started.', name),
          );
        } catch (err) {
          vscode.window.showErrorMessage(vscode.l10n.t('TM1 Chore error: {0}', errMsg(err)));
        }
      })();
    }),
    vscode.commands.registerCommand('tm1.activateChore', async (node: Tm1TreeNode) => {
      const name = node?.meta?.choreName as string;
      if (!name) { return; }
      const cfg = requireServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      try {
        await setChoreActive(cfg, name, true);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Chore "{0}" is now active.', name));
        treeDataProvider.refreshCategory(node?.meta?.serverId as string | undefined, 'Chores');
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 Chore error: {0}', errMsg(err)));
      }
    }),
    vscode.commands.registerCommand('tm1.deactivateChore', async (node: Tm1TreeNode) => {
      const name = node?.meta?.choreName as string;
      if (!name) { return; }
      const cfg = requireServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      try {
        await setChoreActive(cfg, name, false);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Chore "{0}" is now inactive.', name));
        treeDataProvider.refreshCategory(node?.meta?.serverId as string | undefined, 'Chores');
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 Chore error: {0}', errMsg(err)));
      }
    }),
    vscode.commands.registerCommand('tm1.createChore', (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      void ChoreEditorManager.open(null, cfg, () => treeDataProvider.refreshCategory(serverId, 'Chores'));
    }),
    vscode.commands.registerCommand('tm1.editChore', (node: Tm1TreeNode) => {
      const name = node?.meta?.choreName as string;
      if (!name) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      void ChoreEditorManager.open(name, cfg, () => treeDataProvider.refreshCategory(serverId, 'Chores'));
    }),
    vscode.commands.registerCommand('tm1.choreOverview', (node: Tm1TreeNode) => {
      const cfg = getServerConfig(node?.meta?.serverId);
      void overviewManager.open(cfg);
    }),
    vscode.commands.registerCommand('tm1.deleteChore', (node: Tm1TreeNode | undefined, selection: Tm1TreeNode[] | undefined) =>
      deleteChoresCommand(node, selection, serverId => treeDataProvider.refreshCategory(serverId, 'Chores'))),
    { dispose: () => ChoreEditorManager.disposeAll() },
    { dispose: () => overviewManager.disposeAll() },
  );
}

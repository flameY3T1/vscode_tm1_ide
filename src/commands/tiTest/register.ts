import * as vscode from 'vscode';
import type { TiTestTreeItem } from '../../views/tiTestTreeProvider';
import { captureProcess } from './capture';
import {
  deleteTestOrFolder,
  refreshFixtures,
  replaceTiFromServer,
  showDiff,
  toggleActive,
} from './actions';
import type { CommandDeps } from './types';
import { errMsg } from '../../utils/errMsg';
import { logBestEffort } from '../../providers/bestEffortLog';

export function registerTiTestCommands(deps: CommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      'tm1.tiTest.captureProcess',
      async (arg?: unknown) => {
        // arg may be: a string (palette / programmatic), a Tm1TreeNode (right-click on Process tree),
        // or undefined. Tm1TreeNode carries `meta.processName` + `meta.serverId`.
        let name: string | undefined;
        let nodeServerId: string | undefined;
        if (typeof arg === 'string') {
          name = arg;
        } else if (arg && typeof arg === 'object') {
          const meta = (arg as { meta?: { processName?: unknown; serverId?: unknown } }).meta;
          if (typeof meta?.processName === 'string') name = meta.processName;
          if (typeof meta?.serverId === 'string') nodeServerId = meta.serverId;
        }
        if (!name) {
          name = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            title: vscode.l10n.t('TI process name to capture'),
            prompt: vscode.l10n.t('Must exist on the connected server'),
          });
        }
        if (!name) return;
        try {
          await captureProcess(deps, name, nodeServerId);
        } catch (err) {
          // e.g. safeChildPath rejecting an unsafe process/sub-process name —
          // surface it instead of letting it die silently at the command boundary.
          vscode.window.showErrorMessage(
            vscode.l10n.t('TI test capture failed: {0}', errMsg(err)),
          );
        } finally {
          // Partial captures may have written files; keep the tree in sync.
          deps.treeProvider.refresh().catch(e => logBestEffort('TiTest', 'refresh tests tree', e));
        }
      },
    ),
    vscode.commands.registerCommand(
      'tm1.tiTest.showLastDiff',
      (folderArg?: string | TiTestTreeItem) => {
        const folder =
          typeof folderArg === 'string'
            ? folderArg
            : folderArg?.node?.kind === 'test'
              ? folderArg.node.fullPath
              : undefined;
        if (folder) showDiff(deps, folder);
      },
    ),
    vscode.commands.registerCommand('tm1.tiTest.toggleActive', (item?: TiTestTreeItem) =>
      toggleActive(deps, item),
    ),
    vscode.commands.registerCommand('tm1.tiTest.delete', (item?: TiTestTreeItem) =>
      deleteTestOrFolder(deps, item),
    ),
    vscode.commands.registerCommand('tm1.tiTest.refresh', () => deps.treeProvider.refresh()),
    vscode.commands.registerCommand('tm1.tiTest.replaceTiFromServer', (item?: TiTestTreeItem) =>
      replaceTiFromServer(deps, item),
    ),
    vscode.commands.registerCommand('tm1.tiTest.refreshFixtures', (item?: TiTestTreeItem) =>
      refreshFixtures(deps, item),
    ),
  ];
}

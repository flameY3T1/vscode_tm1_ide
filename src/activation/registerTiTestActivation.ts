import * as vscode from 'vscode';
import {
  TiTestTreeProvider, resolveRootFolder as resolveTiTestRoot, type TiTestTreeItem,
} from '../views/tiTestTreeProvider';
import { createFolderCommand as createTiTestFolderCommand } from '../commands/tiTest/tiTestFolder';
import { TiTestDiffWebviewManager } from '../webviews/tiTestDiffWebview';
import { TiTestSummaryWebviewManager } from '../webviews/tiTestSummaryWebview';
import { LastRunCache } from '../commands/tiTest/types';
import { registerTiTestCommands } from '../commands/tiTest/register';
import { registerTiSimulateCommands } from '../commands/tiTest/simulateRegister';
import { getActiveServerName, getAllServers, getServerConfig } from '../commands/serverManager';

/**
 * Activates the TI-Test framework:
 *   - tree view (tm1.tiTests) + diff/summary webview managers + last-run cache
 *   - registers tiTestCommands + tiSimulateCommands + tiTest.createFolder
 *   - watches **\/manifest.json in the workspace to keep the tree fresh
 */
export function registerTiTestActivation(context: vscode.ExtensionContext): void {
  const tiTestTreeProvider = new TiTestTreeProvider(() => resolveTiTestRoot());
  const tiTestDiffView = new TiTestDiffWebviewManager(context.extensionUri);
  const tiTestSummaryView = new TiTestSummaryWebviewManager(context.extensionUri);
  const tiTestLastRun = new LastRunCache();

  context.subscriptions.push(
    vscode.window.createTreeView('tm1.tiTests', { treeDataProvider: tiTestTreeProvider }),
  );

  const getActiveConfigForTests = () => {
    const activeName = getActiveServerName(context);
    if (!activeName) return undefined;
    const profile = getAllServers(context).find((s) => s.name === activeName);
    if (!profile) return undefined;
    const cfg = getServerConfig(profile.id);
    if (!cfg) return undefined;
    return { cfg, serverName: activeName };
  };

  const getConfigByServerIdForTests = (serverId: string) => {
    const cfg = getServerConfig(serverId);
    if (!cfg) return undefined;
    const profile = getAllServers(context).find((s) => s.id === serverId);
    return { cfg, serverName: profile?.name ?? serverId };
  };

  const tiTestExtVersion =
    (context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0.0.0';

  context.subscriptions.push(
    ...registerTiTestCommands({
      context,
      treeProvider: tiTestTreeProvider,
      diffView: tiTestDiffView,
      summaryView: tiTestSummaryView,
      lastRun: tiTestLastRun,
      getActiveConfig: getActiveConfigForTests,
      getConfigByServerId: getConfigByServerIdForTests,
      extensionVersion: tiTestExtVersion,
    }),
    ...registerTiSimulateCommands({
      treeProvider: tiTestTreeProvider,
      diffView: tiTestDiffView,
      summaryView: tiTestSummaryView,
      lastRun: tiTestLastRun,
      floatTolerance: () =>
        vscode.workspace.getConfiguration('tm1.tests').get<number>('floatTolerance', 1e-9),
      maxDiffRows: () =>
        vscode.workspace.getConfiguration('tm1.tests').get<number>('maxDiffRows', 2000),
    }),
    vscode.commands.registerCommand('tm1.tiTest.createFolder', (item?: TiTestTreeItem) =>
      createTiTestFolderCommand(item, resolveTiTestRoot(), () => { void tiTestTreeProvider.refresh(); }),
    ),
  );

  const wsFolder = vscode.workspace.workspaceFolders?.[0];
  if (wsFolder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(wsFolder, '**/manifest.json'),
    );
    watcher.onDidCreate(() => tiTestTreeProvider.refresh());
    watcher.onDidChange(() => tiTestTreeProvider.refresh());
    watcher.onDidDelete(() => tiTestTreeProvider.refresh());
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push({ dispose: () => tiTestDiffView.dispose() });
  context.subscriptions.push({ dispose: () => tiTestSummaryView.dispose() });
}

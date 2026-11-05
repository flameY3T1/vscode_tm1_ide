import * as vscode from 'vscode';
import type { TiTestTreeItem } from '../../views/tiTestTreeProvider';
import { showFolderSummary, simulateFolder, simulateTest } from './simulateBatch';
import type { SimulateDeps } from './simulateTypes';

export function registerTiSimulateCommands(deps: SimulateDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('tm1.tiTest.simulate', async (item?: TiTestTreeItem) => {
      if (!item || (item.node.kind !== 'test' && item.node.kind !== 'sub')) {
        vscode.window.showInformationMessage(vscode.l10n.t('Right-click a test in the TI Tests sidebar.'));
        return;
      }
      await simulateTest(deps, item.node.fullPath);
    }),
    vscode.commands.registerCommand('tm1.tiTest.simulateFolder', (item?: TiTestTreeItem) =>
      simulateFolder(deps, item),
    ),
    vscode.commands.registerCommand('tm1.tiTest.simulateAll', () => simulateFolder(deps, undefined)),
    vscode.commands.registerCommand('tm1.tiTest.showFolderSummary', (item?: TiTestTreeItem) =>
      showFolderSummary(deps, item),
    ),
  ];
}

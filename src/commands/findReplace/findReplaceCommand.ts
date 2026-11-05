import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl, serverIdForCommand } from '../serverManager';
import { FindReplacePanel } from '../../webviews/findReplaceWebview';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

export function registerFindReplaceCommand(context: vscode.ExtensionContext): void {
  FindReplacePanel.initialize(context.extensionUri);
  registerServerDisposer('findReplace', (url) => FindReplacePanel.disposePanelsForServer(url));
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.findReplaceObjects', async (node?: { meta?: { serverId?: string } }) => {
      const serverId = await serverIdForCommand(node);
      if (!serverId) { return; }
      const cfg = getServerConfig(serverId);
      if (!cfg) {
        vscode.window.showErrorMessage(vscode.l10n.t('No server selected'));
        return;
      }
      const displayName = getServerNameByUrl(cfg.serverUrl) ?? serverId;
      FindReplacePanel.open(cfg, serverId, displayName);
    }),
  );
}

import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { ValueNamingPanel } from '../../webviews/tiValueNamingWebview';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

export function registerValueNamingCommand(context: vscode.ExtensionContext): void {
  ValueNamingPanel.initialize(context.extensionUri);
  registerServerDisposer('valueNaming', (url) => ValueNamingPanel.disposePanelsForServer(url));
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.openValueNaming', (node?: { meta?: { serverId?: string } }) => {
      const serverId = node?.meta?.serverId;
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!cfg) {
        vscode.window.showErrorMessage(vscode.l10n.t('No server selected'));
        return;
      }
      const displayName = getServerNameByUrl(cfg.serverUrl) ?? serverId;
      ValueNamingPanel.open(cfg, serverId, displayName);
    }),
  );
}

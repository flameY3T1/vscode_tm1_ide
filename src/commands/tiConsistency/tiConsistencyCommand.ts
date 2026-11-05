import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { ConsistencyPanel } from '../../webviews/tiConsistencyWebview';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

export function registerConsistencyCommand(context: vscode.ExtensionContext): void {
  ConsistencyPanel.initialize(context.extensionUri);
  registerServerDisposer('tiConsistency', (url) => ConsistencyPanel.disposePanelsForServer(url));
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.openConsistencyNormalizer', (node?: { meta?: { serverId?: string } }) => {
      const serverId = node?.meta?.serverId;
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!cfg) {
        vscode.window.showErrorMessage(vscode.l10n.t('No server selected'));
        return;
      }
      const displayName = getServerNameByUrl(cfg.serverUrl) ?? serverId;
      ConsistencyPanel.open(cfg, serverId, displayName);
    }),
  );
}

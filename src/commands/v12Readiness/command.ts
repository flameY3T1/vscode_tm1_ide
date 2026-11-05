import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { analyse } from '../../v12Readiness/analysisPure';
import { scanSource } from './scan';
import { buildReportL10n } from './reportL10n';
import { ReadinessPanel } from './panel';

export function registerV12ReadinessCommand(context: vscode.ExtensionContext): void {
  ReadinessPanel.initialize(context.extensionUri);
  registerServerDisposer('v12Readiness', (url) => ReadinessPanel.disposePanelsForServer(url));
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.v12ReadinessCheck', async (node?: { meta?: { serverId?: string } }) => {
      const serverId = node?.meta?.serverId;
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!serverId || !cfg) {
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: No server selected.'));
        return;
      }
      if (cfg.version === 'v12') {
        vscode.window.showInformationMessage(vscode.l10n.t('The v12 readiness check reads a TM1 11 database. This server already runs TM1 12.'));
        return;
      }
      const displayName = getServerNameByUrl(cfg.serverUrl) ?? serverId;
      const scan = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('v12 Readiness Check: {0}', displayName), cancellable: true },
        (progress, token) => scanSource(cfg, displayName, token, progress),
      );
      ReadinessPanel.show({ cfg, serverId, scan, analysis: analyse(scan), l10n: buildReportL10n() }, displayName);
    }),
  );
}

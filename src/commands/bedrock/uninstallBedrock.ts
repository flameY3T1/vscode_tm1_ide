import * as vscode from 'vscode';
import { getServerConfig } from '../../serverState/state';
import { fetchNamesOrThrow } from '../../providers/fetchNames';
import { deleteProcess } from '../../tm1Rest/processApi';
import { setBedrockInstalled } from '../../bedrock/bedrockStateCache';
import { errMsg } from '../../utils/errMsg';

export async function uninstallBedrock(node?: { meta?: { serverId?: string } }): Promise<void> {
  const serverId = node?.meta?.serverId;
  if (!serverId) { vscode.window.showErrorMessage(vscode.l10n.t('Run this from a server context menu.')); return; }
  const cfg = getServerConfig(serverId);
  if (!cfg) { vscode.window.showErrorMessage(vscode.l10n.t('Server configuration not found.')); return; }

  let all: string[];
  try {
    all = await fetchNamesOrThrow('Processes', cfg);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not load process list: {0}', errMsg(err)));
    return;
  }
  const bedrock = all.filter(n => /^}?bedrock\./i.test(n));
  if (bedrock.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t('No Bedrock processes found.'));
    return;
  }
  const _deleteAllLabel = vscode.l10n.t('Delete all');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete {0} Bedrock processes? This cannot be undone.', bedrock.length),
    { modal: true }, _deleteAllLabel,
  );
  if (choice !== _deleteAllLabel) { return; }

  try { await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Uninstall Bedrock'), cancellable: false },
    async progress => {
      let done = 0;
      let succeeded = 0;
      let firstError: string | undefined;
      for (const name of bedrock) {
        try { await deleteProcess(cfg, name); succeeded++; }
        // Skip — process may have dependencies; the first reason is reported below.
        catch (err) { firstError ??= `${name}: ${errMsg(err)}`; }
        done++;
        progress.report({ message: `${done}/${bedrock.length}: ${name}`, increment: 100 / bedrock.length });
      }
      const summary = vscode.l10n.t('Bedrock uninstalled ({0}/{1}).', succeeded, bedrock.length);
      if (firstError === undefined) {
        setBedrockInstalled(serverId, false);
        vscode.window.showInformationMessage(summary);
      } else {
        // Processes are left behind: Bedrock still counts as installed.
        vscode.window.showWarningMessage(`${summary} ${firstError}`);
      }
      await vscode.commands.executeCommand('tm1.refreshExplorer');
    },
  ); } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Bedrock uninstallation failed: {0}', errMsg(err)));
  }
}

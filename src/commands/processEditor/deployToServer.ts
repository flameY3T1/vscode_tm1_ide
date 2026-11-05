import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { apiRequest, deployProcess } from '../../tm1Client';
import { odbcPasswordNotCopiedText, readProcessForCopy, type ProcessCopy } from '../deploy/copyOne';

import { getServerConfig } from '../../serverState/state';
import { pickTargetServer } from '../deploy/pickTarget';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { encodeODataKey } from '../../utils/odataKey';

export async function deployProcessToServerCommand(node?: Tm1TreeNode): Promise<void> {
  const sourceServerId = node?.meta?.serverId;
  const processName = node?.meta?.processName as string | undefined;
  if (!processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('No process selected.'));
    return;
  }
  if (!sourceServerId) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not determine source server for process.'));
    return;
  }
  const sourceCfg = getServerConfig(sourceServerId);
  if (!sourceCfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Source server is not connected.'));
    return;
  }

  const picked = await pickTargetServer(sourceServerId, vscode.l10n.t('Deploy process "{0}" to which server?', processName));
  if (!picked) { return; }
  const targetCfg = picked.cfg;

  const newName = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: vscode.l10n.t('Process name on "{0}"', picked.label),
    prompt: vscode.l10n.t('Name of the process on the target server'),
    value: processName,
    validateInput: v => v.trim() ? null : vscode.l10n.t('Name must not be empty.'),
  });
  if (newName === undefined) { return; }
  const targetName = newName.trim();

  // Reading and mapping lives in `deploy/copyOne.ts` — the same place the bulk
  // migration also reads from. It names every field individually, because
  // `$select=*` truncates the DataSource, and merges `VariablesUIData` with
  // `Variables`.
  let source: ProcessCopy;
  try {
    source = await readProcessForCopy(sourceCfg, processName);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Loading source process failed: {0}', errMsg(err)));
    return;
  }

  try {
    const checkRes = await apiRequest(
      'GET',
      `Processes('${encodeODataKey(targetName)}')?$select=Name`,
      undefined,
      undefined,
      targetCfg,
    );
    if (checkRes.statusCode === 200) {
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Process "{0}" already exists on "{1}". Overwrite?', targetName, picked.label),
        { modal: true },
        vscode.l10n.t('Overwrite'),
      );
      if (choice !== vscode.l10n.t('Overwrite')) { return; }
    }
  } catch { /* ignore — deployProcess will surface real connection errors */ }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Deploying "{0}" → "{1}" to {2}…', processName, targetName, picked.label),
      cancellable: false,
    },
    async () => {
      // `undefined` for the security flag: this command never sent it along,
      // and toggling it does not belong inside a merge.
      await deployProcess(targetName, source.sections, source.dataSource, source.parameters,
        source.variables, targetCfg, undefined, source.uiData);
    },
  );

  vscode.window.showInformationMessage(
    vscode.l10n.t('TM1: "{0}" deployed as "{1}" to "{2}".', processName, targetName, picked.label),
  );
  if (source.odbcPasswordDropped) { vscode.window.showWarningMessage(odbcPasswordNotCopiedText(targetName)); }

  await vscode.commands.executeCommand('tm1.refreshExplorer');
}

export async function deployMultipleProcessesToServerCommand(
  node?: Tm1TreeNode,
  selection?: Tm1TreeNode[],
): Promise<void> {
  const all: Tm1TreeNode[] = (selection && selection.length > 0)
    ? selection
    : (node ? [node] : []);
  const processNodes = all.filter(n => n?.nodeType === 'process' && n?.meta?.processName);
  if (processNodes.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('No processes selected.'));
    return;
  }

  const sourceServerIds = Array.from(new Set(processNodes.map(n => n.meta?.serverId).filter(Boolean)));
  if (sourceServerIds.length !== 1) {
    vscode.window.showErrorMessage(vscode.l10n.t('All selected processes must come from the same source server.'));
    return;
  }
  const sourceServerId = sourceServerIds[0] as string;
  const sourceCfg = getServerConfig(sourceServerId);
  if (!sourceCfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Source server is not connected.'));
    return;
  }

  const picked = await pickTargetServer(
    sourceServerId,
    vscode.l10n.t('Deploy {0} processes to which server?', String(processNodes.length)),
    vscode.l10n.t('Select target server (all conflicts will be overwritten)'),
  );
  if (!picked) { return; }
  const targetCfg = picked.cfg;

  const failures: { name: string; reason: string }[] = [];
  const passwordDropped: string[] = [];
  let succeeded = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Deploying {0} processes → {1}…', String(processNodes.length), picked.label),
      cancellable: true,
    },
    async (progress, token) => {
      const total = processNodes.length;
      for (let i = 0; i < total; i++) {
        // Between processes only: a write already sent runs to completion on TM1.
        if (token.isCancellationRequested) { break; }
        const n = processNodes[i];
        const processName = n.meta!.processName as string;
        progress.report({
          message: `${processName} (${i + 1}/${total})`,
          increment: 100 / total,
        });

        try {
          const source = await readProcessForCopy(sourceCfg, processName);
          await deployProcess(processName, source.sections, source.dataSource, source.parameters,
            source.variables, targetCfg, undefined, source.uiData);
          if (source.odbcPasswordDropped) { passwordDropped.push(processName); }
          succeeded++;
        } catch (err) {
          failures.push({ name: processName, reason: errMsg(err) });
        }
      }
    },
  );

  if (failures.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('TM1: {0} processes deployed to "{1}".', String(succeeded), picked.label),
    );
  } else {
    const head = failures.slice(0, 3).map(f => `• ${f.name}: ${f.reason}`).join('\n');
    const rest = failures.length > 3 ? `\n… +${failures.length - 3} more` : '';
    vscode.window.showWarningMessage(
      vscode.l10n.t('TM1: {0}/{1} deployed. Errors:\n{2}', String(succeeded), String(processNodes.length), `${head}${rest}`),
      { modal: false },
    );
  }
  if (passwordDropped.length > 0) { vscode.window.showWarningMessage(odbcPasswordNotCopiedText(passwordDropped.join(', '))); }

  await vscode.commands.executeCommand('tm1.refreshExplorer');
}

import * as vscode from 'vscode';
import { getProcess } from '../../tm1Rest/processApi';
import { getServerConfig } from '../../serverState/state';
import type { ProcessTemplateStorage } from '../../processTemplates/processTemplateStorage';
import { processToTemplate } from '../../processTemplates/processTemplateBuilder';
import { errMsg } from '../../utils/errMsg';

export async function saveProcessAsTemplate(
  storage: ProcessTemplateStorage,
  onSaved: () => void,
  node?: { meta?: { serverId?: string; processName?: string } },
): Promise<void> {
  const serverId = node?.meta?.serverId;
  const processName = node?.meta?.processName;
  if (!serverId || !processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('Right-click a process in the tree to use this command.'));
    return;
  }
  const cfg = getServerConfig(serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server configuration not found.'));
    return;
  }
  let process: Record<string, any>;
  try {
    process = await getProcess(cfg, processName, {
      select: 'Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,Parameters,Variables,DataSource',
    });
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not load process: {0}', errMsg(err)));
    return;
  }
  const name = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: vscode.l10n.t('Template name'),
    value: processName,
    validateInput: v => (v && v.trim() ? undefined : vscode.l10n.t('Name is required')),
  });
  if (!name) { return; }
  const description = (await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('Description (optional)'), value: '' })) ?? '';
  const tpl = processToTemplate(process, { name: name.trim(), description });
  await storage.save(tpl);
  onSaved();
  vscode.window.showInformationMessage(vscode.l10n.t('Template "{0}" saved.', tpl.name));
}

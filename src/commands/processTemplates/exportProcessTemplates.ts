import * as vscode from 'vscode';
import { ProcessTemplateStorage } from '../../processTemplates/processTemplateStorage';
import { serializeBundle } from '../../processTemplates/processTemplateIo';

export async function exportProcessTemplates(storage: ProcessTemplateStorage): Promise<void> {
  const all = storage.getAll();
  if (all.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t('No templates available to export.'));
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('tm1-process-templates.json'),
    filters: { 'JSON': ['json'] },
    title: vscode.l10n.t('Export process templates'),
  });
  if (!uri) { return; }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeBundle(all), 'utf-8'));
  vscode.window.showInformationMessage(vscode.l10n.t('{0} template(s) exported to {1}', all.length, uri.fsPath));
}

import * as vscode from 'vscode';
import { ProcessTemplateStorage } from '../../processTemplates/processTemplateStorage';

export async function deleteProcessTemplate(
  storage: ProcessTemplateStorage,
  onChanged: () => void,
  node?: { meta?: { templateId?: string } },
): Promise<void> {
  let id = node?.meta?.templateId;
  if (!id) {
    type TemplatePickItem = vscode.QuickPickItem & { id: string };
    const pick = await vscode.window.showQuickPick(
      storage.getAll().map((t): TemplatePickItem => ({ label: t.name, description: t.description, id: t.id })),
      { placeHolder: vscode.l10n.t('Select template to delete') },
    );
    if (!pick) { return; }
    id = pick.id;
  }
  const tpl = storage.get(id!);
  if (!tpl) { return; }
  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t('Really delete template "{0}"?', tpl.name),
    { modal: true }, vscode.l10n.t('Delete'),
  );
  if (confirm !== vscode.l10n.t('Delete')) { return; }
  await storage.delete(id!);
  onChanged();
  vscode.window.showInformationMessage(vscode.l10n.t('Template "{0}" deleted.', tpl.name));
}

import * as vscode from 'vscode';
import { ProcessTemplateStorage } from '../processTemplates/processTemplateStorage';
import { ProcessTemplateEditorManager } from '../processTemplates/processTemplateEditor';
import { saveProcessAsTemplate } from '../commands/processTemplates/saveProcessAsTemplate';
import { deleteProcessTemplate } from '../commands/processTemplates/manageProcessTemplates';
import { exportProcessTemplates } from '../commands/processTemplates/exportProcessTemplates';
import { importProcessTemplates } from '../commands/processTemplates/importProcessTemplates';

export function registerProcessTemplateCommands(
  context: vscode.ExtensionContext,
  refresh: () => void,
  existingStorage?: ProcessTemplateStorage,
): ProcessTemplateStorage {
  const storage = existingStorage ?? new ProcessTemplateStorage(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.processTemplate.saveFromProcess', (node?: any) =>
      saveProcessAsTemplate(storage, refresh, node)),
    vscode.commands.registerCommand('tm1.processTemplate.edit', (node?: any) => {
      const id = node?.meta?.templateId;
      if (!id) { vscode.window.showErrorMessage(vscode.l10n.t('No template selected.')); return; }
      ProcessTemplateEditorManager.open(storage, id, refresh);
    }),
    vscode.commands.registerCommand('tm1.processTemplate.delete', (node?: any) =>
      deleteProcessTemplate(storage, refresh, node)),
    vscode.commands.registerCommand('tm1.processTemplate.export', () => exportProcessTemplates(storage)),
    vscode.commands.registerCommand('tm1.processTemplate.import', () => importProcessTemplates(storage, refresh)),
    vscode.commands.registerCommand('tm1.processTemplate.new', async () => {
      const name = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        prompt: vscode.l10n.t('New template name'),
        validateInput: v => v && v.trim() ? undefined : vscode.l10n.t('Name required'),
      });
      if (!name) { return; }
      const tpl = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: '',
        createdAt: new Date().toISOString(),
        source: {
          PrologProcedure: '', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
          Parameters: [], Variables: [], DataSource: { Type: 'None' },
        },
      };
      await storage.save(tpl);
      refresh();
      ProcessTemplateEditorManager.open(storage, tpl.id, refresh);
    }),
  );

  return storage;
}

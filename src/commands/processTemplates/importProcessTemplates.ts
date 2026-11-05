import * as vscode from 'vscode';
import { ProcessTemplateStorage } from '../../processTemplates/processTemplateStorage';
import { parseBundle } from '../../processTemplates/processTemplateIo';
import { errMsg } from '../../utils/errMsg';

export async function importProcessTemplates(
  storage: ProcessTemplateStorage,
  onImported: () => void,
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true, canSelectMany: false,
    filters: { 'JSON': ['json'] },
    title: vscode.l10n.t('Import process templates'),
  });
  if (!uris || uris.length === 0) { return; }
  let raw: Uint8Array;
  try { raw = await vscode.workspace.fs.readFile(uris[0]); }
  catch { vscode.window.showErrorMessage(vscode.l10n.t('File could not be read.')); return; }
  let imported: ReturnType<typeof parseBundle>;
  try { imported = parseBundle(Buffer.from(raw).toString('utf-8')); }
  catch (err) { vscode.window.showErrorMessage(vscode.l10n.t('Invalid format: {0}', errMsg(err))); return; }
  if (imported.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t('No valid templates found in the file.'));
    return;
  }
  for (const tpl of imported) { await storage.save(tpl); }
  onImported();
  vscode.window.showInformationMessage(vscode.l10n.t('{0} template(s) imported.', imported.length));
}

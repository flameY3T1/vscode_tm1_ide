import * as vscode from 'vscode';
import type { ProcessTemplate } from './processTemplateTypes';
import type { WebviewToHost as TemplateMsg } from '../webviewClient/processTemplateEditorMonaco/protocol';
import { ProcessTemplateStorage } from './processTemplateStorage';
import { getProcessTemplateEditorHtml } from './processTemplateEditorWebview';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';

/**
 * Lifecycle through `WebviewPanelHost` (lever B, 2026-08-30). No
 * `disposePanelsForServer`: templates live in `globalState` and belong to
 * no server — the key is the template id.
 */
export class ProcessTemplateEditorManager {
  private static readonly host =
    new WebviewPanelHost<TemplateMsg>('tm1ProcessTemplateEditor', 'Process Template Editor');

  static initialize(extensionUri: vscode.Uri): void {
    ProcessTemplateEditorManager.host.initialize(extensionUri);
  }

  static open(storage: ProcessTemplateStorage, templateId: string, onSaved: () => void): void {
    const tpl = storage.get(templateId);
    if (!tpl) { vscode.window.showErrorMessage(vscode.l10n.t('Template not found.')); return; }

    let disposed = false;
    // Without `viewColumn`: the panel opens in the active group and thus in the
    // same window as the triggering click.
    const panel = ProcessTemplateEditorManager.host.open({
      key: templateId,
      title: vscode.l10n.t('Template: {0}', tpl.name),
      html: (webview, extensionUri) => getProcessTemplateEditorHtml(webview, extensionUri, tpl),
      onDispose: () => { disposed = true; },
      onMessage: async (msg) => {
        // The host does NOT detach the receivers on close (see its
        // header comment). Without this guard the return path below would write
        // `panel.title` on a dead panel.
        if (disposed || !msg) { return; }
        if (msg.type === 'cancel') { panel!.dispose(); return; }
        if (msg.type === 'save') {
          if (!msg.name || !msg.name.trim()) { vscode.window.showErrorMessage(vscode.l10n.t('Name required.')); return; }
          const updated: ProcessTemplate = {
            ...tpl,
            name: msg.name.trim(),
            description: msg.description ?? '',
            servers: msg.servers ?? '',
            source: {
              PrologProcedure: msg.PrologProcedure ?? '',
              MetadataProcedure: msg.MetadataProcedure ?? '',
              DataProcedure: msg.DataProcedure ?? '',
              EpilogProcedure: msg.EpilogProcedure ?? '',
              Parameters: msg.Parameters ?? [],
              Variables: msg.Variables ?? [],
              DataSource: msg.DataSource ?? { Type: 'None' },
            },
          };
          await storage.save(updated);
          if (disposed) { return; }
          panel!.title = vscode.l10n.t('Template: {0}', updated.name);
          onSaved();
          vscode.window.showInformationMessage(vscode.l10n.t('Template "{0}" saved.', updated.name));
        }
      },
    });
  }

  static disposeAll(): void {
    ProcessTemplateEditorManager.host.disposeAll();
  }
}

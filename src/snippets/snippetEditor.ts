import * as vscode from 'vscode';
import { SnippetStorage, TiSnippet } from './snippetStorage';
import { getSnippetEditorHtml } from './snippetEditorWebview';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';

type SnippetMsg = {
  type: string; trigger?: string; name?: string;
  description?: string; servers?: string; body?: string;
};

/**
 * Manages Snippet editor webview panels (one per snippet).
 *
 * Lifecycle through `WebviewPanelHost` (lever B, 2026-08-30). No
 * `disposePanelsForServer`: snippets live in `globalState` and belong to
 * no server — the key is the snippet id. The host still brings
 * something the manual work did not have: registration in the
 * window directory and uniform panel settings.
 */
export class SnippetEditorManager {
  private static readonly host = new WebviewPanelHost<SnippetMsg>('tm1SnippetEditor', 'TM1 Snippet Editor');

  static initialize(extensionUri: vscode.Uri): void {
    SnippetEditorManager.host.initialize(extensionUri);
  }

  /**
   * Open a snippet editor.
   * @param storage  The global snippet store.
   * @param snippetId  null → create new snippet; string → edit existing.
   * @param onSaved  Called after the user successfully saves.
   */
  static open(
    storage: SnippetStorage,
    snippetId: string | null,
    onSaved: () => void,
  ): void {
    const isNew   = snippetId === null;
    const snippet = isNew ? null : (storage.get(snippetId!) ?? null);
    const key     = snippetId ?? '__new__';

    const title = isNew ? 'Neuer TM1 Snippet' : `Snippet: ${snippet?.name ?? snippetId}`;
    let disposed = false;

    // Without `viewColumn` the panel opens in the active group and thus in the
    // same window as the triggering click; an existing one is brought to the
    // front by the host, which returns `null`.
    const panel = SnippetEditorManager.host.open({
      key,
      title,
      html: (webview, extensionUri) => getSnippetEditorHtml(snippet, webview.cspSource,
        String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'snippetEditor.js')))),
      onDispose: () => { disposed = true; },
      onMessage: async (msg) => {
        if (disposed || !msg) { return; }
        if (msg.type === 'cancel') { panel!.dispose(); return; }
        if (msg.type === 'save') {
          if (!msg.trigger || !msg.name) {
            vscode.window.showErrorMessage(vscode.l10n.t('TM1 Snippets: trigger and name are required.'));
            return;
          }
          const saved: TiSnippet = {
            id:          snippet?.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            trigger:     msg.trigger,
            name:        msg.name,
            description: msg.description ?? '',
            servers:     msg.servers ?? '',
            body:        msg.body ?? '',
          };
          await storage.save(saved);
          panel!.dispose();
          onSaved();
          vscode.window.showInformationMessage(vscode.l10n.t('TM1 snippet "{0}" saved.', saved.name));
        }
      },
    });
  }

  static disposeAll(): void {
    SnippetEditorManager.host.disposeAll();
  }
}

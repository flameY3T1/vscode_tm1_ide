import * as vscode from 'vscode';
import { SnippetEditorManager } from '../snippets/snippetEditor';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { errMsg } from '../utils/errMsg';
import type { ActivationContext } from './context';
import { onServerChanged } from '../serverState/state';

/**
 * Registers TM1 snippet commands:
 *   tm1.snippet.new/edit/delete/export/import
 */
export function registerSnippetCommands(ctx: ActivationContext): void {
  const { context, snippetStorage, treeDataProvider, processEditorManager } = ctx;

  SnippetEditorManager.initialize(context.extensionUri);

  /**
    * Refresh the tree AND open process editors.
   *
    * The tree alone used to suffice because the webview did not know the snippets
    * at all. Now it keeps a list of its own — without this broadcast an
    * open panel would show the old state until it is opened again.
   */
  const refreshAll = (): void => {
    treeDataProvider.refresh();
    processEditorManager.broadcastSnippets();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.snippet.new', () => {
      SnippetEditorManager.open(snippetStorage, null, refreshAll);
    }),
    vscode.commands.registerCommand('tm1.snippet.edit', (node: Tm1TreeNode) => {
      const id = node?.meta?.snippetId as string | undefined;
      if (!id) { return; }
      SnippetEditorManager.open(snippetStorage, id, refreshAll);
    }),
    vscode.commands.registerCommand('tm1.snippet.delete', async (node: Tm1TreeNode) => {
      const id   = node?.meta?.snippetId as string | undefined;
      const name = (node?.label as string) ?? 'Snippet';
      if (!id) { return; }
      const deleteLabel = vscode.l10n.t('Delete');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete Snippet "{0}"?', name),
        { modal: true }, deleteLabel,
      );
      if (answer !== deleteLabel) { return; }
      await snippetStorage.delete(id);
      refreshAll();
    }),
    vscode.commands.registerCommand('tm1.snippet.export', () => {
      snippetStorage.exportToFile().catch(e => vscode.window.showErrorMessage(errMsg(e)));
    }),
    vscode.commands.registerCommand('tm1.snippet.import', () => {
      snippetStorage.importFromFile(refreshAll).catch(e => vscode.window.showErrorMessage(errMsg(e)));
    }),
    // A snippet can be restricted to certain servers, so the list
    // hangs on the active server. Connecting and disconnecting change it without
    // anyone having touched a snippet command — the same reason
    // `registerV12Mode` listens in here.
    onServerChanged.event(() => processEditorManager.broadcastSnippets()),
    { dispose: () => SnippetEditorManager.disposeAll() },
  );
}

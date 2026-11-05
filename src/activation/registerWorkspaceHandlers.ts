import * as vscode from 'vscode';
import { warmCache } from '../providers/fetchNames';
import type { Tm1TreeDataProvider } from '../providers/tm1TreeDataProvider';

const TRIGGER_KEYWORDS = ['cube', 'dim', 'hier', 'proc', 'chore'];

/**
 * Registers workspace-level event handlers:
 *   - re-warm IntelliSense cache when a .pro/.ti file opens
 *   - react to tm1.objectExplorerAutoRefreshMs config changes
 *   - auto-trigger suggestions when typing TI object keywords
 */
export function registerWorkspaceHandlers(
  context: vscode.ExtensionContext,
  treeDataProvider: Tm1TreeDataProvider,
): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId === 'ti') {
        warmCache();
      }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('tm1.objectExplorerAutoRefreshMs')) {
        treeDataProvider.stopAutoRefresh();
        const newMs = vscode.workspace.getConfiguration('tm1').get<number>('objectExplorerAutoRefreshMs', 0);
        treeDataProvider.startAutoRefresh(newMs);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      const doc = e.document;
      if (doc.languageId !== 'ti') { return; }
      for (const change of e.contentChanges) {
        const pos = change.range.start.translate(0, change.text.length);
        const wordRange = doc.getWordRangeAtPosition(pos, /[a-zA-Z]\w*/);
        if (!wordRange) { continue; }
        const word = doc.getText(wordRange).toLowerCase();
        if (TRIGGER_KEYWORDS.some(k => k.startsWith(word) || word.startsWith(k)) && word.length >= 2) {
          setTimeout(() => { void vscode.commands.executeCommand('editor.action.triggerSuggest'); }, 10);
          break;
        }
      }
    }),
  );
}

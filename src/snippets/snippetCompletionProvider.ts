import * as vscode from 'vscode';
import { SnippetStorage } from './snippetStorage';

/**
 * Provides TI code-snippet completions in .ti / .pro files.
 * Triggers on any word of ≥ 2 characters that matches a snippet trigger prefix.
 * Items are sorted to the end of the completion list (sortText 'zzz_…').
 */
export class TiSnippetCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly storage: SnippetStorage,
    private readonly getActiveServer: () => string | undefined = () => undefined,
  ) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const before = document.lineAt(position).text.slice(0, position.character);
    const wordMatch = /[A-Za-z_]\w*$/.exec(before);
    if (!wordMatch || wordMatch[0].length < 2) { return undefined; }
    const typed = wordMatch[0].toLowerCase();

    const matches = this.storage.getFiltered(this.getActiveServer()).filter(s =>
      s.trigger.toLowerCase().startsWith(typed),
    );
    if (matches.length === 0) { return undefined; }

    return matches.map(s => {
      const lines = s.body.split('\n');
      const preview = lines.slice(0, 5).join('\n') + (lines.length > 5 ? '\n…' : '');
      const doc = new vscode.MarkdownString(
        (s.description ? `${s.description}\n\n` : '') + '```\n' + preview + '\n```',
      );

      const item = new vscode.CompletionItem(s.name, vscode.CompletionItemKind.Snippet);
      item.detail = `[${s.trigger}]  TM1 Snippet`;
      item.documentation = doc;
      item.insertText = new vscode.SnippetString(s.body);
      item.filterText = s.trigger;
      item.sortText = 'zzz_' + s.trigger; // always at end of list
      return item;
    });
  }
}

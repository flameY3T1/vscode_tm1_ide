import * as vscode from 'vscode';
import { findAllOccurrences } from './tiIdentifierUtils';

/**
 * Provides "Find All References" (Shift+F12) for TI variables in .pro and .ti files.
 * Returns all occurrences of the identifier under the cursor across all sections,
 * excluding string literals and line comments.
 */
export class TiReferencesProvider implements vscode.ReferenceProvider {
  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
  ): vscode.Location[] {
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-ZÄÖÜäöüß_][a-zA-ZÄÖÜäöüß0-9_]*/);
    if (!wordRange) { return []; }

    const word = document.getText(wordRange);
    const ranges = findAllOccurrences(document, word);
    return ranges.map(r => new vscode.Location(document.uri, r));
  }
}

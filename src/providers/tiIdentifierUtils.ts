/**
 * Shared utilities for TI identifier analysis (rename, find references, etc.)
 * VS Code-side wrapper over the pure helpers in tiIdentifierUtilsPure.ts.
 */

import * as vscode from 'vscode';
import {
  findAllOccurrencesPure,
} from './tiIdentifierUtilsPure';

export { findAllOccurrencesPure };

/**
 * Finds all ranges in `document` where `word` appears as a whole word
 * (case-insensitive), excluding string literals and line comments.
 */
export function findAllOccurrences(document: vscode.TextDocument, word: string): vscode.Range[] {
  const ranges = findAllOccurrencesPure(document.getText(), word);
  return ranges.map(r => new vscode.Range(r.line, r.startCol, r.line, r.endCol));
}

import * as vscode from 'vscode';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';
import { findAllOccurrences } from './tiIdentifierUtils';
import { isReservedName, validateRenameTarget } from './tiRenameProviderPure';

const ID_REGEX = /[a-zA-ZÄÖÜäöüß_][a-zA-ZÄÖÜäöüß0-9_]*/;

// Lazy: KNOWN_SIGNATURES Map is populated at activation (node-boot) — defer
// the Set build until first call to avoid order-of-import pitfalls.
let _builtinNames: ReadonlySet<string> | null = null;
function builtinNames(): ReadonlySet<string> {
  if (!_builtinNames) {
    _builtinNames = new Set([...KNOWN_SIGNATURES.keys()].map(k => k.toLowerCase()));
  }
  return _builtinNames;
}

/**
 * Provides rename support for TI variables in .pro and .ti files.
 * Searches all occurrences in the document (covering all 4 sections of a .pro file).
 * Built-in functions and TI keywords cannot be renamed.
 *
 * Validation policy lives in `tiRenameProviderPure.ts` (vscode-free).
 */
export class TiRenameProvider implements vscode.RenameProvider {
  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<{ range: vscode.Range; placeholder: string }> {
    const wordRange = document.getWordRangeAtPosition(position, ID_REGEX);
    if (!wordRange) {
      throw new Error(vscode.l10n.t('No identifier at this position.'));
    }
    const word = document.getText(wordRange);
    if (isReservedName(word.toLowerCase(), builtinNames())) {
      throw new Error(vscode.l10n.t('Built-in functions and keywords cannot be renamed.'));
    }
    return { range: wordRange, placeholder: word };
  }

  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
  ): vscode.WorkspaceEdit | undefined {
    const wordRange = document.getWordRangeAtPosition(position, ID_REGEX);
    if (!wordRange) { return undefined; }

    const word = document.getText(wordRange);
    if (validateRenameTarget(word, newName, builtinNames()) !== null) { return undefined; }

    const ranges = findAllOccurrences(document, word);
    if (ranges.length === 0) { return undefined; }

    const edit = new vscode.WorkspaceEdit();
    for (const range of ranges) {
      edit.replace(document.uri, range, newName.trim());
    }
    return edit;
  }
}

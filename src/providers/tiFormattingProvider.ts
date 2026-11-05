import * as vscode from 'vscode';
import { formatTi } from '../tiLogicVisualizer/formatTi';
import { formatRulesText } from '../tiLogicVisualizer/formatRulesText';
import { loadFormatConfig } from './formatConfigStore';
import { loadRuleFormatConfig } from './ruleFormatConfigStore';

/**
 * `Shift+Alt+F` for plain TI and rules files — the same formatter the webview
 * editors run, on documents VS Code owns itself (`.ti`/`.pro`/`.rux` from the
 * Git mirror, a `.pro` opened from the file tree).
 *
 * A file on disk carries no server binding, so the preferences come from the
 * '__default__' key of the stores the editors write to. The formatters
 * themselves are pure text transforms: no REST call, nothing that depends on
 * which server happens to be active. The identifier-case rule stays off here
 * because its canonical-name map comes from the loaded process.
 */
const DISK_KEY = '__default__';

function fullRange(doc: vscode.TextDocument): vscode.Range {
  const last = doc.lineCount - 1;
  return new vscode.Range(0, 0, last, doc.lineAt(last).text.length);
}

/** One replace-everything edit, or none when the text is already formatted —
 *  an empty result leaves the undo stack and the dirty flag alone. */
function editsFor(doc: vscode.TextDocument, formatted: string): vscode.TextEdit[] {
  return formatted === doc.getText() ? [] : [vscode.TextEdit.replace(fullRange(doc), formatted)];
}

export class TiFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
    return editsFor(doc, formatTi(doc.getText(), loadFormatConfig(DISK_KEY)));
  }
}

export class RulesFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
    return editsFor(doc, formatRulesText(doc.getText(), loadRuleFormatConfig(DISK_KEY)));
  }
}

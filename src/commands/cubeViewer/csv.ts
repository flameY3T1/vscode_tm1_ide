import * as vscode from 'vscode';

export async function _saveCsvFile(csv: string, cubeName: string): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${cubeName}.csv`),
    filters: { [vscode.l10n.t('CSV file')]: ['csv'] },
  });
  if (!uri) { return; }
  // Prepend a UTF-8 BOM so Excel (esp. on Windows/German locale) detects UTF-8
  // instead of ANSI/Windows-1252 — otherwise umlauts (äöüß) render as mojibake.
  await vscode.workspace.fs.writeFile(uri, Buffer.from('﻿' + csv, 'utf-8'));
  vscode.window.showInformationMessage(vscode.l10n.t('TM1: CSV saved: {0}', uri.fsPath));
}

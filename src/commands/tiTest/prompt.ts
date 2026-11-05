import * as vscode from 'vscode';
import { validateTestName } from './promptPure';

export async function promptForTestName(
  parentAbs: string,
  defaultName: string,
): Promise<string | undefined> {
  let siblings: string[] = [];
  try {
    const fsSync = await import('node:fs');
    const entries = fsSync.readdirSync(parentAbs, { withFileTypes: true });
    siblings = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    /* parent may not exist yet */
  }
  return await vscode.window.showInputBox({
    title: vscode.l10n.t('Test name'),
    value: defaultName,
    prompt: vscode.l10n.t('Will be a subfolder under the selected test folder'),
    ignoreFocusOut: true,
    validateInput: (v) => validateTestName(v, siblings),
  });
}

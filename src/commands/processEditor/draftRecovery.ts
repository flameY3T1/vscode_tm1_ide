import * as vscode from 'vscode';
import { clearDraft, loadDraft, type ProcessDraft } from './draftStore';
import { getExtensionContext } from '../../utils/extensionContext';

/**
 * Offers back the unsaved content of a process editor that was closed dirty.
 *
 * Called on open, before the server version reaches the webview. Returns the
 * draft to hydrate with, or undefined to use what TM1 holds.
 */
export async function offerDraftRecovery(
  panelKey: string, processName: string,
): Promise<ProcessDraft | undefined> {
  const memento = getExtensionContext()?.globalState;
  if (!memento) { return undefined; }

  const draft = loadDraft(memento, panelKey);
  if (!draft) { return undefined; }

  const RESTORE = vscode.l10n.t('Restore');
  const DISCARD = vscode.l10n.t('Discard');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('"{0}" has unsaved changes from {1}. Restore them?',
      processName, new Date(draft.savedAt).toLocaleString()),
    { modal: true },
    RESTORE, DISCARD,
  );

  // Esc means "not now", not "throw my work away" — only an explicit answer
  // consumes the draft. Anything else leaves it parked for the next open.
  if (answer === RESTORE || answer === DISCARD) {
    await clearDraft(memento, panelKey);
  }
  return answer === RESTORE ? draft : undefined;
}

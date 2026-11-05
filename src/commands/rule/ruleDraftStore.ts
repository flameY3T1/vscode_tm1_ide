/**
 * Close-/crash-recovery for unsaved RULE editor content.
 *
 * Same contract as the process editor's store — a webview panel close cannot be
 * intercepted, so the host parks what it already has. The rule editor is the
 * cheap case: its webview already posts the full text on every user edit
 * (`codeChanged`), so no extra mirroring is needed, only remembering.
 */

import * as vscode from 'vscode';
import { createDraftStore, type DraftMemento } from '../../utils/draftStore';
import { errMsg } from '../../utils/errMsg';

export interface RuleDraft { rulesText: string }

const store = createDraftStore<RuleDraft>(
  'tm1.ruleDrafts',
  // Empty rules are a legitimate edit (the user deleted everything), so the
  // check is on the TYPE, not on truthiness.
  (draft) => typeof (draft as RuleDraft).rulesText === 'string',
);

export const saveRuleDraft = store.save;
export const loadRuleDraft = store.load;
export const hasRuleDraft = store.has;
export const clearRuleDraft = store.clear;

/**
 * Parks the editor content of a rule panel that disappeared while dirty.
 * No-op when the panel was clean or no storage is available.
 */
export async function parkRuleDraft(
  memento: DraftMemento | undefined,
  panelKey: string,
  cubeName: string,
  rulesText: string,
  dirty: boolean,
  now: number,
): Promise<void> {
  if (!memento || !dirty) { return; }
  try {
    await saveRuleDraft(memento, panelKey, { rulesText }, now);
    vscode.window.showWarningMessage(
      vscode.l10n.t('Unsaved rule changes for "{0}" were kept. Reopen the rules to restore them.', cubeName),
    );
  } catch (err) {
    // Losing the draft silently is exactly what this path exists to prevent.
    vscode.window.showErrorMessage(
      vscode.l10n.t('Unsaved rule changes for "{0}" could not be kept: {1}', cubeName, errMsg(err)),
    );
  }
}

/**
 * Offers back parked rule text before the server version reaches the webview.
 * Returns the text to hydrate with, or undefined to use what TM1 holds.
 */
export async function offerRuleDraftRecovery(
  memento: DraftMemento | undefined,
  panelKey: string,
  cubeName: string,
): Promise<string | undefined> {
  if (!memento) { return undefined; }
  const draft = loadRuleDraft(memento, panelKey);
  if (!draft) { return undefined; }

  const RESTORE = vscode.l10n.t('Restore');
  const DISCARD = vscode.l10n.t('Discard');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('The rules of "{0}" have unsaved changes from {1}. Restore them?',
      cubeName, new Date(draft.savedAt).toLocaleString()),
    { modal: true },
    RESTORE, DISCARD,
  );

  // Esc means "not now", not "throw my work away".
  if (answer === RESTORE || answer === DISCARD) {
    await clearRuleDraft(memento, panelKey);
  }
  return answer === RESTORE ? draft.rulesText : undefined;
}

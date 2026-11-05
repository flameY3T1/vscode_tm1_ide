/**
 * Commit / discard wiring.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state, vscode, serializeState } from './state';
import { validateClient } from './helpers';
import { askConfirm, showError, showInfo } from './modals';
import type { HostToWebview } from './protocol';
import { getL10n, fmt } from '../_shared/l10n';

export {};

const L = getL10n();

export { serializeState };

export function handleCommitResult(msg: Extract<HostToWebview, { type: 'commitResult' }>): void {
  const btn = document.getElementById('save-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = false;
  if (msg.ok) {
    showInfo(L.changesSaved);
  } else {
    const all = msg.errors || [];
    const list = all.slice(0, 5).map(e => '• ' + (e && e.message ? e.message : String(e))).join('\n');
    const more = all.length > 5 ? '\n' + fmt(L, 'andMore', all.length - 5) : '';
    showError(fmt(L, 'saveErrorsCount', all.length));
    void askConfirm({
      message: fmt(L, 'saveErrorsCount', all.length),
      detail: list + more,
      yes: L.ok,
    });
  }
}

export function sendSaveAsNew(): void {
  if (!state.data) return;
  const errors = validateClient();
  if (errors.length > 0) {
    showError(fmt(L, 'fixValidationFirst', errors[0]));
    return;
  }
  // No dirty gate: even an unchanged state may be copied as a new dim.
  // The name prompt and the creation run on the host side (showInputBox).
  // Unchanged → send only the active name here; the host clones server-side
  // fresh. This saves serializing and transmitting back the complete draft
  // (tens of MB for large dims → much faster). Dirty → full state.
  if (state.data.dirty) {
    vscode.postMessage({ type: 'saveAsNew', state: serializeState() });
  } else {
    vscode.postMessage({ type: 'saveAsNew', activeHier: state.data.hierName });
  }
}

export function sendCommit(): void {
  if (!state.data || !state.data.dirty) return;
  const errors = validateClient();
  if (errors.length > 0) {
    showError(fmt(L, 'fixValidationFirst', errors[0]));
    return;
  }
  (document.getElementById('save-btn') as HTMLButtonElement).disabled = true;
  vscode.postMessage({ type: 'commit', state: serializeState() });
}

export async function sendDiscard(): Promise<void> {
  if (!state.data || !state.data.dirty) return;
  const ok = await askConfirm({
    message: L.discardConfirm,
    yes: L.discardYes,
    // Throws the whole unsaved draft away.
    danger: true,
  });
  if (!ok) return;
  vscode.postMessage({ type: 'discard', hier: state.data.hierName });
}

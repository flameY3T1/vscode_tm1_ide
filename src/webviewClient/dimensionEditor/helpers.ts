/**
 * Stateless-ish helpers shared across dimensionEditor sub-modules.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import type { ElementDraft } from '../../dimensionEditor/model';
import { state, vscode, serializeState } from './state';
import {
  escapeHtml as _pureEscapeHtml,
  validateDimensionState as _pureValidateDimensionState,
  occNames,
} from './pure';

export {};

export const escapeHtml = _pureEscapeHtml;
export { typeBadgeHtml } from './pure';

export function elementsList(): ElementDraft[] {
  if (!state.data || !state.data.elements) return [];
  return Object.values(state.data.elements);
}

export function findElement(name: unknown): ElementDraft | null {
  if (!state.data || !state.data.elements || !name) return null;
  return state.data.elements[name as string] || null;
}

export function validateClient(): string[] {
  if (!state.data) return [];
  return _pureValidateDimensionState(elementsList(), state.data.edges || []);
}

/**
 * The single selected element NAME when the selection resolves to exactly one
 * distinct element, else null. Selection is keyed by occurrence, so several
 * occurrences of the same element still count as one element here (attributes
 * are per-element, not per-occurrence).
 */
export function primarySelected(): string | null {
  const names = occNames(state.selected);
  return names.length === 1 ? names[0] : null;
}

export function updateDirty(): void {
  const dirty = !!(state.data && state.data.dirty);
  const errors = validateClient();
  (document.getElementById('dirty-indicator') as HTMLElement).style.display = dirty ? '' : 'none';
  (document.getElementById('discard-btn') as HTMLButtonElement).disabled = !dirty;
  (document.getElementById('save-btn') as HTMLButtonElement).disabled = !dirty || errors.length > 0;
  // Save-as is independent of dirty — disabled only without loaded data or on
  // validation errors.
  const saveAsBtn = document.getElementById('save-as-btn') as HTMLButtonElement | null;
  if (saveAsBtn) { saveAsBtn.disabled = !state.data || errors.length > 0; }
  const status = document.getElementById('validation-status') as HTMLElement;
  status.textContent = errors.length
    ? errors[0] + (errors.length > 1 ? ' (+' + (errors.length - 1) + ')' : '')
    : '';
  status.title = errors.join('\n');
  vscode.postMessage({ type: 'dirtyState', dirty });
  if (dirty) { scheduleDraftSync(); }
}

/**
 * Debounced draft push to the host.
 *
 * `updateDirty()` runs after every mutation, so this is the one choke point that
 * sees all of them. The payload can be large (a full hierarchy), hence the
 * debounce: keystroke-frequency serialization of 100k elements would stall the
 * webview. 1.5 s is the window of work a close can still cost.
 */
let _draftSyncTimer = 0;
export function scheduleDraftSync(): void {
  clearTimeout(_draftSyncTimer);
  _draftSyncTimer = setTimeout(() => {
    if (!state.data || !state.data.dirty) { return; }
    vscode.postMessage({ type: 'draftSync', draft: serializeState() });
  }, 1500) as unknown as number;
}

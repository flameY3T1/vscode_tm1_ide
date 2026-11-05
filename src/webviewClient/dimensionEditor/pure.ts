/**
 * Pure helpers for the dimension-editor webview.
 *
 * Originally a single file extracted from `index.ts` (Hebel 17 — Iter 9);
 * split by concern (Junk-Drawer split) into model/sort/validation/selection/
 * reparent. This module stays as a barrel so existing importers are unchanged.
 * No DOM, no module state.
 */

export {};

export { escapeHtml } from '../htmlUtils';

import { escapeHtml as _escapeHtml } from '../htmlUtils';
/** Escaped `<span class="type-badge">` for an element type (N/C/S/…). The type
 * is a constrained enum, but escape it anyway so no value can inject markup. */
export function typeBadgeHtml(type: string): string {
  return `<span class="type-badge">${_escapeHtml(type)}</span>`;
}
export { typeSortKey, compareByTypeName } from './sort';
export {
  parseBulkInput,
  validateDimensionState,
} from './validation';
export { toggleSelection, computeRange, occKey, occName, occParent, occNames } from './selection';
export { planReparent, deleteElementFromDraft, removeEdgeFromDraft, settlePersistedNew, nextOrder, reindexChildren } from './reparent';

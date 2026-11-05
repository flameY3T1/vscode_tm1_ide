/**
 * Close-/crash-recovery for unsaved DIMENSION editor content.
 *
 * Thin binding over the generic store in `utils/draftStore` — see there for why
 * this exists at all (a webview panel close cannot be intercepted, so the
 * warning "the changes are lost" was the whole recovery story).
 *
 * Unlike the process editor, the parked payload can be big: it is the editor's
 * full working set for ONE hierarchy (elements, edges, attribute definitions)
 * plus the snapshot it was loaded from. `MAX_DRAFT_BYTES` caps what goes into
 * `globalState`; above it the draft is dropped and the user is told so at close
 * time rather than being promised a restore that never comes.
 */

import { createDraftStore } from '../../utils/draftStore';

/** Serialized dimension-editor state — same shape the webview posts. */
export interface DimensionDraft {
  serverId: string;
  dimName: string;
  hierName: string;
  hierarchies: string[];
  elements: Record<string, unknown>;
  edges: unknown[];
  attrDefs: unknown[];
  snapshot: unknown;
  dirty: boolean;
}

/**
 * ~4 MB of JSON. A 100k-element hierarchy serializes well past that, and
 * `globalState` is a synchronously-read JSON blob shared by the whole
 * extension — parking a payload that size would slow every later read.
 */
export const MAX_DRAFT_BYTES = 4 * 1024 * 1024;

const store = createDraftStore<DimensionDraft>(
  'tm1.dimensionDrafts',
  // Without elements there is nothing to restore into the editor.
  (draft) => !!(draft as DimensionDraft)?.elements && !!(draft as DimensionDraft)?.dimName,
);

/** Store key — one draft per server + dimension + hierarchy. */
export function dimensionDraftKey(serverUrl: string, dimName: string, hierName: string): string {
  return `${serverUrl}|${dimName}|${hierName}`;
}

/** True when the payload is small enough to park. */
export function draftFitsStore(draft: DimensionDraft): boolean {
  try {
    return JSON.stringify(draft).length <= MAX_DRAFT_BYTES;
  } catch {
    return false;
  }
}

export const saveDimensionDraft = store.save;
export const loadDimensionDraft = store.load;
export const clearDimensionDraft = store.clear;

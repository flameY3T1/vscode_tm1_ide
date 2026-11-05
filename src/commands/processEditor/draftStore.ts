/**
 * Close-/crash-recovery for unsaved PROCESS editor content.
 *
 * Thin binding over the generic store in `utils/draftStore` — see there for why
 * this exists at all (a webview panel close cannot be intercepted).
 */

import { createDraftStore, type DraftMemento } from '../../utils/draftStore';
import { redactPassword } from '../../utils/dataSourceWire';
export type { DraftMemento };

export interface ProcessDraft {
  sections: { prolog: string; metadata: string; data: string; epilog: string };
  parameters: unknown[];
  dataSource: unknown;
  variables: unknown[];
}

const store = createDraftStore<ProcessDraft>(
  'tm1.processDrafts',
  // Without sections there is nothing to restore into the editor.
  (draft) => !!(draft as ProcessDraft).sections,
);

/**
 * A draft goes to globalState (`state.vscdb` on disk), so the ODBC password —
 * here the plaintext the user just typed — must not travel with it. Restoring
 * a draft therefore leaves the password field empty; the server still holds
 * the real one and a `DataSource` PATCH merges, so only a brand-new process
 * needs it typed again.
 */
export const saveDraft: typeof store.save = (memento, itemKey, draft, now) =>
  store.save(memento, itemKey, { ...draft, dataSource: redactPassword(draft.dataSource as object) }, now);

export const loadDraft = store.load;
export const hasDraft = store.has;
export const clearDraft = store.clear;

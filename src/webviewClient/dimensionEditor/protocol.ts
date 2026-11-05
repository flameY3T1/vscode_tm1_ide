/**
 * Discriminated-union protocol for the Dimension Editor
 * webview ↔ extension-host bridge.
 *
 * Hebel 13 (2026-05-17): single source of truth for every `postMessage`
 * shape. Both sides import from this module — host
 * (`src/commands/dimension/dimensionEditor.ts`) and webview client
 * (`src/webviewClient/dimensionEditor/index.ts`).
 *
 * Type imports from `src/dimensionEditor/model` and `src/usageCheck/*`
 * are pure-types — vscode-free, no layer break under depcruise.
 */

import type {
  DimDraftState, DimSnapshot, ElementDraft, HierarchySnapshot, DefaultMemberState, SortOrderState,
} from '../../dimensionEditor/model';
import type { UsageRef } from '../../usageCheck/elementUsage';

/**
 * Draft state shape transported via postMessage. The `elements` Map is
 * serialized to a plain object (Map is not postMessage-safe) and
 * `attrCubeExists` is added by the host before sending.
 */
export type DimEditorDraftPayload =
  Omit<DimDraftState, 'elements'> & {
    elements: Record<string, ElementDraft>;
    attrCubeExists?: boolean;
  };

export interface CommitError {
  message: string;
}

// ── Host → Webview ──────────────────────────────────────────────
export type HostToWebview =
  | { type: 'initData'; state: DimEditorDraftPayload }
  /** Partial commit: new server baseline, the working state stays (only unapplied changes remain dirty). */
  | { type: 'rebaseSnapshot'; snapshot: DimSnapshot }
  | { type: 'loadError'; message: string }
  | {
      type: 'mergeHier';
      hier: string;
      content?: HierarchySnapshot;
      error?: string;
    }
  | { type: 'confirmDelete'; elements: string[]; usages: Array<UsageRef & { element: string }> }
  | { type: 'commitResult'; ok: boolean; errors: CommitError[] }
  /** Default member per loaded hierarchy: `explicit` = set, `effective` = what TM1 uses. */
  | { type: 'defaultMemberState'; states: DefaultMemberState[] }
  | { type: 'defaultMemberResult'; ok: boolean; hier: string; state?: DefaultMemberState; message?: string }
  /** `sort` missing = could not be read (`message`), e.g. TM1 12. */
  | { type: 'sortOrderState'; hier: string; sort?: SortOrderState; message?: string }
  | { type: 'sortOrderResult'; ok: boolean; message?: string; state?: DimEditorDraftPayload }
  /** Tree entry "Sort Order…": open the dialog for this hierarchy. */
  | { type: 'openSortOrder'; hier: string };

// ── Webview → Host ──────────────────────────────────────────────
export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'dirtyState'; dirty: boolean }
  /**
   * Debounced copy of the working state while it is dirty. The host parks it so
   * closing the panel — which cannot be intercepted — stops destroying the work.
   */
  | { type: 'draftSync'; draft: unknown }
  | { type: 'fetchHier'; hier: string }
  | { type: 'checkUsage'; elements: string[] }
  /** Serialized draft state — host's `deserializeState` re-parses. */
  | { type: 'commit'; state: unknown }
  /**
   * Save the current dimension under a new name. If the draft is unmodified the
   * webview omits `state` and sends only `activeHier` — the host then clones the
   * source hierarchy fresh via REST instead of receiving the whole (potentially
   * tens-of-MB) serialized draft. When dirty, `state` carries the full draft.
   */
  | { type: 'saveAsNew'; state?: unknown; activeHier?: string }
  | { type: 'openAttrCube' }
  /** `element === null` resets. */
  | { type: 'setDefaultMember'; hier: string; element: string | null }
  | { type: 'readSortOrder'; hier: string }
  | { type: 'setSortOrder'; hier: string; sort: SortOrderState }
  | { type: 'discard'; hier: string };

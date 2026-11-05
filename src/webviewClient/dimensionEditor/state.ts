/**
 * Shared mutable state for the Dimension Editor webview.
 *
 * Replaces the IIFE-closure-scoped vars in the original `index.ts` so
 * other sub-modules can read/mutate state via `state.x` references.
 * Extracted in Post-H17 #4 split.
 */

import type { DimEditorDraftPayload, WebviewToHost } from './protocol';
import type { DefaultMemberState, ElementDraft } from '../../dimensionEditor/model';
import { EMPTY_CLIPBOARD, type ElementClipboard } from '../../dimensionEditor/pasteStructurePure';
import { getVsCodeApi } from '../_shared/vscodeApi';

export {};


export const vscode = getVsCodeApi<WebviewToHost>();

export interface FlatRow {
  el: ElementDraft;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
  /** Parent element this row is drawn under; null = root/orphan (no parent edge). */
  parent: string | null;
}

export interface DimEditorState {
  data: DimEditorDraftPayload | null;
  selected: Set<string>;
  anchor: string | null;
  pendingHierSwitch: string | null;
  flatView: FlatRow[];
  collapsed: Set<string>;
  treeScrollBound: boolean;
  searchQuery: string;
  /** Attribute name (type Alias) used as element display label; '' = raw Name. */
  displayAlias: string;
  /**
   * Internal clipboard, filled by Ctrl+C, pasted by Ctrl+V or the
   * context menu. Holds elements WITH type and the edges between the marked ones —
   * when pasting into another hierarchy the source structure is no longer
   * in the state (the editor loads the target hierarchy when switching), so it must
   * travel along here.
   */
  clipboard: ElementClipboard;
  /** Default member per hierarchy name. Empty as long as the host has not delivered anything. */
  defaultMembers: Record<string, DefaultMemberState>;
}

export const state: DimEditorState = {
  data: null,
  selected: new Set<string>(),
  anchor: null,
  pendingHierSwitch: null,
  flatView: [],
  collapsed: new Set<string>(),
  treeScrollBound: false,
  searchQuery: '',
  displayAlias: '',
  clipboard: EMPTY_CLIPBOARD,
  defaultMembers: {},
};

export const TREE_ROW_H = 22;
export const TREE_BUFFER = 10;

/** Draft as it travels to the host — `attrCubeExists` is host-owned and stays out. */
export type SerializedDraft = Omit<DimEditorDraftPayload, 'attrCubeExists'>;

/**
 * Plain-object copy of the working state.
 *
 * Lives here rather than in `commit.ts` because both the commit path and the
 * debounced draft sync in `helpers.ts` need it, and `commit.ts` already imports
 * `helpers.ts` — the other direction would close an import cycle.
 */
export function serializeState(): SerializedDraft | null {
  if (!state.data) return null;
  return {
    serverId: state.data.serverId,
    dimName: state.data.dimName,
    hierName: state.data.hierName,
    hierarchies: (state.data.hierarchies || []).slice(),
    elements: state.data.elements || {},
    edges: (state.data.edges || []).map(e => ({ ...e })),
    attrDefs: (state.data.attrDefs || []).map(a => ({ ...a })),
    snapshot: state.data.snapshot,
    dirty: !!state.data.dirty,
  };
}

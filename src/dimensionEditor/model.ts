// src/dimensionEditor/model.ts

export type ElementType = 'N' | 'C' | 'S';
export type AttrDefType = 'Alias' | 'String' | 'Numeric';
export type ChangeMark = 'new' | 'changed' | 'deleted' | 'clean';

export interface ElementDraft {
  name: string;                       // Primary key, immutable (TM1 does not support a lossless rename)
  type: ElementType;
  attrs: Record<string, string>;      // attrName -> value; "" = geleert
  marked: ChangeMark;
  /**
   * Position in the hierarchy's element index (0-based), from the fetch order.
   * Top-level elements show in this order, and dragging one between two others
   * rewrites it. New elements carry none until saved — they go to the end.
   */
  index?: number;
}

export interface EdgeDraft {
  parent: string;
  child: string;
  weight: number;
  marked: 'new' | 'deleted' | 'clean';
  /**
   * Component order of this child under its parent (0-based, TM1 storage order).
   * Populated from the fetch array position; the tree renders children by it and
   * drag-reorder rewrites it. Optional — legacy/test edges without it sort as 0.
   */
  order?: number;
}

export interface AttrDef {
  name: string;
  type: AttrDefType;
  marked: 'new' | 'deleted' | 'clean';
}

export interface HierarchySnapshot {
  elements: ElementDraft[];           // alle marked='clean'
  edges: EdgeDraft[];                 // alle marked='clean'
  attrDefs: AttrDef[];                // alle marked='clean'
}

export interface DimSnapshot {
  dimName: string;
  hierarchies: string[];
  perHier: Record<string, HierarchySnapshot>;
}

export interface DimDraftState {
  serverId: string;
  dimName: string;
  hierName: string;
  hierarchies: string[];
  elements: Map<string, ElementDraft>;  // Key: elementName
  edges: EdgeDraft[];
  attrDefs: AttrDef[];
  snapshot: DimSnapshot;
  dirty: boolean;
}

/**
 * Default element of a hierarchy. Lives here and not in `tm1Rest/` because
 * the webview protocol and the menu logic need the type and `webview-no-tm1rest`
 * forbids them to import from the REST layer — even type-only.
 */
export interface DefaultMemberState {
  hierarchy: string;
  /** What TM1 actually uses. `null` if the hierarchy has none (HTTP 204). */
  effective: string | null;
  /** What is stored in `}HierarchyProperties`. `''` means: nothing set, TM1 derives it. */
  explicit: string;
}

/** Element order, TM1 type and sense folded into one dropdown choice. */
export type ElementSort = 'input' | 'name-asc' | 'name-desc' | 'level-asc' | 'level-desc' | 'hierarchy';
/** Order of the children inside each consolidation. */
export type ComponentSort = 'input' | 'name-asc' | 'name-desc';

/** Sort order of a hierarchy, from its sort properties (here for the same reason as above). */
export interface SortOrderState {
  elements: ElementSort;
  components: ComponentSort;
}

// ─── Change Types ────────────────────────────────────────────────────────────

export type Change =
  | { kind: 'addElement';      hier: string; name: string; type: ElementType }
  | { kind: 'deleteElement';   hier: string; name: string }
  | { kind: 'changeType';      hier: string; name: string; newType: ElementType }
  | { kind: 'addEdge';         hier: string; parent: string; child: string; weight: number }
  | { kind: 'deleteEdge';      hier: string; parent: string; child: string }
  | { kind: 'setEdgeWeight';   hier: string; parent: string; child: string; weight: number }
  // Reorder a consolidation's children. There is no positional insert, so this
  // is applied as delete-all-components + re-add in `children` order (edges have
  // no attributes, so the round-trip is lossless).
  | { kind: 'reorderComponents'; hier: string; parent: string; children: Array<{ name: string; weight: number }> }
  // New element index order. There is no positional call for existing
  // elements: the hierarchy is PATCHed with its full element AND edge list —
  // Elements alone drops every edge (measured 11.8, 2026-09-30).
  | { kind: 'reorderElements'; hier: string; elements: Array<{ name: string; type: ElementType }>; edges: Array<{ parent: string; child: string; weight: number }> }
  | { kind: 'setAttr';         hier: string; element: string; attr: string; value: string | number }
  | { kind: 'clearAttr';       hier: string; element: string; attr: string }
  | { kind: 'addAttrDef';      name: string; type: AttrDefType }
  | { kind: 'deleteAttrDef';   name: string }
  | { kind: 'addHierarchy';    name: string }
  | { kind: 'deleteHierarchy'; name: string };

export interface ChangeSet {
  changes: Change[];
  estimatedRestCalls: number;
}


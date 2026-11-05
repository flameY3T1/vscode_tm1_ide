/**
 * Shared pure data shapes for the dimension-editor webview.
 *
 * Split out of `pure.ts` (Junk-Drawer split). No DOM, no module state.
 */

export interface ElementLike {
  name: string;
  type?: string;
  marked?: string;
}

export interface EdgeLike {
  parent: string;
  child: string;
  marked?: string;
  /** Component order under the parent (0-based). See EdgeDraft.order. */
  order?: number;
}

export interface BulkParseResult {
  valid: string[];
  duplicateFile: string[];
  alreadyExists: string[];
  invalid: string[];
}

export type ReparentPlan =
  | { action: 'add' }
  | { action: 'restore' }
  | { action: 'skip'; reason: 'self' | 'cycle' | 'exists' };

export interface DraftLike {
  elements: Record<string, { name: string; marked?: string }>;
  edges: Array<{ parent: string; child: string; marked?: string; order?: number }>;
}

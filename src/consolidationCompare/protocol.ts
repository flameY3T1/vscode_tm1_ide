// Messages between the consolidation compare panel and its webview client.
import type { Change, Edge } from './comparePure';

/** What the panel remembers per dimension and hierarchy. Sources are not kept. */
export interface CompareView {
  ref: string; cmp: string[]; alias: string;
  scopeAttr: string; scopeValue: string; group: boolean; onlyDiff: boolean;
}

export type ToHost =
  | { type: 'ready' }
  | { type: 'reload' }
  | { type: 'switchHierarchy'; hier: string }
  | { type: 'alias'; alias: string }
  | { type: 'scopeAttr'; attr: string }
  | { type: 'saveView'; view: CompareView }
  | { type: 'pickImportFile' }
  | { type: 'loadHierarchy'; hier: string }
  /** The same dimension and hierarchy on another connected server; no id = ask which. */
  | { type: 'loadServer'; serverId?: string }
  | { type: 'save'; base: Edge[]; changes: Change[] }
  | { type: 'export'; kind: 'changes' | 'subtree' | 'result'; name: string; text: string };

export type ToClient =
  | { type: 'loading' }
  /** `elements`: every element name — imports are matched against it, not only against the edges.
   *  `hierarchies`: all of the dimension except Leaves, the shown one included. */
  | { type: 'edges'; dim: string; hier: string; edges: Edge[]; aliases: string[]; elements: string[]; hierarchies: string[];
      /** Leaf elements, numeric and string — the leaves of the "all leaves" reference. */
      leaves: string[]; attributes: string[]; view: CompareView }
  /** Element name → alias value; empty for no alias. */
  | { type: 'aliasValues'; alias: string; values: Record<string, string> }
  /** Element name → attribute value as text; elements without a value are left out. */
  | { type: 'scopeValues'; attr: string; values: Record<string, string> }
  /** `switchFailed`: a hierarchy switch could not load; the client stays on its hierarchy. */
  | { type: 'error'; message: string; switchFailed?: boolean }
  | { type: 'exported'; kind: 'changes' | 'subtree' | 'result'; path: string }
  | { type: 'importText'; name: string; text: string }
  /** Edges of another hierarchy of the same dimension, read-only. */
  | { type: 'hierEdges'; hier: string; edges: Edge[] }
  /** Edges of the shown hierarchy on another server, read-only. `label` names the server. */
  | { type: 'serverEdges'; serverId: string; label: string; edges: Edge[] }
  /** Save finished: `edges` is the server state afterwards. */
  | { type: 'saved'; edges: Edge[] }
  /** Save refused or failed: `edges` is the server state, the draft stays.
   *  No `edges`: the re-read after writing failed too, the server state is unknown. */
  | { type: 'saveFailed'; conflict: boolean; message: string; edges?: Edge[] }
  /** The confirmation was declined. */
  | { type: 'saveCancelled' };

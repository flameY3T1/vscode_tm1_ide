// Writes a consolidation compare draft to TM1. No vscode here: the panel does
// the confirmation and posting, this module only orders the REST calls.
import { netOps, sameEdges, type Change, type Edge } from './comparePure';
import { errMsg } from '../utils/errMsg';

/** The three edge writes `DimensionApi` offers, bound to one dimension. */
export interface EdgeWriter {
  deleteEdge(hier: string, parent: string, child: string): Promise<void>;
  setEdgeWeight(hier: string, parent: string, child: string, weight: number): Promise<void>;
  addEdges(hier: string, edges: Array<{ parent: string; child: string; weight: number }>): Promise<void>;
}

export type ApplyResult =
  | { ok: true; edges: Edge[] }
  /** The server changed since loading; nothing was written. */
  | { ok: false; conflict: true; edges: Edge[] }
  /** A write failed part way; `edges` is the server state after the failure. */
  | { ok: false; conflict: false; message: string; edges: Edge[] };

/**
 * Re-reads the edges, refuses when they differ from `base`, then writes the
 * net effect: removes first, then weights, then one add for all new edges.
 * Removing first keeps intermediate states free of cycles the end state does
 * not have. No rollback on failure — TM1 has no transaction for this, so the
 * caller gets the real state back instead.
 */
export async function applyDraft(
  api: EdgeWriter,
  readEdges: () => Promise<Edge[]>,
  hier: string,
  base: readonly Edge[],
  changes: readonly Change[],
): Promise<ApplyResult> {
  const now = await readEdges();
  if (!sameEdges(base, now)) { return { ok: false, conflict: true, edges: now }; }
  const ops = netOps(base, changes);
  try {
    for (const e of ops.remove) { await api.deleteEdge(hier, e.parent, e.child); }
    for (const e of ops.patch) { await api.setEdgeWeight(hier, e.parent, e.child, e.weight); }
    if (ops.add.length) { await api.addEdges(hier, ops.add); }
  } catch (e) {
    return { ok: false, conflict: false, message: errMsg(e), edges: await readEdges() };
  }
  return { ok: true, edges: await readEdges() };
}

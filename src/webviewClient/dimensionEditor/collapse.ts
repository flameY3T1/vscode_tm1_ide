/**
 * Pure collapse helpers for the dimension-editor tree.
 *
 * No DOM, no module state — unit-tested in `dimensionEditorCollapse.test.ts`.
 */
import type { EdgeLike } from './model';

/**
 * Direct children of `parent` that are themselves consolidations (i.e. have
 * at least one child of their own). Deleted edges are ignored.
 *
 * Used so that re-expanding a collapsed node shows only its direct children:
 * each returned name is added back to the `collapsed` set, so the subtree that
 * was open before the last collapse does not spring back into view.
 */
export function directChildConsolidations(edges: EdgeLike[], parent: string): string[] {
  const parents = new Set<string>();
  for (const e of edges) {
    if (e.marked === 'deleted') continue;
    parents.add(e.parent);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.marked === 'deleted') continue;
    if (e.parent !== parent) continue;
    if (seen.has(e.child)) continue;
    seen.add(e.child);
    if (parents.has(e.child)) out.push(e.child);
  }
  return out;
}

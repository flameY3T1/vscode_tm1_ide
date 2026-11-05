/**
 * Re-parent and draft-mutation helpers for the dimension-editor webview.
 *
 * Split out of `pure.ts` (Junk-Drawer split). No DOM, no module state.
 */

import type { EdgeLike, ReparentPlan, DraftLike } from './model';

/**
 * Decide how to re-parent `src` under `target`, given the current edges.
 * Pure — no state, no DOM. Mirrors the single-drag rules: skip self, skip if
 * `target` is a descendant of `src` (cycle), skip if a live edge already
 * exists, restore a deleted edge, otherwise add.
 */
export function planReparent(
  edges: ReadonlyArray<EdgeLike>,
  src: string,
  target: string,
): ReparentPlan {
  if (src === target) { return { action: 'skip', reason: 'self' }; }

  const descendants = new Set<string>();
  (function walk(name: string) {
    for (const e of edges) {
      if (e.marked === 'deleted') { continue; }
      if (e.parent === name && !descendants.has(e.child)) {
        descendants.add(e.child);
        walk(e.child);
      }
    }
  })(src);
  if (descendants.has(target)) { return { action: 'skip', reason: 'cycle' }; }

  const live = edges.find(e => e.parent === target && e.child === src && e.marked !== 'deleted');
  if (live) { return { action: 'skip', reason: 'exists' }; }

  const deleted = edges.find(e => e.parent === target && e.child === src && e.marked === 'deleted');
  if (deleted) { return { action: 'restore' }; }

  return { action: 'add' };
}

/**
 * Delete `name` from a draft in place: a `new` element (and its `new` edges)
 * is removed outright; otherwise the element and its live edges are marked
 * `deleted`. No-op if the element is absent. Pure (no DOM).
 */
export function deleteElementFromDraft(data: DraftLike, name: string): void {
  // Own keys only: an element named "__proto__" would otherwise write onto Object.prototype.
  if (!Object.prototype.hasOwnProperty.call(data.elements, name)) { return; }
  const el = data.elements[name];
  if (!el) { return; }
  if (el.marked === 'new') {
    delete data.elements[name];
  } else {
    el.marked = 'deleted';
  }
  for (const ed of [...data.edges]) {
    if (ed.marked === 'deleted') { continue; }
    if (ed.parent === name || ed.child === name) {
      if (ed.marked === 'new') {
        data.edges = data.edges.filter(x => x !== ed);
      } else {
        ed.marked = 'deleted';
      }
    }
  }
}

/**
 * After a partial commit the new baseline already holds some of the draft's
 * `new` elements and attribute definitions. Still marked `new`, deleting one
 * drops it from the draft outright, and the diff emits no delete — it stays on
 * TM1. Mark the persisted ones `changed` (the diff ignores the mark, so pending
 * attribute values still go out); the truly pending ones stay `new`. Pure.
 */
export function settlePersistedNew(
  data: { elements: Record<string, { marked?: string }>; attrDefs?: Array<{ name: string; marked?: string }> },
  hierSnap: { elements: ReadonlyArray<{ name: string }>; attrDefs: ReadonlyArray<{ name: string }> } | undefined,
): void {
  if (!hierSnap) { return; }
  for (const { name } of hierSnap.elements) {
    if (!Object.prototype.hasOwnProperty.call(data.elements, name)) { continue; }
    const el = data.elements[name];
    if (el && el.marked === 'new') { el.marked = 'changed'; }
  }
  const defs = new Set(hierSnap.attrDefs.map(d => d.name));
  for (const d of data.attrDefs ?? []) {
    if (d.marked === 'new' && defs.has(d.name)) { d.marked = 'changed'; }
  }
}

/**
 * Remove a single `parent`->`child` edge from a draft in place (i.e. detach the
 * element from ONE consolidation node, leaving it under its other parents). A
 * `new` edge is dropped outright; a persisted edge is marked `deleted`. The
 * `child` element itself is untouched except for a `clean`->`changed` bump so
 * the commit re-emits it. Returns `false` (no-op) when no live edge matches.
 * Pure — no DOM.
 */
export function removeEdgeFromDraft(data: DraftLike, parent: string, child: string): boolean {
  const edge = data.edges.find(
    e => e.parent === parent && e.child === child && e.marked !== 'deleted',
  );
  if (!edge) { return false; }
  if (edge.marked === 'new') {
    data.edges = data.edges.filter(e => e !== edge);
  } else {
    edge.marked = 'deleted';
  }
  const childEl = data.elements[child];
  if (childEl && childEl.marked === 'clean') { childEl.marked = 'changed'; }
  return true;
}

/** Append order for a new child under `parent` = max live sibling order + 1. */
export function nextOrder(edges: ReadonlyArray<EdgeLike>, parent: string): number {
  let max = -1;
  for (const e of edges) {
    if (e.parent === parent && e.marked !== 'deleted' && typeof e.order === 'number' && e.order > max) {
      max = e.order;
    }
  }
  return max + 1;
}

/**
 * Reassign contiguous 0-based `order` to `parent`'s live children so their
 * sequence becomes exactly `orderedChildren`. Any live child not listed is
 * appended after, preserving its relative order. Pure (mutates edges in place).
 */
export function reindexChildren(data: DraftLike, parent: string, orderedChildren: string[]): void {
  const live = data.edges.filter(e => e.parent === parent && e.marked !== 'deleted');
  const byChild = new Map(live.map(e => [e.child, e] as const));
  let i = 0;
  for (const child of orderedChildren) {
    const e = byChild.get(child);
    if (e) { e.order = i++; byChild.delete(child); }
  }
  for (const e of live) { if (byChild.has(e.child)) { e.order = i++; } }
}

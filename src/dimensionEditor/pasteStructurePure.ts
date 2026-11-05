// src/dimensionEditor/pasteStructurePure.ts
// Copying a selection within one hierarchy and pasting it into another.
// vscode-free (`pure-no-vscode`) — the webview hands in plain data.
//
// Why the structure is captured at COPY time and not only at paste time:
// when the hierarchy is switched, the editor discards the draft and loads the
// target hierarchy. At paste time the source structure is therefore no longer
// in the state — it has to travel with the clipboard.
//
// Measured against TM1 11.8 (2026-08-14, altHierProbe1.js and
// follow-up probe), what determines the design:
//   - An element that already exists in the dimension can be added to a further
//     hierarchy: `POST …/Hierarchies('ab')/Elements` → 201.
//   - The same element with a DIFFERENT type → 400 `ElementLeafTypeConflict`.
//     The type belongs to the dimension, not to the hierarchy. That is why the
//     type of the original travels along and is never re-determined.
import type { ElementType } from './model';

/** What Ctrl+C captures: the marked elements and the edges BETWEEN THEM. */
export interface ElementClipboard {
  elements: Array<{ name: string; type: ElementType }>;
  /** Only edges whose parent AND child element were both marked. */
  edges: Array<{ parent: string; child: string; weight: number }>;
}

/** Empty clipboard — initial value and result of an empty selection. */
export const EMPTY_CLIPBOARD: ElementClipboard = { elements: [], edges: [] };

/**
 * Builds the clipboard from the selection.
 *
 * `selected` are element names (the selection in the tree is occurrence-based;
 * the caller resolves it to names beforehand). Only marked elements and edges
 * between two marked elements are taken over — whatever hangs below a marked
 * element but is not itself marked stays out.
 * That is the explicit decision: "only those that are marked, not those that
 * are not visible."
 */
export function buildClipboard(
  selected: readonly string[],
  elements: ReadonlyMap<string, { name: string; type: ElementType }>,
  edges: ReadonlyArray<{ parent: string; child: string; weight: number; marked?: string }>,
): ElementClipboard {
  const wanted = new Set<string>();
  const out: ElementClipboard = { elements: [], edges: [] };
  for (const name of selected) {
    const el = elements.get(name);
    // A name without an element in the draft cannot be copied; skipping
    // silently is right, it is not a state the user produces.
    if (!el || wanted.has(name)) { continue; }
    wanted.add(name);
    out.elements.push({ name: el.name, type: el.type });
  }
  for (const e of edges) {
    if (e.marked === 'deleted') { continue; }
    if (wanted.has(e.parent) && wanted.has(e.child)) {
      out.edges.push({ parent: e.parent, child: e.child, weight: e.weight });
    }
  }
  return out;
}

/** A skipped element with the reason that is reported to the user. */
export interface PasteSkip {
  name: string;
  reason: 'typeConflict' | 'cycle' | 'alreadyChild';
}

export interface PastePlan {
  /** Elements that are newly added to the target hierarchy. */
  addElements: Array<{ name: string; type: ElementType }>;
  /** Edges that are newly created — the copied ones plus the attachment of the roots. */
  addEdges: Array<{ parent: string; child: string; weight: number }>;
  skipped: PasteSkip[];
}

/**
 * Plans the paste into the CURRENT hierarchy.
 *
 * `existingElements` are the elements of the target hierarchy (name → type),
 * `existingEdges` its edges. `target` is the clicked row under which the roots
 * of the selection are hung; `null` puts them on the top level.
 *
 * Root here means: a copied element whose parent was not copied along. Only
 * these need a target — all others hang below their co-copied parents.
 */
export function planPaste(
  clip: ElementClipboard,
  target: string | null,
  existingElements: ReadonlyMap<string, { type: ElementType }>,
  existingEdges: ReadonlyArray<{ parent: string; child: string; marked?: string }>,
): PastePlan {
  const plan: PastePlan = { addElements: [], addEdges: [], skipped: [] };
  if (clip.elements.length === 0) { return plan; }

  // 1. Add elements that do not yet exist in the target hierarchy.
  //    A type conflict is the only case TM1 rejects outright (400 Code 271)
  //    — we catch it here instead of letting it run into the commit.
  const present = new Set<string>();
  for (const el of clip.elements) {
    const existing = existingElements.get(el.name);
    if (existing) {
      if (existing.type !== el.type) {
        plan.skipped.push({ name: el.name, reason: 'typeConflict' });
        continue;
      }
      present.add(el.name);
      continue;
    }
    plan.addElements.push({ name: el.name, type: el.type });
    present.add(el.name);
  }

  // 2. Build edges: first the co-copied ones, then the roots onto the target.
  //    `have` is the edge inventory against which duplicates and cycles are
  //    checked — it grows with every planned edge, otherwise a
  //    selection could build a cycle within itself.
  const have = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  const addKnown = (parent: string, child: string): void => {
    have.add(`${parent}\u0000${child}`);
    const l = childrenOf.get(parent);
    if (l) { l.push(child); } else { childrenOf.set(parent, [child]); }
  };
  for (const e of existingEdges) {
    if (e.marked === 'deleted') { continue; }
    addKnown(e.parent, e.child);
  }

  /** Is `from` reachable from `start`? Then `start → from` would be a cycle. */
  const reaches = (start: string, from: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === start) { return true; }
      if (seen.has(cur)) { continue; }
      seen.add(cur);
      for (const c of childrenOf.get(cur) ?? []) { stack.push(c); }
    }
    return false;
  };

  const tryEdge = (parent: string, child: string, weight: number): void => {
    if (parent === child) { plan.skipped.push({ name: child, reason: 'cycle' }); return; }
    if (have.has(`${parent}\u0000${child}`)) {
      plan.skipped.push({ name: child, reason: 'alreadyChild' });
      return;
    }
    if (reaches(parent, child)) { plan.skipped.push({ name: child, reason: 'cycle' }); return; }
    plan.addEdges.push({ parent, child, weight });
    addKnown(parent, child);
  };

  const copiedChildren = new Set(clip.edges.map(e => e.child));
  for (const e of clip.edges) {
    if (!present.has(e.parent) || !present.has(e.child)) { continue; }
    tryEdge(e.parent, e.child, e.weight);
  }

  // 3. Hang the roots of the selection onto the target. Without a target they stay on the
  //    top level — no edge is needed there.
  if (target) {
    for (const el of clip.elements) {
      if (!present.has(el.name) || copiedChildren.has(el.name)) { continue; }
      tryEdge(target, el.name, 1);
    }
  }
  return plan;
}

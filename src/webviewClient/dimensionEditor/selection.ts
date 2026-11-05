/**
 * Multi-select helpers for the dimension-editor webview.
 *
 * Split out of `pure.ts` (Junk-Drawer split). No DOM, no module state.
 */

/**
 * Toggle membership of `name` in `set` (add if absent, remove if present).
 * Mutates and returns the same set.
 */
export function toggleSelection(set: Set<string>, name: string): Set<string> {
  if (set.has(name)) { set.delete(name); } else { set.add(name); }
  return set;
}

/**
 * Contiguous inclusive range over `orderedNames` between `anchor` and `target`,
 * located by their FIRST index. If either name is absent, degrades to
 * `[target]` (single selection).
 */
export function computeRange(orderedNames: string[], anchor: string, target: string): string[] {
  const ai = orderedNames.indexOf(anchor);
  const ti = orderedNames.indexOf(target);
  if (ai === -1 || ti === -1) { return [target]; }
  const lo = Math.min(ai, ti);
  const hi = Math.max(ai, ti);
  return orderedNames.slice(lo, hi + 1);
}

// ---------------------------------------------------------------------------
// Occurrence keys.
//
// A TM1 element is identified by its NAME, but the same element can hang under
// several consolidation parents, so it appears once per parent in the tree.
// Selection is keyed by *occurrence* (parent + name), not by name alone — so
// clicking one row highlights only that row, and "remove from this node" can
// target the single parent->child edge. `parent === ''`/`null` = a root/orphan
// occurrence (no parent edge).
// ---------------------------------------------------------------------------

/** Separator; TM1 element names cannot contain control chars, so NUL is safe. */
const OCC_SEP = '\x00';

/** Encode a tree occurrence: element `name` drawn under `parent` (null/'' = root). */
export function occKey(parent: string | null | undefined, name: string): string {
  return (parent ?? '') + OCC_SEP + name;
}

/** Element name of an occurrence key. */
export function occName(key: string): string {
  const i = key.indexOf(OCC_SEP);
  return i === -1 ? key : key.slice(i + 1);
}

/** Parent of an occurrence key, or null for a root/orphan occurrence. */
export function occParent(key: string): string | null {
  const i = key.indexOf(OCC_SEP);
  if (i === -1) { return null; }
  const p = key.slice(0, i);
  return p === '' ? null : p;
}

/** Unique element names across occurrence keys, first-seen order preserved. */
export function occNames(keys: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const n = occName(k);
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

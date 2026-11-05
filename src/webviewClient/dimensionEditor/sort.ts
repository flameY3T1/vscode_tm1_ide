/**
 * Element ordering helpers for the dimension-editor webview.
 *
 * Split out of `pure.ts` (Junk-Drawer split). No DOM, no module state.
 */

import type { ElementLike } from './model';

/** Sort priority: C (consolidations) first, then N (numerics), then S (strings). */
export function typeSortKey(el: { type?: string }): number {
  const map: Record<string, number> = { C: 0, N: 1, S: 2 };
  return el.type != null ? (map[el.type] ?? 3) : 3;
}

/** Compare two elements by type-rank then by name (locale-aware). */
export function compareByTypeName(a: ElementLike, b: ElementLike): number {
  const d = typeSortKey(a) - typeSortKey(b);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

/**
 * Element index order for the dimension-editor webview. No DOM, no module state.
 */

interface IndexedElement { name: string; marked?: string; index?: number }

/**
 * Move `names` next to `anchor` in the element index and renumber every live
 * element 0..n-1. Elements without an index (new, unsaved) count as last, in
 * their current order. Returns `false` when nothing changed.
 */
export function moveInIndex(
  elements: Record<string, IndexedElement>,
  names: string[],
  anchor: string,
  after: boolean,
): boolean {
  const live = Object.values(elements).filter(e => e.marked !== 'deleted')
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.index ?? Infinity) - (b.e.index ?? Infinity) || a.i - b.i)
    .map(x => x.e);
  const moving = new Set(names);
  const rest = live.filter(e => !moving.has(e.name));
  const at = rest.findIndex(e => e.name === anchor);
  if (at < 0 || moving.size === 0) { return false; }
  const moved = live.filter(e => moving.has(e.name));
  const next = [...rest.slice(0, at + (after ? 1 : 0)), ...moved, ...rest.slice(at + (after ? 1 : 0))];
  if (next.every((e, i) => e === live[i])) { return false; }
  next.forEach((e, i) => { e.index = i; });
  return true;
}

/** Pure, DOM-free helpers for the debug variables panel. Unit-tested. */

export interface DebugVariable {
  name: string;
  value: string | number | boolean;
}

/** Case-insensitive substring match on the variable NAME. Empty/whitespace query returns all. */
export function filterVarsByName(
  vars: ReadonlyArray<DebugVariable>,
  query: string,
): DebugVariable[] {
  const q = (query ?? '').trim().toLowerCase();
  if (q === '') { return vars.slice(); }
  return vars.filter(v => String(v.name).toLowerCase().includes(q));
}

/** name → String(value) snapshot for diffing across pauses. */
export function snapshotOf(vars: ReadonlyArray<DebugVariable>): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of vars) { m.set(v.name, String(v.value)); }
  return m;
}

/** Names whose String(value) differs from prev, or that are absent in prev (new). */
export function diffChangedNames(
  prev: ReadonlyMap<string, string>,
  curr: ReadonlyArray<DebugVariable>,
): Set<string> {
  const changed = new Set<string>();
  for (const v of curr) {
    const before = prev.get(v.name);
    if (before === undefined || before !== String(v.value)) { changed.add(v.name); }
  }
  return changed;
}

/**
 * Order of the list: pinned first, then those changed since the last stop,
 * then the rest — within each group in the original
 * order, so that nothing jumps between two renders.
 *
 * Pinned ones come BEFORE the changed ones, even if they have not changed:
 * whoever pins a variable wants to see it in a fixed place and not search
 * for it at every step. A pinned one that has changed
 * is still highlighted — pinning and marking are two separate
 * statements.
 */
export function sortPinnedThenChanged(
  vars: ReadonlyArray<DebugVariable>,
  pinned: ReadonlySet<string>,
  changed: ReadonlySet<string>,
): DebugVariable[] {
  const pin: DebugVariable[] = [];
  const chg: DebugVariable[] = [];
  const rest: DebugVariable[] = [];
  for (const v of vars) {
    if (pinned.has(v.name)) { pin.push(v); }
    else if (changed.has(v.name)) { chg.push(v); }
    else { rest.push(v); }
  }
  return [...pin, ...chg, ...rest];
}

/** Clamp a pixel width into [min, max]. */
export function clampWidth(px: number, min: number, max: number): number {
  if (px < min) { return min; }
  if (px > max) { return max; }
  return px;
}

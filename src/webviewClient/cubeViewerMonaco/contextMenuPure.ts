/**
 * Pure helpers for the cube-viewer context menu.
 *
 * Extracted from `contextMenu.ts` (Hebel 17 — Iter 3). No DOM, no state.
 * Inputs are explicit; outputs are plain values / Sets the caller applies.
 */

export {};

export interface AxisInfo {
  parents: Record<string, string>;
  allParents: Record<string, string[]>;
  children: Record<string, string[]>;
  /**
   * "Has children" according to the host. Must come from the host: `children` is the
   * reverse index over the TRIMMED parent map and only knows what is
   * loaded - a collapsed consolidation looks childless in it.
   */
  hasChildren: Record<string, true>;
}

export interface MatrixLike {
  rowDims?: ReadonlyArray<string>;
  colDims?: ReadonlyArray<string>;
  rowParents?: ReadonlyArray<Record<string, string>>;
  colParents?: ReadonlyArray<Record<string, string>>;
  rowAllParents?: ReadonlyArray<Record<string, string[]>>;
  colAllParents?: ReadonlyArray<Record<string, string[]>>;
  rowHasChildren?: ReadonlyArray<Record<string, true>>;
  colHasChildren?: ReadonlyArray<Record<string, true>>;
}

export interface CellFlag { c?: number; r?: number; u?: number; s?: number }

/**
 * Build the AxisInfo lookup struct for one dimension by locating it in the
 * matrix's row or col axes. Returns null when the dim is unknown.
 * Children map is derived from the single-parent `parents` map.
 */
export function buildAxisInfo(
  matrix: MatrixLike | null | undefined,
  dim: string,
  fallbackRowDims: ReadonlyArray<string>,
  fallbackColDims: ReadonlyArray<string>,
): AxisInfo | null {
  if (!matrix) { return null; }
  const rowDims = matrix.rowDims ?? fallbackRowDims;
  const colDims = matrix.colDims ?? fallbackColDims;
  let parents: Record<string, string> | null = null;
  let allParents: Record<string, string[]> = {};
  let hasChildren: Record<string, true> = {};
  let di = rowDims.indexOf(dim);
  if (di >= 0) {
    parents = (matrix.rowParents ?? [])[di] ?? {};
    allParents = (matrix.rowAllParents ?? [])[di] ?? {};
    hasChildren = (matrix.rowHasChildren ?? [])[di] ?? {};
  } else {
    di = colDims.indexOf(dim);
    if (di >= 0) {
      parents = (matrix.colParents ?? [])[di] ?? {};
      allParents = (matrix.colAllParents ?? [])[di] ?? {};
      hasChildren = (matrix.colHasChildren ?? [])[di] ?? {};
    }
  }
  if (!parents) { return null; }
  const children: Record<string, string[]> = {};
  for (const c in parents) {
    if (Object.prototype.hasOwnProperty.call(parents, c)) {
      const p = parents[c];
      (children[p] ??= []).push(c);
    }
  }
  return { parents, allParents, children, hasChildren };
}

/**
 * Union of parents across multiple elements, preserving first-seen order.
 * Prefers `allParents[el]` (multi-parent); falls back to `parents[el]`
 * single-parent map when the multi-parent list is empty (legacy view payloads).
 */
export function collectParentsUnion(elems: ReadonlyArray<string>, info: AxisInfo): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of elems) {
    const list = info.allParents[el];
    if (list && list.length) {
      for (const p of list) { if (!seen.has(p)) { seen.add(p); out.push(p); } }
    } else {
      const p = info.parents[el];
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out;
}

/**
 * Filter cells down to those eligible for "spread on consolidated".
 * Eligibility: cell flag has `c === 1` (consolidated) AND `r !== 1` (no rule)
 * AND `u !== 0` (not locked).
 */
export function eligibleCCells(
  cells: ReadonlyArray<{ ri: number; ci: number }>,
  flagMap: Record<string, CellFlag>,
): Array<{ ri: number; ci: number }> {
  return cells.filter((c) => {
    const f = flagMap[`${c.ri},${c.ci}`];
    return !!f && f.c === 1 && f.r !== 1 && f.u !== 0;
  });
}

/**
 * BFS over multi-parent ancestor maps. Returns the set of all ancestor names
 * reachable from `targets` (exclusive of targets themselves).
 * Defensive: avoids re-visits; safe on cyclic input.
 */
export function collectAncestorsBfs(
  targets: ReadonlyArray<string>,
  info: AxisInfo,
): Set<string> {
  const seen = new Set<string>();
  const queue = targets.slice();
  while (queue.length) {
    const n = queue.shift()!;
    const list = (info.allParents[n] && info.allParents[n].length)
      ? info.allParents[n]
      : (info.parents[n] ? [info.parents[n]] : []);
    for (const p of list) {
      if (!p || seen.has(p)) { continue; }
      seen.add(p);
      queue.push(p);
    }
  }
  return seen;
}

/**
 * DFS over children map. Returns set of `targets` + all descendants.
 * Defensive: cycle-safe via visited Set.
 */
export function collectDescendantsDfs(
  targets: ReadonlyArray<string>,
  info: AxisInfo,
): Set<string> {
  const out = new Set<string>();
  function walk(name: string): void {
    if (out.has(name)) { return; }
    out.add(name);
    (info.children[name] ?? []).forEach(walk);
  }
  targets.forEach(walk);
  return out;
}

/**
 * Direct-children-only collect: returns the union of children across all
 * `targets` (without the targets themselves).
 */
export function collectDirectChildren(
  targets: ReadonlyArray<string>,
  info: AxisInfo,
): Set<string> {
  const out = new Set<string>();
  for (const tgt of targets) {
    (info.children[tgt] ?? []).forEach((c) => out.add(c));
  }
  return out;
}

/**
 * The axis that "Keep only" shrinks it to: `axisOrder` filtered
 * to `targets`.
 *
 * The selection itself comes from a `Set` and thus in CLICK ORDER - passing it
 * on unexamined reordered the axis as soon as someone clicked from bottom to
 * top. But "Keep only" removes, it does not reorder. Side effect of staying
 * true to the axis: a merely shrunk axis is still contained in the loaded
 * matrix, so the webview can show it without the server.
 *
 * Names that occur several times stay several times - a consolidation may lie
 * twice on an axis, and silently letting one of the two occurrences vanish
 * would be a removal nobody asked for.
 */
export function keepOnlyNames(
  axisOrder: ReadonlyArray<string>,
  targets: ReadonlyArray<string>,
): string[] {
  const keep = new Set(targets);
  return axisOrder.filter((n) => keep.has(n));
}

/**
 * Pure helpers for the cube-viewer context menu.
 *
 * Extracted from `contextMenu.ts` (Hebel 17 — Iter 3). No DOM, no state.
 * Inputs are explicit; outputs are plain values / Sets the caller applies.
 */

import { nameMap, asNameMap } from '../../utils/nameMapPure';
import type { DimSelection } from './protocol';

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
  rowTuples?: ReadonlyArray<ReadonlyArray<string>>;
  colTuples?: ReadonlyArray<ReadonlyArray<string>>;
  rowElements?: ReadonlyArray<string>;
  colElements?: ReadonlyArray<string>;
}

export interface CellFlag { c?: number; r?: number; u?: number; s?: number }

/** One dimension's slice of the matrix axis it sits on: the row/col choice made once. */
export interface AxisSide {
  /** Position of the dimension in the axis tuples. */
  index: number;
  tuples?: ReadonlyArray<ReadonlyArray<string>>;
  /** Joined axis labels - ' / ' between the dimensions, so no element names. */
  elements?: ReadonlyArray<string>;
  parents?: Record<string, string>;
  allParents?: Record<string, string[]>;
  hasChildren?: Record<string, true>;
}

/** The axis side of `dim`; null when the dimension is on neither axis. */
export function axisOf(
  matrix: MatrixLike,
  dim: string,
  fallbackRowDims: ReadonlyArray<string>,
  fallbackColDims: ReadonlyArray<string>,
): AxisSide | null {
  const ri = (matrix.rowDims ?? fallbackRowDims).indexOf(dim);
  if (ri >= 0) {
    return { index: ri, tuples: matrix.rowTuples, elements: matrix.rowElements,
      parents: matrix.rowParents?.[ri], allParents: matrix.rowAllParents?.[ri], hasChildren: matrix.rowHasChildren?.[ri] };
  }
  const ci = (matrix.colDims ?? fallbackColDims).indexOf(dim);
  if (ci < 0) { return null; }
  return { index: ci, tuples: matrix.colTuples, elements: matrix.colElements,
    parents: matrix.colParents?.[ci], allParents: matrix.colAllParents?.[ci], hasChildren: matrix.colHasChildren?.[ci] };
}

/**
 * Distinct element names of one axis dimension, in axis order. Read per
 * dimension from the tuples - never from the joined `elements` (multi-dim
 * tuples are joined with ' / ', which TM1 rejects as an element name).
 * Null when the matrix carries no tuples for that axis.
 */
export function axisElementNames(side: AxisSide): string[] | null {
  if (!side.tuples) { return null; }
  const set = new Set<string>();
  side.tuples.forEach((t) => { if (t[side.index]) { set.add(t[side.index]); } });
  return Array.from(set);
}

/**
 * Reverse index parent -> children over BOTH parent maps: the multi-parent
 * list wins, the first-parent map is the fallback. Since the trimming `all`
 * only carries multi-parent elements and `first` all the others
 * (`axisMetaScopePure.ts`) - built from `first` alone, a child is missing
 * under every parent but its first; built from `all` alone, the map stays
 * empty in the normal case.
 */
export function buildChildMap(
  first: Record<string, string> | undefined,
  all: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const children = nameMap<string[]>();
  const edge = (c: string, p: string): void => { (children[p] ??= []).push(c); };
  if (all) {
    for (const c in all) {
      if (Object.prototype.hasOwnProperty.call(all, c)) {
        for (const p of all[c]) { edge(c, p); }
      }
    }
  }
  if (first) {
    for (const c in first) {
      if (Object.prototype.hasOwnProperty.call(first, c) && !(all?.[c]?.length)) {
        edge(c, first[c]);
      }
    }
  }
  return children;
}

/**
 * Build the AxisInfo lookup struct for one dimension by locating it in the
 * matrix's row or col axes. Returns null when the dim is unknown.
 */
export function buildAxisInfo(
  matrix: MatrixLike | null | undefined,
  dim: string,
  fallbackRowDims: ReadonlyArray<string>,
  fallbackColDims: ReadonlyArray<string>,
): AxisInfo | null {
  const side = matrix && axisOf(matrix, dim, fallbackRowDims, fallbackColDims);
  return side ? axisInfoOf(side) : null;
}

/** The lookup struct for an axis side that is already located. */
export function axisInfoOf(side: AxisSide): AxisInfo {
  // Keys are element names: no prototype (utils/nameMapPure.ts), also for maps
  // that did not pass through renderGrid.
  const parents = asNameMap(side.parents ?? nameMap<string>());
  const allParents = asNameMap(side.allParents ?? nameMap<string[]>());
  const hasChildren = asNameMap(side.hasChildren ?? nameMap<true>());
  return { parents, allParents, children: buildChildMap(parents, allParents), hasChildren };
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
 * All ancestor names reachable from `targets` over multi-parent ancestor maps
 * (exclusive of targets themselves), every ancestor before its descendants.
 * Depth-first, a name is emitted after its own parents: a breadth-first order
 * reversed put a root below its child as soon as two parent paths differed in
 * length (review 2026-11-15).
 * Defensive: avoids re-visits; safe on cyclic input.
 */
export function collectAncestorsRootFirst(
  targets: ReadonlyArray<string>,
  info: AxisInfo,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  function walk(n: string): void {
    const list = (info.allParents[n] && info.allParents[n].length)
      ? info.allParents[n]
      : (info.parents[n] ? [info.parents[n]] : []);
    for (const p of list) {
      if (!p || seen.has(p)) { continue; }
      seen.add(p);
      walk(p);
      out.push(p);
    }
  }
  targets.forEach(walk);
  return out;
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

/**
 * "Show parent(s)": the parents, in the given order, directly above the first
 * clicked element; the rest of the axis stays. Before the axis when no target
 * is on it.
 */
export function insertAboveFirstTarget(
  axis: ReadonlyArray<string>,
  targets: ReadonlyArray<string>,
  parents: ReadonlyArray<string>,
): string[] {
  const targetSet = new Set(targets);
  const at = Math.max(0, axis.findIndex((e) => targetSet.has(e)));
  return Array.from(new Set([...axis.slice(0, at), ...parents, ...axis.slice(at)]));
}

/**
 * The names on the axis as the user sees them. An element selection wins over
 * the matrix: "Keep only" and a collapse narrow locally without reloading, so
 * the matrix still holds the rows they hide (click test by flameY3T1,
 * 2026-11-13: keep one year, show parent - every year came back). The
 * selection also keeps multiple occurrences.
 */
export function shownAxisNames(
  selection: DimSelection | undefined,
  fromMatrix: () => string[],
): string[] {
  return selection?.kind === 'elements' ? selection.names.slice() : fromMatrix();
}

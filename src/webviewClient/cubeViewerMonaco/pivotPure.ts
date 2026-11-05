/**
 * Pure axis-pivot helpers (no DOM / vscode). Consumed by axis.ts.
 */

import { dimOfKey, hierKey } from '../../utils/hierKeyPure';

export type Zone = 'rows' | 'cols' | 'titles';

export interface Axes {
  rowDims: string[];
  colDims: string[];
  titleDims: string[];
}

/**
 * Classify whether the last matrix's axis layout can be trusted for `dim`.
 * After a pivot, `state.rowDims/colDims` are ahead of `lastMatrix` — a dim can
 * be on a state axis while the matrix still reflects the pre-pivot layout. In
 * that 'movedFresh' case the caller must NOT read tuples by the stale matrix
 * index (which would miss the dim and fall back to its single title element);
 * it should expand the dim to its full subset instead.
 */
export function resolveMovedDimElements(
  dim: string,
  ctx: { stateRowDims: string[]; stateColDims: string[]; matrixRowDims?: string[]; matrixColDims?: string[] },
): 'onAxisInMatrix' | 'movedFresh' | 'notOnAxis' {
  const onStateAxis = ctx.stateRowDims.includes(dim) || ctx.stateColDims.includes(dim);
  if (!onStateAxis) { return 'notOnAxis'; }
  const inMatrix = (ctx.matrixRowDims ?? []).includes(dim) || (ctx.matrixColDims ?? []).includes(dim);
  return inMatrix ? 'onAxisInMatrix' : 'movedFresh';
}

/** Consume a pending-refresh mark for `dim`: returns true and removes it if
 *  present, false otherwise. Lets the elementsData handler re-refresh exactly
 *  once for a freshly-moved dim whose element list had to be fetched. */
export function consumePendingRefresh(pending: Set<string>, dim: string): boolean {
  if (!pending.has(dim)) { return false; }
  pending.delete(dim);
  return true;
}

/** Index of `beforeDim` within `zoneDims` (the dim to insert in front of), or
 *  `zoneDims.length` (append) when `beforeDim` is null / not found. `zoneDims`
 *  must already have the dragged dim removed. */
export function computeInsertIndex(zoneDims: string[], beforeDim: string | null): number {
  if (beforeDim === null) { return zoneDims.length; }
  const i = zoneDims.indexOf(beforeDim);
  return i < 0 ? zoneDims.length : i;
}

/** Move `dim` into `target` at `index` (null = append), returning fresh axis
 *  arrays and a `changed` flag (false on an identical-layout drop). `index` is
 *  interpreted against the target array AFTER `dim` has been removed. */
export function computeZoneMoveAt(dim: string, target: Zone, index: number | null, axes: Axes): { axes: Axes; changed: boolean } {
  const orig = target === 'rows' ? axes.rowDims : target === 'cols' ? axes.colDims : axes.titleDims;
  const rowDims = axes.rowDims.filter((d) => d !== dim);
  const colDims = axes.colDims.filter((d) => d !== dim);
  const titleDims = axes.titleDims.filter((d) => d !== dim);
  const arr = target === 'rows' ? rowDims : target === 'cols' ? colDims : titleDims;
  const at = index === null ? arr.length : Math.max(0, Math.min(index, arr.length));
  arr.splice(at, 0, dim);
  const next = { rowDims, colDims, titleDims };
  const nextTarget = target === 'rows' ? next.rowDims : target === 'cols' ? next.colDims : next.titleDims;
  const changed = JSON.stringify(orig) !== JSON.stringify(nextTarget) || !orig.includes(dim);
  return { axes: next, changed };
}

/**
 * Swap the row and column axes wholesale, title dims untouched.
 *
 * Order WITHIN each axis is kept: `rows [Jahr, Version] / cols [Monat]` becomes
 * `rows [Monat] / cols [Jahr, Version]`. Swapping is not reversing — the nesting
 * order of a multi-dim axis is the user's arrangement and survives the move.
 *
 * `changed` is false when the swap would produce the identical layout (both
 * axes empty, or — not reachable with real dims — the same dims in the same
 * order); the caller uses it to avoid leaving saved-view mode for a no-op.
 */
export function computeAxisSwap(axes: Axes): { axes: Axes; changed: boolean } {
  const next: Axes = {
    rowDims: [...axes.colDims],
    colDims: [...axes.rowDims],
    titleDims: [...axes.titleDims],
  };
  const changed = JSON.stringify(axes.rowDims) !== JSON.stringify(axes.colDims);
  return { axes: next, changed };
}

/**
 * Title zone keys for a layout (keys are `dim` or `dim:hier`, hierKeyPure).
 * Keeps the previous title keys in order unless that very hierarchy is now on
 * an axis — a title on ANOTHER hierarchy of an axis dimension is a valid slicer
 * (`[D].[D]` on rows, `WHERE ([D].[Alt].[Grp1])` filters them, measured 11.8,
 * 2026-09-28). A dimension no key names at all gets its default hierarchy
 * (`defaults` lists those not named like their dimension).
 */
export function titleKeysFor(
  cubeDims: string[], rowDims: string[], colDims: string[], prevTitles: string[],
  defaults: Record<string, string> = {},
): string[] {
  const onAxis = new Set([...rowDims, ...colDims]);
  const kept = [...new Set(prevTitles)].filter((k) => cubeDims.includes(dimOfKey(k)) && !onAxis.has(k));
  const named = new Set([...onAxis, ...kept].map(dimOfKey));
  return [...kept, ...cubeDims.filter((d) => !named.has(d)).map((d) => hierKey(d, defaults[d] ?? d))];
}

/** Put `next` where `key` is, in whichever zone holds it. */
export function replaceKey(axes: Axes, key: string, next: string): Axes {
  const swap = (arr: string[]) => arr.map((k) => (k === key ? next : k));
  return { rowDims: swap(axes.rowDims), colDims: swap(axes.colDims), titleDims: swap(axes.titleDims) };
}

/** Drop `key` from whichever zone holds it. */
export function removeKey(axes: Axes, key: string): Axes {
  const drop = (arr: string[]) => arr.filter((k) => k !== key);
  return { rowDims: drop(axes.rowDims), colDims: drop(axes.colDims), titleDims: drop(axes.titleDims) };
}

/** Insert `added` right after `key` on the same row/column axis. */
export function addKeyAfter(axes: Axes, key: string, added: string): Axes {
  const ins = (arr: string[]) => {
    const i = arr.indexOf(key);
    return i < 0 ? arr : [...arr.slice(0, i + 1), added, ...arr.slice(i + 1)];
  };
  return { rowDims: ins(axes.rowDims), colDims: ins(axes.colDims), titleDims: axes.titleDims };
}

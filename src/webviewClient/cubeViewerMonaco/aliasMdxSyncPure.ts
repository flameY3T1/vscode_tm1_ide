/**
 * Pure alias→MDX synchronisation for the cube viewer.
 *
 * A native view stores the display alias in its axis subset (`Subset.Alias`),
 * so picking one there survives a save/reopen on its own. An MDX view has no
 * axis subsets — the only place the choice can live is the MDX text itself, as
 * a per-axis `DIMENSION PROPERTIES` clause (see `src/mdx/dimensionPropertiesPure.ts`).
 *
 * This module owns the decision *what* the new MDX text is; writing it into the
 * Monaco model stays in the caller (`contextMenu.ts` / `mdxView.ts`), because a
 * pure module must not touch DOM or Monaco.
 *
 * No `vscode` import — `src/webviewClient/**` is barred from it (depcruise).
 */

import { setDimensionProperty } from '../../mdx/dimensionPropertiesPure';
import { splitHierKey } from '../../utils/hierKeyPure';

/** Cube-viewer axis convention: `ON 0` = columns, `ON 1` = rows. */
export const COLS_AXIS_INDEX = 0;
export const ROWS_AXIS_INDEX = 1;

export interface AliasMdxSyncInput {
  /** The MDX text currently in effect (editor content / `state.lastInlineMdx`). */
  mdx: string | null;
  /** Only MDX views carry their alias in the text; native views use `Subset.Alias`. */
  isMdxView: boolean;
  /** Viewer key (`dim` or `dim:hier`) whose alias was picked in the context menu. */
  dim: string;
  /** The chosen alias attribute, or `null` when the user picked "no alias". */
  alias: string | null;
  rowDims: readonly string[];
  colDims: readonly string[];
}

/** TM1 object names are case-insensitive. */
function _sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Axis ordinal of `dim`, or `null` when it sits on neither axis (a title/context
 * dimension). Columns are checked first — a dimension can only be on one of the
 * two axes, and `ON 0` is the columns axis by the viewer's own convention.
 */
export function axisIndexForDim(
  dim: string,
  rowDims: readonly string[],
  colDims: readonly string[],
): number | null {
  if (colDims.some((d) => _sameName(d, dim))) { return COLS_AXIS_INDEX; }
  if (rowDims.some((d) => _sameName(d, dim))) { return ROWS_AXIS_INDEX; }
  return null;
}

/**
 * The MDX text after applying the alias pick, or `null` when there is nothing to
 * write — not an MDX view, no MDX text, the dimension is not on an axis, or the
 * clause already says exactly this. `null` must stay a no-op at the call site:
 * an edit that changes nothing would still push an empty step onto the user's
 * Monaco undo stack.
 */
export function syncAliasIntoMdx(input: AliasMdxSyncInput): string | null {
  const { mdx, isMdxView, dim, alias, rowDims, colDims } = input;
  if (!isMdxView) { return null; }
  if (!mdx || !mdx.trim()) { return null; }
  if (!dim) { return null; }

  const axisIndex = axisIndexForDim(dim, rowDims, colDims);
  if (axisIndex === null) { return null; }

  const { dim: d, hier } = splitHierKey(dim);
  const next = setDimensionProperty(mdx, d, hier, alias || null, axisIndex);
  return next === mdx ? null : next;
}

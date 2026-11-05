// src/webviewClient/cubeViewerMonaco/mdxBuild.ts
//
// Builds an MDX expression from the CURRENT axis configuration.
//
// Until 2026-08-04 this lived in `mdxView.ts` and moved here: a pure move,
// no behaviour change. Reason: the save dialog (`viewSave.ts`) now needs the
// builder too, in order to store a non-native view as an MDX view.
// `mdxView.ts` in turn imports `openViewSaveForMdx` from `viewSave.ts`, so a
// direct import would have been a cycle (promptly caught by
// `depcruise#no-circular`). Both sides now depend on this leaf module.
//
// The member-reference/set/CROSSJOIN/SELECT building blocks come from
// `mdxParts.ts` since B1 (2026-08-19); they used to exist here, in
// `mdxPivotPure.ts` and in `mdxSlicerPure.ts` as three copies of the same kit.

import { splitHierKey } from '../../utils/hierKeyPure';
import { altHiersOf, state } from './state';
import { getRefs, isToggleOn } from './dom';
import { collapseMemberSet, memberRef, dimSet, crossjoinAll, selectStatement } from './mdxParts';
import { mapAxisFactorForDim } from '../../mdx/axisFactorsPure';
import { buildAxisSetMdx } from '../../cubeViewer/axisMdxPure';
import { setDimensionProperty } from '../../mdx/dimensionPropertiesPure';
import { axisIndexForDim } from './aliasMdxSyncPure';

/**
 * The set of ONE dimension as finished MDX, or `null` for "no selection".
 *
 * Returns the expression instead of names: a selection of kind `expression`
 * (from the Dimension Browser, when it was collapsed/sorted/filtered there)
 * can NOT be expressed as a list of names, which is exactly its purpose.
 */
function _dimSetFromSel(dim: string): string | null {
  const sel = state.dimSelections[dim];
  // An empty name list counts as "no selection" here: the axis then keeps the
  // tuples of the previous view. "All" is NOT that - it becomes TM1SUBSETALL.
  if (!sel || (sel.kind === 'elements' && sel.names.length === 0)) return null;
  // Same set expression the host uses for its custom-axis MDX (review B2).
  return buildAxisSetMdx(dim, sel);
}

/**
 * Build axis set EXACTLY from matrix tuples returned by the server.
 * Avoids blind CROSSJOIN of per-dim unique elements (which over-generates tuples
 * that NativeView's explicit subset never included → NON EMPTY then surfaces
 * cells the view definition meant to exclude).
 *
 * Falls back to CROSSJOIN of per-dim sets when matrix lacks tuples OR when
 * the user has set explicit dimSelections (drill from dim-browser).
 */
function _buildAxisExpr(axis: 'row' | 'col'): string {
  const m = state.lastMatrix;
  const dims = axis === 'row' ? (m?.rowDims ?? state.rowDims) : (m?.colDims ?? state.colDims);
  if (dims.length === 0) return '{}';

  const hasAnySel = dims.some((d) => _dimSetFromSel(d) !== null);
  const tuples = axis === 'row' ? m?.rowTuples : m?.colTuples;

  // Preferred: exact tuples from the matrix (NativeView's actual subset).
  if (!hasAnySel && tuples && tuples.length > 0) {
    const tupleRefs = tuples.map((t) => {
      if (dims.length === 1) {
        return memberRef(dims[0], t[0] ?? '');
      }
      const parts = dims.map((d, i) => memberRef(d, t[i] ?? ''));
      return `(${parts.join(', ')})`;
    });
    return `{ ${tupleRefs.join(', ')} }`;
  }

  // Fallback: per-dim sets joined via CROSSJOIN.
  const perDim = dims.map((d) => {
    const sel = _dimSetFromSel(d);
    if (sel) return sel;
    if (tuples && tuples.length > 0) {
      const idx = dims.indexOf(d);
      const seen = new Set<string>();
      const names: string[] = [];
      tuples.forEach((t) => {
        const v = t[idx];
        if (v && !seen.has(v)) { seen.add(v); names.push(v); }
      });
      return dimSet(d, names);
    }
    const flat = axis === 'row' ? (m?.rowElements ?? []) : (m?.colElements ?? []);
    const idx = dims.indexOf(d);
    return dimSet(d, idx === 0 ? Array.from(new Set(flat)) : []);
  });
  return crossjoinAll(perDim);
}

export function buildCurrentMdx(): string {
  const cube = state.cubeName || '';
  const refs = getRefs();
  const suppRows = isToggleOn(refs.chkSuppRows);
  const suppCols = isToggleOn(refs.chkSuppCols);

  const rowSet = _buildAxisExpr('row');
  const colSet = _buildAxisExpr('col');

  const titleAssignments = state.titleAssignments || {};
  const titleMembers: string[] = [];
  state.titleDims.forEach((d) => {
    const v = titleAssignments[d];
    if (v) titleMembers.push(memberRef(d, v));
  });

  const base = selectStatement({
    cube,
    rowSet,
    colSet,
    titleMembers,
    suppressRows: suppRows,
    suppressCols: suppCols,
  });

  // A native view keeps its display alias on `Subset.Alias`; an MDX view has no
  // axis subsets, so the only surviving carrier is a `DIMENSION PROPERTIES`
  // clause in the text itself. Without this, saving a native/fresh axis as an
  // MDX view (viewSave.ts path 3) silently dropped every alias pick — the same
  // choice already applies fine once the view IS MDX, via `syncAliasIntoMdx`,
  // which this reuses (`setDimensionProperty`) so both write paths agree on shape.
  return Object.entries(state.dimAliases || {}).reduce((mdx, [dim, alias]) => {
    if (!alias) return mdx;
    const axisIndex = axisIndexForDim(dim, state.rowDims, state.colDims);
    if (axisIndex === null) return mdx;
    const { dim: d, hier } = splitHierKey(dim);
    return setDimensionProperty(mdx, d, hier, alias, axisIndex);
  }, base);
}

/**
 * The EFFECTIVE MDX of an open MDX view: the one place that hands it out.
 *
 * Two paths narrow the display without asking the server: "Keep only" and
 * the like (`contextMenu#_postDrillFilter`) and collapsing something that is
 * already loaded (`grid.ts`, `localToggle`). Both deliberately skip the
 * server round trip, and precisely because of that the trace that such a
 * round trip would otherwise leave was missing: `doRefresh` rewrites
 * `lastInlineMdx`, the shortcuts did not. Result (bug report 2026-08-20): the
 * grid showed only "Result (EBIT)", while the MDX window and "Save as view"
 * still carried the untrimmed axis, and saved it that way.
 *
 * Instead of writing the MDX out again on every click (an axis may have
 * 10,000 rows), the shortcuts only set `_inlineMdxStale`; it is built here,
 * at the first reader.
 */
export function effectiveInlineMdx(): string | null {
  if (!state.isMdxView) { return null; }
  if (state._inlineMdxStale) {
    state.lastInlineMdx = buildCurrentMdx();
    state._inlineMdxStale = false;
  }
  const base = state.lastInlineMdx ?? state.originalMdx;
  return base ? withDisplayCollapse(base) : base;
}

/**
 * Lay the DISPLAY collapse state over an existing expression.
 *
 * A collapse without a user selection ends up in the fallback of `grid.ts`
 * and only writes `state.collapsed`: pure display state that nobody
 * noticed until now (click test 2026-08-23).
 *
 * Derived instead of carried forward, for two reasons:
 *  - `buildCurrentMdx` is NOT suitable here. It rebuilds the axis from the
 *    matrix tuples and thereby discards the existing expression: the first
 *    attempt (`10196166`, reverted in `063fab53`) boiled
 *    `DRILLDOWNMEMBER`/`TM1FILTERBYLEVEL` down to a flat tuple list, lost an
 *    axis dimension and wrote display names (alias) instead of element names.
 *  - Expanding needs no unwinding: once the entry drops out of
 *    `state.collapsed`, the shell is no longer produced on the next read.
 *    `lastInlineMdx` therefore deliberately stays free of collapse state.
 *
 * It is expressed with `collapseMemberSet` (`EXCEPT`/`DESCENDANTS`), NOT with
 * `DRILLUPMEMBER`: that only works on a tree run and is a silent no-op on the
 * list of a saved MDX view, measured live on `Cube A/Default` (2026-08-23);
 * the reasoning and numbers are at `mdxParts#collapseMemberSet`. The server
 * path (`grid.ts`, branch `kind === 'expression'`) keeps writing
 * `DRILLUPMEMBER`; there the base is always a tree run, and there it applies
 * per OCCURRENCE.
 *
 * If the factor of a dimension cannot be determined unambiguously (it appears
 * only in the `WHERE`, or twice on one axis), the expression is left as it is:
 * better without collapse state than with an invented axis.
 */
export function withDisplayCollapse(mdx: string): string {
  let out = mdx;
  for (const dim of Object.keys(state.collapsed)) {
    for (const elem of Object.keys(state.collapsed[dim] || {})) {
      const next = mapAxisFactorForDim(out, dim, (factor) => collapseMemberSet(factor, dim, elem), altHiersOf(dim));
      if (next) { out = next; }
    }
  }
  return out;
}

/**
 * Set `lastInlineMdx` AND clear the flag: every path that redetermines the
 * MDX as a whole goes through here. Two writers with only one flag reset
 * would be exactly the silent half that caused this bug.
 */
export function setInlineMdx(mdx: string | null): void {
  state.lastInlineMdx = mdx;
  state._inlineMdxStale = false;
}

/** The display was narrowed locally, so the written-out MDX is now lagging behind. */
export function markInlineMdxStale(): void {
  if (state.isMdxView) { state._inlineMdxStale = true; }
}

/**
 * Header-label helpers for the cube grid: alias display names and the
 * collapse triangle (`.cell-toggle`) drawn in row labels and column headers.
 */

import { state } from './state';
import { axisBaseFromTuples, computeBlockOrdinals, isCollapsedByDisplay } from './gridPure';
import { axisTuples, type GridCtx } from './gridAxes';

/**
 * Display label for a member: when an alias is active for `dim` and a value is
 * cached for `name`, show the alias value; otherwise the raw element name.
 * Applied to visible header text ONLY — dataset.elemName + toggle logic keep
 * the real element name so drill/filter/save stay correct.
 */
export function _dispElem(dim: string, name: string): string {
  const alias = state.dimAliases[dim];
  if (!alias || !name) { return name; }
  const m = state.aliasMaps[dim];
  const v = m && m[name];
  return (v != null && v !== '') ? v : name;
}

export type ToggleHtml = (axis: 'row' | 'col', di: number, elem: string, idx: number) => string;

/** Builds the per-render triangle renderer. Its lazy caches live as long as
 *  the returned function, i.e. one `renderGrid` call (including the body
 *  slices drawn later while scrolling). */
export function makeToggleHtml(ctx: GridCtx, _structRowIdx: number[], _structColIdx: number[]): ToggleHtml {
  const { rowAxisDims, colAxisDims, rowHasChildren, colHasChildren, rowParents, colParents } = ctx;

  // Block ordinal per axis position, computed lazily per (axis, dim) because
  // only the server-filter branch below needs it. A member may sit on an axis
  // more than once since the 2026-08-01 rework, so a toggle must say WHICH
  // occurrence it belongs to — resolving it by name would always hit the first.
  const _rowOcc: (number[] | undefined)[] = [];
  const _colOcc: (number[] | undefined)[] = [];
  function _blockOcc(axis: 'row' | 'col', di: number, idx: number): number {
    const cache = axis === 'row' ? _rowOcc : _colOcc;
    let arr = cache[di];
    if (!arr) {
      const tuples = axisTuples(ctx, axis);
      arr = computeBlockOrdinals(tuples, di);
      cache[di] = arr;
    }
    return arr[idx] ?? 0;
  }

  // The DISPLAYED name sequence of an axis dimension, built from the
  // structurally visible rows (`_structRowIdx`/`_structColIdx`: everything that
  // collapse state, focus and selection leave standing — but BEFORE empty-row
  // suppression, because the triangle answers the structure, not the data
  // situation). Lazy per (axis, dim), because only rows with a collapse
  // triangle ask for it.
  const _rowSeq: (string[] | null | undefined)[] = [];
  const _colSeq: (string[] | null | undefined)[] = [];
  const _rowVisOrd: (Map<number, number> | undefined)[] = [];
  const _colVisOrd: (Map<number, number> | undefined)[] = [];
  function _visTuples(axis: 'row' | 'col'): string[][] {
    const tuples = axisTuples(ctx, axis);
    const idxs = axis === 'row' ? _structRowIdx : _structColIdx;
    return idxs.map((i) => tuples[i] ?? []);
  }
  function _dispSeq(axis: 'row' | 'col', di: number): string[] | null {
    const cache = axis === 'row' ? _rowSeq : _colSeq;
    if (cache[di] !== undefined) { return cache[di] ?? null; }
    const seq = axisBaseFromTuples(_visTuples(axis), di);
    cache[di] = seq;
    return seq;
  }
  // The block ordinal WITHIN the displayed rows. `_blockOcc` counts over the
  // whole matrix and remains the address for `sel.names` (the filter list also
  // knows hidden things); for the display sequence, what is actually standing
  // there has to be counted along — otherwise an ordinal addresses nothing as
  // soon as an earlier occurrence lies under a collapsed ancestor.
  function _visOcc(axis: 'row' | 'col', di: number, idx: number): number {
    const cache = axis === 'row' ? _rowVisOrd : _colVisOrd;
    let map = cache[di];
    if (!map) {
      const idxs = axis === 'row' ? _structRowIdx : _structColIdx;
      const ords = computeBlockOrdinals(_visTuples(axis), di);
      map = new Map<number, number>();
      idxs.forEach((full, k) => map!.set(full, ords[k] ?? 0));
      cache[di] = map;
    }
    return map.get(idx) ?? -1;
  }

  function _toggleHtml(axis: 'row' | 'col', di: number, elem: string, idx: number): string {
    const dim = axis === 'row' ? rowAxisDims[di] : colAxisDims[di];
    const has = axis === 'row' ? rowHasChildren[di] : colHasChildren[di];
    // Own keys only: a leaf named "constructor" would otherwise get a triangle.
    if (!has || !Object.prototype.hasOwnProperty.call(has, elem)) { return ''; }
    // ONE rule for all selection kinds: collapsed ⇔ no direct child stands
    // under this occurrence. Previously there were three answers (visible
    // children for `localFocus`, filter list for `kind:'elements'`, marker
    // otherwise) — and the marker lied as soon as the axis travels as an
    // expression. Reasoning in `gridPure#isCollapsedByDisplay`.
    const pmap = axis === 'row' ? rowParents[di] : colParents[di];
    const kids: string[] = [];
    if (pmap) {
      for (const c in pmap) {
        if (Object.prototype.hasOwnProperty.call(pmap, c) && pmap[c] === elem) { kids.push(c); }
      }
    }
    const seq = _dispSeq(axis, di);
    const isCollapsed = seq
      ? isCollapsedByDisplay(seq, elem, kids, _visOcc(axis, di, idx))
      // An axis that cannot be explained as a name sequence (contradictory
      // order across the blocks): answer non-positionally instead of guessing.
      : !kids.some((c) => _visTuples(axis).some((t) => t[di] === c));
    const glyph = isCollapsed ? '▸' : '▾';
    // `data-occ` still carries the matrix ordinal — the filter path uses it to
    // address `sel.names`. `data-coll` carries the answer itself, so that the
    // click handler takes the same direction that the triangle shows.
    const occ = _blockOcc(axis, di, idx);
    const occAttr = occ >= 0 ? ` data-occ="${occ}"` : '';
    const collAttr = ` data-coll="${isCollapsed ? '1' : '0'}"`;
    return `<span class="cell-toggle" data-axis="${axis}" data-dim="${dim.replace(/"/g, '&quot;')}" data-elem="${String(elem).replace(/"/g, '&quot;')}"${occAttr}${collAttr}>${glyph}</span>`;
  }
  return _toggleHtml;
}

/**
 * Axis chips, title-zone selectors, drag & drop, moveDimToZone.
 *
 * The three axis containers (rows / cols / titles) are populated with chip
 * elements built here. Drag-source is any element carrying `data-draggable-dim`,
 * drop-target is any of the three zones; dropping calls `moveDimToZone`.
 */

import { altHiersOf, state } from './state';
import { effectiveInlineMdx, setInlineMdx } from './mdxBuild';
import { getRefs, isToggleOn } from './dom';
import { vscode } from './vscodeApi';
import { getL10n } from '../_shared/l10n';
import { computeZoneMoveAt, computeInsertIndex, computeAxisSwap, resolveMovedDimElements, replaceKey, addKeyAfter, removeKey, type Axes, type Zone } from './pivotPure';
import { dimOfKey, hierKey, splitHierKey } from '../../utils/hierKeyPure';
import { computeDropIndex, resolveDropPlacement } from './dropIndicatorPure';
import { pivotMatrixLocal } from './pivotMatrixPure';
import { buildPivotedMdx } from './mdxPivotPure';
import { axisBaseNamesFromMatrix } from './gridPure';
import { renderGrid } from './grid';
import { _dispElem } from './gridLabels';
import { requestRefresh } from './refreshBridge';
import { attachTitleCombo, closeTitleCombo } from '../_shared/filterCombo';
import { axisFactorForDim } from '../../mdx/axisFactorsPure';
import { clearSelection } from './selection';

const L = getL10n();

/** Sort a list of element names in hierarchical (parent-first DFS) order using
 *  the matrix's parent map for this dim. Names not in any parent map fall
 *  back to their original position. */
function _hierOrder(dim: string, names: string[]): string[] {
  const m = state.lastMatrix;
  if (!m || names.length <= 1) return names;
  const rowDims = m.rowDims ?? state.rowDims;
  const colDims = m.colDims ?? state.colDims;
  let pmap: Record<string, string> | undefined;
  const ri = rowDims.indexOf(dim);
  if (ri >= 0) pmap = (m.rowParents ?? [])[ri];
  else {
    const ci = colDims.indexOf(dim);
    if (ci >= 0) pmap = (m.colParents ?? [])[ci];
  }
  if (!pmap) return names;
  const want = new Set(names);
  const childMap: Record<string, string[]> = {};
  for (const c in pmap) {
    if (Object.prototype.hasOwnProperty.call(pmap, c)) {
      (childMap[pmap[c]] ??= []).push(c);
    }
  }
  // Find roots within `names`: an item is a root if its parent isn't in want.
  // (Lifts intermediate consolidations to root when their actual parent
  // wasn't selected, so they appear at top of their visible subtree.)
  const ordered: string[] = [];
  const seen = new Set<string>();
  function dfs(n: string): void {
    if (!want.has(n) || seen.has(n)) return;
    seen.add(n); ordered.push(n);
    (childMap[n] ?? []).forEach(dfs);
  }
  names.forEach((n) => {
    const p = pmap![n];
    if (!p || !want.has(p)) dfs(n);
  });
  // Anything still missing (cycle / orphans) appended in original order.
  names.forEach((n) => { if (!seen.has(n)) { seen.add(n); ordered.push(n); } });
  return ordered;
}

/** Strict-reduction filter: build the (filtered) tree-options for a `<select>`. */
function _fillSelect(
  sel: HTMLSelectElement,
  items: Array<string | { name: string; depth: number }> | undefined,
  selectedValue: string | undefined,
  selection: import('./state').DimSelection | undefined,
): void {
  const prev = selectedValue !== undefined ? selectedValue : sel.value;
  const dim = sel.dataset.dim ?? '';
  sel.innerHTML = '';

  const tree = (items ?? []).map((it) => typeof it === 'string' ? { name: it, depth: 0 } : it);

  let filtered = tree;
  if (selection && selection.kind === 'elements' && Array.isArray(selection.names)) {
    const keep = new Set(selection.names);
    filtered = tree.filter((it) => keep.has(it.name));
  } else if (selection && selection.kind === 'consolidation' && selection.name) {
    const idx = tree.findIndex((it) => it.name === selection.name);
    if (idx >= 0) {
      const root = tree[idx];
      const end = tree.findIndex((it, i) => i > idx && it.depth <= root.depth);
      filtered = tree.slice(idx, end === -1 ? tree.length : end);
    }
  }

  const minDepth = filtered.reduce((m, it) => Math.min(m, it.depth), Number.POSITIVE_INFINITY);
  const shift = isFinite(minDepth) ? minDepth : 0;

  const names: string[] = [];
  filtered.forEach((it) => {
    const opt = document.createElement('option');
    opt.value = it.name;
    const pad = '  '.repeat(Math.max(0, it.depth - shift));
    // Label carries the active alias like the grid headers; value stays the
    // element name, so selection, MDX and save keep working on real names.
    opt.textContent = pad + (dim ? _dispElem(dim, it.name) : it.name);
    sel.appendChild(opt);
    names.push(it.name);
  });
  if (prev && names.indexOf(prev) >= 0) { sel.value = prev; }
  sel.disabled = filtered.length === 0;
}

export { _fillSelect as fillSelect };

/**
 * Derive the currently visible element names for a dimension from state.lastMatrix.
 * Row dim → unique values from rowTuples[*][di]; col dim → analogous; title dim →
 * the single titleAssignment. Passed to the DimBrowser embed as initialSelection,
 * so that the Selected pane shows the view subset right away (PAfE pattern).
 */
export function currentDimElements(dim: string): string[] { return _currentDimElements(dim); }

/**
 * The current set expression of a dimension, WITH a reason when nothing comes out.
 *
 * The reason travels all the way to the composition diagnostics of the Dimension Browser
 * (Ctrl+Alt+K). Without it, a fallback to the name list cannot be told apart
 * from "not even tried" — that is exactly what the first attempt
 * (2026-08-20) ran into: the display stayed identical character for character, and that said
 * nothing about WHERE the chain broke off.
 */
export function currentDimExpressionInfo(dim: string): { expr: string | null; note: string } {
  // The EFFECTIVE MDX, not the base: the shortcuts that save a
  // server round ("Keep only", collapsing what is already loaded)
  // are not in `lastInlineMdx` — they are only resolved on reading
  // (`mdxBuild#effectiveInlineMdx`). Reading directly here sends the state
  // BEFORE the last narrowing into the Dimension Browser (click test 2026-08-23).
  // The fallback carries the non-MDX case, where `effectiveInlineMdx` returns `null`.
  const mdx = effectiveInlineMdx() || state.lastInlineMdx || state.originalMdx || '';
  if (!mdx) {
    return { expr: null, note: `kein wirksames MDX (isMdxView=${!!state.isMdxView})` };
  }
  const expr = axisFactorForDim(mdx, dim, altHiersOf(dim));
  if (expr) { return { expr, note: '' }; }
  return { expr: null, note: `kein eindeutiger Faktor fuer '${dim}' in ${mdx.length} Zeichen MDX: ${mdx.slice(0, 160)}` };
}

/**
 * Subset baseline for ALL row+col dims from state.lastMatrix. Sent along with
 * refreshData/saveView, so that the extension on the temp-view path also keeps
 * the view subsets for unfiltered dims (otherwise they fall back to
 * "all elements" → other dims lose their subset definition).
 */
export function currentDimSubsetsAll(): Record<string, string[]> {
  if (!state.lastMatrix) return { ...state.restoredDimSubsets };
  const out: Record<string, string[]> = {};
  // Use the CURRENT axis assignment (state.rowDims/colDims), not lastMatrix's —
  // after a pivot the freshly-moved dim is in state but not yet in lastMatrix.
  // _currentDimElements falls back to the dim's title element, so the single
  // selected element travels onto the new axis instead of being dropped (→
  // server would otherwise refetch ALL elements for it).
  [...state.rowDims, ...state.colDims].forEach((d) => { out[d] = _currentDimElements(d); });
  return out;
}

function _currentDimElements(dim: string): string[] {
  // If user explicitly multi-selected header elements on this dim (Ctrl/Shift
  // click), use those — opening the dim browser then pre-selects exactly
  // what the user marked, not the full view subset.
  const hs = state.headerSelection?.[dim];
  if (hs && hs.size > 0) return _hierOrder(dim, Array.from(hs));

  // Client-side Keep-Only / Local-Focus narrowed visibility on this dim →
  // open dim browser with that narrowed set as the active selection.
  if (state.localFocus && state.localFocus.dim === dim && state.localFocus.visible.size > 0) {
    return _hierOrder(dim, Array.from(state.localFocus.visible));
  }

  // Active server-side element filter → use it (more accurate than tuples
  // because future view refetches go through this filter).
  const ds = state.dimSelections?.[dim];
  if (ds && ds.kind === 'elements' && ds.names.length > 0) {
    return _hierOrder(dim, ds.names.slice());
  }

  // Freshly pivoted dim (on a state axis but not yet in lastMatrix): the matrix
  // layout is stale, so the tuple/index path below can't resolve this dim. It
  // came from the title zone, so carry ONLY its selected context element onto
  // the new axis — NOT the dim's full element list. Expanding to every element
  // triggers a massive server-side load (view spans the whole dimension); the
  // user drills/adds more from the chip filter when they want it.
  const m0 = state.lastMatrix;
  if (m0 && resolveMovedDimElements(dim, {
    stateRowDims: state.rowDims, stateColDims: state.colDims,
    matrixRowDims: m0.rowDims, matrixColDims: m0.colDims,
  }) === 'movedFresh') {
    const t = state.titleAssignments?.[dim];
    if (t) { return [t]; }
    // No context member captured (unexpected for a title→axis move) → fall back
    // to the cached subset if already fetched, else fetch once and keep empty
    // until elementsData arrives (which re-refreshes). Guard the post so a
    // second call in the same refresh cycle doesn't duplicate the fetch.
    const cached = state.elementsCache[dim];
    if (cached !== undefined) {
      return _hierOrder(dim, cached.map((it) => typeof it === 'string' ? it : it.name));
    }
    if (!state._pendingSubsetFetch.has(dim)) {
      state._pendingSubsetFetch.add(dim);
      vscode.postMessage({ type: 'fetchElements', dimName: dim });
    }
  }

  const m = state.lastMatrix;
  if (!m) {
    // Fallback: titleAssignments (live in state) or empty
    const t = state.titleAssignments?.[dim];
    return t ? [t] : [];
  }
  const rowDims = m.rowDims ?? state.rowDims;
  const colDims = m.colDims ?? state.colDims;
  const rowIdx = rowDims.indexOf(dim);
  if (rowIdx >= 0 && m.rowTuples) {
    const set = new Set<string>();
    m.rowTuples.forEach((t) => { if (t[rowIdx]) set.add(t[rowIdx]); });
    return Array.from(set);
  }
  const colIdx = colDims.indexOf(dim);
  if (colIdx >= 0 && m.colTuples) {
    const set = new Set<string>();
    m.colTuples.forEach((t) => { if (t[colIdx]) set.add(t[colIdx]); });
    return Array.from(set);
  }
  const t = m.titleAssignments?.[dim] ?? state.titleAssignments?.[dim];
  return t ? [t] : [];
}

/** Expression + reason as message fields — both opening paths send the same thing. */
export function _expressionFields(dim: string): { currentExpression?: string; currentExpressionNote?: string } {
  const info = currentDimExpressionInfo(dim);
  return info.expr ? { currentExpression: info.expr } : { currentExpressionNote: info.note };
}

/** ▼ filter button shared by row/col chips and title groups — opens the dim
 *  browser for `dim` with the current elements preselected. */
function _makeDimFilterButton(dim: string, className: string): HTMLSpanElement {
  const hasSel = !!state.dimSelections[dim];
  const filter = document.createElement('span');
  filter.className = className;
  filter.title = hasSel ? L.changeSelection : L.selectElements;
  filter.textContent = '▼';
  filter.addEventListener('click', (e) => {
    e.stopPropagation();
    vscode.postMessage({
      type: 'openDimBrowser', dimName: dim,
      currentElements: _currentDimElements(dim),
      ..._expressionFields(dim),
      alias: state.dimAliases[dim] || '',
      takenHiers: [...state.rowDims, ...state.colDims, ...state.titleDims]
        .filter((k) => k !== dim && dimOfKey(k) === dimOfKey(dim))
        .map((k) => splitHierKey(k).hier),
    });
  });
  return filter;
}

/**
 * Dims whose element list has been requested but not yet delivered (M12).
 * `elementsCache[dim]` only fills when `elementsData` arrives — on a 100k-element
 * dim that is seconds later, and the combo calls `onOpen` on EVERY open, so
 * without this marker re-opening the dropdown fires a second (third, …) fetch.
 * Same idea as `state._pendingSubsetFetch` on the moved-dim path above, but a
 * separate set: entries there additionally trigger a re-refresh on arrival.
 */
const _elementFetchPending = new Set<string>();

/** Lazy-fetch a title dim's full element list when its dropdown is first opened.
 *  The combo calls this on every open; cache + in-flight check keep it to one
 *  request per dim. */
function _lazyFetchElements(dim: string): void {
  if (state.elementsCache[dim] || _elementFetchPending.has(dim)) { return; }
  _elementFetchPending.add(dim);
  vscode.postMessage({ type: 'fetchElements', dimName: dim });
}

/** Release the in-flight marker for `dim` — its `elementsData` arrived. Pass no
 *  dim to release all: a failed fetch reports no dim name, and a stuck marker
 *  would keep the dropdown from ever retrying. */
export function clearElementFetchPending(dim?: string): void {
  if (dim === undefined) { _elementFetchPending.clear(); } else { _elementFetchPending.delete(dim); }
}

/** Label of an axis/title entry: the dimension name, plus a hierarchy picker
 *  when the dimension has more than one hierarchy. */
function _makeKeyLabel(key: string, className: string): HTMLSpanElement {
  const { dim, hier } = splitHierKey(key);
  const lbl = document.createElement('span');
  lbl.className = className ? `${className} chip-label` : 'chip-label';
  lbl.title = key;
  // The name shrinks to an ellipsis when the zone is narrow (the rows zone is
  // as wide as the row headers); the picker shrinks too (see css.ts .chip-hier).
  const name = document.createElement('span');
  name.className = 'chip-name';
  lbl.appendChild(name);
  const hiers = state.hierarchies[dim];
  if (!hiers || hiers.length < 2) { name.textContent = dim; return lbl; }
  name.textContent = dim;
  const sel = document.createElement('select');
  sel.className = 'chip-hier';
  sel.title = L.hierarchy;
  // Another hierarchy of this dimension already on the grid is not offered:
  // one key per hierarchy.
  const taken = new Set([...state.rowDims, ...state.colDims, ...state.titleDims].filter((k) => k !== key));
  for (const h of hiers) {
    const k = hierKey(dim, h);
    if (taken.has(k)) { continue; }
    const opt = document.createElement('option');
    opt.value = k;
    // The default hierarchy repeats the dimension name right beside it.
    opt.textContent = h === (state.defaultHiers[dim] ?? dim) ? L.defaultHierarchy : h;
    opt.title = h;
    opt.selected = h === hier;
    sel.appendChild(opt);
  }
  // The chip is draggable; a drag must not start from the picker.
  sel.addEventListener('mousedown', (e) => e.stopPropagation());
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', () => switchHierarchy(key, sel.value));
  lbl.appendChild(sel);
  return lbl;
}

/** Hierarchy of `key`'s dimension not yet on the grid, or `undefined`. */
function _freeHierarchy(key: string): string | undefined {
  const { dim } = splitHierKey(key);
  const onGrid = new Set([...state.rowDims, ...state.colDims, ...state.titleDims]);
  return (state.hierarchies[dim] ?? []).map((h) => hierKey(dim, h)).find((k) => !onGrid.has(k));
}

function _forgetKey(key: string): void {
  delete state.titleAssignments[key];
  if (state.dimSelections[key]) {
    delete state.dimSelections[key];
    vscode.postMessage({ type: 'clearDimSelection', dimName: key });
  }
}

function _setAxes(axes: Axes): void {
  state.rowDims = axes.rowDims;
  state.colDims = axes.colDims;
  state.titleDims = axes.titleDims;
  state.existingViewName = null;
  state.existingViewIsPrivate = false;
  if (state.isMdxView) { state._mdxAxisDirty = true; }
}

/** Common tail of a layout change that the loaded matrix cannot answer. */
function _applyAxes(axes: Axes): void {
  _setAxes(axes);
  rebuildZones();
  requestRefresh();
}

/** Put `next` in place of `key` without redrawing — the dimension browser
 *  switched hierarchy; the selection update that carries it redraws. */
export function rekeyHierarchy(key: string, next: string): void {
  if (!next || next === key) { return; }
  _forgetKey(key);
  _setAxes(replaceKey({ rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims }, key, next));
}

/** Show `next` (another hierarchy of the same dimension) in place of `key`. */
export function switchHierarchy(key: string, next: string): void {
  if (!next || next === key) { return; }
  _forgetKey(key);
  _applyAxes(replaceKey({ rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims }, key, next));
}

/** Put a further hierarchy of `key`'s dimension on the same axis, after `key`. */
export function addHierarchy(key: string): void {
  const added = _freeHierarchy(key);
  if (!added) { return; }
  _applyAxes(addKeyAfter({ rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims }, key, added));
}

/** Another hierarchy of `key`'s dimension is on the grid too, in any zone. */
function _hasSiblingHierarchy(key: string): boolean {
  const dim = dimOfKey(key);
  return [...state.rowDims, ...state.colDims, ...state.titleDims].some((k) => k !== key && dimOfKey(k) === dim);
}

/** Take `key` off the grid. Only for a second hierarchy: the dimension stays
 *  through its sibling, so the cube keeps every dimension on some zone. */
export function removeHierarchy(key: string): void {
  if (!_hasSiblingHierarchy(key)) { return; }
  _forgetKey(key);
  _applyAxes(removeKey({ rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims }, key));
}

/** The chip/title × removes a second hierarchy; a dimension's only key has
 *  nowhere to go but the title zone. */
function _makeRemoveButton(key: string, inTitles: boolean): HTMLSpanElement | null {
  const sibling = _hasSiblingHierarchy(key);
  if (inTitles && !sibling) { return null; }
  const x = document.createElement('span');
  x.className = inTitles ? 'chip-x title-x' : 'chip-x';
  x.title = sibling ? L.remove : L.moveToTitle;
  x.textContent = '×';
  x.addEventListener('mousedown', (e) => e.stopPropagation());
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    if (sibling) { removeHierarchy(key); } else { moveDimToZone(key, 'titles'); }
  });
  return x;
}

function _makeAxisChip(dim: string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'dim-chip';
  chip.draggable = true;
  chip.dataset.draggableDim = dim;
  chip.dataset.dimName = dim;

  const hasSel = !!state.dimSelections[dim];
  if (hasSel) { chip.classList.add('has-selection'); }

  const lbl = _makeKeyLabel(dim, '');

  const filter = _makeDimFilterButton(dim, 'chip-filter');

  const add = document.createElement('span');
  if (_freeHierarchy(dim)) {
    add.className = 'chip-add';
    add.title = L.addHierarchy;
    add.textContent = '+';
    add.addEventListener('click', (e) => { e.stopPropagation(); addHierarchy(dim); });
  }

  const x = _makeRemoveButton(dim, false);

  chip.appendChild(lbl);
  chip.appendChild(filter);
  if (add.textContent) { chip.appendChild(add); }
  if (x) { chip.appendChild(x); }
  return chip;
}

function _makeTitleGroup(dim: string): HTMLSpanElement {
  const group = document.createElement('span');
  group.className = 'title-chip-group';
  const hasSel = !!state.dimSelections[dim];
  if (hasSel) { group.classList.add('has-selection'); }

  const lbl = _makeKeyLabel(dim, 'title-dim-label');
  lbl.draggable = true;
  lbl.dataset.draggableDim = dim;
  lbl.dataset.dimName = dim;
  group.appendChild(lbl);

  // Filled-dropdown icon: opens the dim browser to curate which elements this
  // context dropdown offers — same flow as the row/col chip filter (host returns
  // dimSelectionUpdate → dimSelections[dim] → rebuildZones narrows the select).
  group.appendChild(_makeDimFilterButton(dim, 'title-filter'));

  const sel = document.createElement('select');
  sel.className = 'title-elem-sel';
  sel.classList.add('title-dim-select');
  sel.dataset.dim = dim;
  sel.dataset.dimName = dim;
  const elems = state.elementsCache[dim] ?? [];
  const ds = state.dimSelections[dim];
  if (elems.length === 0 && ds?.kind === 'elements' && ds.names.length > 0) {
    // Curated subset via the ▼ dim-browser but full element list not fetched yet:
    // populate the right dropdown straight from the selected names so the user
    // immediately sees (and can switch between) exactly what they picked, instead
    // of only the single active member. A later mousedown still lazy-loads the
    // full list (then _fillSelect re-filters it to this same subset).
    _fillSelect(sel, ds.names, state.titleAssignments[dim], undefined);
  } else if (elems.length === 0) {
    // Lazy mode: show only the current title element as a placeholder — the
    // full element list is only fetched on the first user click on the dropdown.
    // Saves RAM for title dims that are already fixed contextually and whose
    // list is never opened.
    const current = state.titleAssignments[dim] ?? '';
    const opt = document.createElement('option');
    opt.value = current;
    opt.textContent = current ? _dispElem(dim, current) : L.selectPlaceholder;
    opt.selected = true;
    sel.appendChild(opt);
  } else {
    _fillSelect(sel, elems, state.titleAssignments[dim], state.dimSelections[dim]);
  }
  // Searchable dropdown on top of the (hidden) select — context dims are often
  // far too large to scroll through a native option list.
  // byLabel: button and list show the option label, i.e. the alias when one is
  // active for this dim (the value is always the element name).
  group.appendChild(attachTitleCombo(sel, dim, () => _lazyFetchElements(dim), { byLabel: true }));
  const x = _makeRemoveButton(dim, true);
  if (x) { group.appendChild(x); }
  return group;
}

function _clearChips(zone: HTMLElement): void {
  zone.querySelectorAll('[data-draggable-dim], .title-chip-group').forEach((el) => el.remove());
}

export function rebuildZones(): void {
  // Title groups (and with them any open combo popup) are about to be replaced —
  // drop the open-state so it doesn't point at a detached element.
  closeTitleCombo();
  const r = getRefs();
  _clearChips(r.zoneRows);
  state.rowDims.forEach((dim) => r.zoneRows.appendChild(_makeAxisChip(dim)));

  _clearChips(r.zoneCols);
  state.colDims.forEach((dim) => r.zoneCols.appendChild(_makeAxisChip(dim)));

  _clearChips(r.zoneTitles);
  state.titleDims.forEach((dim) => r.zoneTitles.appendChild(_makeTitleGroup(dim)));
}

/** Read the context assignment from the select fields — the same source from which
 *  `doRefresh` takes it. */
function _titleAssignmentsFromDom(): Record<string, string> {
  const out: Record<string, string> = {};
  getRefs().zoneTitles.querySelectorAll<HTMLSelectElement>('.title-elem-sel').forEach((s) => {
    if (s.dataset.dim && s.value) { out[s.dataset.dim] = s.value; }
  });
  return out;
}

/**
 * Compute the new axis layout from the already loaded matrix instead of re-reading
 * the grid. Returns `false` if that is not possible — then the server has to be
 * asked, as before.
 *
 * For an MDX view, the effective expression is additionally rebuilt, exactly
 * as `doRefresh` would do via `_mdxAxisDirty` — just without executing it.
 * Otherwise the MDX window and, worse, saving would show an axis layout
 * that the grid no longer has. Whether the axis can be reordered at all is
 * decided by `pivotMatrixLocal`: a computed MDX axis cannot be explained as a
 * sequence of names and falls back to the server there anyway.
 */
function _tryLocalPivot(
  oldRowDims: string[], oldColDims: string[], titleMembers: Record<string, string>,
): boolean {
  if (state.paged || !state.lastMatrix) { return false; }
  const next = pivotMatrixLocal({
    matrix: state.lastMatrix,
    oldRowDims, oldColDims,
    nextRowDims: state.rowDims, nextColDims: state.colDims,
    titleMembers,
  });
  if (!next) { return false; }
  if (state.isMdxView) {
    const r = getRefs();
    const titleAssignments = _titleAssignmentsFromDom();
    state.titleAssignments = titleAssignments;
    setInlineMdx(buildPivotedMdx({
      cube: state.cubeName,
      rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims,
      dimSubsets: currentDimSubsetsAll(),
      titleAssignments,
      suppressRows: isToggleOn(r.chkSuppRows),
      suppressCols: isToggleOn(r.chkSuppCols),
    }));
    state._mdxAxisDirty = false;
  }
  // Without this, "Keep only" would retain the base lists of the PREVIOUS axis layout.
  state.axisBaseNames = axisBaseNamesFromMatrix(next);
  // The anchor describes coordinates of the OLD matrix; after a local
  // axis change the same numbers mean something different. Every server reload
  // clears the selection via `clearSelection()` in `cellData` — this path
  // does not reload from the server and therefore has to do it itself here, otherwise
  // a Ctrl+V after the pivot points at cells the user never selected.
  clearSelection();
  renderGrid(next);
  return true;
}

/**
 * Swap the row and column axes as a whole.
 *
 * The same path as a zone change by dragging, just without a target dimension: the
 * values are already there, `_tryLocalPivot` rotates the loaded matrix without
 * a server query and falls back to a reload only if that is not
 * possible (cell paging, computed MDX axis).
 */
export function swapAxes(): void {
  const { axes, changed } = computeAxisSwap({
    rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims,
  });
  if (!changed) { return; }

  const oldRowDims = [...state.rowDims];
  const oldColDims = [...state.colDims];
  state.rowDims = axes.rowDims;
  state.colDims = axes.colDims;
  // Like every pivot: the layout is no longer that of the saved view.
  state.existingViewName = null;
  state.existingViewIsPrivate = false;
  if (state.isMdxView) { state._mdxAxisDirty = true; }
  rebuildZones();
  // No title change involved, so no context elements to hold on to either.
  if (_tryLocalPivot(oldRowDims, oldColDims, {})) { return; }
  requestRefresh();
}

export function moveDimToZone(dim: string, target: string | undefined, beforeDim: string | null = null): void {
  const zone = (target === 'cols' ? 'cols' : target === 'titles' ? 'titles' : 'rows') as Zone;
  const targetDims = zone === 'rows' ? state.rowDims : zone === 'cols' ? state.colDims : state.titleDims;
  const index = computeInsertIndex(targetDims.filter((d) => d !== dim), beforeDim);
  const { axes, changed } = computeZoneMoveAt(dim, zone, index, {
    rowDims: state.rowDims, colDims: state.colDims, titleDims: state.titleDims,
  });
  if (!changed) { return; } // no-op drop: don't leave saved-view mode, don't re-execute

  // Remember the old layout while it is still there — the local pivot
  // below needs it to map the loaded cells.
  const oldRowDims = [...state.rowDims];
  const oldColDims = [...state.colDims];
  const titleMembers: Record<string, string> = {};

  if (zone === 'titles') {
    // → titles: a title dim needs exactly ONE element. Capture the first current
    // axis member / selection BEFORE clearing, so the title never lands empty.
    const cur = _currentDimElements(dim);
    if (cur.length > 0) { state.titleAssignments[dim] = cur[0]; titleMembers[dim] = cur[0]; }
    if (state.dimSelections[dim]) {
      delete state.dimSelections[dim];
      vscode.postMessage({ type: 'clearDimSelection', dimName: dim });
    }
  } else if (state.titleDims.includes(dim)) {
    // title → axis: pin exactly the element currently shown in the context
    // dropdown so the new axis loads ONLY that member, not the dim's whole
    // element list (a massive server-side load). doRefresh rebuilds
    // state.titleAssignments from the REMAINING title selects — and rebuildZones
    // below is about to remove this dim's select — so the former context member
    // would otherwise be lost. Pin it into dimSelections, which doRefresh does
    // NOT clobber; _currentDimElements then reads it back for both the native
    // temp-view (dimSubsets) and the MDX pivot rebuild.
    const selEl = getRefs().zoneTitles.querySelector<HTMLSelectElement>(
      `.title-elem-sel[data-dim="${CSS.escape(dim)}"]`);
    const member = selEl?.value || state.titleAssignments[dim] || '';
    if (member) { state.dimSelections[dim] = { kind: 'elements', names: [member] }; }
  }

  state.rowDims = axes.rowDims;
  state.colDims = axes.colDims;
  state.titleDims = axes.titleDims;
  state.existingViewName = null; // pivot leaves saved-view mode
  state.existingViewIsPrivate = false;
  // MDX views: rebuild the whole MDX on refresh, not just the slicer, else the
  // moved dim lands on an axis AND in the WHERE clause (rte 33 double-include).
  if (state.isMdxView) { state._mdxAxisDirty = true; }
  rebuildZones();
  // The values are already there: distributing the same dimensions differently across rows, columns
  // and context is a reordering, not a new read.
  if (_tryLocalPivot(oldRowDims, oldColDims, titleMembers)) { return; }
  requestRefresh(); // re-execute so the grid matches the new layout, also mid-load
}

let _dragDim: string | null = null;
let _ghost: HTMLElement | null = null;
let _dropZone: HTMLElement | null = null;
let _dropIndex = 0;

/** Countable entries of a zone in display order: on rows/columns the
 *  chips, in the title zone the whole group (not the draggable label inside it).
 *  The placeholder carries none of these classes and therefore drops out. */
function _zoneEntries(zone: HTMLElement): HTMLElement[] {
  return Array.from(zone.querySelectorAll<HTMLElement>('.dim-chip, .title-chip-group'));
}

/** Dimension name of an entry — directly on the chip, in the title group on the label. */
function _entryDim(el: HTMLElement): string | undefined {
  return el.dataset.draggableDim
    ?? el.querySelector<HTMLElement>('[data-draggable-dim]')?.dataset.draggableDim;
}

/** Axis list of the zone from the state (not from the DOM). */
function _zoneDims(zone: HTMLElement): string[] {
  const z = zone.dataset.zone;
  return z === 'cols' ? state.colDims : z === 'titles' ? state.titleDims : state.rowDims;
}

/** Boxes of the entries that count for the index calculation — without the dragged one.
 *  Must be measured BEFORE the placeholder is set. */
function _entryRects(zone: HTMLElement, draggedDim: string): DOMRect[] {
  return _zoneEntries(zone)
    .filter((el) => _entryDim(el) !== draggedDim)
    .map((el) => el.getBoundingClientRect());
}

/** Place the placeholder at `index` of the countable entries. Move an existing
 *  node instead of rebuilding it, so that it does not flicker anew while wandering. */
function _placeGhost(zone: HTMLElement, dim: string, index: number): void {
  if (!_ghost) {
    _ghost = document.createElement('span');
    _ghost.className = 'drop-ghost';
  }
  _ghost.textContent = dim;
  const entries = _zoneEntries(zone).filter((el) => _entryDim(el) !== dim);
  zone.insertBefore(_ghost, entries[index] ?? null);
}

function _removeGhost(): void {
  _ghost?.remove();
}

export function wireDragAndDrop(): void {
  const r = getRefs();
  const dropZones: HTMLElement[] = [r.zoneRows, r.zoneCols, r.zoneTitles];

  document.addEventListener('dragstart', (e: DragEvent) => {
    const tgt = e.target as Element | null;
    const draggable = tgt?.closest<HTMLElement>('[data-draggable-dim]');
    if (!draggable) return;
    _dragDim = draggable.dataset.draggableDim ?? null;
    if (e.dataTransfer && _dragDim) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', _dragDim);
    }
    setTimeout(() => { if (draggable.isConnected) draggable.classList.add('dragging'); }, 0);
  });

  document.addEventListener('dragend', () => {
    document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    dropZones.forEach((z) => z.classList.remove('drag-over'));
    _removeGhost();
    _dragDim = null; _dropZone = null; _dropIndex = 0;
  });

  dropZones.forEach((zone) => {
    zone.addEventListener('dragover', (e: DragEvent) => {
      if (!_dragDim) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      dropZones.forEach((z) => z.classList.remove('drag-over'));
      zone.classList.add('drag-over');
      const index = computeDropIndex(_entryRects(zone, _dragDim), { x: e.clientX, y: e.clientY });
      const { resting } = resolveDropPlacement(_zoneDims(zone), _dragDim, index);
      _dropZone = zone; _dropIndex = index;
      // Resting position: the dimension is already there. No placeholder, otherwise
      // it promises a movement that releasing does not perform.
      if (resting) { _removeGhost(); } else { _placeGhost(zone, _dragDim, index); }
    });
    zone.addEventListener('dragleave', (e: DragEvent) => {
      if (!zone.contains(e.relatedTarget as Node)) {
        zone.classList.remove('drag-over');
        if (_dropZone === zone) { _removeGhost(); _dropZone = null; }
      }
    });
    zone.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      dropZones.forEach((z) => z.classList.remove('drag-over'));
      _removeGhost();
      const dim = (e.dataTransfer?.getData('text/plain')) || _dragDim;
      if (!dim) return;
      // Use the LAST DISPLAYED index, do not measure again: the
      // placeholder has shifted the chips behind it, so a second measurement
      // could therefore differ from what the user saw.
      const index = _dropZone === zone ? _dropIndex : _entryRects(zone, dim).length;
      const { beforeDim, resting } = resolveDropPlacement(_zoneDims(zone), dim, index);
      if (resting) return; // same position — no leaving of the saved view mode
      moveDimToZone(dim, zone.dataset.zone, beforeDim);
    });
  });
}

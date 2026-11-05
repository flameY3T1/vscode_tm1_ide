/**
 * Right-click context menus + spread prompt modal.
 *
 * Two distinct context menus:
 *  - #ctx-menu        — dimension/element actions (Keep only, Show parents,
 *                       Expand all, Open browser, Clear filter)
 *  - #ctx-spread-menu — 4 spread methods on consolidated cells
 *
 * Plus the spread-prompt modal (#spread-prompt-overlay) for methods that
 * need a numeric input (proportional / repeat / percentage). 'clear' fires
 * directly without prompting.
 */

import { state } from './state';
import { setInlineMdx, markInlineMdxStale } from './mdxBuild';
import { vscode } from './vscodeApi';
import { getL10n, fmt } from '../_shared/l10n';

import { openFormatDialog, type FormatTarget } from './formatDialog';
import { attrCubeDimension } from './elementFormatPure';

const L = getL10n();
import { sendSpread, sendSpreadBulk, sendTrace } from './actions';
import { renderGrid } from './grid';
import { currentDimElements, _expressionFields, rebuildZones } from './axis';
import type { SpreadMethod } from './pureBridge';
import {
  buildAxisInfo,
  collectParentsUnion,
  eligibleCCells,
  collectAncestorsBfs,
  collectDescendantsDfs,
  collectDirectChildren,
  keepOnlyNames,
  type AxisInfo,
} from './contextMenuPure';
import { isSubsequenceOf } from './gridPure';
import { children, expandAllSet, parents, allParents } from '../_shared/hierarchy/operations';
import { buildCubeStructure } from './cubeHierStructure';
import { syncAliasIntoMdx } from './aliasMdxSyncPure';
import { applyMdxToPopupEditor } from './mdxView';
import { writeClipboard } from '../_shared/clipboardWrite';
import { memberMdxRef } from '../../utils/hierKeyPure';

interface CtxDom {
  menu: HTMLElement;
  keepOnly: HTMLElement;
  showParents: HTMLElement;
  showAllParents: HTMLElement;
  expandAll: HTMLElement;
  leaves: HTMLElement;
  elemPlusLeaves: HTMLElement;
  copyName: HTMLElement;
  copyMdx: HTMLElement;
  sepCell: HTMLElement;
  openBrw: HTMLElement;
  alias: HTMLElement;
  aliasSub: HTMLElement;
  clearFilt: HTMLElement;
  spreadMenu: HTMLElement;
  spreadOverlay: HTMLElement;
  spreadTitle: HTMLElement;
  spreadLabel: HTMLElement;
  spreadInput: HTMLInputElement;
  spreadError: HTMLElement;
  spreadOk: HTMLButtonElement;
  spreadCancel: HTMLButtonElement;
}

let _dom: CtxDom | null = null;
let _ctxDim: string | null = null;
let _ctxElem: string | null = null;
/** Snapshot of selected elements for the dim at ctx-menu open time. When
 *  the clicked element is part of a multi-selection (size > 1, includes
 *  _ctxElem), Keep-only / Parent-anzeigen / Expand-all apply to the whole
 *  set. Otherwise stays [_ctxElem] for single-element behavior. */
let _ctxElems: string[] = [];
let _ctxSpreadRi: number | null = null;
let _ctxSpreadCi: number | null = null;
/** Eligible cells for the current spread operation (single-cell ⇒ length 1). */
let _ctxSpreadTargets: Array<{ ri: number; ci: number }> = [];
/** Every cell the right-click covered, writable or not — for "Format…". */
let _ctxFormatCells: Array<{ ri: number; ci: number }> = [];
let _spreadPromptMethod: SpreadMethod | null = null;
let _spreadPromptTargets: Array<{ ri: number; ci: number }> = [];

const SPREAD_LABELS: Partial<Record<SpreadMethod, { title: string; label: string }>> = {
  proportional: { title: L.spreadProportional, label: L.spreadTargetLabel },
  repeat:       { title: L.spreadRepeat,        label: L.spreadValueLabel },
  percentage:   { title: L.spreadPercentage,    label: L.spreadPercentLabel },
};

function _required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[contextMenu] missing #${id}`);
  return el as T;
}

function _initDom(): CtxDom {
  if (_dom) return _dom;
  _dom = {
    menu:           _required<HTMLElement>('ctx-menu'),
    keepOnly:       _required<HTMLElement>('ctx-keep-only'),
    showParents:    _required<HTMLElement>('ctx-show-parents'),
    showAllParents: _required<HTMLElement>('ctx-show-all-parents'),
    expandAll:      _required<HTMLElement>('ctx-expand-all'),
    leaves:         _required<HTMLElement>('ctx-leaves'),
    elemPlusLeaves: _required<HTMLElement>('ctx-elem-plus-leaves'),
    copyName:       _required<HTMLElement>('ctx-copy-name'),
    copyMdx:        _required<HTMLElement>('ctx-copy-mdx'),
    sepCell:        _required<HTMLElement>('ctx-sep-cell'),
    openBrw:        _required<HTMLElement>('ctx-open-browser'),
    alias:          _required<HTMLElement>('ctx-alias'),
    aliasSub:       _required<HTMLElement>('ctx-alias-sub'),
    clearFilt:      _required<HTMLElement>('ctx-clear-filter'),
    spreadMenu:     _required<HTMLElement>('ctx-spread-menu'),
    spreadOverlay:  _required<HTMLElement>('spread-prompt-overlay'),
    spreadTitle:    _required<HTMLElement>('spread-prompt-title'),
    spreadLabel:    _required<HTMLElement>('spread-prompt-label'),
    spreadInput:    _required<HTMLInputElement>('spread-prompt-input'),
    spreadError:    _required<HTMLElement>('spread-prompt-error'),
    spreadOk:       _required<HTMLButtonElement>('spread-prompt-ok'),
    spreadCancel:   _required<HTMLButtonElement>('spread-prompt-cancel'),
  };
  return _dom;
}

function _hideCtx(): void {
  const d = _initDom();
  d.menu.style.display = 'none';
  d.showParents.classList.remove('ctx-submenu-open');
}
function _hideSpreadMenu(): void {
  const d = _initDom();
  d.spreadMenu.style.display = 'none';
  _ctxSpreadRi = null; _ctxSpreadCi = null;
  _ctxSpreadTargets = [];
}
function _hideSpreadPrompt(): void {
  const d = _initDom();
  d.spreadOverlay.classList.remove('visible');
  _spreadPromptMethod = null;
  _spreadPromptTargets = [];
}

/** Returns eligible (writable C, not rule, not locked) cells from a candidate list. */
function _eligibleCCells(cells: Array<{ ri: number; ci: number }>): Array<{ ri: number; ci: number }> {
  return eligibleCCells(cells, state.lastMatrix?.cellFlags ?? {});
}

function _showCtxAt(e: MouseEvent): void {
  const d = _initDom();
  d.menu.style.display = 'block';
  const mw = d.menu.offsetWidth, mh = d.menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth)  { x = window.innerWidth  - mw - 6; }
  if (y + mh > window.innerHeight) { y = window.innerHeight - mh - 6; }
  d.menu.style.left = `${x}px`;
  d.menu.style.top  = `${y}px`;
}

/**
 * If `dim` currently has a server-side element filter, promote that filter to
 * a client-side localFocus, queue the user's drill action, and tell the
 * extension to clear the server filter (which triggers a re-fetch with all
 * elements). After the new matrix arrives, `applyPendingDrillAction()` replays
 * the drill against the full parents/children map.
 *
 * Returns true if promotion happened (caller should bail out and let the
 * replay handle the drill).
 */
function _promoteIfFiltered(
  dim: string,
  elems: string[],
  kind: 'toggle' | 'showParents' | 'expandAll' | 'keepOnly',
): boolean {
  const sel = state.dimSelections[dim];
  if (!sel || sel.kind !== 'elements') return false;
  if (elems.length === 0) return false;
  // Seed localFocus from prior selection so the post-refresh view stays narrow.
  state.localFocus = { dim, visible: new Set(sel.names) };
  // Make sure the drilled elements themselves are in the visible set even if
  // the user drills on a parent that wasn't part of the original mark set
  // (rare but possible after Komplett-ausklappen / Behalten chains).
  elems.forEach((el) => state.localFocus!.visible.add(el));
  state.pendingDrillAction = { dim, elem: elems[0], kind, elems: elems.slice() };
  vscode.postMessage({ type: 'clearDimFilter', dimName: dim });
  return true;
}

/** Replay the queued drill action with the full matrix from a fresh fetch.
 *
 * Prefers shared hierarchy/operations (buildCubeStructure) for set computation
 * so the replay uses the same level-aware logic as the live click handlers.
 * Falls back to contextMenuPure collect* helpers when buildCubeStructure returns
 * null (e.g. matrix missing tuples/levels).
 */
export function applyPendingDrillAction(): void {
  const action = state.pendingDrillAction;
  if (!action) return;
  state.pendingDrillAction = null;
  const info = _getAxisInfo(action.dim);
  if (!info) return;

  const targets = action.elems && action.elems.length ? action.elems : [action.elem];
  const focus = state.localFocus && state.localFocus.dim === action.dim
    ? state.localFocus
    : (state.localFocus = { dim: action.dim, visible: new Set(targets) });

  // Build shared hierarchy structure. Null when matrix lacks level/tuple data —
  // each branch falls back to the contextMenuPure collect* equivalent.
  const hier = buildCubeStructure(state.lastMatrix, action.dim, state.rowDims, state.colDims);

  if (action.kind === 'showParents') {
    // Direct parents — matches live showParents handler (parents, not all ancestors).
    const parList: string[] = hier
      ? Array.from(new Set(targets.flatMap((t) => parents(hier, t))))
      : collectParentsUnion(targets, info);
    parList.forEach((p) => focus.visible.add(p));
  } else if (action.kind === 'showAllParents') {
    // All ancestors via BFS — matches live showAllParents handler.
    const ancestors: string[] = hier
      ? Array.from(new Set(targets.flatMap((t) => allParents(hier, t))))
      : [...collectAncestorsBfs(targets, info)];
    ancestors.forEach((p) => focus.visible.add(p));
  } else if (action.kind === 'expandAll') {
    // Target + all descendants (DFS). expandAllSet = [t, ...descendants].
    const expanded: string[] = hier
      ? Array.from(new Set(targets.flatMap((t) => expandAllSet(hier, t))))
      : [...collectDescendantsDfs(targets, info)];
    expanded.forEach((n) => focus.visible.add(n));
  } else if (action.kind === 'toggle') {
    // Direct children only — matches live toggle/children drill handler.
    const kids: string[] = hier
      ? Array.from(new Set(targets.flatMap((t) => children(hier, t))))
      : [...collectDirectChildren(targets, info)];
    kids.forEach((c) => focus.visible.add(c));
  } else if (action.kind === 'keepOnly') {
    focus.visible.clear();
    targets.forEach((tgt) => focus.visible.add(tgt));
  }
  if (state.lastMatrix) renderGrid(state.lastMatrix);
}

function _collectParentsUnion(elems: string[], info: AxisInfo): string[] {
  return collectParentsUnion(elems, info);
}

function _renderParentSubmenu(parents: string[]): void {
  const host = document.getElementById('ctx-show-parents-sub');
  if (!host) return;
  host.innerHTML = '';
  if (parents.length <= 1) return;
  for (const p of parents) {
    const item = document.createElement('div');
    item.className = 'ctx-submenu-item';
    item.textContent = p;
    item.dataset.parent = p;
    host.appendChild(item);
  }
}

/** (Re)build the right-click "Alias" submenu for the current _ctxDim. */
function _renderAliasSubmenu(): void {
  const dim = _ctxDim;
  if (!dim) { return; }
  const host = _initDom().aliasSub;
  host.innerHTML = '';
  const defs = state.aliasDefs[dim];
  if (!defs) {
    const loading = document.createElement('div');
    loading.className = 'ctx-submenu-item ctx-disabled';
    loading.textContent = '…';
    host.appendChild(loading);
    vscode.postMessage({ type: 'fetchDimAliasDefs', dimName: dim });
    return;
  }
  const active = state.dimAliases[dim] || '';
  const mkItem = (label: string, val: string): void => {
    const it = document.createElement('div');
    it.className = 'ctx-submenu-item' + (active === val ? ' ctx-active' : '');
    it.textContent = (active === val ? '✓ ' : '') + label;
    it.dataset.alias = val;
    host.appendChild(it);
  };
  mkItem(L['noAlias'] || '(no alias)', '');
  for (const a of defs) { mkItem(a, a); }
}

/** Called from messaging.ts when alias defs arrive while the menu is open. */
export function refreshAliasSubmenu(dimName: string): void {
  if (_ctxDim === dimName) { _renderAliasSubmenu(); }
}

function _getAxisInfo(dim: string): AxisInfo | null {
  return buildAxisInfo(state.lastMatrix, dim, state.rowDims, state.colDims);
}

function _openCtxMenu(e: MouseEvent, dimName: string, elemName: string | null): void {
  e.preventDefault();
  const d = _initDom();
  _ctxDim = dimName;
  _ctxElem = elemName;

  // Compute the effective target set: if the clicked elem is part of an
  // active multi-selection on this dim, all selected elems become targets.
  const selSet = state.headerSelection?.[dimName];
  if (elemName && selSet && selSet.has(elemName) && selSet.size > 1) {
    _ctxElems = Array.from(selSet);
  } else if (elemName) {
    _ctxElems = [elemName];
  } else {
    _ctxElems = [];
  }

  const isCell = !!_ctxElem;
  const multiN = _ctxElems.length;
  d.keepOnly.style.display       = isCell ? '' : 'none';
  d.showParents.style.display    = isCell ? '' : 'none';
  d.showAllParents.style.display = isCell ? '' : 'none';
  d.expandAll.style.display      = isCell ? '' : 'none';
  d.leaves.style.display         = isCell ? '' : 'none';
  d.elemPlusLeaves.style.display = isCell ? '' : 'none';
  d.copyName.style.display       = isCell ? '' : 'none';
  d.copyMdx.style.display        = isCell ? '' : 'none';
  document.getElementById('ctx-format')?.style.setProperty('display', isCell ? '' : 'none');
  d.sepCell.style.display        = isCell ? '' : 'none';

  // Update labels with multi-count badge
  const suffix = multiN > 1 ? ` (${multiN})` : '';
  d.keepOnly.textContent       = multiN > 1 ? fmt(L, 'keepOnlyMany', suffix) : fmt(L, 'keepOnlyOne', suffix);
  // NOTE: showParents has nested arrow + submenu DOM — never set textContent on the root.
  const spLabel = document.getElementById('ctx-show-parents-label');
  if (spLabel) spLabel.textContent = fmt(L, 'showParentSuffix', suffix);
  d.showAllParents.textContent = fmt(L, 'showAllParentsSuffix', suffix);
  d.expandAll.textContent      = fmt(L, 'expandAllSuffix', suffix);
  d.leaves.textContent         = fmt(L, 'leavesSuffix', suffix);
  d.elemPlusLeaves.textContent = fmt(L, 'elemPlusLeavesSuffix', suffix);
  d.copyName.textContent       = multiN > 1 ? fmt(L, 'copyNameMany', multiN) : L.copyName;

  const info = isCell ? _getAxisInfo(_ctxDim!) : null;
  const parentsUnion = info ? _collectParentsUnion(_ctxElems, info) : [];
  const hasParent = parentsUnion.length > 0;
  // "Expand completely"/"Leaves" ask the host (`expandSubtree`), so the enabling
  // must not hang on the reverse index of the trimmed parent map either: that
  // only knows what is loaded, and for a collapsed consolidation - the main
  // case for these commands - it is empty. `hasChildren` comes from the host and
  // applies to the whole dimension; the index remains a fallback for payloads
  // without the field.
  const hasKids   = !!(info && _ctxElems.some(
    (el) => info.hasChildren[el] || info.children[el]?.length,
  ));
  d.showParents.classList.toggle('ctx-disabled', !hasParent);
  d.showParents.classList.toggle('ctx-multi', parentsUnion.length > 1);
  _renderParentSubmenu(parentsUnion);
  d.showAllParents.classList.toggle('ctx-disabled', !hasParent);
  d.expandAll.classList.toggle('ctx-disabled', !hasKids);
  d.leaves.classList.toggle('ctx-disabled', !hasKids);
  d.elemPlusLeaves.classList.toggle('ctx-disabled', !hasKids);

  const hasFilt = !!state.dimSelections[_ctxDim!] || state.localFocus?.dim === _ctxDim;
  d.clearFilt.classList.toggle('ctx-disabled', !hasFilt);

  // Alias applies to the whole axis dimension → always available (cell or chip).
  _renderAliasSubmenu();

  _showCtxAt(e);
}

function _openSpreadMenu(ev: MouseEvent, targets: Array<{ ri: number; ci: number }>): void {
  const d = _initDom();
  _ctxSpreadTargets = targets;
  // Backwards-compat fields for any single-cell consumer reading them
  _ctxSpreadRi = targets[0]?.ri ?? null;
  _ctxSpreadCi = targets[0]?.ci ?? null;
  // Indicate count via menu items' subtitle when multi-cell
  const items = d.spreadMenu.querySelectorAll<HTMLElement>('.ctx-item');
  items.forEach((it) => {
    const base = it.dataset.baseLabel ?? it.textContent ?? '';
    if (!it.dataset.baseLabel) it.dataset.baseLabel = base;
    it.textContent = targets.length > 1 ? `${base} (${targets.length} ${L.cells})` : base;
  });
  d.spreadMenu.style.display = 'block';
  let x = ev.pageX, y = ev.pageY;
  const rect = d.spreadMenu.getBoundingClientRect();
  if (x + rect.width  > window.innerWidth)  x = window.innerWidth  - rect.width  - 4;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
  d.spreadMenu.style.left = `${x}px`;
  d.spreadMenu.style.top  = `${y}px`;
  ev.preventDefault();
}

function _openSpreadPrompt(method: SpreadMethod, targets: Array<{ ri: number; ci: number }>): void {
  const d = _initDom();
  const meta = SPREAD_LABELS[method];
  if (!meta) return;
  _spreadPromptMethod = method;
  _spreadPromptTargets = targets;
  d.spreadTitle.textContent = targets.length > 1
    ? `${meta.title} — ${targets.length} ${L.cells}`
    : meta.title;
  d.spreadLabel.textContent = meta.label;
  d.spreadInput.value = '';
  d.spreadError.style.display = 'none';
  d.spreadOverlay.classList.add('visible');
  setTimeout(() => { d.spreadInput.focus(); }, 0);
}

function _submitSpreadPrompt(): void {
  const d = _initDom();
  const raw = d.spreadInput.value.trim();
  if (raw === '') {
    d.spreadError.textContent = L.valueRequired;
    d.spreadError.style.display = 'block';
    return;
  }
  const num = Number(raw);
  if (!isFinite(num)) {
    d.spreadError.textContent = L.mustBeNumber;
    d.spreadError.style.display = 'block';
    return;
  }
  const method = _spreadPromptMethod;
  const targets = _spreadPromptTargets;
  _hideSpreadPrompt();
  if (method === null || targets.length === 0) return;
  if (targets.length === 1) sendSpread(method, num, targets[0].ri, targets[0].ci);
  else sendSpreadBulk(method, num, targets);
}

/**
 * Carry an alias pick into the MDX text of an MDX view.
 *
 * A native view keeps the choice in its axis subset (`Subset.Alias`) and needs
 * nothing here. An MDX view has no axis subsets, so the only place the alias can
 * survive save/reopen is a `DIMENSION PROPERTIES` clause in the MDX itself.
 *
 * `state.lastInlineMdx` is the text every later save/execute reads (see
 * `viewSave.ts` and `messaging.ts#doRefresh`) and the value the popup is seeded
 * with on reopen — so it is updated together with the open editor, never
 * instead of it. `null` from the pure module means "nothing to do"; writing
 * anyway would push an empty step onto the user's undo stack.
 */
function _syncAliasIntoMdxView(dim: string, alias: string | null): void {
  if (!state.isMdxView) { return; }
  const next = syncAliasIntoMdx({
    mdx: state.lastInlineMdx ?? state.originalMdx,
    isMdxView: state.isMdxView,
    dim,
    alias,
    rowDims: state.rowDims,
    colDims: state.colDims,
  });
  if (next === null) { return; }
  setInlineMdx(next);
  applyMdxToPopupEditor(next);
}

export function wireContextMenu(): void {
  const d = _initDom();

  // Unified contextmenu: cell first, then dim-level
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const tgt = e.target as Element | null;
    if (!tgt?.closest) { _hideCtx(); _hideSpreadMenu(); return; }

    // Data cell right-click → spread menu.
    // If the click hits a multi-cell selection that includes this cell, open
    // the spread menu in bulk mode over all eligible (writable C) cells in
    // the selection. Otherwise single-cell mode on this cell.
    const tdCell = tgt.closest<HTMLTableCellElement>('td[data-ri][data-ci]');
    if (tdCell && !tdCell.classList.contains('row-label')) {
      const ri = Number(tdCell.dataset.ri);
      const ci = Number(tdCell.dataset.ci);
      const cellKey = `${ri},${ci}`;
      const inSel = state.selection.has(cellKey);
      const multi = inSel && state.selection.size > 1;
      if (multi) {
        const cells: Array<{ ri: number; ci: number }> = [];
        for (const k of state.selection) {
          const [r, c] = k.split(',').map(Number);
          if (Number.isFinite(r) && Number.isFinite(c)) cells.push({ ri: r, ci: c });
        }
        const eligible = _eligibleCCells(cells);
        _ctxFormatCells = cells;
        _hideCtx();
        // No spreadable cell: the menu still opens, "Format…" applies to any cell.
        _openSpreadMenu(e, eligible);
        const dmMulti = _initDom();
        dmMulti.spreadMenu.querySelectorAll<HTMLElement>('[data-trace]').forEach((it) => { it.style.display = 'none'; });
        document.getElementById('ctx-trace-sep')?.style.setProperty('display', 'none');
        dmMulti.spreadMenu.querySelectorAll<HTMLElement>('[data-method]').forEach((it) => { it.style.display = eligible.length ? '' : 'none'; });
        document.getElementById('ctx-format-sep')?.style.setProperty('display', eligible.length ? '' : 'none');
        return;
      }
      // Single-cell path
      const flag = state.lastMatrix?.cellFlags?.[cellKey];
      const isRule   = flag?.r === 1;
      const isLocked = flag?.u === 0;
      const isC      = flag?.c === 1;
      const spreadable = isC && !isRule && !isLocked;
      _hideCtx();
      _ctxFormatCells = [{ ri, ci }];
      _openSpreadMenu(e, [{ ri, ci }]);
      document.getElementById('ctx-format-sep')?.style.setProperty('display', '');
      // Trace items always available; spread items only for spreadable C-cells.
      const dm = _initDom();
      dm.spreadMenu.querySelectorAll<HTMLElement>('[data-method]').forEach((it) => {
        it.style.display = spreadable ? '' : 'none';
      });
      dm.spreadMenu.querySelectorAll<HTMLElement>('[data-trace]').forEach((it) => {
        it.style.display = '';
      });
      const sep = document.getElementById('ctx-trace-sep');
      if (sep) { sep.style.display = spreadable ? '' : 'none'; }
      return;
    }

    const cell = tgt.closest<HTMLElement>(
      'td.row-label[data-dim-name][data-elem-name], th[data-dim-name][data-elem-name]',
    );
    if (cell) {
      _hideSpreadMenu();
      _openCtxMenu(e, cell.dataset.dimName!, cell.dataset.elemName ?? null);
      return;
    }
    const dimEl = tgt.closest<HTMLElement>(
      // .title-combo-btn is the visible context control — the select behind it is
      // display:none and never receives the contextmenu event.
      '.dim-chip[data-dim-name], .title-dim-label[data-dim-name], .title-combo-btn[data-dim-name]',
    );
    if (dimEl) {
      _hideSpreadMenu();
      _openCtxMenu(e, dimEl.dataset.dimName!, null);
      return;
    }
    _hideCtx(); _hideSpreadMenu();
  });

  document.addEventListener('click',   () => { _hideCtx(); _hideSpreadMenu(); });
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { _hideCtx(); _hideSpreadMenu(); _hideSpreadPrompt(); }
  });

  d.keepOnly.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    _hideCtx();
    // In axis order, not in click order: `_ctxElems` comes from a `Set` and
    // would otherwise stand as clicked - selected from bottom to top, "Keep
    // only" would have reversed the axis. The current selection is the more
    // precise source here than the visible names, because it preserves
    // multiple occurrences.
    const sel = state.dimSelections[_ctxDim];
    const axisOrder = sel?.kind === 'elements' ? sel.names : currentDimElements(_ctxDim);
    _postDrillFilter(_ctxDim, keepOnlyNames(axisOrder, _ctxElems));
  });

  document.getElementById('ctx-format')?.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) { return; }
    _hideCtx();
    openFormatDialog([{ dim: _ctxDim, elements: [..._ctxElems] }]);
  });
  document.getElementById('ctx-cell-format')?.addEventListener('click', () => {
    _hideSpreadMenu();
    const attr = attrCellTarget(_ctxFormatCells);
    if (attr) { openFormatDialog([], { kind: 'attrCell', ...attr }); return; }
    openFormatDialog(formatCandidates(_ctxFormatCells));
  });

  d.openBrw.addEventListener('click', () => {
    if (!_ctxDim) return;
    _hideCtx();
    vscode.postMessage({
      type: 'openDimBrowser',
      dimName: _ctxDim,
      currentElements: currentDimElements(_ctxDim),
      ..._expressionFields(_ctxDim),
      alias: state.dimAliases[_ctxDim] || '',
    });
  });

  // Alias submenu: root click keeps menu open (hover reveals submenu); a
  // submenu pick activates / deactivates the alias for the whole axis dim.
  d.alias.addEventListener('click', (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    const subItem = target?.closest<HTMLElement>('.ctx-submenu-item');
    if (!subItem) { ev.stopPropagation(); return; } // root click → keep open
    ev.stopPropagation();
    if (!_ctxDim || subItem.classList.contains('ctx-disabled')) { return; }
    const dim = _ctxDim;
    const alias = subItem.dataset.alias || '';
    _hideCtx();
    if (!alias) {
      delete state.dimAliases[dim];
      _syncAliasIntoMdxView(dim, null);
      if (state.lastMatrix) renderGrid(state.lastMatrix);
      if (state.titleDims.includes(dim)) rebuildZones();
      return;
    }
    state.dimAliases[dim] = alias;
    _syncAliasIntoMdxView(dim, alias);
    delete state.aliasMaps[dim]; // stale (cached for a previous alias)
    if (state.lastMatrix) renderGrid(state.lastMatrix); // raw names until values arrive
    vscode.postMessage({ type: 'fetchDimAliasValues', dimName: dim, alias });
  });

  d.clearFilt.addEventListener('click', () => {
    if (!_ctxDim) return;
    _hideCtx();
    // Clear both client-side focus and server-side selection
    if (state.localFocus?.dim === _ctxDim) {
      state.localFocus = null;
      if (state.lastMatrix) renderGrid(state.lastMatrix);
    }
    if (state.dimSelections[_ctxDim]) {
      vscode.postMessage({ type: 'clearDimFilter', dimName: _ctxDim });
    }
  });

  d.showParents.addEventListener('click', (ev: MouseEvent) => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    const info = _getAxisInfo(_ctxDim);
    if (!info) return;
    // If click landed inside the submenu, defer to its own handler.
    const target = ev.target as HTMLElement | null;
    if (target && target.closest('.ctx-submenu')) return;
    const hier = buildCubeStructure(state.lastMatrix, _ctxDim, state.rowDims, state.colDims);
    const union = hier
      ? Array.from(new Set(_ctxElems.flatMap((e) => parents(hier, e))))
      : _collectParentsUnion(_ctxElems, info);
    // Multi-parent: keep menu open and reveal submenu (also via hover).
    if (union.length > 1) {
      ev.stopPropagation();
      d.showParents.classList.add('ctx-submenu-open');
      return;
    }
    if (union.length === 0) return;
    _hideCtx();
    _applyParentInsert(_ctxDim, _ctxElems.slice(), union);
  });

  // Submenu pick → insert chosen parent above targets.
  d.showParents.addEventListener('click', (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    const subItem = target?.closest<HTMLElement>('.ctx-submenu-item');
    if (!subItem || !_ctxDim || _ctxElems.length === 0) return;
    const chosen = subItem.dataset.parent;
    if (!chosen) return;
    ev.stopPropagation();
    _hideCtx();
    _applyParentInsert(_ctxDim, _ctxElems.slice(), [chosen]);
  });

  d.showAllParents.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    _hideCtx();
    const info = _getAxisInfo(_ctxDim);
    if (!info) return;
    const dim = _ctxDim;
    const targets = _ctxElems.slice();

    // Walk EVERY ancestor across ALL parent paths (multi-parent BFS), not just the first-parent chain.
    const baseline = _onAxisAxisElems(dim);
    const hier = buildCubeStructure(state.lastMatrix, dim, state.rowDims, state.colDims);
    let ancestors: string[];
    if (hier) {
      ancestors = Array.from(new Set(targets.flatMap((e) => allParents(hier, e))));
    } else {
      // Fallback: original BFS over contextMenuPure AxisInfo
      const seenA = new Set<string>();
      const accum: string[] = [];
      const queue = targets.slice();
      while (queue.length) {
        const n = queue.shift()!;
        const list = info.allParents[n] && info.allParents[n].length ? info.allParents[n] : (info.parents[n] ? [info.parents[n]] : []);
        for (const p of list) {
          if (!p || seenA.has(p)) continue;
          seenA.add(p); accum.push(p); queue.push(p);
        }
      }
      ancestors = accum;
    }
    if (ancestors.length === 0) return;
    const names = Array.from(new Set([...baseline, ...targets, ...ancestors]));
    _postDrillFilter(dim, names);
  });

  d.expandAll.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    _hideCtx();
    const dim = _ctxDim;
    const targets = _ctxElems.slice();
    // Resolve the FULL subtree (all descendant C + N elements) on the server —
    // the visible (paged) matrix only holds the collapsed parent, so client-side
    // enumeration would miss unloaded descendants. The host fetches them via a
    // recursive MDX drilldown and re-applies the dim filter. Mirrors the
    // dim-browser "Expand fully" server drill.
    vscode.postMessage({ type: 'expandSubtree', dimName: dim, names: targets });
  });

  // ── New PAfE-style drill actions: Children / Descendants / Leaves /
  // Element + N-Elemente / Copy name. All use server-side setDimFilterElements
  // (with current matrix elements as baseline) so the refetch loads exactly
  // the requested set — no reliance on the client-side matrix already
  // containing the target rows/cols.
  function _onAxisAxisElems(dim: string): string[] {
    const m = state.lastMatrix;
    if (!m) return [];
    const rowDims = m.rowDims ?? state.rowDims;
    const colDims = m.colDims ?? state.colDims;
    const ri = rowDims.indexOf(dim);
    if (ri >= 0) {
      // Per-dim members — NEVER use joined `rowElements` (executeView joins
      // multi-dim tuples with ' / ' which TM1 rejects as element name).
      const tuples = m.rowTuples;
      if (tuples && tuples.length) {
        const set = new Set<string>();
        tuples.forEach((t) => { if (t[ri]) set.add(t[ri]); });
        return Array.from(set);
      }
      return m.rowElements.slice();
    }
    const ci = colDims.indexOf(dim);
    if (ci >= 0) {
      const tuples = m.colTuples;
      if (tuples && tuples.length) {
        const set = new Set<string>();
        tuples.forEach((t) => { if (t[ci]) set.add(t[ci]); });
        return Array.from(set);
      }
      return m.colElements.slice();
    }
    return [];
  }
  function _postDrillFilter(dim: string, names: string[]): void {
    // Clear stale localFocus on this dim — server filter is the visibility
    // source of truth after this message.
    if (state.localFocus && state.localFocus.dim === dim) state.localFocus = null;

    // One funnel, one question: does the loaded matrix still cover the new axis?
    // Then nothing needs to be reloaded - the action only took something away
    // (e.g. "Keep only"), and the rows are already there. Actions that ADD names
    // (insert children, descendants, parents) fail this same check on their own
    // and continue to the server. So no list of which action shrinks is needed -
    // the comparison says it.
    const base = state.axisBaseNames[dim];
    if (!state.paged && state.lastMatrix && base && isSubsequenceOf(names, base)) {
      state.dimSelections[dim] = { kind: 'elements', names };
      vscode.postMessage({ type: 'setDimFilterElements', dimName: dim, names, silent: true });
      // The saved server round trip would have rewritten `lastInlineMdx` - without
      // this marker the grid showed the narrowed axis while the MDX window and
      // saving kept carrying the old one (bug report 2026-08-20).
      markInlineMdxStale();
      renderGrid(state.lastMatrix);
      return;
    }

    vscode.postMessage({ type: 'setDimFilterElements', dimName: dim, names });
  }

  // Insert chosen parent(s) directly above the first target in the current axis order.
  function _applyParentInsert(dim: string, targets: string[], parents: string[]): void {
    const baseline = _onAxisAxisElems(dim);
    const targetSet = new Set(targets);
    const insertAt = baseline.findIndex((e) => targetSet.has(e));
    const before = insertAt >= 0 ? baseline.slice(0, insertAt) : [];
    const after  = insertAt >= 0 ? baseline.slice(insertAt) : baseline;
    const names = Array.from(new Set([...before, ...parents, ...after]));
    _postDrillFilter(dim, names);
  }

  // "All N descendants": every level-0 (leaf) descendant. Resolved server-side
  // (recursive MDX + TM1FILTERBYLEVEL 0) — the visible paged matrix only holds
  // the collapsed parent, so client-side enumeration would miss unloaded leaves.
  d.leaves.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    _hideCtx();
    vscode.postMessage({ type: 'expandSubtree', dimName: _ctxDim, names: _ctxElems.slice(), mode: 'leaves' });
  });

  // "Element + N-Elemente": the clicked consolidation(s) AND all leaf
  // descendants underneath. Skips intermediate consolidations. Server-side.
  d.elemPlusLeaves.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    _hideCtx();
    vscode.postMessage({ type: 'expandSubtree', dimName: _ctxDim, names: _ctxElems.slice(), mode: 'elemLeaves' });
  });

  d.copyName.addEventListener('click', () => {
    if (_ctxElems.length === 0) return;
    _hideCtx();
    void writeClipboard(_ctxElems.join('\n'));
  });
  d.copyMdx.addEventListener('click', () => {
    if (!_ctxDim || _ctxElems.length === 0) return;
    const dim = _ctxDim;
    _hideCtx();
    void writeClipboard(_ctxElems.map((n) => memberMdxRef(dim, n)).join(',\n'));
  });

  d.spreadOk.addEventListener('click', _submitSpreadPrompt);
  d.spreadCancel.addEventListener('click', _hideSpreadPrompt);
  d.spreadInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter')  { e.preventDefault(); _submitSpreadPrompt(); }
    if (e.key === 'Escape') { e.preventDefault(); _hideSpreadPrompt(); }
  });

  d.spreadMenu.addEventListener('click', (ev: MouseEvent) => {
    const tgt = ev.target as Element | null;
    const traceItem = tgt?.closest<HTMLElement>('[data-trace]');
    if (traceItem) {
      const kind = traceItem.dataset.trace as 'rule' | 'feeders' | 'check';
      const ri = _ctxSpreadRi, ci = _ctxSpreadCi;
      _hideSpreadMenu();
      if (ri != null && ci != null) { sendTrace(kind, ri, ci); }
      return;
    }
    const item = tgt?.closest<HTMLElement>('[data-method]');
    if (!item) return;
    const method = item.dataset.method as SpreadMethod;
    const targets = _ctxSpreadTargets.slice();
    _hideSpreadMenu();
    if (targets.length === 0) return;
    if (method === 'clear') {
      if (targets.length === 1) sendSpread('clear', 0, targets[0].ri, targets[0].ci);
      else sendSpreadBulk('clear', 0, targets);
    } else {
      _openSpreadPrompt(method, targets);
    }
  });
}

/**
 * Where a cell's format can live, in TM1's own priority order (column tuple
 * innermost first, then the row tuple, then the titles) — the first one is
 * what TM1 would use, so it is preselected. Several cells: the elements of
 * each dimension are collected over all of them.
 */
function formatCandidates(cells: Array<{ ri: number; ci: number }>): FormatTarget[] {
  const m = state.lastMatrix;
  if (!m || !cells.length) { return []; }
  const colDims = m.colDims?.length ? m.colDims : state.colDims;
  const rowDims = m.rowDims?.length ? m.rowDims : state.rowDims;
  const out: FormatTarget[] = [];
  const collect = (dims: string[], tupleOf: (c: { ri: number; ci: number }) => string[]) => {
    for (let di = dims.length - 1; di >= 0; di--) {
      const els = [...new Set(cells.map((c) => tupleOf(c)[di]).filter(Boolean))];
      out.push({ dim: dims[di], elements: els });
    }
  };
  collect(colDims, (c) => m.colTuples?.[c.ci] ?? [m.colElements[c.ci]]);
  collect(rowDims, (c) => m.rowTuples?.[c.ri] ?? [m.rowElements[c.ri]]);
  const titles = m.titleAssignments ?? state.titleAssignments;
  for (const [dim, el] of Object.entries(titles)) { if (el) { out.push({ dim, elements: [el] }); } }
  return out;
}

/**
 * In `}ElementAttributes_<dim>`, cells of the `Format` column are the stored
 * element formats themselves: the dialog then edits those cells (prefix and
 * all). Returns the dimension and the elements, or null when the selection is
 * anything else.
 */
function attrCellTarget(cells: Array<{ ri: number; ci: number }>): { dim: string; elements: string[] } | null {
  const dim = attrCubeDimension(state.cubeName);
  const m = state.lastMatrix;
  if (!dim || !m || !cells.length) { return null; }
  const attrDim = state.cubeName;
  const colDims = m.colDims?.length ? m.colDims : state.colDims;
  const rowDims = m.rowDims?.length ? m.rowDims : state.rowDims;
  const at = (dims: string[], tuple: string[] | undefined, want: string) => {
    const i = dims.indexOf(want);
    return i < 0 || !tuple ? undefined : tuple[i];
  };
  const elements: string[] = [];
  for (const c of cells) {
    const colT = m.colTuples?.[c.ci] ?? [m.colElements[c.ci]];
    const rowT = m.rowTuples?.[c.ri] ?? [m.rowElements[c.ri]];
    const attr = at(colDims, colT, attrDim) ?? at(rowDims, rowT, attrDim) ?? m.titleAssignments?.[attrDim];
    const el = at(rowDims, rowT, dim) ?? at(colDims, colT, dim) ?? m.titleAssignments?.[dim];
    if (!attr || attr.toLowerCase() !== 'format' || !el) { return null; }
    if (!elements.includes(el)) { elements.push(el); }
  }
  return { dim, elements };
}

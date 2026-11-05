/**
 * Click dispatcher for the cube grid table: header multi-select
 * (Ctrl/Cmd/Shift) and the collapse/expand toggle with its three paths —
 * expression axis, server-side element filter, and plain axis (host child
 * query, then focus/collapse tail).
 */

import { state } from './state';
import type { MatrixData } from './state';
import { vscode } from './vscodeApi';
import { getRefs } from './dom';
import { insertChildrenAfterParent, toggleFilterNames, nthOccurrenceIndex, isSubsequenceOf } from './gridPure';
import { drillDownMemberSet, drillUpMemberSet } from './mdxParts';
import { markInlineMdxStale } from './mdxBuild';
import type { GridCtx } from './gridAxes';

// ── Kind queries to the host ────────────────────────────────────────────────
// Its own counter, NOT `nextReqId`/`state._reqSent`: that one counts the
// refresh generation, and a collapse click must not invalidate a refresh
// response that is still running. Only the most recent child query continues
// its click.
let _childReqSeq = 0;

/** One resolved toggle click: the member it addresses plus the render it
 *  happened on. `rerender` is `renderGrid`, passed in to avoid an import cycle. */
interface ToggleClick {
  ctx: GridCtx;
  rerender: (m: MatrixData) => void;
  dimName: string;
  elemName: string;
  clickedOcc: number;
  clickedColl: boolean | undefined;
}

export function wireGridClick(table: HTMLTableElement, ctx: GridCtx, rerender: (m: MatrixData) => void): void {
  // ── Toggle / selection click handler ────────────────────
  table.addEventListener('click', (e: MouseEvent) => {
    const tgt = e.target as Element | null;
    if (!tgt?.closest) { return; }

    // Ctrl/Cmd or Shift click → header multi-select
    if ((e.ctrlKey || e.metaKey || e.shiftKey) && !tgt.closest('.cell-toggle')) {
      const labelEl = tgt.closest<HTMLElement>(
        'td.row-label[data-dim-name][data-elem-name], th[data-dim-name][data-elem-name]',
      );
      if (labelEl && labelEl.dataset.dimName && labelEl.dataset.elemName) {
        e.preventDefault();
        e.stopPropagation();
        _onHeaderSelectClick(labelEl, e);
        return;
      }
    }

    const toggleEl = tgt.closest<HTMLElement>('.cell-toggle');
    let dim: string | undefined;
    let elem: string | undefined;
    // The glyph carries the block ordinal it was rendered from (`data-occ`), so
    // clicking anywhere on the label toggles the same block the glyph shows.
    let occEl: HTMLElement | null = toggleEl;
    if (toggleEl) {
      dim = toggleEl.dataset.dim;
      elem = toggleEl.dataset.elem;
    } else {
      const labelEl = tgt.closest<HTMLElement>(
        'td.row-label[data-dim-name][data-elem-name], th[data-dim-name][data-elem-name]',
      );
      if (!labelEl) { return; }
      occEl = labelEl.querySelector<HTMLElement>('.cell-toggle');
      if (!occEl) { return; }
      dim = labelEl.dataset.dimName;
      elem = labelEl.dataset.elemName;
    }
    if (!dim || !elem) { return; }
    // Fixed binding for the continuations below: `dim`/`elem` are `let` and
    // lose their narrowing as soon as they are read in a closure.
    const dimName = dim;
    const elemName = elem;
    const occRaw = occEl?.dataset.occ;
    const clickedOcc = occRaw != null && occRaw !== '' ? Number(occRaw) : -1;
    // The answer that the drawn triangle used (`_toggleHtml`).
    const collRaw = occEl?.dataset.coll;
    const clickedColl = collRaw === '1' ? true : collRaw === '0' ? false : undefined;

    if (!toggleEl && state.headerSelection && Object.keys(state.headerSelection).length) {
      _clearHeaderSelection();
    }
    e.stopPropagation();

    const t: ToggleClick = { ctx, rerender, dimName, elemName, clickedOcc, clickedColl };

    // Axis travels as an EXPRESSION (filter chip, or a dynamic subset of the
    // opened view): then there is no name list in which children could be
    // entered and removed — the collapse state is part of the expression.
    // `DRILLDOWNMEMBER`/`DRILLUPMEMBER` carry it forward, the server resolves
    // the children itself (no `fetchAxisChildren` needed) and also carries
    // descendants that were never loaded. The direction comes from `data-coll`,
    // so that click and triangle use the same answer.
    const selExpr = state.dimSelections[dimName];
    if (selExpr?.kind === 'expression' && selExpr.expression) {
      const wasCollapsed = clickedColl === true;
      const next = wasCollapsed
        ? drillDownMemberSet(selExpr.expression, dimName, elemName)
        : drillUpMemberSet(selExpr.expression, dimName, elemName);
      // A marker from an earlier round must not hide the freshly fetched
      // children right away again.
      if (state.collapsed[dimName]) { delete state.collapsed[dimName][elemName]; }
      // Only send, do not set it yourself: the host manages the selection (also
      // for the refresh of a NativeView) and sends it back as
      // `dimSelectionUpdate` with `autoRefresh` — one source, one redraw.
      holdScroll();
      vscode.postMessage({ type: 'setDimFilterExpression', dimName, expression: next });
      return;
    }

    // Server-side filter active → extend/shrink it
    const sel = state.dimSelections[dimName];
    if (sel?.kind === 'elements') {
      _toggleInFilter(t, sel.names);
      return;
    }

    _toggleOnAxis(t);
  });
}

// Focus/collapse tail: what the click does when the children are already
// loaded. It stands as a function because, since the host query, the expand
// path falls in here asynchronously instead of simply running on.
function _focusOrCollapseTail(t: ToggleClick, hostKids?: string[], hostDescendants?: string[]): void {
  const { ctx, dimName, elemName } = t;
  // Focus mode: matrix has children → mutate visible-set additively
  if (state.localFocus && state.localFocus.dim === dimName) {
    const focus = state.localFocus;
    const axisDi = ctx.rowAxisDims.indexOf(dimName);
    const onRowAxis = axisDi >= 0;
    const mapDi = onRowAxis ? axisDi : ctx.colAxisDims.indexOf(dimName);
    const focusAllParents = onRowAxis ? ctx.rowAllParents[mapDi] : ctx.colAllParents[mapDi];
    const focusParents = onRowAxis ? ctx.rowParents[mapDi] : ctx.colParents[mapDi];
    if (!focusAllParents && !focusParents) { return; }
    // Reverse index ONLY for clearing the descendants out of the visible
    // set, and from BOTH maps: since the trimming `all` only carries
    // multi-parent elements, `first` all the others (`axisMetaScopePure.ts`).
    // Built from `all` alone, the map stayed empty in the normal case — then
    // focus mode collapsed nothing at all anymore.
    const focusChildMap: Record<string, string[]> = {};
    const _edge = (c: string, p: string): void => { (focusChildMap[p] ??= []).push(c); };
    if (focusAllParents) {
      for (const c in focusAllParents) {
        if (Object.prototype.hasOwnProperty.call(focusAllParents, c)) {
          for (const p of focusAllParents[c]) { _edge(c, p); }
        }
      }
    }
    if (focusParents) {
      for (const c in focusParents) {
        if (Object.prototype.hasOwnProperty.call(focusParents, c)
            && !(focusAllParents?.[c]?.length)) {
          _edge(c, focusParents[c]);
        }
      }
    }
    // The host tells the direct children (`fetchAxisChildren`) — the trimmed
    // map only knows what is loaded and would overlook a child that is not
    // yet shown. The reverse index is only a fallback for the path without a
    // host query (dimension on no axis).
    const children = hostKids ?? focusChildMap[elemName] ?? [];
    if (children.length === 0) { return; }
    const anyChildVisible = children.some((c) => focus.visible.has(c));
    if (anyChildVisible) {
      if (hostDescendants && hostDescendants.length > 0) {
        // From the host, limited to the loaded axis names — exactly the set
        // that can be visible at all.
        hostDescendants.forEach((d) => focus.visible.delete(d));
      } else {
        const _stripDescendants = (name: string): void => {
          (focusChildMap[name] ?? []).forEach((c) => {
            focus.visible.delete(c);
            _stripDescendants(c);
          });
        };
        _stripDescendants(elemName);
      }
    } else {
      children.forEach((c) => focus.visible.add(c));
    }
    if (state.lastMatrix) { t.rerender(state.lastMatrix); }
    return;
  }

  state.collapsed[dimName] = state.collapsed[dimName] || {};
  if (state.collapsed[dimName][elemName]) { delete state.collapsed[dimName][elemName]; }
  else { state.collapsed[dimName][elemName] = true; }
  if (state.lastMatrix) { t.rerender(state.lastMatrix); }
}

// Hold the click and order the child list from the host. The child index
// used to live here in the client and was built over the whole dimension on
// EVERY click (160k–211k entries); since the parent maps arrive trimmed,
// the client could not derive it completely anyway. The host keeps it in
// the cache, ETag-validated.
function _askHost(
  t: ToggleClick,
  mode: 'filter' | 'expand',
  within: string[] | undefined,
  resume: (children: string[], descendants: string[]) => void,
): void {
  const { dimName, elemName, clickedOcc } = t;
  _childReqSeq += 1;
  const reqId = _childReqSeq;
  state.pendingChildLookup = { dim: dimName, elem: elemName, occ: clickedOcc, mode, reqId, resume };
  vscode.postMessage({ type: 'fetchAxisChildren', dimName, elem: elemName, within, reqId });
}

// Server-side filter path (`kind: 'elements'`).
function _toggleInFilter(t: ToggleClick, selNames: string[]): void {
  const { dimName, elemName, clickedOcc } = t;
  // `within` = the active filter list. The host restricts the descendants
  // to it, and that gives the same result: `toggleFilterNames` only strikes
  // names that are in this list — a descendant outside cannot change the
  // result. Proven by `src/test/cubeViewerToggleFilterNames.test.ts`.
  _askHost(t, 'filter', selNames, (immediate, descendants) => {
    // Read the selection fresh from the state: between click and response
    // another path may have changed it.
    const cur = state.dimSelections[dimName];
    if (cur?.kind !== 'elements') { return; }
    if (immediate.length > 0) {
      // Position-aware: only descendants BELOW the parent collapse away. A
      // member the user dragged above its consolidation in the Dimension
      // Browser has left that block and stays (live bug report 2026-08-01).
      // Block-precise via the clicked occurrence, matching the glyph above —
      // otherwise a second block of the same member toggles the first one.
      const parentIdx = Number.isFinite(clickedOcc)
        ? nthOccurrenceIndex(cur.names, elemName, clickedOcc)
        : -1;
      const newNames = toggleFilterNames(cur.names, elemName, immediate, descendants, parentIdx);
      if (state.localFocus && state.localFocus.dim === dimName) {
        state.localFocus = null;
      }
      // Clear any stale client-side collapsed flag — server is now the
      // visibility source, so _colHidden must not re-hide the children.
      if (state.collapsed[dimName]) { delete state.collapsed[dimName][elemName]; }

      // If the loaded matrix still covers the new selection, the server has
      // nothing to contribute: set the selection, silently update the host,
      // redraw. The glyph follows by itself, because it is computed from
      // `sel.names`.
      //
      // Applies to BOTH directions. Collapsing only removes what is loaded
      // anyway; re-expanding hits it as soon as the children have already
      // been fetched once before and have only been hidden since — the usual
      // case when collapsing and expanding the same node back and forth.
      //
      // NOT in page mode: there the server's `totalRows` counts, and
      // following pages come index-based from its cellset — which would
      // still contain the collapsed children. Empty-row suppression already
      // draws the same boundary.
      const base = state.axisBaseNames[dimName];
      const localToggle = !state.paged
        && !!state.lastMatrix
        && !!base
        && isSubsequenceOf(newNames, base);
      if (localToggle) {
        state.dimSelections[dimName] = { kind: 'elements', names: newNames };
        vscode.postMessage({ type: 'setDimFilterElements', dimName, names: newNames, silent: true });
        // As with "Keep only": the saved server round would have rewritten
        // the effective MDX. Without the marker an MDX view would save the
        // untrimmed axis (bug report 2026-08-20).
        markInlineMdxStale();
        t.rerender(state.lastMatrix!);
        return;
      }

      holdScroll();
      vscode.postMessage({ type: 'setDimFilterElements', dimName, names: newNames });
      return;
    }
    state.localFocus = { dim: dimName, visible: new Set(cur.names) };
    state.localFocus.visible.add(elemName);
    state.pendingDrillAction = { dim: dimName, elem: elemName, kind: 'toggle' };
    holdScroll();
    vscode.postMessage({ type: 'clearDimFilter', dimName });
  });
}

/** Keep the viewport across a toggle that reloads the cellset (`state.holdScrollTop`). */
function holdScroll(): void {
  state.holdScrollTop = getRefs().gridContainer.scrollTop;
}

// No server filter — check if children need to be fetched from server
function _toggleOnAxis(t: ToggleClick): void {
  const { ctx, dimName, elemName } = t;
  const axisDi = ctx.rowAxisDims.indexOf(dimName);
  const onRow = axisDi >= 0;
  const di = onRow ? axisDi : ctx.colAxisDims.indexOf(dimName);
  if (di < 0) {
    // Dimension on no axis — there is no row set against which "are the
    // children already there?" could be answered. As before, straight into
    // the focus/collapse tail, without bothering the host.
    _focusOrCollapseTail(t);
    return;
  }
  // Capture the visible name set of the axis NOW — it is the basis the user
  // clicked on; a refill between click and response must not reinterpret the
  // click.
  const axisTuples = onRow ? ctx.rowTuples : ctx.colTuples;
  const curElems = axisTuples
    ? Array.from(new Set(axisTuples.map((tu) => tu[di]).filter(Boolean) as string[]))
    : (onRow ? ctx.rowElements : ctx.colElements);
  // This path only needs the direct children — the descendants stay unused.
  // Still pass `within`, limited to the loaded axis names: without that
  // specification the host returns the FULL descendants, and a click on a
  // root consolidation would send half the dimension through the wire just to
  // throw it away here. `within` does not restrict the direct children (host
  // handler `fetchAxisChildren`).
  _askHost(t, 'expand', curElems, (immediate, descendants) => {
    if (immediate.length > 0) {
      const presentSet = new Set(curElems);
      const anyImmediatePresent = immediate.some((c) => presentSet.has(c));
      if (!anyImmediatePresent) {
        const baseline = state.localFocus && state.localFocus.dim === dimName
          ? Array.from(state.localFocus.visible)
          : curElems;
        // Insert children directly AFTER the parent (mirror the server-filter
        // path). The old `[...baseline, elem, ...immediate]` dropped them at
        // the very bottom of the dimension instead of under the expanded node.
        const newNames = insertChildrenAfterParent(baseline, elemName, immediate);
        if (state.localFocus && state.localFocus.dim === dimName) {
          state.localFocus = null;
        }
        // Clear stale collapsed flag — children arriving from server must not be hidden.
        if (state.collapsed[dimName]) { delete state.collapsed[dimName][elemName]; }
        holdScroll();
        vscode.postMessage({ type: 'setDimFilterElements', dimName, names: newNames });
        return;
      }
    }
    _focusOrCollapseTail(t, immediate, descendants);
  });
}

/** Clear all header-multi-selection state and strip .header-selected DOM classes. */
function _clearHeaderSelection(): void {
  state.headerSelection = {};
  state.headerSelectionAnchor = null;
  document.querySelectorAll('.header-selected').forEach((el) => el.classList.remove('header-selected'));
}

/**
 * Handle Ctrl/Cmd or Shift click on a row-label / col-header cell.
 *
 * Note: with virtual scrolling, shift-select spans only currently rendered
 * rows. Ctrl/Cmd selection works across the full dataset via state.
 */
function _onHeaderSelectClick(labelEl: HTMLElement, ev: MouseEvent): void {
  const dim = labelEl.dataset.dimName!;
  const elem = labelEl.dataset.elemName!;
  if (!state.headerSelection) state.headerSelection = {};
  let set = state.headerSelection[dim];
  if (!set) { set = new Set<string>(); state.headerSelection[dim] = set; }

  if (ev.shiftKey && state.headerSelectionAnchor && state.headerSelectionAnchor.dim === dim) {
    const refs = getRefs();
    const all = Array.from(
      refs.gridContainer.querySelectorAll<HTMLElement>(
        `td.row-label[data-dim-name="${cssEsc(dim)}"][data-elem-name],th[data-dim-name="${cssEsc(dim)}"][data-elem-name]`,
      ),
    );
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const el of all) {
      const name = el.dataset.elemName || '';
      if (!name || seen.has(name)) continue;
      seen.add(name); ordered.push(name);
    }
    const aIdx = ordered.indexOf(state.headerSelectionAnchor.elem);
    const bIdx = ordered.indexOf(elem);
    if (aIdx >= 0 && bIdx >= 0) {
      const [lo, hi] = aIdx <= bIdx ? [aIdx, bIdx] : [bIdx, aIdx];
      for (let i = lo; i <= hi; i++) set.add(ordered[i]);
    } else {
      set.add(elem);
    }
  } else {
    if (set.has(elem)) set.delete(elem);
    else set.add(elem);
    state.headerSelectionAnchor = { dim, elem };
  }

  if (set.size === 0) {
    delete state.headerSelection[dim];
    if (state.headerSelectionAnchor && state.headerSelectionAnchor.dim === dim) {
      state.headerSelectionAnchor = null;
    }
  }

  const refs = getRefs();
  refs.gridContainer.querySelectorAll<HTMLElement>(
    `td.row-label[data-dim-name="${cssEsc(dim)}"][data-elem-name],th[data-dim-name="${cssEsc(dim)}"][data-elem-name]`,
  ).forEach((el) => {
    const name = el.dataset.elemName || '';
    el.classList.toggle('header-selected', !!name && set!.has(name));
  });
}

function cssEsc(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** Opening phase: start or switch the view and bind the table and trail click handlers. */

import { initialView, freezeOrder, mdxBase, type ViewState } from './intents';
import type { WebviewToHost } from './protocol';
import { toggleMark, markRange, clearMarks, setLastClicked, lastClicked } from './viewMarks';
import { initViewControls, showActiveAlias } from './viewControls';
import { initViewDrag } from './viewDrag';
import { initColResize } from './colResize';
import { state } from './state';
import { attrColumns, columnWidth, setAttrColumns as applyAttrColumns } from './attrColumns';
import { vr, resetViewRun } from './viewRun';
import { fetchRows } from './viewFetch';
import { drawWindow, bindScroll, _resetViewportForTest } from './viewViewport';
import { paintMarkCount } from './viewStats';
import { keepMarked, removeMarked, applyFilter, previewLayer, popLayer } from './viewLayers';
import { toggleAt, setBase, setAlias, setSort, setLevel } from './viewActions';
import { moveNamesTo } from './viewOrder';

let clickBound = false;

/** For tests only: reset the module state. */
export function _resetViewPathForTest(): void {
  resetViewRun(); _resetViewportForTest();
  clickBound = false; trailBound = false;
}

/**
 * Switch the hierarchy - the selection in the header row.
 *
 * A new hierarchy is a new ANSWER: base, layers, marks and the
 * display alias belonged to the old one. A type filter may still apply over there,
 * a name selection certainly not - and an attribute of the same name would be a
 * different alias.
 *
 * `startView` does that together with the follow-up queries (attributes, levels); the
 * subset list is added here because otherwise it is only fetched on opening.
 *
 * NEVER `fetchElements`: that is the old renderer, and it drew into the same
 * table body.
 */
export function switchHierarchy(hier: string): void {
  const h = (hier || '').trim();
  if (!vr.run || !vr.poster || !h || h === vr.run.hier) { return; }
  const dim = vr.run.dim;
  const post = vr.poster;
  // Header, save and subset reference read `state._currentHier`. Set it HERE,
  // after the guard: set by the caller before it, an ignored switch left the
  // field naming a hierarchy no view was running on (review E1).
  state._currentHier = h;
  startView(dim, h, post);
  post({ type: 'fetchSubsets', dimName: dim, hierName: h });
}

/**
 * Facade for `drawWindow()`.
 *
 * Since this rework the response path calls `drawWindow()` directly -
 * outside of `src/test` there is NO caller any more. The facade lives
 * solely because the test files still know this name; no caller counter
 * supports it any more.
 */
export function drawView(): void { drawWindow(); }

/**
 * Catch up the markings.
 *
 * Formerly a sweep over ALL `<tr>` (with 200,000 rows 29 ms per click,
 * measured 2026-08-24). Now a rebuild of the slice: ~52 rows, and the
 * marking is already in the painted HTML anyway (`isMarked` as a parameter).
 * The scroll position survives because it hangs on the container, not on the `tbody`.
 *
 * Note, a side effect since this rework: `drawWindow()` can, when
 * needed, itself trigger a `fetchRows(true)` (network request) and write back
 * `scrollTop` - the old marking sweep could do neither. The callers
 * in `domKeyboard.ts` (Esc, Ctrl+A) call this trusting in a pure
 * repaint; that no longer holds without restriction.
 */
export function repaintMarks(): void { drawWindow(); }

/**
 * A click in the table body - triangle OR row. Bound on the body, not
 * on the row - the body is rewritten with every draw, a
 * binding on the row would be lost in the process.
 *
 * The attribute names the POSITION, the row behind it the member. The intent
 * then names the MEMBER, not the occurrence: `DRILLUPMEMBER` hits every
 * occurrence of the named member (measured live). That is the
 * server semantics, and the new path maps it instead of rebuilding it.
 *
 * The triangle collapses, the row marks (with Shift the range since the
 * last click) - the same split that the old path already has.
 */
function bindClick(): void {
  if (clickBound) { return; }
  const body = document.getElementById('table-body');
  if (!body) { return; }
  clickBound = true;
  (body as unknown as { addEventListener: (t: string, h: (e: unknown) => void) => void })
    .addEventListener('click', (e) => {
      const ev = e as {
        shiftKey?: boolean;
        target?: {
          classList?: { contains(c: string): boolean };
          closest?(s: string): { getAttribute(a: string): string | null } | null;
        };
      };
      const targetName = ev.target;
      if (!targetName || !targetName.closest) { return; }
      const tr = targetName.closest('tr');
      const rawIdx = tr ? tr.getAttribute('data-idx') : null;
      if (rawIdx === null) { return; }
      const idx = Number(rawIdx);
      const row = vr.rows[idx];
      // No silent fallback: a position without a row means that the
      // display and the state are drifting apart - that must be reported.
      if (!row) { console.warn('[dimBrowser] click on row', rawIdx, 'that does not exist'); return; }

      // THE TRIANGLE COLLAPSES, THE ROW MARKS.
      // Until plan 4 a click ANYWHERE on the row triggered the collapsing.
      // That collides with marking, and the conflict is resolved in favor of the
      // operation that the old path already has.
      if (targetName.classList && targetName.classList.contains('vw-twisty')) {
        // `zeile.drilled` is the collapse state of THIS occurrence, as the
        // server reported it - it decides the direction.
        toggleAt(row.name, row.drilled);
        return;
      }

      const anchor = lastClicked();
      if (ev.shiftKey && anchor !== null) {
        markRange(vr.rows, anchor, idx);
      } else {
        toggleMark(row.name);
        setLastClicked(idx);
      }
      repaintMarks();
      paintMarkCount();
    });
}

/**
 * Open a dimension via the new path - or fetch it again.
 *
 * The base is the TREE (`.Members`): on it everything is expanded, and
 * collapsing is the only collapse intent (measured live, see design).
 */
/** What a freshly opened view starts with - expression before names before tree. */
function startingView(nameList?: readonly string[], mdx?: string): ViewState {
  const e = (mdx ?? '').trim();
  if (e) { return mdxBase(e); }
  if (nameList && nameList.length) { return freezeOrder(initialView('tree'), nameList); }
  return initialView('tree');
}

export function startView(
  dim: string, hier: string, post: (m: WebviewToHost) => void,
  /**
   * The caller's preset (Cube Viewer: the current axis selection).
   *
   * It NARROWS the view - "the visible rows ARE the selection" (spec E3)
   * - and in THEIR order: an axis can be sorted arbitrarily
   * (MDX view), and a confirmation without touching must not rewrite it
   * into tree order.
   *
   * Passed as a parameter instead of read from `state`, so that it is in place BEFORE the first
   * fetch: set afterwards it would cost a whole window query for nothing.
   */
  initialNames?: readonly string[],
  /**
   * The caller's axis expression (Cube Viewer). It BEATS `initialNames`.
   *
   * Only it carries the COLLAPSE STATE: a collapsed consolidation appears there
   * as `DRILLUPMEMBER`, in the name list you cannot tell. Whoever
   * took the names would get the row back expanded. The old path
   * does the same and says so in `subset.ts#consumePendingSourceMdx`: "Where an
   * expression is present, IT is the statement."
   */
  initialMdx?: string,
  /**
   * The caller's display alias (Cube Viewer: the alias under which the
   * view shows this dimension).
   *
   * As a parameter, not set afterwards: `setAlias` fetches anew, and set
   * afterwards it would cost a whole window query for nothing - the same
   * consideration as for the preset.
   */
  initialAlias?: string,
): void {
  vr.poster = post;
  const sameHier = vr.run && vr.run.dim === dim && vr.run.hier === hier;
  vr.run = {
    dim, hier,
    view: sameHier ? vr.run!.view : startingView(initialNames, initialMdx),
    // A preview does NOT survive the restart of the view: it belongs to
    // a field that is cleared in the process.
    previousView: null, preview: null, appended: null,
    alias: sameHier ? vr.run!.alias : (initialAlias ?? ''),
    toggleAttempt: null, holdPosition: null, requestId: 0, appending: false,
  };
  if (!sameHier) {
    vr.rows = [];
    vr.hasMore = false;
    // Important 3 (final review): the marks are ELEMENT NAMES of a
    // previous dimension - if they stay, the next
    // keep/remove layer builds an INTERSECT/EXCEPT against names that the
    // NEW dimension does not know at all (empty or unchanged, without explanation),
    // and the counter/button row keep showing the old marking. Today not yet
    // reachable (hierarchy dropdown blocked in the new path, every
    // panel its own webview context) - plan 6 makes this branch reachable.
    clearMarks();
    paintMarkCount();
  }
  // The select field should say what really takes effect - even if the alias comes from
  // the caller and never went through the field.
  showActiveAlias(vr.run.alias);
  bindClick();
  initViewDrag({
    nameAt: (i) => vr.rows[i]?.name ?? null,
    moveNamesTo,
  });
  bindTrailClick();
  bindScroll();
  /**
   * Report the current column state to the host (task 8).
   *
   * Two callers, both places that CHANGE the state: the
   * `setAttrColumns` callback below (selection) and `initColResize`'s
   * release callback (width). `dim`/`post` are parameters of this
   * `startView` execution, not module variables - exactly the running view.
   */
  const reportColumns = (): void => {
    const columns = attrColumns();
    const widthsByCol: Record<string, number> = {};
    for (const n of columns) { widthsByCol[n] = columnWidth(n); }
    post({ type: 'saveAttrColumns', dimName: dim, cols: columns.slice(), widths: widthsByCol });
  };
  // The callbacks here, not as an import over there - otherwise a cycle (see
  // `ViewControlCallbacks`). `applyFilter` takes any `FilterLayer`; the
  // button row only sends type layers.
  initViewControls({
    setBase, keepMarked, removeMarked, applyLayer: applyFilter, previewLayer, setAlias,
    setSort, setLevel,
    setAttrColumns: (names) => {
      applyAttrColumns(names);
      reportColumns();
      // A reload, as with the alias change - the columns are an
      // order to the host, and the old rows do not carry the new
      // values.
      fetchRows(false);
    },
  });
  // Second caller of `reportColumns` (see there): releasing the
  // drag handle changes only a width, not a selection - no reload needed.
  initColResize(() => drawWindow(), reportColumns);
  fetchRows();
  // AFTER `fetchRows`: the rows are what the user is waiting for, the
  // attribute list only fills a select field. Only on a CHANGE, because the
  // definitions belong to the dimension and not to the window - a repeated
  // `startView` on the same dimension would otherwise fetch them once more for no reason.
  if (!sameHier) {
    post({ type: 'fetchAttrDefs', dimName: dim, hierName: hier });
    post({ type: 'fetchLevels', dimName: dim, hierName: hier });
  }
}

/**
 * Click on the `×` of the trail. Bound on the container, not on the button - like
 * `bindClick`: the trail is rewritten with every draw, a
 * binding on the button would be lost in the process.
 */
let trailBound = false;

function bindTrailClick(): void {
  if (trailBound) { return; }
  const trailEl = document.getElementById('vw-trail');
  if (!trailEl) { return; }
  trailBound = true;
  trailEl.addEventListener('click', (e: unknown) => {
    const targetName = (e as { target?: { classList?: { contains(c: string): boolean } } }).target;
    if (!targetName || !targetName.classList || !targetName.classList.contains('vw-trail-pop')) { return; }
    popLayer();
  });
}

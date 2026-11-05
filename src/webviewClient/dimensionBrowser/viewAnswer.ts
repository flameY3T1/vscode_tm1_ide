/** Answer phase: redeem viewRows, viewCount, levels and attrDefs responses from the host. */

import { rowsFromAnswer } from './rowsFromAnswer';
import type { HostToWebview } from './protocol';
import { setLastClicked } from './viewMarks';
import { setViewPhase } from './viewPhase';
import { trailHtml } from './viewTrail';
import { flashBanner } from './banner';
import { showAttrDefs, showLevels, attrColSelection } from './viewControls';
import { getL10n, fmt } from '../_shared/l10n';
import { attrColumns, setAttrColumns as applyAttrColumns } from './attrColumns';
import { vr, currentView } from './viewRun';
import { fetchRows } from './viewFetch';
import { drawWindow, rowHeight, markRowHDirty } from './viewViewport';
import { paintCounter } from './viewStats';
import { currentMdx, mdxDeviates, rowsComplete } from './viewQuery';

const L = getL10n();

/**
 * The response of the count.
 *
 * A failure gets NO banner: a missing total is not a
 * broken display, and the rows next to it are correct. `-1` falls back in `paintCounter`
 * to the left number alone.
 */
export function onViewCount(msg: Extract<HostToWebview, { type: 'viewCount' }>): void {
  if (msg.requestId !== vr.countRequestId) { return; }
  vr.total = msg.ok ? msg.total : -1;
  paintCounter();
  drawWindow();
}

/**
 * Give the level list to the select field - discarded if it belongs to a
 * different dimension (like `onAttrDefs`).
 */
export function onLevels(msg: Extract<HostToWebview, { type: 'levels' }>): void {
  if (!vr.run || msg.dimName !== vr.run.dim || msg.hierName !== vr.run.hier) { return; }
  showLevels(msg.levels || []);
}

/**
 * Give the answer to `fetchAttrDefs` to the selection list.
 *
 * Discarded if it belongs to a different dimension/hierarchy: the
 * answer to the previous dimension would otherwise arrive after the switch and fill
 * the list with attributes that do not exist here.
 */
export function onAttrDefs(msg: Extract<HostToWebview, { type: 'attrDefs' }>): void {
  if (!vr.run || msg.dimName !== vr.run.dim || msg.hierName !== vr.run.hier) { return; }
  showAttrDefs(msg.defs || [], msg.dimName);
  // The intersection with the definitions (fix round 2, finding 1) happens over there,
  // at the ONE place that knows both sides. Here only a catch-up happens:
  // a remembered column that no longer exists in this hierarchy would
  // otherwise stand as an empty ghost column in the grid and would go to the server with every fetch as
  // `rowAttrs`. In the normal case both lists are equal and nothing
  // happens - no second fetch per dimension opening.
  const selectedCols = attrColSelection();
  const currentExpr = attrColumns();
  if (selectedCols.length !== currentExpr.length || selectedCols.some((n, i) => n !== currentExpr[i])) {
    applyAttrColumns(selectedCols);
    fetchRows(false);
  }
}

/** The `viewRows` response, directly from the protocol - no hand copy next to it. */
type ViewRowsMsg = Extract<HostToWebview, { type: 'viewRows' }>;

/**
 * Redeem the response - or discard it with a reason.
 *
 * Only the ORDER is checked here: an outdated request must not overwrite a
 * younger one. The hierarchy switch is caught by the central
 * guard (`MSG_SCOPE`), because the message carries `dimName`/`hierName` -
 * the same precaution as with `drillAncestors` (K11). Two checks for
 * the same thing would be one too many.
 */
export function onViewRows(msg: ViewRowsMsg): void {
  if (!vr.run || msg.requestId !== vr.run.requestId) { return; }
  if (!msg.ok) {
    vr.fetching = false;
    // Important 3: the intent rolls back to the state before the triggering
    // click - otherwise `run.view` would carry a `DRILLUPMEMBER` that the (unchanged)
    // display never showed, and the next click would put it
    // down again without a comment.
    if (vr.run.previousView) { vr.run.view = vr.run.previousView; vr.run.previousView = null; }
    // Critical (final review): if rows already stand, they stay visible -
    // `ready` does not cover pane/table, only the spinner/error screen would
    // otherwise be wrong. If NO rows stand yet (first error on opening), the phase must
    // go to `error`, otherwise the user hangs in the spinner: the new path does not post
    // `setLoading`, so otherwise there is nobody to get them out of there again.
    if (vr.rows.length) {
      setViewPhase('ready');
      // No silent fallback: the old rows stay standing, and the
      // banner line says why nothing new came.
      flashBanner(msg.message);
    } else {
      setViewPhase('error');
      const el = document.getElementById('error-banner') as HTMLElement | null;
      if (el) { el.textContent = msg.message; }
    }
    return;
  }
  // The state BEFORE the triggering click - needed for taking back the
  // ineffective collapse further below. `run.previousView` itself is cleared
  // here because the response is there (see field comment).
  const viewBeforeClick = vr.run.previousView;
  vr.run.previousView = null;
  vr.fetching = false;
  vr.hasMore = msg.hasMore;
  // Only with rows is there anything to measure at all, and a new response
  // can bring different rows (attribute values wrap, header appears). When
  // merely scrolling on within the already loaded window, the flag stays off -
  // that is the point of the exercise (review 2026-08-24, H7).
  markRowHDirty();
  const freshRows = rowsFromAnswer(msg.rows, currentView());
  // The silent collapse click.
  //
  // `DRILLUPMEMBER` is POSITIONAL: it only removes the block that stands directly
  // behind the parent. Measured live (2026-08-22,
  // dimIndexIsTreeOrderProbe.js): on an alternative hierarchy and
  // the large dimension it works on the raw set, on `aa` it does NOT -
  // there `a` and `b` were created before their consolidation `sum`, so
  // no block stands behind `sum`. The click then did nothing and said nothing
  // (click test by flameY3T1: "when I click all, only xxx collapses, all
  // others without effect in aa").
  //
  // This is recognized from the RESULT, not from a prediction: same names in
  // the same order, and both windows complete => the layer has
  // had no effect. It is taken back so that the stack does not carry an intent
  // that the display never showed (the same rule as in the
  // error branch above).
  const attempt = vr.run.toggleAttempt;
  vr.run.toggleAttempt = null;
  // Gone after use: the next run has a reason of its own, and a
  // leftover hold would put a sorting run at the wrong place.
  const holdAfter = vr.run.holdPosition;
  vr.run.holdPosition = null;
  if (attempt && !vr.run.appending && !msg.hasMore
      && freshRows.length === attempt.rowsBefore.length
      && freshRows.every((r, i) => r.name === attempt.rowsBefore[i])) {
    if (viewBeforeClick) { vr.run.view = viewBeforeClick; }
    flashBanner(fmt(L, 'vwCollapseNoEffect', attempt.member));
  }
  if (vr.run.appending) {
    // Append instead of copying over: `concat` re-creates the WHOLE existing
    // inventory with EVERY reload. With 295,000 rows in 30 windows that is
    // ~4.4 million element copies that move nothing (review 2026-08-24, M7).
    //
    // Loop instead of `push(...neue)`: the spread passes every element on as its
    // own argument, and a window is up to `WINDOW` rows big
    // - that eventually runs into the argument limit of the runtime.
    for (const r of freshRows) { vr.rows.push(r); }
  } else {
    vr.rows = freshRows;
    // Important 1 (final review): the toggle anchor is a POSITION, not a
    // marking - it deliberately survives `applyFilter`/`toggleAt`/`popLayer`
    // (the marks are names and deliberately stay), but a
    // replaced row set makes it wrong: anchor 800 in a window with
    // 5000 rows points, after the replacement, to a completely different row in a
    // window with 40. A shift click then marked up to the end instead of up to
    // the intended row - without an error, without a warning. NOT in `fetchRows()`:
    // a running request can fail and `run.view` rolls back,
    // then the rows (and the anchor) should stay as they were.
    setLastClicked(null);
    // The same case as with the toggle anchor just now - only the scroll position instead of
    // the marking: with 100,000 rows `scrollTop` stands at ~2.2 million, and
    // a sorted/filtered set of 5000 landed in it at position ~4963
    // instead of at the top (the reload condition in `drawWindow()` then fires
    // immediately a superfluous run). Unreachable before virtualization,
    // because `scrollTop` never became that large with capped 20,000 rows.
    const container = document.getElementById('table-container') as unknown as { scrollTop: number } | null;
    // ... EXCEPT if the row that was clicked is still there: then it stays
    // at its screen position. Without this the list began at the top again after every collapse,
    // although the user had been working far below.
    const hold = holdAfter;
    const newIdx = hold ? freshRows.findIndex((r) => r.name === hold.member) : -1;
    if (container) {
      container.scrollTop = (hold && newIdx >= 0)
        ? Math.max(0, newIdx * rowHeight() - hold.offsetPx)
        : 0;
    }
  }
  // Captured BEFORE drawing: `drawWindow()` can itself trigger a
  // reload (if the view stands near `rows.length`), and `fetchRows(true)`
  // sets `run.appending = true` in the process. Without this snapshot the
  // trail/MDX bar branch below silently drops out on a FRESH response, only
  // because the renderer (not the server) set `appending`.
  const wasAppending = vr.run.appending;
  // BEFORE drawing, not after (fix round 2, finding 1): up to here
  // the phase still stands at `loading`, `#table-container` hence at `display: none`
  // - `clientHeight` is then 0, `drawWindow()` falls back to the
  // fallback `viewH` (800px) and measures a guessed `rowH`. Between these
  // two statements nothing draws; the error branch is handled
  // separately above and sets `ready`/`error` itself.
  setViewPhase('ready');
  drawWindow();
  paintCounter();
  // When appending (scroll) the expression stays unchanged - the same
  // assurance as with `fetchCount()` above (`if (!append)`). Rewriting trail and
  // MDX bar would be pure idling here: with 20,000
  // marked names `storedMdx` is ~500 KB, and a scroll batch would
  // otherwise trigger that again with EVERY append (Important 6, final review).
  if (!wasAppending) {
    // Catch up the trail - the same order as with the MDX bar in the old
    // path: first the table, then the bar above it, which names the new state.
    const trail = document.getElementById('vw-trail') as HTMLElement | null;
    if (trail && vr.run) {
      trail.innerHTML = trailHtml(vr.run.view, vr.run.preview);
      trail.style.display = 'flex';
    }
    // Fill the MDX bar with the expression - the old path does that in
    // `subset.ts`; the new one has to do it itself. VIA `currentMdx()`, so that
    // bar and popup do not have two sources: the popup read for a long time
    // `effectiveMdx()` from the old path and showed a state that the new one
    // had never declared (click test 2026-08-23).
    const bar = document.getElementById('subset-mdx-bar') as HTMLElement | null;
    const textEl = document.getElementById('subset-mdx-text') as HTMLElement | null;
    const mdx = currentMdx();
    if (textEl && mdx !== null) { textEl.textContent = mdx; }
    // The full expression as a tooltip: the bar is one line and truncates.
    // If it deviates from the server state of the loaded subset, the tooltip carries
    // BOTH - otherwise one sees THAT something is different, but not what.
    const deviation = mdxDeviates();
    if (bar && mdx !== null) {
      bar.title = deviation ? `${mdx}\n\n${L.subsetMdxOriginal ?? ''}\n${deviation}` : mdx;
    }
    const changedEl = document.getElementById('subset-mdx-changed') as HTMLElement | null;
    if (changedEl) { changedEl.style.display = deviation ? 'inline' : 'none'; }
    if (bar) { bar.style.display = 'flex'; }
  }
  // Only AFTER drawing: the comparison reads the standing rows.
  reportNotFound();
}

/**
 * Say which of the most recently inserted names the server does not know.
 *
 * Only with a COMPLETELY loaded window: a missing name could otherwise
 * stand beyond the window edge, and the message would be a claim about
 * the unseen.
 *
 * Case-insensitive, because TM1 is too (`{[SUM]}` finds `sum`).
 */
function reportNotFound(): void {
  if (!vr.run || !vr.run.appended) { return; }
  const requested = vr.run.appended;
  vr.run.appended = null;
  if (!rowsComplete()) { return; }
  const present: Record<string, true> = {};
  for (const r of vr.rows) { present[r.name.toUpperCase()] = true; }
  const missingNames = requested.filter((n) => !present[n.toUpperCase()]);
  if (missingNames.length) { flashBanner(fmt(L, 'vwPasteNotFound', missingNames.length, missingNames.join(', '))); }
}

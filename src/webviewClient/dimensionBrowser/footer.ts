/**
 * The footer: mark count, button locks, "x of y".
 *
 * Kept in its own file because it is called both from the message path
 * (`msgSession.ts`) and from selection mode. The two modules with which it used
 * to form a cycle (`render.ts`, `listState.ts`) no longer exist since the old
 * load path was removed; the numbers now come from `selectionSource.ts`.
 */

import { selectionCountFromView } from './selectionSource';
import { markCount as viewMarkCount } from './viewMarks';
import { state } from './state';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

export {};

function el(id: string): HTMLElement | null {
  return document.getElementById(id) as HTMLElement | null;
}

/**
 * Refresh selection-footer counters. Called after any state mutation that
 * affects marks or the selection.
 *
 * The marks come from `viewMarks`, the mark store of the NEW path. Until
 * 2026-08-26 this spot counted `state._markedNames` - a field whose only
 * remaining writer reset it to `{}`. The counter therefore sat permanently at 0
 * (review 2026-08-24, H6). That was not visible: it drove only
 * `btn-keep-marked`/`btn-remove-marked`/`mark-count`, and those three are in the
 * `OLD_IDS` list of `viewControls.ts`, so they are hidden. The visible counterparts
 * of the new path (`vw-btn-keep`, `vw-btn-remove`, `vw-mark-count`) are served
 * by `viewPath.ts` and `viewControls.ts` themselves - that is why the old button
 * block is dropped here without replacement instead of being rewired.
 */
export function _updateSelectionFooter(): void {
  if (state._mode !== 'selection') { return; }
  // What is counted is the VIEW. `selectionCountFromView()` always answers - the
  // earlier fallbacks to `state._visibleNames`/`_allData` were dead, since the new
  // path maintains neither field.
  const { visible: count, total } = selectionCountFromView();
  const markCount = viewMarkCount();
  let lbl: string;
  if (markCount > 0) {
    lbl = fmt(L, 'markedApplyHint', markCount);
  } else if (count === total && total > 0) {
    lbl = L.allNoFilter;
  } else {
    lbl = fmt(L, 'visibleOfTotal', count, total);
  }
  // Guarded like the neighbours above: an unguarded cast threw when the markup
  // changed and took the whole message path down with it.
  const sel = el('sel-count');
  if (!sel) {
    console.warn('[dimbrowser] sel-count missing from the markup');
    return;
  }
  sel.textContent = lbl;
}

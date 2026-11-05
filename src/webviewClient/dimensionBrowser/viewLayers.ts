/** Layers on the running view built from the marking or a filter: keep, remove, cut, filter, preview, pop. */

import { pushIntent, popIntent, freezeOrder } from './intents';
import { markCount, clearMarks, markedNames } from './viewMarks';
import type { FilterLayer } from './filterPredicate';
// flashBanner directly instead of going through a callback indirection: the only caller
// (msgSession.ts) itself passed flashBanner through an onBanner parameter, so the
// pass-through was redundant and also hid a silent fallback on an error in
// applyFilter.
import { flashBanner } from './banner';
import { getL10n, fmt } from '../_shared/l10n';
import { vr } from './viewRun';
import { fetchRows } from './viewFetch';
import { paintMarkCount } from './viewStats';
import { clipboardNames } from './viewQuery';

const L = getL10n();

/**
 * This many names is the most a `keep`/`remove` layer may carry.
 *
 * 5000 is the highest value MEASURED in spec block I (134 ms). A constant
 * instead of a number in the branch, because the same number appears in the message: an
 * increase must not make the message lie.
 */
export const MARK_LAYER_CAP = 5000;

/**
 * The selection becomes the new base - a set literal, no `INTERSECT`.
 *
 * Reasoning and measurement are at `CtxPlan.freeze` in `ctxIntents.ts`. The
 * stack drops in the process because the base replaces it: whatever comes after
 * builds on the selection.
 */
export function setSelectionAsBase(nameList: readonly string[]): void {
  if (!vr.run) { flashBanner(L.vwNoDim ?? ''); return; }
  if (!nameList.length) { flashBanner(L.vwNothingMarked ?? ''); return; }
  if (nameList.length > MARK_LAYER_CAP) {
    flashBanner(fmt(L, 'vwTooManyMarks', MARK_LAYER_CAP.toLocaleString()));
    return;
  }
  vr.run.previousView = vr.run.view;
  vr.run.view = freezeOrder(vr.run.view, nameList);
  clearMarks();
  vr.rows = [];
  vr.hasMore = false;
  paintMarkCount();
  fetchRows();
}

/**
 * Convert the marking into a layer.
 *
 * Afterwards the marking is EMPTY: it has passed into the layer and
 * appears in the trail. Applying it once more would mean laying the same layer
 * twice.
 *
 * Price, measured (spec block I, 1,634,905 rows, window 200):
 *   Remove ~280 ms per layer per window, additive.
 *   Keep costs nothing - `INTERSECT` shrinks the set, afterwards every
 *   window is cheaper than without (295 ms versus 461 ms raw).
 */
// Since "Keep" makes the selection the base, only the
// removal goes through here: "everything except b" cannot be written as a list
// without enumerating everything else - that stays a layer.
function setLayer(kind: 'remove'): void {
  if (!vr.run) { flashBanner(L.vwNoDim ?? ''); return; }
  const nameList = markedNames();
  if (!nameList.length) {
    // No silent fallback: `EXCEPT(x, {}, ALL)` would be `x` - an operation
    // that does nothing and says nothing.
    flashBanner(L.vwNothingMarked ?? '');
    return;
  }
  if (nameList.length > MARK_LAYER_CAP) {
    // Important 6 (final review): 5000 is the highest MEASURED value
    // (spec block I). `EXCEPT`/`INTERSECT` with that many names would be ~500 KB
    // of MDX, sent for rows AND count, again with every
    // scroll append. No silent fallback: the marking stays,
    // no layer is created.
    flashBanner(fmt(L, 'vwTooManyMarks', MARK_LAYER_CAP.toLocaleString()));
    return;
  }
  vr.run.previousView = vr.run.view;
  vr.run.view = pushIntent(vr.run.view, { kind, names: nameList });
  clearMarks();
  paintMarkCount();
  fetchRows();
}

/**
 * "Keep" is the SAME act as "only these elements" in the context menu - hence
 * also the same form: the selection becomes the base (decision by flameY3T1,
 * 2026-08-22). Two entry points, one result; different expressions for
 * the same word were already once the source of errors in the click test of plan 3.
 */
export function keepMarked(): void { setSelectionAsBase(markedNames()); }

export function removeMarked(): void { setLayer('remove'); }

/**
 * Ctrl+X: emit the marking AND take it out of the set.
 *
 * Without a marking NOTHING happens. Cutting everything would empty the display
 * - nobody who presses a key can have meant that.
 */
export function cutMarked(): string[] {
  if (!vr.run || !markCount()) { return []; }
  const nameList = clipboardNames();
  removeMarked();
  return nameList;
}

/**
 * Show the typed layer without creating it.
 *
 * `null` takes it back. The same layer twice does not fetch twice - the
 * debounce and a click on "Apply" would otherwise meet, and with the
 * attribute filter every round costs ~1.4 s (live 2026-08-23).
 */
export function previewLayer(layer: FilterLayer | null): void {
  if (!vr.run) { return; }
  const prevPreview = vr.run.preview;
  if (JSON.stringify(prevPreview) === JSON.stringify(layer)) { return; }
  vr.run.preview = layer;
  fetchRows();
}

/** Create a filter layer - the click path of N/C/S. */
export function applyFilter(layer: FilterLayer): void {
  if (!vr.run) {
    // No silent fallback: without an open dimension (the click came before
    // `startView` ever ran - `run` exists afterwards always, even after an
    // error on opening) the click would otherwise have no effect and no
    // explanation. `flashBanner` directly instead of via the module-local `banner`:
    // both are only set in `startView`/`_resetViewPathForTest`, so
    // `banner` is in exactly this branch always also `null` - the old
    // `if (banner)` detour swallowed the message instead of showing it
    // (final review 2026-08-22). `newViewPathFlag.ts#blockLegacyControlInNewViewPath`
    // calls `flashBanner` directly for the same reason.
    flashBanner(L.vwNoDimFilter ?? '');
    return;
  }
  vr.run.previousView = vr.run.view;
  // The preview goes UNDER in the process, instead of staying lying next to the
  // new layer: it showed the same intent, and the same layer twice is
  // the same expression with double the cost.
  vr.run.preview = null;
  vr.run.view = pushIntent(vr.run.view, { kind: 'filter', layer });
  fetchRows();
}

/** Take back the topmost layer - the click on the `×` of the trail. */
export function popLayer(): void {
  if (!vr.run || !vr.run.view.intents.length) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.view = popIntent(vr.run.view);
  fetchRows();
}

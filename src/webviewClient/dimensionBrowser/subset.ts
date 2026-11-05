/**
 * Subset & dropdown helpers for the Dimension Browser webview.
 *
 * Owns:
 * - Generic dropdown filler (`populateSelect`)
 * - Subset-picker (`_populateSubsetSelect`) + selection (`_applySubsetChoice`)
 * - Redeeming the axis expression handed in by the caller (`consumePendingSourceMdx`)
 *
 * Calls postMessage via the callbacks wired in `initSubset(callbacks)` (called
 * once at module-init from index.ts).
 *
 * Until 2026-08-26 this file additionally held the drill machinery of the OLD path -
 * `ResolvedDrill`/`DRILL_SPECS`/`drillContexts`/`planDrillEmission`/
 * `drillSaveContext`/`_buildSubsetMdx`, around 490 lines. It hung on
 * `state._drills`, and that field had had no writer any more since the old path was
 * dismantled: the gate `if (!state._drills.length) return null` was
 * impassable, so the whole block was unreachable (Review 2026-08-24, H6).
 * The drill intent of the new path lives in `drillModel.ts`.
 *
 * Extracted from `index.ts` in Hebel 9 (Phase H).
 */

import { state } from './state';
import { applySubsetPseudoInView } from './subsetSource';
import { esc } from './pure';
import { DYNAMIC_SUBSET_MARK } from '../../utils/dynamicSubsetMark';
import { getL10n } from '../_shared/l10n';
import { attachTitleCombo } from '../_shared/filterCombo';
import type { WebviewToHost } from './protocol';

export {};

const L = getL10n();

interface SubsetCallbacks {
  postMessage: (msg: WebviewToHost) => void;
}

let _cbs: SubsetCallbacks = {
  postMessage: () => {},
};

export function populateSelect(id: string, items: string[], selected: string): void {
  const sel = document.getElementById(id) as HTMLSelectElement;
  const parts: string[] = [];
  items.forEach((v) => {
    parts.push('<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>');
  });
  sel.innerHTML = parts.join('') || '<option value="">—</option>';
}

/**
 * Marker appended to a DYNAMIC subset's dropdown entry. A `<select>` option
 * renders text only (no markup, no icon), so the flag has to live in the label.
 * The glyph itself comes from the shared `DYNAMIC_SUBSET_MARK` constant, which
 * the TM1 explorer tree uses too — one symbol, one definition. It stays short
 * enough not to push long subset names out of the visible width.
 */
const DYNAMIC_MARK = '  ' + DYNAMIC_SUBSET_MARK;

/** `name ƒx` for a dynamic subset, plain `name` otherwise. */
export function subsetOptionLabel(name: string, isDynamic: boolean): string {
  return isDynamic ? name + DYNAMIC_MARK : name;
}

/**
 * The `subset-select` option VALUE of a real subset: scope prefix + raw name
 * (`pub:Sales` / `priv:Sales`). Single source of truth for that encoding —
 * `_populateSubsetSelect` writes it, `_applySubsetChoice` parses it back, and
 * `msg.ts` compares against it to tell whether a `setSubsetElements` reply still
 * answers the subset the dropdown currently shows.
 */
export function subsetOptionValue(name: string, isPrivate: boolean): string {
  return (isPrivate ? 'priv:' : 'pub:') + name;
}

/**
 * The real subset the dropdown currently points at, or `null` for the
 * pseudo-entries (`__all__`, `__nlevel__`, `__toplevel__`, `__default__`).
 *
 * Inverse of `subsetOptionValue`. The dropdown is used as the source rather than
 * `_subsetExpressionOf` or `_selectionFromSubset` because those two only ever
 * carry a DYNAMIC subset — the value here is the one place a static pick is
 * remembered too, which is what the save dialog needs to prefill its name.
 */
export function currentSubsetPick(): { name: string; isPrivate: boolean } | null {
  const sel = document.getElementById('subset-select') as HTMLSelectElement | null;
  const v = sel ? sel.value : '';
  if (v.indexOf('priv:') === 0) { return { name: v.substring(5), isPrivate: true }; }
  if (v.indexOf('pub:') === 0) { return { name: v.substring(4), isPrivate: false }; }
  return null;
}

type SubsetEntry = { name: string; isPrivate?: boolean; isDynamic?: boolean };

export function _populateSubsetSelect(subsets: SubsetEntry[]): void {
  // Keep the list as DATA as well, not just as options: the
  // save dialog has to know, for the typed target name, whether a
  // subset already exists there and whether it is static (`dynamicSaveDefaultOn`). From the
  // dropdown that could only be read back via the label - and exactly that
  // carries the dynamic marker that `subsetOptionLabel` appends.
  state._knownSubsets = (subsets || []).map((s) => ({
    name: String(s.name), isPrivate: !!s.isPrivate, isDynamic: s.isDynamic,
  }));
  const sel = document.getElementById('subset-select') as HTMLSelectElement;
  const prev = sel.value;
  const parts: string[] = [
    '<option value="__all__">' + esc(L.optAll) + '</option>',
    '<option value="__nlevel__">' + esc(L.optNLevel) + '</option>',
    '<option value="__toplevel__">' + esc(L.optTopLevel) + '</option>',
    '<option value="__default__">' + esc(L.optDefaultElement) + '</option>',
  ];
  // The dynamic flag rides on the option's LABEL (and title), never on its
  // value — `_applySubsetChoice` parses the raw subset name back out of it.
  const opt = (isPrivate: boolean, s: SubsetEntry): string =>
    '<option value="' + esc(subsetOptionValue(s.name, isPrivate)) + '"'
    + (s.isDynamic ? ' title="' + esc(L.subsetDynamicTitle) + '"' : '')
    + '>' + esc(subsetOptionLabel(s.name, !!s.isDynamic)) + '</option>';
  const pub = subsets.filter((s) => !s.isPrivate);
  const priv = subsets.filter((s) => s.isPrivate);
  if (pub.length) {
    parts.push('<optgroup label="' + esc(L.optgroupPublic) + '">');
    pub.forEach((s) => { parts.push(opt(false, s)); });
    parts.push('</optgroup>');
  }
  if (priv.length) {
    parts.push('<optgroup label="' + esc(L.optgroupPrivate) + '">');
    priv.forEach((s) => { parts.push(opt(true, s)); });
    parts.push('</optgroup>');
  }
  sel.innerHTML = parts.join('');
  let matched = false;
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === prev) { sel.selectedIndex = i; matched = true; break; }
  }
  if (!matched) { sel.value = '__all__'; }
}

/** Longest MDX prefix rendered inline in the marker bar; the full text goes on the tooltip. */
const MDX_BAR_MAX = 160;

/** Collapse the MDX to one line and cap it at `max` characters. */
export function truncateMdx(mdx: string, max: number = MDX_BAR_MAX): string {
  const oneLine = mdx.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}



/**
 * Resolve the axis expression that was passed in: it becomes the page base AND
 * the composition base, and the name prefill next to it falls away.
 *
 * Called from TWO places, and that is the point: `setMode` brings the
 * expression, but the order relative to `setHierarchies` is not
 * guaranteed. The host posts `setMode` immediately and `setHierarchies` only after
 * its queries - if the webview listener is not yet registered at that point,
 * the first post is lost and only arrives via the
 * `webviewReady` handshake, possibly AFTER `setHierarchies`. Exactly
 * that happened live (click test flameY3T1, 2026-08-20): the diagnostic reported
 * "axis expression: 642 characters" - so it was there - and yet the
 * base stood on the 24-name list of the prefill. A SINGLE resolution point in
 * `setHierarchies` is therefore a bet on the order.
 *
 * Idempotent via `_pendingSourceMdx`: whoever comes first resolves it, the second
 * finds nothing left.
 *
 * Returns whether it was resolved - the caller decides whether it
 * fetches the page again (the first page came in without a base).
 */
export function consumePendingSourceMdx(): boolean {
  const srcMdx = state._pendingSourceMdx;
  if (!srcMdx) { return false; }
  state._pendingSourceMdx = null;
  // The name prefill falls away where an expression is present: it carries the
  // rows just drawn by the caller, so at best the shadow
  // of the axis. Where an expression is present, IT is the statement.
  state._initialSelectionNames = null;
  return true;
}



/**
 * Apply the choice in the subset select.
 *
 * Two cases, there are no more: the four pseudo entries are answered by the
 * VIEW itself (`subsetSource#applySubsetPseudoInView` - "All" takes back every
 * layer, "Top level" sets a root base, "N-level" a level
 * filter, "Default element" asks the server). A real subset name
 * is fetched; its members become the base in the answer
 * (`subsetSource#loadSubsetIntoView`).
 *
 * Until 2026-08-23 this file additionally held the cleanup of the old renderer -
 * filter bar, page base, display alias, mirror, root view. The single path does
 * none of that: a new base IS the fresh start.
 */
export function _applySubsetChoice(): void {
  const v = (document.getElementById('subset-select') as HTMLSelectElement).value;
  if (applySubsetPseudoInView(v)) { return; }
  const isPrivate = v.indexOf('priv:') === 0;
  const name = v.substring(isPrivate ? 5 : 4);
  if (!state._currentDim || !state._currentHier) { return; }
  _cbs.postMessage({
    type: 'fetchSubsetElements',
    dimName: state._currentDim,
    hierName: state._currentHier,
    subsetName: name,
    isPrivate,
  });
}


/** Wire the subset-select change listener. Call once at module load. */
export function initSubset(cbs: SubsetCallbacks): void {
  _cbs = cbs;
  const sel = document.getElementById('subset-select') as HTMLSelectElement;
  sel.addEventListener('change', _applySubsetChoice);
  // Hidden native select as value carrier, filterable list on top (filterCombo.ts).
  const spot = sel.nextSibling;
  sel.parentNode!.insertBefore(
    attachTitleCombo(sel, '', undefined, { placeholder: L.filterByName, byLabel: true }), spot);
}

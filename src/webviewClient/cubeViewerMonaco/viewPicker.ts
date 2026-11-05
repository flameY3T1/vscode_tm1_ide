/**
 * View-Picker dropdown: populated from extension's `viewsData` message,
 * and on change posts `switchView` for the extension to load + send a fresh
 * `cellData` matrix. Public/Private split via <optgroup>.
 */

import { state } from './state';
import { getRefs, showLoading } from './dom';
import { vscode } from './vscodeApi';
import { getL10n } from '../_shared/l10n';
import { attachTitleCombo } from '../_shared/filterCombo';
import { sortViewsForPicker, viewOptionValue, viewOptionLabel, parseViewOptionValue } from './viewPickerPure';
import { nextReqId } from './reqGuard';

const L = getL10n();

interface SavedView { name: string; isPrivate?: boolean; isMdx?: boolean; }

let _viewsFetched = false;

export function resetViewsLoaded(): void { _viewsFetched = false; }

/** Request the full public+private view list once. Used by the picker dropdown
 *  and by the Save-View modal (so it can default the priv/pub radio). */
export function ensureViewsFetched(): void {
  if (_viewsFetched) return;
  _viewsFetched = true;
  vscode.postMessage({ type: 'fetchViews' });
}

/**
 * Arm or disarm the "Reload view" button.
 *
 * It only makes sense while a saved view is selected — with "Own selection"
 * there is nothing it could return to. Called from every place that changes
 * the dropdown selection; `showLoading` additionally disables it while a load
 * is in progress.
 */
export function syncReloadViewEnabled(): void {
  const r = getRefs();
  r.btnReloadView.disabled = state.loading || r.viewSelect.value === '__none__';
}

function escH(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Show the opened view IMMEDIATELY, without fetching the list.
 *
 * Why this exists: since P5 (2026-06-11) the list is only fetched on the first
 * click on the dropdown. Until then the `<select>` has only the placeholder
 * option, and `populateViewSelect` — the only thing that selects — never runs.
 * Anyone opening the viewer on a saved view therefore saw "Own selection"
 * instead of its name. A single option costs nothing; the saving stays in place
 * because no `fetchViews` is sent. The later real run replaces the options and
 * selects again via the same `target` value.
 */
export function showOpenedView(name: string, isPrivate: boolean, isMdx = false): void {
  const sel = getRefs().viewSelect;
  const value = viewOptionValue(name, isPrivate);
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === value) { sel.selectedIndex = i; syncReloadViewEnabled(); return; }
  }
  const opt = document.createElement('option');
  opt.value = value;
  // Same label as later from the list, otherwise the marker jumps on or off on
  // the first expand.
  opt.textContent = viewOptionLabel(name, isMdx);
  sel.appendChild(opt);
  sel.value = value;
  syncReloadViewEnabled();
}

export function populateViewSelect(rawViews: SavedView[]): void {
  // Sorting happens in the client and not in the host: it is a presentation
  // concern, and `state.knownViews` should carry the same order as the dropdown.
  const views = sortViewsForPicker(rawViews);
  // Retain the full list so the Save-View modal can default the priv/pub radio
  // to how an existing view of the typed name was previously saved.
  state.knownViews = views.map((v) => ({ name: v.name, isPrivate: !!v.isPrivate }));
  const sel = getRefs().viewSelect;
  const prev = sel.value;
  const parts: string[] = [`<option value="__none__">${escH(L.ownSelection)}</option>`];
  const pub = views.filter((v) => !v.isPrivate);
  const priv = views.filter((v) => v.isPrivate);
  // The marker `{}` goes in the LABEL, never in the value — `change` reads the
  // name back from the value, and a marker there would corrupt it.
  if (pub.length) {
    parts.push(`<optgroup label="${escH(L.publicGroup)}">`);
    pub.forEach((v) => parts.push(
      `<option value="pub:${escH(v.name)}">${escH(viewOptionLabel(v.name, !!v.isMdx))}</option>`));
    parts.push('</optgroup>');
  }
  if (priv.length) {
    parts.push(`<optgroup label="${escH(L.privateGroup)}">`);
    priv.forEach((v) => parts.push(
      `<option value="priv:${escH(v.name)}">${escH(viewOptionLabel(v.name, !!v.isMdx))}</option>`));
    parts.push('</optgroup>');
  }
  sel.innerHTML = parts.join('');

  const target = state.existingViewName
    ? viewOptionValue(state.existingViewName, state.existingViewIsPrivate)
    : prev;
  let matched = false;
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === target) { sel.selectedIndex = i; matched = true; break; }
  }
  if (!matched) { sel.value = '__none__'; }
  syncReloadViewEnabled();
}

export function wireViewPicker(): void {
  const sel = getRefs().viewSelect;
  // On expand the selection is NO LONGER touched (click test flameY3T1,
  // 2026-08-12): a `<select>` opens at the selected option, so a value reset to
  // the placeholder opens at the very top — with 82 views that meant the list
  // always started at the beginning instead of at the open view.
  //
  // The reset was here because selecting the SAME option again does not fire
  // `change`; via the detour through the placeholder, unsaved changes to a view
  // could be discarded. That detour is gone — discarding still works, only via
  // two picks (another view, then back). Expanding is the frequent action,
  // discarding the rare one; the frequent one wins.
  // The native select stays hidden as the value carrier; the combo on top of it
  // puts a filter box at the top of the list, like the title elements. The
  // list is fetched lazily on first open.
  const spot = sel.nextSibling;
  sel.parentNode!.insertBefore(
    attachTitleCombo(sel, '', ensureViewsFetched, { placeholder: L.filterByName, byLabel: true }), spot);
  sel.addEventListener('change', () => {
    const picked = parseViewOptionValue(sel.value);
    if (!picked) {
      state.existingViewName = null;
      state.existingViewIsPrivate = false;
      syncReloadViewEnabled();
      return;
    }
    state.existingViewName = picked.name;
    state.existingViewIsPrivate = picked.isPrivate;
    syncReloadViewEnabled();
    showLoading(true);
    vscode.postMessage({ type: 'switchView', viewName: picked.name, isPrivate: picked.isPrivate, reqId: nextReqId(state) });
  });

  // "Reload view": exactly the same path as a change in the dropdown, only
  // for the ALREADY selected view. The host clears the user filters
  // (`_dimSelections`), the context override and a running inline MDX and
  // re-reads the view on the server (`messaging.ts#switchView`) — so a dynamic
  // subset on the axis is re-evaluated as well.
  //
  // This path did not exist before: selecting the same option again does not
  // fire `change`, and the detour through the placeholder that was previously
  // used for it was dropped on 2026-08-12 (see the comment at `mousedown`
  // above).
  //
  // The view is read from the DROPDOWN, not from `state.existingViewName`:
  // every pivot (axis swap, chip into another zone) releases the binding in the
  // state, because the layout is no longer the saved one — but the marker in the
  // dropdown stays, and the button stays armed because its enablement also
  // hangs on the dropdown (`syncReloadViewEnabled`). Read from the state field,
  // it was silently dead after a pivot, exactly where "back to the saved view"
  // is needed.
  getRefs().btnReloadView.addEventListener('click', () => {
    const picked = parseViewOptionValue(sel.value);
    if (!picked) { return; }
    showLoading(true);
    vscode.postMessage({
      type: 'switchView',
      viewName: picked.name,
      isPrivate: picked.isPrivate,
      reqId: nextReqId(state),
    });
  });
}

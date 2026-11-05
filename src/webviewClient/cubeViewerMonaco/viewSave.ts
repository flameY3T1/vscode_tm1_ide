/**
 * Save-View modal: opens with prefilled name (existingViewName), accepts
 * private/public + overwrite flag, posts `saveView` to the extension.
 *
 * Also handles the `viewSaveResult` message: success → close after 800ms,
 * fail → re-enable Save button + show error.
 *
 * MDX-mode: `openViewSaveForMdx(mdx)` reuses the same modal for MDX-save,
 * posting `saveMdxView` instead of `saveView` on submit.
 */

import { state } from './state';
import { getRefs, showError, isToggleOn } from './dom';
import { vscode } from './vscodeApi';
import { currentDimSubsetsAll } from './axis';
import { hasCollapsedAncestorDag } from './gridPure';
import { getL10n } from '../_shared/l10n';
import { mdxMayLoseContent } from './mdxLossPure';
import { rewriteMdxSlicer } from './mdxSlicerPure';
import { ensureViewsFetched } from './viewPicker';
import { parseViewOptionValue } from './viewPickerPure';
import { mdxSaveDefaultOn } from './viewSaveMode';
import { buildCurrentMdx, effectiveInlineMdx, setInlineMdx } from './mdxBuild';
import { escCloses } from '../_shared/escCloses';
import { fmt } from '../_shared/l10n';
import { hasDisplayFormats } from '../../cubeViewer/displayFormatPure';
import { embedDisplayFormats } from '../../cubeViewer/mdxFormatEmbedPure';
import { showToast } from './dom';

const L = getL10n();

/** Plain MDX of a save in flight that embedded display formats. */
let _savedPlainMdx: string | null = null;

interface ViewSaveDom {
  modal: HTMLElement;
  name: HTMLInputElement;
  overwrite: HTMLInputElement;
  asMdx: HTMLInputElement;
  msg: HTMLElement;
  doBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  openBtn: HTMLButtonElement;
}

let _dom: ViewSaveDom | null = null;
let _pendingMdx: string | null = null;
/** The user's last explicit priv/pub choice (or the modal's open-default). Used
 *  so the live name listener can restore it when the typed name stops matching an
 *  existing view — otherwise a transient match while typing would stick. */
let _userPriv: 'private' | 'public' = 'private';

function _required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[viewSave] missing #${id}`);
  return el as T;
}

function _initDom(): ViewSaveDom {
  if (_dom) return _dom;
  _dom = {
    openBtn:   _required<HTMLButtonElement>('btn-save-view'),
    modal:     _required<HTMLElement>('view-save-modal'),
    name:      _required<HTMLInputElement>('view-save-name'),
    overwrite: _required<HTMLInputElement>('view-save-overwrite'),
    asMdx:     _required<HTMLInputElement>('view-save-as-mdx'),
    msg:       _required<HTMLElement>('view-save-msg'),
    doBtn:     _required<HTMLButtonElement>('view-save-do-btn'),
    cancelBtn: _required<HTMLButtonElement>('view-save-cancel-btn'),
  };
  return _dom;
}

/** Look up how a view of the given name is stored (public vs private) among the
 *  views last delivered by `viewsData`. Case-insensitive (TM1 view names are). */
function _lookupVisibility(name: string): 'private' | 'public' | null {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return null;
  // The open/picked view decides for its own name: a public and a private view
  // may share it, and the first name hit could be the other one.
  const own = _ownView();
  if (own && own.name.toLowerCase() === n) return own.isPrivate ? 'private' : 'public';
  const hit = state.knownViews.find((v) => v.name.toLowerCase() === n);
  return hit ? (hit.isPrivate ? 'private' : 'public') : null;
}

/** The loaded view, or after a pivot (which releases `existingViewName`) the
 *  dropdown's mark — with its visibility, not just the name. */
function _ownView(): { name: string; isPrivate: boolean } | null {
  return state.existingViewName
    ? { name: state.existingViewName, isPrivate: state.existingViewIsPrivate }
    : parseViewOptionValue(getRefs().viewSelect.value);
}

/** Keep the priv/pub radio + overwrite in sync with the typed name: if it matches
 *  an existing view, reflect that view's stored visibility; otherwise restore the
 *  user's own last choice (`_userPriv`). Recomputed from scratch each keystroke so
 *  a transient match while typing (e.g. "Sales" on the way to "Sales2") never
 *  sticks. `overwrite` tracks whether the name currently hits an existing view. */
function _syncVisibilityForName(): void {
  const d = _initDom();
  const match = _lookupVisibility(d.name.value);
  const target = match ?? _userPriv;
  const r = document.querySelector<HTMLInputElement>(`input[name="view-save-priv"][value="${target}"]`);
  if (r) r.checked = true;
  d.overwrite.checked = match !== null;
}

/** Re-apply the visibility default when the view list arrives after the modal is
 *  already open (the list is fetched lazily/async). Called on `viewsData`. */
export function refreshViewSaveVisibility(): void {
  if (!_dom || !_dom.modal.classList.contains('visible')) return;
  _syncVisibilityForName();
}

/** Prefill the shared save modal (name/overwrite/private radio) and show it.
 *  `warnMsg` renders an error-styled hint (used for the MDX loss warning). */
function _populateModal(opts: { privVal: 'private' | 'public'; warnMsg?: string }): void {
  const d = _initDom();
  // A pivot releases `existingViewName` (the layout is no longer the saved
  // one), but the dropdown keeps the view mark — offer its name, so saving the
  // pivoted layout back under the same view does not start from an empty field.
  d.name.value = _ownView()?.name ?? '';
  // Default the priv/pub radio to how a view of this name was previously saved;
  // fall back to the caller's suggestion for a new/unknown name.
  const match = _lookupVisibility(d.name.value);
  const privVal = match ?? opts.privVal;
  // Seed the user-choice tracker with the open-default so the live name listener
  // has something to restore to when the typed name stops matching a view.
  _userPriv = opts.privVal;
  d.overwrite.checked = !!state.existingViewName || match !== null;
  // Pre-set "As MDX": on, unless a real native view is loaded. Rationale and
  // edge cases are at `mdxSaveDefaultOn`. Deliberately re-set on EVERY open —
  // the origin changes with every view switch and every pivot.
  d.asMdx.checked = mdxSaveDefaultOn({
    existingViewName: state.existingViewName,
    isMdxView: state.isMdxView,
    pendingMdx: _pendingMdx,
  });
  _syncFormatsRow();
  d.doBtn.disabled = false;
  const privRadio = document.querySelector<HTMLInputElement>(`input[name="view-save-priv"][value="${privVal}"]`);
  if (privRadio) privRadio.checked = true;
  if (opts.warnMsg) {
    d.msg.className = 'modal-msg error';
    d.msg.textContent = opts.warnMsg;
  } else {
    d.msg.textContent = '';
    d.msg.className = 'modal-msg';
  }
  d.modal.classList.add('visible');
  setTimeout(() => { d.name.focus(); d.name.select(); }, 30);
}

/** Display formats can travel only in an MDX view; the row says so and why
 *  the formatted rows/columns will not take input there. */
function _syncFormatsRow(): void {
  const d = _initDom();
  const row = document.getElementById('view-save-formats-row');
  const box = document.getElementById('view-save-formats') as HTMLInputElement | null;
  const note = document.getElementById('view-save-formats-note');
  if (!row || !box || !note) { return; }
  row.hidden = !hasDisplayFormats(state.displayFormats);
  box.disabled = !d.asMdx.checked;
  // TM1 picks by cube dimension order where two formatted members cross, not
  // by the grid's column-before-row rule (measured 11.8, 2026-09-27).
  const dims = Object.keys(state.displayFormats).length;
  note.textContent = !d.asMdx.checked ? L.fmtSaveNativeOnly
    : dims > 1 ? `${L.fmtSaveNote} ${L.fmtSaveCross}` : L.fmtSaveNote;
}

function _open(): void {
  _pendingMdx = null;
  if (state.rowDims.length === 0 || state.colDims.length === 0) {
    showError(L.needRowAndColDim);
    return;
  }
  // Make sure the view list is loaded so an existing name defaults the radio;
  // refreshViewSaveVisibility() re-applies it if the list arrives after open.
  ensureViewsFetched();
  // Default to the currently-loaded view's stored visibility so re-saving an
  // existing view preselects its prior private/public choice even before the
  // (async) view list arrives; _lookupVisibility still overrides on match.
  _populateModal({ privVal: state.existingViewIsPrivate ? 'private' : 'public' });
}

function _close(): void {
  _pendingMdx = null;
  _dom?.modal.classList.remove('visible');
}

function _submit(): void {
  // A failed earlier save must not leave its plain MDX for this one.
  _savedPlainMdx = null;
  const d = _initDom();
  const refs = getRefs();
  const name = (d.name.value ?? '').trim();
  if (!name) {
    d.msg.className = 'modal-msg error';
    d.msg.textContent = L.enterName;
    d.name.focus();
    return;
  }
  const privSel = document.querySelector<HTMLInputElement>('input[name="view-save-priv"]:checked');
  const isPrivate = privSel?.value === 'private';
  const overwrite = d.overwrite.checked;

  d.msg.className = 'modal-msg info';
  d.msg.textContent = L.saving;
  d.doBtn.disabled = true;

  // Sync titleAssignments live before any save path.
  const titleAssignments: Record<string, string> = {};
  refs.zoneTitles.querySelectorAll<HTMLSelectElement>('.title-elem-sel').forEach((s) => {
    if (s.dataset.dim && s.value) titleAssignments[s.dataset.dim] = s.value;
  });
  state.titleAssignments = titleAssignments;

  // The modal is shared. Save-type priority:
  //  1. _pendingMdx (opened via the MDX-editor overlay) → save that MDX verbatim.
  //  2. state.isMdxView (an MDX view is loaded) → save the current effective MDX,
  //     NOT a native view. Toolbar-Save must never silently convert an MDX view
  //     to native. lastInlineMdx already reflects pivots/axis-filters/suppress;
  //     re-assert the WHERE slicer for the current context members.
  //     (An MDXView stores only an MDX string — a multi-element context
  //     restriction has no title-subset to persist; it stays a runtime dropdown
  //     filter, with the single selected member in WHERE.)
  // The save mode is now decided by the checkbox, no longer by a silent rule.
  // Its default comes from `mdxSaveDefaultOn`; whoever changes it means it.
  if (d.asMdx.checked) {
    // 1. Opened from the MDX window → exactly this MDX, unchanged.
    // 2. MDX view loaded → the currently effective MDX; `lastInlineMdx` already
    //    carries pivots/axis filters/suppress, only the WHERE slicer is set anew
    //    for the current context elements.
    // 3. Otherwise (fresh cube, pivoted, native view deliberately switched) →
    //    build from the current axis configuration.
    let mdx: string | null = _pendingMdx;
    if (mdx === null) {
      const base = effectiveInlineMdx();
      mdx = base ? rewriteMdxSlicer(base, titleAssignments) : buildCurrentMdx();
    }
    if (!mdx) {
      d.msg.className = 'modal-msg error';
      d.msg.textContent = L.mdxEmpty;
      d.doBtn.disabled = false;
      return;
    }
    const withFormats = (document.getElementById('view-save-formats') as HTMLInputElement | null)?.checked;
    let plainMdx: string | undefined;
    if (withFormats && hasDisplayFormats(state.displayFormats)) {
      plainMdx = mdx;
      const r = embedDisplayFormats(mdx, state.displayFormats);
      mdx = r.mdx;
      if (r.skipped.length) {
        showToast(fmt(L, 'fmtSaveSkipped', r.skipped.map((s) => `${s.dim} › ${s.element}`).join(', ')), 'error');
      }
    }
    _savedPlainMdx = plainMdx ?? null;
    vscode.postMessage({ type: 'saveMdxView', mdx, viewName: name, isPrivate, overwrite, plainMdx });
    return;
  }

  // Native view path.
  // Curated context-dim restrictions (title dim → element names). Only genuine
  // multi-element restrictions; a single element is a normal unrestricted slice.
  // Host folds these into the native view's title subsets (round-trip persist).
  const titleSubsets: Record<string, string[]> = {};
  state.titleDims.forEach((d) => {
    const s = state.dimSelections[d];
    if (s && s.kind === 'elements' && s.names.length > 1) { titleSubsets[d] = s.names; }
  });
  vscode.postMessage({
    type: 'saveView',
    viewName: name,
    isPrivate, overwrite,
    rowDims: state.rowDims, colDims: state.colDims,
    titleAssignments,
    suppressRows: isToggleOn(refs.chkSuppRows),
    suppressCols: isToggleOn(refs.chkSuppCols),
    dimSubsets: withoutCollapsed(currentDimSubsetsAll()),
    dimAliases: { ...state.dimAliases },
    titleSubsets,
  });
}

/**
 * A collapse made only in the grid is part of what a native view saves:
 * the saved view shows what was on screen (decided 2026-11-03, review C7).
 * Only here — a workbench capture keeps the query and restores the collapse
 * as display state.
 */
function withoutCollapsed(subsets: Record<string, string[]>): Record<string, string[]> {
  const m = state.lastMatrix;
  if (!m) { return subsets; }
  const out = { ...subsets };
  const axes = [
    { dims: m.rowDims ?? [], parents: m.rowParents, allParents: m.rowAllParents },
    { dims: m.colDims ?? [], parents: m.colParents, allParents: m.colAllParents },
  ];
  for (const { dims, parents, allParents } of axes) {
    dims.forEach((d, i) => {
      if (!out[d]) { return; }
      out[d] = out[d].filter((e) => !hasCollapsedAncestorDag(e, allParents?.[i] ?? {}, state.collapsed[d], parents?.[i]));
    });
  }
  return out;
}

export function wireViewSave(): void {
  const d = _initDom();
  d.openBtn.addEventListener('click', _open);
  d.cancelBtn.addEventListener('click', _close);
  d.doBtn.addEventListener('click', _submit);
  // Enter in the name field ends the dialog like the Save button does — via the button,
  // so a disabled Save still refuses.
  d.name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); d.doBtn.click(); }
  });
  // Escape aborts it, wherever the focus sits inside the modal.
  escCloses(d.modal, _close);
  // Live-update the priv/pub radio as the user types a name matching an existing view.
  d.name.addEventListener('input', _syncVisibilityForName);
  d.asMdx.addEventListener('change', _syncFormatsRow);
  // Remember an explicit priv/pub choice so _syncVisibilityForName can restore it
  // when the typed name no longer matches an existing view.
  document.querySelectorAll<HTMLInputElement>('input[name="view-save-priv"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked && (radio.value === 'private' || radio.value === 'public')) {
        _userPriv = radio.value;
      }
    });
  });
}

/** Opens the save-view modal pre-configured for an MDX save.
 *  Skips the native row/col guard; prefills name + overwrite + private from state. */
export function openViewSaveForMdx(mdx: string): void {
  _pendingMdx = mdx;
  ensureViewsFetched();
  _populateModal({
    privVal: state.existingViewIsPrivate ? 'private' : 'public',
    warnMsg: mdxMayLoseContent(state.originalMdx, mdx) ? L.mdxLossWarn : undefined,
  });
}

/** Called from messaging.ts on `viewSaveResult` message. */
export function handleViewSaveResult(msg: {
  ok: boolean; message?: string; viewName?: string; isPrivate?: boolean;
}): boolean {
  const d = _initDom();
  if (msg.ok) {
    d.msg.className = 'modal-msg info';
    d.msg.textContent = msg.message ?? L.saved;
    if (msg.viewName) { state.existingViewName = msg.viewName; }
    if (msg.isPrivate !== undefined) { state.existingViewIsPrivate = !!msg.isPrivate; }
    // The saved view now carries the current context, so refreshes may execute it
    // directly again — the pick no longer overrides someone else's view.
    state.titleOverride = false;
    _pendingMdx = null;
    if (_savedPlainMdx) {
      // Saved with format members: from now on this window is an MDX view
      // that refreshes through its plain query (the host keeps the same one).
      state.isMdxView = true;
      state.originalMdx = _savedPlainMdx;
      setInlineMdx(_savedPlainMdx);
    }
    _savedPlainMdx = null;
    setTimeout(() => { d.modal.classList.remove('visible'); }, 800);
    return true; // caller should refetch view list
  }
  _savedPlainMdx = null;
  d.msg.className = 'modal-msg error';
  d.msg.textContent = msg.message ?? L.saveFailed;
  d.doBtn.disabled = false;
  return false;
}

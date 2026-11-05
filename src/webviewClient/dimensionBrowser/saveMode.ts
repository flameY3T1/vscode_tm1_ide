/**
 * Save-subset modal for the Dimension Browser webview.
 *
 * `_openSaveModal` / `_closeSaveModal` show/hide the modal that takes the
 * target subset name, the private/public radio, the overwrite checkbox and the
 * "save as a dynamic subset (MDX)" option.
 *
 * The `_enterSaveMode` / `_exitSaveMode` pair that used to live here is gone:
 * it only unveiled a second Save button in the selection footer, without
 * offering a choice the modal did not already make — so `#save-subset-btn`
 * opens the modal directly now. Post-save mark cleanup moved into the
 * `subsetSaveResult` branch of `msg.ts`, which owns the rest of that sequence.
 *
 * Extracted from `index.ts` in Hebel 9 (Phase I). The modal's listeners
 * (`initSaveModalHandlers`, at the very bottom) stood until S2-12 (Review 2026-08-02) as
 * block 9 in the monolithic `dom.ts` and moved here - a pure
 * move, no behavior change.
 */

import { state } from './state';
import { subsetSaveInput, saveIsSafe, dynamicSavePlanForView } from './subsetSource';
import { dynamicSaveExpression, dynamicSaveDefaultOn } from './pure';
import type { DynamicSavePlan } from './pure';
import { currentSubsetPick, truncateMdx } from './subset';
import { getL10n, fmt } from '../_shared/l10n';
import { escCloses } from '../_shared/escCloses';
import type { WebviewToHost } from './protocol';

export {};

const L = getL10n();

/**
 * Whether the user has touched the dynamic checkbox while this modal is open.
 *
 * The checkbox defaults to ON whenever a dynamic save is possible, and that
 * default is re-evaluated on every keystroke in the name box (the target name
 * decides whether an existing dynamic subset is being rewritten). Once the user
 * has made a choice, re-evaluating must not silently flip it back.
 */
let _dynTouched = false;

/**
 * The current dynamic-save offer, derived from the modal's inputs plus the live
 * drill/subset state. Recomputed on demand — never cached — so the answer can
 * never lag behind the name the user just typed.
 */
function _computeDynamicSavePlan(): DynamicSavePlan {
  const nameEl = document.getElementById('save-name') as HTMLInputElement | null;
  const name = (nameEl?.value || '').trim();
  const privEl = document.querySelector('input[name="save-priv"]:checked') as HTMLInputElement | null;
  const isPrivate = (privEl?.value ?? 'private') === 'private';
  // The offer comes from the VIEW: there is always an expression there.
  // The target name goes in WITH it - if the base points by name at exactly this
  // subset, the expression would be a self-reference (`baseIsTarget`); live on 11.8
  // TM1 swallows that, and the subset loses its members in the process.
  return dynamicSavePlanForView({ name, isPrivate }) as DynamicSavePlan;
}

/**
 * Re-evaluate the dynamic-save offer and repaint its row: checkbox enabled/
 * checked state, the reason line when it is unavailable, and the MDX preview.
 *
 * The reason line matters — a greyed-out checkbox with no explanation reads as
 * a broken dialog rather than as "your selection no longer describes a drill".
 */
export function _syncDynamicSaveRow(): void {
  const box = document.getElementById('save-dynamic') as HTMLInputElement | null;
  if (!box) { return; }
  const plan = _computeDynamicSavePlan();
  box.disabled = !plan.available;
  if (!plan.available) { box.checked = false; }
  else if (!_dynTouched) {
    // Prefill "as MDX", unless the target is a subset that is static on the server -
    // rationale at `dynamicSaveDefaultOn`. The target name is read fresh
    // here, because this function hangs on every keystroke in the
    // name field and the answer changes with it.
    const nameEl = document.getElementById('save-name') as HTMLInputElement | null;
    const privEl = document.querySelector('input[name="save-priv"]:checked') as HTMLInputElement | null;
    box.checked = dynamicSaveDefaultOn(
      true,
      { name: (nameEl?.value || '').trim(), isPrivate: (privEl?.value ?? 'private') === 'private' },
      state._knownSubsets,
    );
  }

  // `partial` is the only reason that is BOTH available and still needs a hint:
  // the checkbox stays on, but the user has to be told that only some of the
  // drills are still dynamic — the rest were degraded to fixed members.
  const hint = document.getElementById('save-dynamic-hint') as HTMLElement | null;
  if (hint) {
    if (plan.reason === 'partial') {
      hint.textContent = fmt(L, 'dynSavePartial', plan.activeDrills, plan.activeDrills + plan.demotedDrills);
      hint.style.display = 'block';
    } else if (plan.reason === 'duplicates') {
      hint.textContent = L.dynSaveDuplicates;
      hint.style.display = 'block';
    } else if (plan.reason === 'too-many-moves') {
      hint.textContent = L.dynSaveTooManyMoves;
      hint.style.display = 'block';
    } else if (plan.reason === 'shared-elements') {
      // The same number as above, but the user has not moved anything - the
      // rows repeat because a child hangs under several parents.
      hint.textContent = L.dynSaveSharedElements;
      hint.style.display = 'block';
    } else if (plan.reason === 'simulation-mismatch') {
      hint.textContent = L.dynSaveNotExpressible;
      hint.style.display = 'block';
    } else if (plan.reason === 'base-is-target') {
      hint.textContent = L.dynSaveBaseIsTarget;
      hint.style.display = 'block';
    } else if (plan.reason === 'window-limited') {
      hint.textContent = L.dynSaveWindowLimited;
      hint.style.display = 'block';
    } else if (!plan.available) {
      hint.textContent = plan.reason === 'selection-changed' ? L.dynSaveAllDemoted : L.saveDynamicNoDrill;
      hint.style.display = 'block';
    } else {
      hint.textContent = '';
      hint.style.display = 'none';
    }
  }

  // Preview only while the box is ticked: an MDX line under an unticked box
  // would advertise something the save is not going to store.
  const show = plan.available && box.checked && !!plan.expression;
  const preview = document.getElementById('save-dynamic-preview') as HTMLElement | null;
  if (preview) {
    preview.style.display = show ? 'block' : 'none';
    preview.title = show ? plan.expression : '';
  }
  const mdxEl = document.getElementById('save-dynamic-mdx') as HTMLElement | null;
  if (mdxEl) { mdxEl.textContent = show ? truncateMdx(plan.expression) : ''; }
}

/** Remember that the user set the checkbox by hand (see `_dynTouched`). */
export function _markDynamicSaveTouched(): void {
  _dynTouched = true;
}

/**
 * The `expression` the pending `saveSubset` message should carry — `undefined`
 * for a static (element-list) save.
 *
 * Recomputes the plan instead of trusting the last repaint, so a save can never
 * ship an expression that belongs to a name the user has since edited.
 */
export function _dynamicSaveExpression(): string | undefined {
  const box = document.getElementById('save-dynamic') as HTMLInputElement | null;
  const checked = !!box && box.checked && !box.disabled;
  return dynamicSaveExpression(_computeDynamicSavePlan(), checked);
}

export function _openSaveModal(): void {
  // Prefill from the dropdown: whoever edits a loaded subset will in
  // all likelihood want to write it back under the same name - they should not have to
  // type it out. The scope (private/public) comes along too, otherwise the
  // dialog displays one name but means another subset.
  //
  // "Overwrite" deliberately stays OFF: a prefilled name plus a pre-checked
  // overwrite would be one click away from silently replacing someone else's subset.
  // The host reports the conflict, the checkbox is the deliberate answer.
  const pick = currentSubsetPick();
  const nameEl = document.getElementById('save-name') as HTMLInputElement;
  nameEl.value = pick ? pick.name : '';
  (document.getElementById('save-overwrite') as HTMLInputElement).checked = false;
  const msgEl = document.getElementById('save-msg') as HTMLElement;
  msgEl.textContent = '';
  msgEl.className = 'modal-msg';
  (document.getElementById('save-do-btn') as HTMLButtonElement).disabled = false;
  const scope = pick && !pick.isPrivate ? 'public' : 'private';
  (document.querySelector('input[name="save-priv"][value="' + scope + '"]') as HTMLInputElement).checked = true;
  _dynTouched = false;
  _syncDynamicSaveRow();
  (document.getElementById('save-modal') as HTMLElement).classList.add('visible');
  // Focus the prefilled name with it selected: typing replaces it, Enter accepts it.
  setTimeout(() => { nameEl.focus(); nameEl.select(); }, 30);
}

export function _closeSaveModal(): void {
  (document.getElementById('save-modal') as HTMLElement).classList.remove('visible');
}

type VsApi = { postMessage: (msg: WebviewToHost) => void } | null;

/**
 * Short hint above the list - the channel through which this dialog justifies its
 * refusals (no `alert` in the webview sandbox).
 *
 * Deliberately here rather than from `banner.ts`: `saveMode.ts` otherwise imports
 * `banner.ts` nowhere else.
 */
function _flashSaveBanner(text: string): void {
  const el = document.getElementById('error-banner') as HTMLElement | null;
  if (!el) { return; }
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(function () { el.style.display = 'none'; }, 2500);
}

/** Wires up the controls of the save modal. Called from `dom.ts#initDomHandlers`. */
export function initSaveModalHandlers(vscode: VsApi): void {
  // One click opens the dialog. There used to be an intermediate "save mode"
  // that only unveiled a second Save button in the selection footer — a step
  // without a choice, since the save handler below resolves the element list
  // the same way either way (list → marks → visible).
  (document.getElementById('save-subset-btn') as HTMLButtonElement).addEventListener('click', function () {
    const hasSomething = subsetSaveInput().names.length;
    if (!hasSomething) { _flashSaveBanner(L.noVisibleElements); return; }
    _openSaveModal();
  });

  (document.getElementById('save-cancel-btn') as HTMLButtonElement).addEventListener('click', _closeSaveModal);
  // Escape aborts the dialog the way Enter finishes it.
  escCloses(document.getElementById('save-modal') as HTMLElement, _closeSaveModal);

  // Whether a DYNAMIC save is on the table depends on the target the user is
  // typing (an existing dynamic subset saved under its own name keeps its MDX),
  // so re-evaluate the option on every name keystroke and scope switch — not
  // just when the modal opens.
  const _saveNameEl = document.getElementById('save-name') as HTMLInputElement | null;
  if (_saveNameEl) {
    _saveNameEl.addEventListener('input', _syncDynamicSaveRow);
    // Enter finishes the dialog, as the focus comment at _openSaveModal promises.
    _saveNameEl.addEventListener('keydown', function (e: KeyboardEvent) {
      if (e.key !== 'Enter') { return; }
      e.preventDefault();
      (document.getElementById('save-do-btn') as HTMLButtonElement).click();
    });
  }
  document.querySelectorAll('input[name="save-priv"]').forEach(function (el) {
    el.addEventListener('change', _syncDynamicSaveRow);
  });
  const _saveDynEl = document.getElementById('save-dynamic') as HTMLInputElement | null;
  if (_saveDynEl) {
    _saveDynEl.addEventListener('change', function () {
      // A hand-set checkbox outranks the default for the rest of this dialog.
      _markDynamicSaveTouched();
      _syncDynamicSaveRow();
    });
  }

  (document.getElementById('save-do-btn') as HTMLButtonElement).addEventListener('click', function () {
    if (!vscode) { return; }
    const nameInput = document.getElementById('save-name') as HTMLInputElement;
    const name = (nameInput.value || '').trim();
    const msgEl = document.getElementById('save-msg') as HTMLElement;
    if (!name) {
      msgEl.className = 'modal-msg error';
      msgEl.textContent = L.enterName;
      nameInput.focus();
      return;
    }
    const isPrivate = (document.querySelector('input[name="save-priv"]:checked') as HTMLInputElement).value === 'private';
    const overwrite = (document.getElementById('save-overwrite') as HTMLInputElement).checked;
    // Saving ALWAYS takes all visible rows (spec E5). Marks have no effect
    // here on purpose - a forgotten mark would otherwise silently boil a
    // 4000-element subset down to three elements.
    // ONE place decides where names, alias and expression come from
    // (`subsetSource.ts`) - the new path does not maintain `state._visibleNames` and
    // `state._displayAlias`, and reading them here would write the state
    // of a path that is not drawing at all.
    const dynExpr = _dynamicSaveExpression();
    const input = subsetSaveInput();
    // Saving an incompletely loaded window statically would mean silently turning
    // a large set into just the loaded rows.
    if (!saveIsSafe(input, !!dynExpr)) {
      msgEl.className = 'modal-msg error';
      msgEl.textContent = L.vwSaveWindowIncomplete ?? '';
      return;
    }
    const names = input.names.slice();
    state._lastSavedSubset = { name: name, isPrivate: isPrivate, elements: names.slice() };
    msgEl.className = 'modal-msg info';
    msgEl.textContent = L.savingEllipsis;
    (document.getElementById('save-do-btn') as HTMLButtonElement).disabled = true;
    const saveMsg: Extract<WebviewToHost, { type: 'saveSubset' }> = {
      type: 'saveSubset',
      dimName: state._currentDim,
      hierName: state._currentHier,
      subsetName: name,
      isPrivate: isPrivate,
      overwrite: overwrite,
      elements: names,
      // Save the subset under the labels it is being read under. An overwrite
      // PATCHes in place with an explicit `Alias: ''` when none is given, so
      // leaving this off would not merely skip the alias — it would strip
      // whatever alias the old subset had.
      displayAlias: input.alias,
    };
    // The "dynamic subset (MDX)" checkbox decides whether an expression rides
    // along at all: ticked → either the subset's OWN server MDX (write-back is
    // ownership-checked in `expressionForSave`, so opening dynamic subset X and
    // saving as Y can never stamp X's rule onto Y) or the semantic MDX of the
    // active drill. Unticked → none, i.e. an explicit conversion to a static
    // list, which the host confirms before it destroys anything.
    // `elements` stays on the message either way — the host's fallback.
    // In the new path the expression is that of the VIEW, not that of the old
    // composition state - the same source as the MDX bar and popup.
    const expr = dynExpr ? (input.expression ?? dynExpr) : undefined;
    if (expr) { saveMsg.expression = expr; }
    vscode.postMessage(saveMsg);
  });
}

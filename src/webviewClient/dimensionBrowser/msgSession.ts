/**
 * Host-to-webview handlers of the SESSION: operating mode, loading indicator,
 * error banner, and the dimension/hierarchy switch together with the subset list.
 *
 * S2-11 (2026-08-02): cut out of `msg.ts`, taken over unchanged.
 */

import { state, makePerDimState } from './state';
import { _updateSelectionFooter } from './footer';
import {
  populateSelect, _populateSubsetSelect, _applySubsetChoice,
  subsetOptionValue,
  consumePendingSourceMdx,
} from './subset';
import { setViewPhase } from './viewPhase';
import { getL10n } from '../_shared/l10n';
import { startView } from './viewPath';
import { initViewCtx } from './viewCtx';
import { setAttrColumns, setColumnWidth } from './attrColumns';
import { showAttrColumnSelection } from './viewControls';
import type { MsgTable } from './msgCtx';

const L = getL10n();

/**
 * Select a pending subset as soon as it appears in the dropdown.
 *
 * Two triggers, the same operation: the list arrives (`setSubsets`), or a
 * `setMode` arrives for a panel whose list has long been in place (a click on a
 * second subset of the same dimension in the tree).
 */
function applyPendingSubsetIfListed(consume: boolean): void {
  const ips = state._pendingInitialSubset;
  if (!ips) { return; }
  // An arriving LIST consumes the pending marker in every case, even if it does
  // not contain the name: it is the list of this dimension, and a leftover pending
  // marker would otherwise land later on a FOREIGN one.
  // A `setMode`, by contrast, consumes it only on a hit - the list may still be
  // on its way.
  if (consume) { state._pendingInitialSubset = null; }
  // `SubsetSnapshot` is the loose host shape - a missing name never matches a
  // real option, because all real options carry one.
  const value = subsetOptionValue(ips.name ?? '', !!ips.isPrivate);
  const selEl = document.getElementById('subset-select') as HTMLSelectElement | null;
  if (!selEl) { return; }
  for (let i = 0; i < selEl.options.length; i++) {
    if (selEl.options[i].value === value) {
      state._pendingInitialSubset = null;
      selEl.selectedIndex = i;
      _applySubsetChoice();
      return;
    }
  }
}

export const sessionHandlers: Pick<
  MsgTable,
  'setMode' | 'setLoading' | 'setAttrCubeExists' | 'setError' | 'setHierarchies' | 'setSubsets' | 'attrColumns'
> = {
  setMode: (msg) => {
    state._mode = msg.mode || 'standalone';
    state._multiSelect = !!msg.multiSelect;
    state._allowedTypes = msg.allowedTypes || null;
    state._initialSelectionNames = (msg.initialSelection && msg.initialSelection.length)
      ? msg.initialSelection.slice() : null;
    if (msg.initialSubset) {
      state._pendingInitialSubset = msg.initialSubset;
      // If the panel is already open (a click on a second subset of the same
      // dimension in the tree), `setSubsets` does NOT arrive again - and until now the
      // pending marker was redeemed only there. The panel then stayed on the subset it
      // was opened with, even though `_setModeMsg` is sent again for exactly this case
      // (click test 2026-08-23).
      applyPendingSubsetIfListed(false);
    }
    if (msg.initialSourceMdx) { state._pendingSourceMdx = msg.initialSourceMdx; }
    state._acceptsExpression = !!msg.acceptsExpression;
    state._hierSwitchTaken = msg.hierSwitch ? msg.hierSwitch.taken.slice() : null;
    state._sourceMdxSeen = msg.initialSourceMdx || '';
    state._sourceMdxNote = msg.initialSourceNote || '';
    // Same slot a loaded subset's own alias uses: `_restoreDisplayAlias` picks it
    // up once the dimension's attribute list is known and drops it again if that
    // dimension offers no such attribute. Seeding it here is what lets the
    // browser open under the alias its caller is already showing.
    if (msg.initialAlias) { state._loadedSubsetAlias = msg.initialAlias; }
    if (state._mode === 'selection') {
      document.body.classList.add('selection-mode');
      (document.getElementById('selection-footer') as HTMLElement).style.display = 'flex';
      // The mark-actions bar (All/Keep only/Delete/Drill) has stayed visible in
      // both modes since task 10 - the visible row list is itself the selection.
      // Shown but locked unless the caller can follow a switch: the cube viewer
      // re-keys its chip to the hierarchy the user ends on. Hidden before 2026-09-28; with
      // alternate hierarchies on the grid the browser must say which one it shows.
      // Unlocked when the caller can follow a switch (cube viewer, `hierSwitch`).
      (document.getElementById('hier-select') as HTMLSelectElement).disabled = !state._hierSwitchTaken;
      _markTakenHiers();
      // The editor button STAYS here. Until 2026-08-12 this spot hid it, with the
      // reasoning "selecting elements is not editing" - which does not hold: whoever
      // stands in the browser coming from the cube viewer sees the same dimension and
      // has the same reason to open it (flameY3T1, click test 2026-08-12: "why is it not
      // there when you enter from the cube viewer?"). The button worked in this mode
      // all along, it was merely hidden.
      // The hierarchy selection above it is different: it belongs to the caller's
      // preset and switches only when the caller can follow (`hierSwitch`).
      // The arrow/all-action buttons (->->, <-<-, =>) have not existed since the pane
      // merge, the checkmark column not since the Architect rebuild: the visible row
      // list IS the selection.
    }
    _updateSelectionFooter();
  },

  setLoading: (msg) => {
    // `loading:false` arrives after the response (the host sends `setElementPage`
    // first, then this) and therefore means "done" - the same phase the two element
    // handlers set. A failed attempt sends `setError` afterwards and wins (see
    // `viewPhase.ts`).
    setViewPhase(msg.loading ? 'loading' : 'ready');
  },

  setAttrCubeExists: (msg) => {
    const attrBtn = document.getElementById('open-attr-cube-btn') as HTMLButtonElement | null;
    if (attrBtn) { attrBtn.disabled = !msg.exists; }
  },

  setError: (msg) => {
    // Guarded: an unguarded cast threw when the markup changed, in the middle of
    // the message path - and the error path of all things would then have stayed silent.
    const banner = document.getElementById('error-banner') as HTMLElement | null;
    if (banner) { banner.textContent = msg.message || L.unknownError; }
    else { console.warn('[dimbrowser] error-banner missing from the markup'); }
    // K26 (review 2026-08-02): the error phase ALSO hides the pane. On an error
    // while opening, the host sends both - `setLoading(false)`, which shows the pane
    // via inline style, and `setError`. Without this, the header line ("Available
    // 0 / 0") stood permanently above an empty frame although nothing more follows
    // below it; the CSS start state (`display:none`) does not cover it, because the
    // inline style has already overridden it. `setViewPhase` can no longer forget
    // exactly this - the phase switches all five elements.
    setViewPhase('error');
  },

  setHierarchies: (msg, { vscode }) => {
    // setHierarchies only fires on a dimension (re)load — initial open or a
    // reveal-reload of the same panel. There is no dim dropdown anymore (one
    // panel per dim), so _currentDim is synced solely from this message.
    // A packet WITHOUT `selectedDim` stays with the current dimension - the value
    // must therefore be captured BEFORE the swap.
    const nextDim = msg.selectedDim || state._currentDim;
    // Must likewise run before the swap: the call decides on
    // `_selectionFromSubset` and redraws. The reload leaves the loaded subset, so the
    // mirror in the list goes with it (a selection built by hand is not a mirror and
    // survives).
    // S2-4 (2026-08-02): ONE object swap instead of the individual assignments
    // that stood here (subset filter, flat property, MDX binding, drills, the
    // name-keyed drill maps). Everything dimension-related thereby falls away
    // structurally - including what only gets added tomorrow. The reasons for the
    // individual fields now stand next to them in `state.ts`; the most expensive one:
    // without discarding the three expression fields, a later save under the same
    // subset name would have written the MDX of the OLD dimension back
    // (`expressionForSave` compares only name + visibility, not dim/hier).
    Object.assign(state, makePerDimState());
    state._currentDim = nextDim;
    state._currentHier = msg.selectedHier || '';
    populateSelect('hier-select', msg.hiers || [], state._currentHier);
    _markTakenHiers();
    // The page base MUST come after the perDim swap above (which clears
    // `_pageBaseMdx`). If it is already available it is redeemed HERE, so that the
    // first page does not arrive without it in the first place. If `setMode` only
    // comes later (handshake resend), `msgElements.ts` catches up - see
    // `consumePendingSourceMdx`.
    // Capture BEFORE consuming: the new path makes it its base,
    // and `consumePendingSourceMdx` clears the field.
    const sourceExpr = state._pendingSourceMdx || '';
    consumePendingSourceMdx();
    {
      if (state._currentDim && state._currentHier && vscode) {
        // K27 (final review, Critical): the pane and its table frame start
        // `display:none` (CSS) and are shown ONLY by `setViewPhase` - so far triggered
        // exclusively by the host message `setLoading:false` after `fetchElements`.
        // This branch never posts that (it draws via `startView`/`onViewRows` instead),
        // hence switch to "loading" immediately here - otherwise the user hangs in the
        // spinner permanently, even when the rows are long since in the DOM. The
        // transition to "done" or "error" happens in `viewPath.ts` (`onViewRows`),
        // symmetrical to the old path (`setElementPage`/`setError`).
        setViewPhase('loading');
        // The preset goes IN with it, not afterwards: set afterwards, it cost a whole
        // window query for nothing. It is consumed in the process - otherwise it would
        // leak into the next start.
        const preselection = state._initialSelectionNames;
        state._initialSelectionNames = null;
        startView(
          state._currentDim, state._currentHier,
          (m) => vscode.postMessage(m),
          preselection ?? undefined,
          sourceExpr,
          // The alias under which the calling view shows the dimension
          // (`initialAlias`, stored above in `_loadedSubsetAlias`). Without it,
          // the browser opened on raw element names while the grid next to it
          // showed the alias (click test 2026-08-23).
          state._loadedSubsetAlias || undefined,
        );
        // The subset list fetches NO elements - it fills a selection field. The
        // `return` further down keeps `fetchElements` away (otherwise the old renderer
        // would come back over the new one) and accidentally took this along with it.
        // The other senders are dead in the new path as well (hierarchy dropdown and
        // "Refresh" are blocked), so only the lookup after a save remained - until then
        // the field held only its three static entries, without "default element" and
        // without a single subset (click test 2026-08-23).
        vscode.postMessage({
          type: 'fetchSubsets', dimName: state._currentDim, hierName: state._currentHier,
        });
        // From HERE, not from `startView`: `viewCtx` imports `viewPath`,
        // and the way back would be a cycle that `npm run lint:deps` reports as a
        // build breaker. `initViewCtx` is idempotent.
        initViewCtx();
      } else {
        // Minor 1 (final review): without dim/hier/vscode the new path draws
        // nothing - and without this line that would go unnoticed. No banner: there is
        // no pane yet in which a banner line would stand out, and the three
        // prerequisites are normally missing only for the blink of an eye during
        // bootstrap (handshake resend, see `consumePendingSourceMdx`).
        console.warn('[dimBrowser] setHierarchies: new path skipped (dim/hier/vscode missing)');
      }
    }
  },

  setSubsets: (msg) => {
    _populateSubsetSelect(msg.subsets || []);
    applyPendingSubsetIfListed(true);
  },

  // Arrives when a dimension is opened, BEFORE `setHierarchies` - whose handler
  // triggers `startView`/`fetchRows()` synchronously, and `fetchRows()` reads the state set
  // here. No redraw of its own needed: the first `fetchRows()` pass does that
  // along the way, with the remembered columns.
  attrColumns: (msg) => {
    setAttrColumns(msg.cols || []);
    // SECOND recipient, and not optional (fix round 2, finding 1): the
    // renderer above and the checkbox list here have separate states. Without
    // this line the grid shows the remembered columns while the button and ticks
    // stay empty - and the next closing of the list collects `[]` and deletes the
    // stored entry.
    showAttrColumnSelection(msg.cols || [], msg.dimName);
    for (const [name, px] of Object.entries(msg.widths || {})) {
      setColumnWidth(name, px);
    }
  },
};

/** Grey out hierarchies the caller already shows elsewhere (one key per
 *  hierarchy in the cube viewer); the current one stays pickable. */
function _markTakenHiers(): void {
  if (!state._hierSwitchTaken?.length) { return; }
  const taken = new Set(state._hierSwitchTaken);
  const sel = document.getElementById('hier-select') as HTMLSelectElement;
  for (const o of Array.from(sel.options)) { o.disabled = o.value !== state._currentHier && taken.has(o.value); }
}

/**
 * window.message router for the Dimension Browser webview.
 *
 * Hebel 9-K2a (2026-05-17): extracted from `index.ts`. Reacts to
 * postMessage packets from the extension host side (see
 * `src/commands/dimension/dimensionBrowser.ts`) — setMode, setLoading,
 * setError, setHierarchies, setSubsets, setSubsetElements,
 * setDefaultMember, subsetSaveResult.
 *
 * S2-11 (2026-08-02): The 19 branches used to sit in ONE `else if` chain. They
 * are now split by topic (`msgSession`, `msgElements`, `msgSubset`,
 * `msgDrill`) and are assembled here into ONE table. The
 * `MsgTable` mapped type is exhaustive over `HostToWebview['type']`: a
 * new message type without a handler is a compile error — the chain let it
 * fall through silently. The branches themselves were taken over unchanged;
 * the chain had no order dependency (19 disjoint
 * `msg.type === '…'` tests on a discriminated union, no `else` branch),
 * so the table is behavior-identical.
 *
 * `vscode` (webview API) is passed in via an `init` callback, because the
 * `acquireVsCodeApi` handle is only initialized in the index module.
 */

import { state } from './state';
import { _updateSelectionFooter } from './footer';
import { clearMarks } from './viewMarks';
import { _closeSaveModal } from './saveMode';
import { isCurrentSelection } from './pure';
import { acceptForSelection } from './msgScope';
import { getL10n } from '../_shared/l10n';
import { sessionHandlers } from './msgSession';
import { subsetHandlers } from './msgSubset';
import { drillHandlers } from './msgDrill';
import { onViewRows, onViewCount, onAttrDefs, onLevels, hierOfView, currentAlias, currentMdx } from './viewPath';
import type { MsgCtx, MsgTable } from './msgCtx';
import type { HostToWebview, WebviewToHost } from './protocol';

const L = getL10n();

interface MsgDeps {
  vscode: { postMessage: (msg: WebviewToHost) => void } | null;
}

/**
 * Exhaustive message table. If a `HostToWebview` type is missing, the
 * assignment to `MsgTable` already breaks — the same safeguard as on the
 * host side (`dimensionBrowserHandlers.ts#dimBrowserTable`).
 */
const handlers: MsgTable = {
  ...sessionHandlers,
  ...subsetHandlers,
  ...drillHandlers,

  // ── Workbench: hand out the state ───────────────────────────────────────
  // The EXPRESSION is the statement, not the intent stack and certainly not a
  // list of names: only it carries the collapse state (`DRILLUPMEMBER`). In
  // exactly this form the Cube Viewer also hands over its axis, and in exactly
  // this form `startView` takes it back on restore —
  // that is why the Dimension Browser needs NO counter-message for applying it.
  requestState: (msg, { vscode }) => {
    vscode?.postMessage({
      type: 'stateReply',
      token: msg.token,
      state: {
        hierarchy: hierOfView(),
        alias: currentAlias(),
        subset: state._subsetExpressionOf ?? undefined,
        mdx: currentMdx() ?? undefined,
      },
    });
  },

  // Deliberately stays here instead of in `saveMode.ts` (this part of the S2-11
  // proposal is deferred): the follow-up depends on `_closeSaveModal` AND on the
  // router's `vscode` handle.
  subsetSaveResult: (msg, { vscode }) => {
    const msgEl = document.getElementById('save-msg') as HTMLElement;
    if (msg.ok) {
      msgEl.className = 'modal-msg info';
      msgEl.textContent = msg.message || L.saved;
      // K16 (Review 2026-08-02): hold on to the pair the save was made for.
      // The body below only runs 600 ms later and then narrows the filter to
      // the saved element set — whoever switches the hierarchy in that time had
      // it pushed onto the NEW one, along with `fetchSubsets` for a subset
      // that does not belong there.
      const savedForDim = state._currentDim;
      const savedForHier = state._currentHier;
      setTimeout(function () {
        _closeSaveModal();
        // Marks fed the save, so drop them once it landed — the removed
        // `_exitSaveMode` used to do this on its way out. Unlike that one,
        // this leaves the picker footer alone: in selection mode it must
        // survive a subset save.
        // `clearMarks()` instead of the former assignment to
        // `state._markedNames`/`_markedKeys`: both fields were dead, the
        // mark store of the new path lives in `viewMarks` (Review
        // 2026-08-24, H6). Clearing here was therefore ineffective since the
        // old path was dismantled — the marks survived the save. Now it
        // coincides again with the other places that take back a
        // consumed marking (`viewPath#keepMarked` and
        // neighbors).
        clearMarks();
        // No second hide mechanism here any more — the all-bar stays
        // visible (Task 10, review fix Critical B).
        _updateSelectionFooter();
        // Closing the modal and clearing the marks is pure housekeeping and
        // always applies; the state takeover below, by contrast, belongs to the
        // pair the save was made for. The snapshot is also discarded in the
        // cancel case, otherwise a later save would apply it.
        const saved = state._lastSavedSubset;
        state._lastSavedSubset = null;
        if (!isCurrentSelection(savedForDim, savedForHier, state._currentDim, state._currentHier)) { return; }
        if (saved) {
          // No `clearDrillContext`: what was saved is what the drill is just
          // showing — the context continues to describe the selection.
          //
          // In the NEW path this redrawing is omitted: `applyNameSetFilter` +
          // `renderTable` are the old renderer, and it wrote into the same
          // table body — the window was left completely empty afterwards,
          // without rows and without an expression (click test 2026-08-23). The
          // view already shows what was just saved anyway; and the pending
          // marker below reloads the subset regularly right away.
          state._pendingInitialSubset = { name: saved.name, isPrivate: saved.isPrivate };
          if (vscode && state._currentDim && state._currentHier) {
            vscode.postMessage({ type: 'fetchSubsets', dimName: state._currentDim, hierName: state._currentHier });
          }
        }
      }, 600);
    } else {
      // `cancelled` = the user declined the host's flatten warning. Nothing
      // went wrong, so keep the modal neutral (no red) — just release the
      // save button and drop the pending snapshot so a later successful save
      // does not re-apply this attempt's element list.
      msgEl.className = msg.cancelled ? 'modal-msg' : 'modal-msg error';
      msgEl.textContent = msg.message || L.saveFailed;
      if (msg.cancelled) { state._lastSavedSubset = null; }
      (document.getElementById('save-do-btn') as HTMLButtonElement).disabled = false;
    }
  },

  // Plan 3: the view state lives in `viewPath.ts`, not here — the router
  // only passes the reply through.
  viewRows: (msg) => { onViewRows(msg); },
  // Task 3: the same pure pass-through as `viewRows`.
  viewCount: (msg) => { onViewCount(msg); },
  attrDefs: (msg) => { onAttrDefs(msg); },
  levels: (msg) => { onLevels(msg); },
};

export function initMsgHandler(deps: MsgDeps): void {
  const ctx: MsgCtx = { vscode: deps.vscode };

  window.addEventListener('message', function (e: MessageEvent<HostToWebview | null | undefined>) {
    const msg = e.data;
    if (!msg) { return; }
    // S2-5 (2026-08-02): THE guard. Replies arrive in arbitrary
    // order; one that belongs to a dimension/hierarchy that has since been
    // left is discarded here — before ANY handler and
    // thus before any state and DOM mutation. Before, the same check stood
    // eleven times individually in the handlers, and three times it was
    // forgotten at a new reply site, until it had destroyed data live
    // (H3/K11/K24).
    // Which message is checked how — and why one is not checked —
    // is stated in `msgScope.ts#MSG_SCOPE`, which is total over the message
    // union: a new type is a compile error until it is classified.
    if (!acceptForSelection(msg, state._currentDim, state._currentHier)) { return; }
    // Deliberately called SYNCHRONOUSLY instead of via `dispatchTable.ts#dispatch`: the
    // helper is `async`, which would shift every handler into a microtask. The
    // `else if` chain ran synchronously, and the tests post messages and
    // check immediately afterwards. An unknown `type` falls through silently
    // as before (the chain had no `else` branch).
    const handler = handlers[msg.type] as
      ((m: HostToWebview, c: MsgCtx) => void | Promise<void>) | undefined;
    if (handler) { void handler(msg, ctx); }
  });
}

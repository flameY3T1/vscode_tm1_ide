/**
 * postMessage router (extension-host → webview).
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import type { HostToWebview } from './protocol';
import { state } from './state';
import { escapeHtml, updateDirty } from './helpers';
import { showError } from './modals';
import { renderAll } from './render';
import { switchToHierLocal } from './hier';
import { handleCommitResult } from './commit';
import { handleConfirmDelete } from './detail';
import { handleSortOrderState, handleSortOrderResult, requestSortOrder } from './sortOrder';
import { getL10n, fmt } from '../_shared/l10n';
import { settlePersistedNew } from './reparent';

export {};

const L = getL10n();

export function initMsgHandler(): void {
  window.addEventListener('message', (ev: MessageEvent<HostToWebview | null | undefined>) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'initData') {
      state.data = msg.state;
      renderAll();
    } else if (msg.type === 'rebaseSnapshot') {
      if (!state.data) return;
      // Hierarchies loaded earlier but not refetched keep their old baseline.
      const prev = state.data.snapshot;
      state.data.snapshot = { ...msg.snapshot, perHier: { ...(prev ? prev.perHier : {}), ...msg.snapshot.perHier } };
      settlePersistedNew(state.data, msg.snapshot.perHier[state.data.hierName]);
      // Re-park the draft against the new baseline, else a restore re-applies the saved steps.
      updateDirty();
    } else if (msg.type === 'mergeHier') {
      const pending = state.pendingHierSwitch;
      state.pendingHierSwitch = null;
      if (!state.data || !state.data.snapshot) return;
      if (msg.error) {
        showError(fmt(L, 'hierLoadFailed', msg.error));
        return;
      }
      state.data.snapshot.perHier = state.data.snapshot.perHier || {};
      if (msg.content) {
        state.data.snapshot.perHier[msg.hier] = msg.content;
      }
      if (pending && pending === msg.hier) {
        switchToHierLocal(msg.hier, false);
      }
    } else if (msg.type === 'commitResult') {
      handleCommitResult(msg);
    } else if (msg.type === 'confirmDelete') {
      void handleConfirmDelete(msg);
    } else if (msg.type === 'defaultMemberState') {
      for (const s of msg.states) { state.defaultMembers[s.hierarchy] = s; }
      renderAll();
    } else if (msg.type === 'defaultMemberResult') {
      if (msg.ok && msg.state) {
        state.defaultMembers[msg.hier] = msg.state;
        renderAll();
      } else {
        showError(msg.message ?? '');
      }
    } else if (msg.type === 'sortOrderState') {
      void handleSortOrderState(msg);
    } else if (msg.type === 'openSortOrder') {
      requestSortOrder(msg.hier);
    } else if (msg.type === 'sortOrderResult') {
      void handleSortOrderResult(msg);
    } else if (msg.type === 'loadError') {
      (document.getElementById('tree-root') as HTMLElement).innerHTML =
        '<div class="placeholder" style="color:var(--vscode-errorForeground)">' + escapeHtml(msg.message) + '</div>';
    }
  });
}

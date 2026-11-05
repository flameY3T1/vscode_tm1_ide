/**
 * DOM event-listener wiring.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state, vscode } from './state';
import { escapeHtml, updateDirty } from './helpers';
import { askConfirm, askInput, showError, showInfo } from './modals';
import { renderTree, removeOccurrence, orderedVisibleOccKeys } from './tree';
import { renderDetail } from './detail';
import { promptAddElement } from './addElement';
import { pasteClipboard } from './pasteElements';
import { buildClipboard } from '../../dimensionEditor/pasteStructurePure';
import { occName, occParent, occNames } from './pure';
import { renderHierSelect, renderAliasSelect } from './render';
import { switchToHierLocal } from './hier';
import { renderAttrModal } from './attrModal';
import {
  openBulkModal,
  closeBulkModal,
  updateBulkPreview,
  commitBulkAdd,
} from './bulkModal';
import { sendCommit, sendDiscard, sendSaveAsNew } from './commit';
import { getL10n, fmt } from '../_shared/l10n';
import { escCloses } from '../_shared/escCloses';
import { requestSortOrder } from './sortOrder';

export {};

const L = getL10n();

export function initDomHandlers(): void {
  (document.getElementById('hier-select') as HTMLSelectElement).onchange = async (e) => {
    if (!state.data) return;
    const target = e.target as HTMLSelectElement;
    const newHier = target.value;
    if (newHier === state.data.hierName) return;
    if (state.data.dirty) {
      const ok = await askConfirm({
        message: fmt(L, 'hierSwitchConfirm', state.data.hierName),
        yes: L.switch,
        // `switchToHierLocal(newHier, false)` reloads from the snapshot and resets
        // `dirty` — the unsaved edits of the current hierarchy are gone.
        danger: true,
      });
      if (!ok) { target.value = state.data.hierName; return; }
    }
    const cached = state.data.snapshot?.perHier?.[newHier];
    if (!cached) {
      state.pendingHierSwitch = newHier;
      (document.getElementById('tree-root') as HTMLElement).innerHTML =
        '<div class="placeholder">' + fmt(L, 'loadingHierarchy', escapeHtml(newHier)) + '</div>';
      vscode.postMessage({ type: 'fetchHier', hier: newHier });
      return;
    }
    switchToHierLocal(newHier, false);
  };

  (document.getElementById('new-hier-btn') as HTMLButtonElement).onclick = async () => {
    if (!state.data) return;
    const r = await askInput({
      title: L.newHierTitle,
      fields: [{ id: 'name', label: L.nameLabel, placeholder: L.hierNamePlaceholder }],
      okLabel: L.create,
    });
    if (!r) return;
    const trimmed = (r.name || '').trim();
    if (!trimmed) return;
    if (/['[\]\x00-\x1f]/.test(trimmed)) { showError(L.invalidChars); return; }
    if (state.data.hierarchies.includes(trimmed)) { showError(fmt(L, 'hierAlreadyExists', trimmed)); return; }
    state.data.hierarchies.push(trimmed);
    state.data.dirty = true;
    renderHierSelect(); updateDirty();
  };

  (document.getElementById('hier-select') as HTMLSelectElement).oncontextmenu = async (e) => {
    if (!state.data) return;
    e.preventDefault();
    const current = state.data.hierName;
    if (state.data.hierarchies.length <= 1) {
      showError(L.lastHierCannotDelete);
      return;
    }
    const ok = await askConfirm({
      message: fmt(L, 'deleteHierConfirm', current),
      yes: L.deleteHierYes,
      // Removes a whole hierarchy from the draft.
      danger: true,
    });
    if (!ok) return;
    state.data.hierarchies = state.data.hierarchies.filter((h: string) => h !== current);
    state.data.dirty = true;
    switchToHierLocal(state.data.hierarchies[0], true);
  };

  (document.getElementById('open-attr-cube-btn') as HTMLButtonElement).onclick = () => {
    if (!state.data) return;
    vscode.postMessage({ type: 'openAttrCube' });
  };

  (document.getElementById('collapse-all-btn') as HTMLButtonElement).onclick = () => {
    if (!state.data) return;
    // Every element that is a parent in a live edge is a consolidation → collapse it.
    for (const e of (state.data.edges || [])) {
      if (e && e.marked !== 'deleted' && e.parent) { state.collapsed.add(e.parent); }
    }
    renderTree();
  };
  (document.getElementById('expand-all-btn') as HTMLButtonElement).onclick = () => {
    if (!state.data) return;
    state.collapsed.clear();
    renderTree();
  };

  (document.getElementById('alias-select') as HTMLSelectElement).onchange = (e) => {
    state.displayAlias = (e.target as HTMLSelectElement).value || '';
    renderTree();
    renderDetail();
  };

  (document.getElementById('search-box') as HTMLInputElement).oninput = (e) => {
    state.searchQuery = String((e.target as HTMLInputElement).value || '').trim().toLowerCase();
    renderTree();
  };
  (document.getElementById('search-box') as HTMLInputElement).onkeydown = (e) => {
    if (e.key === 'Escape') {
      (e.target as HTMLInputElement).value = '';
      state.searchQuery = '';
      renderTree();
    }
  };

  (document.getElementById('sort-order-btn') as HTMLButtonElement).onclick = () => requestSortOrder();
  (document.getElementById('manage-attr-btn') as HTMLButtonElement).onclick = () => {
    if (!state.data) return;
    renderAttrModal();
    (document.getElementById('attr-modal') as HTMLElement).classList.add('open');
  };
  (document.getElementById('attr-modal-close') as HTMLButtonElement).onclick = () => {
    (document.getElementById('attr-modal') as HTMLElement).classList.remove('open');
  };
  (document.getElementById('attr-modal') as HTMLElement).onclick = (e) => {
    if (e.target === document.getElementById('attr-modal')) {
      (document.getElementById('attr-modal') as HTMLElement).classList.remove('open');
    }
  };
  (document.getElementById('new-attr-name') as HTMLInputElement).onkeydown = (e) => {
    // Enter adds the typed attribute instead of leaving the row sitting there.
    if (e.key !== 'Enter') { return; }
    e.preventDefault();
    (document.getElementById('new-attr-add') as HTMLButtonElement).click();
  };
  (document.getElementById('new-attr-add') as HTMLButtonElement).onclick = () => {
    const data = state.data;
    if (!data) { return; }
    const nameInp = document.getElementById('new-attr-name') as HTMLInputElement;
    const typeSel = document.getElementById('new-attr-type') as HTMLSelectElement;
    const rawName = nameInp.value;
    const name = (rawName || '').trim();
    const type = typeSel.value as 'Numeric' | 'String' | 'Alias';
    if (!name) return;
    if (/['[\]\x00-\x1f]/.test(name)) { showError(L.invalidCharsAttr); return; }
    const lower = name.toLowerCase();
    const existing = (data.attrDefs || []).find((d) => d.name.toLowerCase() === lower);
    if (existing && existing.marked !== 'deleted') {
      showError(fmt(L, 'attrAlreadyExists', name));
      return;
    }
    if (existing && existing.marked === 'deleted') {
      existing.marked = 'clean';
      existing.type = type;
    } else {
      data.attrDefs.push({ name, type, marked: 'new' });
    }
    data.dirty = true;
    nameInp.value = '';
    nameInp.focus();
    renderAttrModal(); renderDetail(); renderAliasSelect(); updateDirty();
    showInfo(fmt(L, 'attrAdded', name));
  };

  (document.getElementById('add-element-btn') as HTMLButtonElement).onclick = () => promptAddElement(null);

  (document.getElementById('bulk-add-btn') as HTMLButtonElement).onclick = openBulkModal;
  (document.getElementById('bulk-cancel') as HTMLButtonElement).onclick = closeBulkModal;
  (document.getElementById('bulk-modal') as HTMLElement).onclick = (e) => {
    if (e.target === document.getElementById('bulk-modal')) closeBulkModal();
  };
  (document.getElementById('bulk-textarea') as HTMLTextAreaElement).oninput = updateBulkPreview;
  // Escape closes both modals. The document handler further down cannot do it:
  // it returns as soon as the focus sits in an INPUT/TEXTAREA — which is where
  // it sits in an open modal.
  escCloses(document.getElementById('bulk-modal') as HTMLElement, closeBulkModal, 'open');
  escCloses(document.getElementById('attr-modal') as HTMLElement, () => {
    (document.getElementById('attr-modal') as HTMLElement).classList.remove('open');
  }, 'open');
  (document.getElementById('bulk-submit') as HTMLButtonElement).onclick = commitBulkAdd;

  (document.getElementById('save-btn') as HTMLButtonElement).onclick = sendCommit;
  (document.getElementById('save-as-btn') as HTMLButtonElement).onclick = sendSaveAsNew;
  (document.getElementById('discard-btn') as HTMLButtonElement).onclick = sendDiscard;

  document.addEventListener('keydown', (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t) {
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) { return; }
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'c' || ev.key === 'C')) {
      // Copies the marked elements WITH type and the edges between them.
      // The structure must be captured here, not only on paste:
      // when the hierarchy is switched, the editor loads the target hierarchy, and the
      // source structure is then no longer in the state.
      const names = occNames(state.selected);
      if (names.length === 0) return;
      const data = state.data;
      if (!data) return;
      // Object → Map, see `pasteElements.ts`: the draft travels as JSON.
      state.clipboard = buildClipboard(names, new Map(Object.entries(data.elements)), data.edges);
      showInfo(fmt(L, 'elementsCopied', state.clipboard.elements.length));
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'a' || ev.key === 'A')) {
      // Visible rows only, like Shift+click — collapsed children stay out, same rule as Ctrl+C.
      ev.preventDefault();
      state.selected = new Set(orderedVisibleOccKeys);
      renderTree();
      renderDetail();
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'v' || ev.key === 'V')) {
      // The target is the row clicked last; without a selection, the top level.
      // With several marked rows the anchor is the one meant — it is the
      // row from which the user started dragging.
      const anchorName = state.anchor ? occName(state.anchor) : null;
      pasteClipboard(anchorName);
      return;
    }
    if (ev.key === 'Escape') {
      if (state.selected.size === 0) return;
      state.selected.clear();
      state.anchor = null;
      renderTree();
      renderDetail();
      return;
    }
    if (ev.key === 'Delete') {
      if (state.selected.size === 0) return;
      ev.preventDefault();
      // Single occurrence under a parent → detach from just that node (edge).
      // Everything else (multi-select, or a root/orphan occurrence) → delete the
      // element(s) entirely, routed through the usage check.
      if (state.selected.size === 1) {
        const key = state.selected.values().next().value as string;
        const parent = occParent(key);
        if (parent) { removeOccurrence(parent, occName(key)); return; }
      }
      vscode.postMessage({ type: 'checkUsage', elements: occNames(state.selected) });
    }
  });
}

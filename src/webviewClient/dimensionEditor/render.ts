/**
 * Top-level render orchestration.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state } from './state';
import { updateDirty, escapeHtml } from './helpers';
import { renderTree } from './tree';
import { renderDetail } from './detail';
import { getL10n } from '../_shared/l10n';

export {};

export function renderHierSelect(): void {
  const sel = document.getElementById('hier-select') as HTMLSelectElement;
  sel.innerHTML = '';
  const data = state.data;
  if (!data) { return; }
  for (const h of (data.hierarchies || [])) {
    const o = document.createElement('option');
    o.value = h; o.textContent = h;
    if (h === data.hierName) o.selected = true;
    sel.appendChild(o);
  }
}

export function renderAliasSelect(): void {
  const sel = document.getElementById('alias-select') as HTMLSelectElement | null;
  if (!sel) { return; }
  const data = state.data;
  const aliasDefs = (data?.attrDefs || []).filter(
    (d: { type?: string; marked?: string }) => d.type === 'Alias' && d.marked !== 'deleted',
  );
  // Drop stale selection if the chosen alias no longer exists.
  if (state.displayAlias && !aliasDefs.some((d: { name: string }) => d.name === state.displayAlias)) {
    state.displayAlias = '';
  }
  const L = getL10n();
  let html = '<option value="">' + escapeHtml(L.aliasNone ?? 'Name') + '</option>';
  for (const d of aliasDefs) {
    const nm = escapeHtml(d.name);
    html += '<option value="' + nm + '"' + (d.name === state.displayAlias ? ' selected' : '') + '>' + nm + '</option>';
  }
  sel.innerHTML = html;
  sel.disabled = aliasDefs.length === 0;
}

export function enableLoadedControls(): void {
  (document.getElementById('add-element-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('bulk-add-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('manage-attr-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('sort-order-btn') as HTMLButtonElement).disabled = false;
  const attrBtn = document.getElementById('open-attr-cube-btn') as HTMLButtonElement;
  const L = getL10n();
  if (state.data && state.data.attrCubeExists === false) {
    attrBtn.disabled = true;
    attrBtn.title = L.openAttrCubeBtnDisabledTitle ?? 'No attribute cube available — create an attribute so TM1 generates it.';
  } else {
    attrBtn.disabled = false;
    attrBtn.title = L.openAttrCubeBtnTitle ?? 'Open attribute cube ( }ElementAttributes_<Dim> )';
  }
  (document.getElementById('search-box') as HTMLInputElement).disabled = false;
  (document.getElementById('hier-select') as HTMLSelectElement).disabled = false;
  (document.getElementById('new-hier-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('collapse-all-btn') as HTMLButtonElement).disabled = false;
  (document.getElementById('expand-all-btn') as HTMLButtonElement).disabled = false;
  // alias-select enabled state is managed by renderAliasSelect (depends on alias attrs).
}

export function renderAll(): void {
  renderHierSelect();
  renderAliasSelect();
  renderTree();
  renderDetail();
  updateDirty();
  enableLoadedControls();
}

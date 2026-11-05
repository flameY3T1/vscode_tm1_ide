/**
 * Detail-pane renderer + element handlers (type/parent/attrs/delete).
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state, vscode } from './state';
import { escapeHtml, findElement, updateDirty, primarySelected } from './helpers';
import { askConfirm, askInput, showError, showInfo } from './modals';
import { renderTree } from './tree';
import type { HostToWebview } from './protocol';
import { deleteElementFromDraft, removeEdgeFromDraft, occNames, occName, nextOrder } from './pure';
import { getL10n, fmt } from '../_shared/l10n';
import { writeClipboard } from '../_shared/clipboardWrite';

export {};

const L = getL10n();

export function renderDetail(): void {
  const pane = document.getElementById('detail') as HTMLElement;
  // Selection is by occurrence; collapse to distinct element names for the panel
  // (attributes/delete are per-element). Two occurrences of the SAME element →
  // one name → single-element detail below, not the multi view.
  const selNames = occNames(state.selected);
  if (selNames.length >= 2) {
    const items = selNames.map(n => '<li>' + escapeHtml(n) + '</li>').join('');
    pane.innerHTML =
      '<div class="detail-header"><span class="name">' + fmt(L, 'elementsSelected', selNames.length) + '</span></div>'
      + '<div class="detail-row">'
      + '<button class="icon-btn danger" id="delete-multi-btn" title="' + L.deleteSelectionTitle + '">' + fmt(L, 'deleteWithCount', selNames.length) + '</button>'
      + '</div>'
      + '<div class="detail-empty">' + L.attrsSingleSelectOnly + '</div>'
      + '<ul style="max-height:50vh;overflow:auto">' + items + '</ul>';
    const del = document.getElementById('delete-multi-btn') as HTMLButtonElement | null;
    if (del) {
      del.onclick = () => vscode.postMessage({ type: 'checkUsage', elements: selNames });
    }
    return;
  }
  const sel = primarySelected();
  if (!sel) {
    pane.innerHTML = '<div class="placeholder">' + L.noElementSelected + '</div>';
    return;
  }
  const data = state.data;
  if (!data) { pane.innerHTML = '<div class="placeholder">' + L.noDataLoaded + '</div>'; return; }
  const el = findElement(sel);
  if (!el) { pane.innerHTML = '<div class="placeholder">' + L.elementNotFound + '</div>'; return; }

  const parents = (data.edges || []).filter((e) => e.child === el.name && e.marked !== 'deleted');
  const children = (data.edges || []).filter((e) => e.parent === el.name && e.marked !== 'deleted');
  const attrDefs = (data.attrDefs || []).filter((d) => d.marked !== 'deleted');

  const html: string[] = [];
  html.push('<div class="detail-header">');
  html.push('  <span class="name" title="' + escapeHtml(el.name) + '">' + escapeHtml(el.name) + '</span>');
  html.push('  <button class="icon-btn" id="copy-name-btn" title="' + L.copyNameTitle + '">' + L.copy + '</button>');
  html.push('</div>');

  html.push('<div class="detail-row">');
  html.push('  <span>' + L.typeLabel + '</span>');
  html.push('  <select id="type-select" disabled>');
  for (const t of ['N', 'C', 'S']) {
    html.push('    <option value="' + t + '"' + (el.type === t ? ' selected' : '') + '>' + t + '</option>');
  }
  html.push('  </select>');
  html.push('  <span style="flex:1"></span>');
  html.push('  <button class="icon-btn danger" id="delete-element-btn" disabled title="' + L.deleteElementTitle + '">' + L.delete + '</button>');
  html.push('</div>');

  html.push('<h4>' + L.parentsHeading + ' <span style="opacity:0.6">(' + parents.length + ')</span></h4>');
  if (parents.length) {
    html.push('<ul id="parents-list">');
    for (const e of parents) {
      html.push('<li><span>' + escapeHtml(e.parent) + '</span>'
        + '<span style="flex:1"></span>'
        + '<span class="weight">' + L.weight + ' ' + e.weight + '</span>'
        + '<button class="icon-btn danger" data-remove-parent="' + escapeHtml(e.parent) + '" disabled title="' + L.removeParentTitle + '">&#10005;</button></li>');
    }
    html.push('</ul>');
  } else {
    html.push('<div class="detail-empty">' + L.noParents + '</div>');
  }
  html.push('<button class="btn-secondary" id="add-parent-btn" disabled style="margin-top:6px">' + L.addParentBtn + '</button>');

  if (el.type === 'C') {
    html.push('<h4>' + L.childrenHeading + ' <span style="opacity:0.6">(' + children.length + ')</span></h4>');
    if (children.length) {
      html.push('<ul>');
      for (const e of children) {
        html.push('<li><span>' + escapeHtml(e.child) + '</span>'
          + '<span style="flex:1"></span>'
          + '<span class="weight">' + L.weight + ' ' + e.weight + '</span></li>');
      }
      html.push('</ul>');
    } else {
      html.push('<div class="detail-empty">' + L.noChildren + '</div>');
    }
  }

  html.push('<h4>' + L.attributesHeading + '</h4>');
  if (attrDefs.length) {
    for (const def of attrDefs) {
      const val = (el.attrs && el.attrs[def.name] != null) ? el.attrs[def.name] : '';
      html.push('<label style="display:block;margin:6px 0">');
      html.push('  ' + escapeHtml(def.name) + '<span class="attr-type">(' + escapeHtml(def.type) + ')</span><br>');
      html.push('  <input type="text" data-attr="' + escapeHtml(def.name) + '" value="' + escapeHtml(val) + '" disabled style="width:100%; box-sizing:border-box; margin-top:2px" />');
      html.push('</label>');
    }
  } else {
    html.push('<div class="detail-empty">' + L.noAttributesDefined + '</div>');
  }

  pane.innerHTML = html.join('');

  const typeSel = pane.querySelector('#type-select') as HTMLSelectElement | null;
  if (typeSel) typeSel.disabled = false;
  const delBtn = pane.querySelector('#delete-element-btn') as HTMLButtonElement | null;
  if (delBtn) delBtn.disabled = false;

  wireDetailHandlers();
}

function wireDetailHandlers(): void {
  const copyBtn = document.getElementById('copy-name-btn') as HTMLButtonElement | null;
  if (copyBtn) {
    copyBtn.onclick = async (ev) => {
      ev.stopPropagation();
      const el = findElement(primarySelected());
      if (!el) return;
      if (await writeClipboard(el.name)) showInfo('„' + el.name + '" ' + L.copiedSuffix);
      else showError(L.copyFailed);
    };
  }
  const typeSel = document.getElementById('type-select') as HTMLSelectElement | null;
  if (typeSel) {
    typeSel.onchange = async (e) => {
      const data = state.data;
      if (!data) { return; }
      const el = findElement(primarySelected());
      if (!el) return;
      const newType = (e.target as HTMLSelectElement).value as 'N' | 'C' | 'S';
      if (el.type === 'C' && newType !== 'C') {
        const childEdges = (data.edges || []).filter((ed) => ed.parent === el.name && ed.marked !== 'deleted');
        if (childEdges.length > 0) {
          const ok = await askConfirm({
            message: fmt(L, 'removeChildrenConfirm', childEdges.length),
            yes: L.changeTypeYes,
            // Confirming drops every child edge of the consolidation.
            danger: true,
          });
          if (!ok) { (e.target as HTMLSelectElement).value = el.type; return; }
        }
        for (const ed of childEdges) {
          if (ed.marked === 'new') {
            data.edges = data.edges.filter((x) => x !== ed);
          } else {
            ed.marked = 'deleted';
          }
        }
      }
      el.type = newType;
      if (el.marked === 'clean') el.marked = 'changed';
      data.dirty = true;
      renderTree(); renderDetail(); updateDirty();
    };
  }

  const deleteBtn = document.getElementById('delete-element-btn') as HTMLButtonElement | null;
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      const sel = primarySelected();
      if (!sel) return;
      vscode.postMessage({ type: 'checkUsage', elements: [sel] });
    };
  }

  const addParentBtn = document.getElementById('add-parent-btn') as HTMLButtonElement | null;
  if (addParentBtn) {
    addParentBtn.disabled = false;
    addParentBtn.onclick = async () => {
      const r = await askInput({
        title: L.addParentTitle,
        fields: [
          { id: 'parent', label: L.parentElementLabel, placeholder: L.parentElementPlaceholder },
          { id: 'weight', label: L.weightLabel, value: '1' },
        ],
        okLabel: L.addBtn,
      });
      if (!r) return;
      const pTrim = (r.parent || '').trim();
      if (!pTrim) return;
      if (pTrim === primarySelected()) { showError(L.cannotBeOwnParent); return; }
      const parentEl = findElement(pTrim);
      if (!parentEl) { showError(fmt(L, 'parentDoesNotExist', pTrim)); return; }
      const weight = Number(r.weight);
      if (!Number.isFinite(weight)) { showError(L.weightMustBeNumber); return; }
      if (parentEl.type !== 'C') {
        const ok = await askConfirm({
          message: fmt(L, 'convertToConsolidationConfirm', pTrim, parentEl.type),
          yes: L.change,
          // Overwrites the type of an EXISTING element; an N element that becomes C
          // loses its stored values on commit. Reached straight after the `askInput`
          // form was submitted with Enter — the auto-repeat case this guards against.
          danger: true,
        });
        if (!ok) return;
        parentEl.type = 'C';
        if (parentEl.marked === 'clean') parentEl.marked = 'changed';
      }

      const data = state.data;
      const sel = primarySelected();
      if (!data || !sel) { return; }
      const existing = (data.edges || []).find((e) => e.parent === pTrim && e.child === sel);
      if (existing && existing.marked !== 'deleted') {
        showError(L.parentAlreadySet);
        return;
      }
      if (existing && existing.marked === 'deleted') {
        existing.marked = 'clean';
        existing.weight = weight;
      } else {
        data.edges.push({ parent: pTrim, child: sel, weight, marked: 'new', order: nextOrder(data.edges, pTrim) });
      }
      data.dirty = true;
      const childEl = findElement(sel);
      if (childEl && childEl.marked === 'clean') childEl.marked = 'changed';
      renderTree(); renderDetail(); updateDirty();
    };
  }

  document.querySelectorAll('[data-remove-parent]').forEach(btnEl => {
    const btn = btnEl as HTMLButtonElement;
    btn.disabled = false;
    btn.onclick = () => {
      const parentName = btn.getAttribute('data-remove-parent');
      const child = primarySelected();
      const data = state.data;
      if (!data || !parentName || !child) { return; }
      if (removeEdgeFromDraft(data, parentName, child)) {
        data.dirty = true;
        renderTree(); renderDetail(); updateDirty();
      }
    };
  });

  document.querySelectorAll('[data-attr]').forEach(inpEl => {
    const inp = inpEl as HTMLInputElement;
    inp.disabled = false;
    inp.onchange = () => {
      const attrName = inp.getAttribute('data-attr')!;
      const value = inp.value;
      const el = findElement(primarySelected());
      if (!el) return;
      if (!el.attrs) el.attrs = {};
      const prev = el.attrs[attrName] != null ? el.attrs[attrName] : '';
      if (prev === value) return;
      el.attrs[attrName] = value;
      if (el.marked === 'clean') el.marked = 'changed';
      const data = state.data;
      if (!data) { return; }
      data.dirty = true;
      renderTree(); updateDirty();
    };
  });
}

export async function handleConfirmDelete(msg: Extract<HostToWebview, { type: 'confirmDelete' }>): Promise<void> {
  const { elements, usages } = msg;
  if (!elements || elements.length === 0) return;
  const data = state.data;
  if (!data) { return; }

  let detail = '';
  if (usages && usages.length) {
    const lines = [L.stillInUse];
    for (const u of usages.slice(0, 12)) {
      const where = u.kind + ': ' + u.sourceName + (u.line ? ':' + u.line : '');
      lines.push('• ' + (elements.length > 1 ? u.element + ' → ' : '') + where);
    }
    if (usages.length > 12) lines.push(fmt(L, 'andMore', usages.length - 12));
    detail = lines.join('\n');
  }
  const message = elements.length === 1
    ? fmt(L, 'deleteElementConfirm', elements[0])
    : fmt(L, 'deleteElementsConfirm', elements.length);
  const ok = await askConfirm({ message, detail, yes: L.delete, danger: true });
  if (!ok) return;

  const toDelete = new Set(elements);
  for (const element of elements) {
    deleteElementFromDraft(data, element);
  }
  // Selection is keyed by occurrence — drop every occurrence of a deleted element.
  for (const key of [...state.selected]) {
    if (toDelete.has(occName(key))) { state.selected.delete(key); }
  }
  data.dirty = true;
  renderTree(); renderDetail(); updateDirty();
}

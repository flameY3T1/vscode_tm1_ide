/**
 * Bulk-add elements modal (textarea + parse-preview + commit).
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state } from './state';
import { elementsList, findElement, primarySelected, updateDirty } from './helpers';
import { showInfo } from './modals';
import { parseBulkInput as _pureParseBulkInput, nextOrder } from './pure';
import { renderTree } from './tree';
import { renderDetail } from './detail';
import { getL10n, fmt } from '../_shared/l10n';

export {};

const L = getL10n();

export function parseBulkInput(text: string) {
  const existingLower = new Set<string>();
  for (const el of elementsList()) {
    if (el.marked !== 'deleted') { existingLower.add(String(el.name).toLowerCase()); }
  }
  return _pureParseBulkInput(text, existingLower);
}

export function updateBulkPreview(): void {
  const text = (document.getElementById('bulk-textarea') as HTMLTextAreaElement).value;
  const p = parseBulkInput(text);
  const preview = document.getElementById('bulk-preview') as HTMLElement;
  const submit = document.getElementById('bulk-submit') as HTMLButtonElement;
  const parts: string[] = [];
  parts.push(fmt(L, 'bulkPreviewNew', p.valid.length));
  if (p.alreadyExists.length) parts.push(fmt(L, 'bulkPreviewExists', p.alreadyExists.length));
  if (p.duplicateFile.length) parts.push(fmt(L, 'bulkPreviewDuplicate', p.duplicateFile.length));
  if (p.invalid.length) parts.push(fmt(L, 'bulkPreviewInvalid', p.invalid.length));
  preview.textContent = parts.join(' · ');
  submit.disabled = p.valid.length === 0;
}

export function openBulkModal(): void {
  if (!state.data) return;
  const ta = document.getElementById('bulk-textarea') as HTMLTextAreaElement;
  ta.value = '';
  (document.getElementById('bulk-type') as HTMLSelectElement).value = 'N';
  const sel = findElement(primarySelected());
  const wrap = document.getElementById('bulk-parent-wrap') as HTMLElement;
  const chk = document.getElementById('bulk-as-child') as HTMLInputElement;
  const nameSpan = document.getElementById('bulk-parent-name') as HTMLElement;
  chk.checked = false;
  if (sel && sel.type === 'C' && sel.marked !== 'deleted') {
    wrap.style.display = '';
    nameSpan.textContent = '„' + sel.name + '"';
  } else {
    wrap.style.display = 'none';
    nameSpan.textContent = '';
  }
  updateBulkPreview();
  (document.getElementById('bulk-modal') as HTMLElement).classList.add('open');
  setTimeout(() => ta.focus(), 0);
}

export function closeBulkModal(): void {
  (document.getElementById('bulk-modal') as HTMLElement).classList.remove('open');
}

export function commitBulkAdd(): void {
  const data = state.data;
  if (!data) { return; }
  const text = (document.getElementById('bulk-textarea') as HTMLTextAreaElement).value;
  const p = parseBulkInput(text);
  if (p.valid.length === 0) return;
  const type = (document.getElementById('bulk-type') as HTMLSelectElement).value as 'N' | 'C' | 'S';
  const asChild = (document.getElementById('bulk-as-child') as HTMLInputElement).checked
    && (document.getElementById('bulk-parent-wrap') as HTMLElement).style.display !== 'none';
  const parentName = primarySelected();

  for (const name of p.valid) {
    data.elements[name] = { name, type, attrs: {}, marked: 'new' };
    if (asChild && parentName) {
      data.edges.push({ parent: parentName, child: name, weight: 1, marked: 'new', order: nextOrder(data.edges, parentName) });
    }
  }
  data.dirty = true;

  const summary: string[] = [];
  summary.push(p.valid.length === 1
    ? fmt(L, 'bulkSummaryCreatedOne', p.valid.length)
    : fmt(L, 'bulkSummaryCreatedMany', p.valid.length));
  if (p.alreadyExists.length) summary.push(fmt(L, 'bulkSummarySkipped', p.alreadyExists.length));
  if (p.duplicateFile.length) summary.push(fmt(L, 'bulkSummaryDuplicateLines', p.duplicateFile.length));
  if (p.invalid.length) summary.push(fmt(L, 'bulkSummaryInvalid', p.invalid.length));
  showInfo(summary.join(' · '));
  closeBulkModal();
  renderTree(); renderDetail(); updateDirty();
}

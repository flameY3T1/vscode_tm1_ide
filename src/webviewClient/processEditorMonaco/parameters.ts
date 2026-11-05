import { escapeAttr, moveItem, nextAutoName as nextAutoNamePure } from './parametersPure';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

export interface ProcessParameter {
  Name: string;
  Type: string;
  Value: string | number;
  Prompt: string;
  [k: string]: unknown;
}

let currentParameters: ProcessParameter[] = [];
let onChangeCb: (() => void) | null = null;

// Process "Security access" flag (HasSecurityAccess) — lives above the parameter
// table in its own DOM node so `rerender()` (which replaces #params-container)
// never wipes it.
let currentHasSecurity = false;

export function getSecurity(): boolean {
  return currentHasSecurity;
}

/** Set the flag + reflect it into the checkbox (host → webview). */
export function setSecurity(v: boolean): void {
  currentHasSecurity = !!v;
  const chk = document.getElementById('chk-has-security') as HTMLInputElement | null;
  if (chk) { chk.checked = currentHasSecurity; }
}

/** Wire the checkbox change → dirty. Call once during init. */
export function initSecurity(): void {
  const chk = document.getElementById('chk-has-security') as HTMLInputElement | null;
  if (!chk) { return; }
  chk.checked = currentHasSecurity;
  chk.addEventListener('change', () => {
    currentHasSecurity = chk.checked;
    notifyChange();
  });
}

export function getParameters(): ProcessParameter[] {
  return currentParameters.map(p => ({ ...p }));
}

export function setOnChange(cb: () => void): void {
  onChangeCb = cb;
}

function nextAutoName(): string {
  return nextAutoNamePure(currentParameters.length);
}

function notifyChange(): void {
  if (onChangeCb) { onChangeCb(); }
}

export function renderParameters(params: ProcessParameter[]): void {
  currentParameters = params.map(p => ({ ...p }));
  rerender();
}

function rerender(): void {
  const container = document.getElementById('params-container');
  const countEl = document.getElementById('params-count');
  if (!container) { return; }

  if (countEl) {
    countEl.textContent = currentParameters.length > 0 ? String(currentParameters.length) : '';
  }

  const rows: string[] = [];
  rows.push('<table class="params-table"><thead><tr>');
  rows.push('<th style="width: 24%">Name</th>');
  rows.push(`<th style="width: 12%">${L.paramColType}</th>`);
  rows.push(`<th style="width: 24%">${L.paramColDefault}</th>`);
  rows.push(`<th style="width: 28%">${L.paramColPrompt}</th>`);
  rows.push('<th style="width: 60px"></th>');
  rows.push('<th style="width: 40px"></th>');
  rows.push('</tr></thead><tbody>');

  for (let i = 0; i < currentParameters.length; i++) {
    const p = currentParameters[i];
    rows.push('<tr>');
    rows.push(`<td><input type="text" data-idx="${i}" data-field="Name" value="${escapeAttr(p.Name)}"></td>`);
    rows.push(`<td><select data-idx="${i}" data-field="Type">`);
    rows.push(`<option value="String"${p.Type === 'String' ? ' selected' : ''}>String</option>`);
    rows.push(`<option value="Numeric"${p.Type === 'Numeric' ? ' selected' : ''}>Numeric</option>`);
    rows.push('</select></td>');
    rows.push(`<td><input type="text" data-idx="${i}" data-field="Value" value="${escapeAttr(String(p.Value ?? ''))}"></td>`);
    rows.push(`<td><input type="text" data-idx="${i}" data-field="Prompt" value="${escapeAttr(String(p.Prompt ?? ''))}"></td>`);
    // Reorder cell: TM1 stores parameters as an ordered array, so the row order
    // shown here is the order that gets PATCHed on save.
    const upDisabled = i === 0 ? ' disabled' : '';
    const downDisabled = i === currentParameters.length - 1 ? ' disabled' : '';
    rows.push('<td style="white-space: nowrap;">');
    rows.push(`<button class="params-move" data-idx="${i}" data-dir="up" title="${escapeAttr(L.paramMoveUp)}" aria-label="${escapeAttr(L.paramMoveUp)}"${upDisabled}>▲</button>`);
    rows.push(`<button class="params-move" data-idx="${i}" data-dir="down" title="${escapeAttr(L.paramMoveDown)}" aria-label="${escapeAttr(L.paramMoveDown)}"${downDisabled}>▼</button>`);
    rows.push('</td>');
    rows.push(`<td><button class="params-remove" data-idx="${i}" title="${L.paramRemove}" aria-label="${escapeAttr(L.paramRemove)}">✕</button></td>`);
    rows.push('</tr>');
  }

  rows.push('</tbody></table>');
  rows.push(`<div style="margin-top: 12px;"><button id="btn-add-param" class="add-param-btn">${L.paramAdd}</button></div>`);

  if (currentParameters.length === 0) {
    container.innerHTML = `<p class="params-empty">${L.paramNoneDefined}</p><div style="margin-top: 12px;"><button id="btn-add-param" class="add-param-btn">${L.paramAdd}</button></div>`;
  } else {
    container.innerHTML = rows.join('');
  }

  bindEvents();
}

function bindEvents(): void {
  const container = document.getElementById('params-container');
  if (!container) { return; }

  container.querySelectorAll<HTMLInputElement>('input[data-idx]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.idx);
      const field = el.dataset.field as keyof ProcessParameter;
      if (Number.isFinite(idx) && currentParameters[idx]) {
        currentParameters[idx][field] = el.value;
        notifyChange();
      }
    });
  });

  container.querySelectorAll<HTMLSelectElement>('select[data-idx]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = Number(el.dataset.idx);
      if (Number.isFinite(idx) && currentParameters[idx]) {
        currentParameters[idx].Type = el.value;
        notifyChange();
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.params-move').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      if (!Number.isFinite(idx) || !currentParameters[idx]) { return; }
      const target = el.dataset.dir === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= currentParameters.length) { return; }
      currentParameters = moveItem(currentParameters, idx, target);
      notifyChange();
      rerender();
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.params-remove').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      if (Number.isFinite(idx) && currentParameters[idx]) {
        currentParameters.splice(idx, 1);
        notifyChange();
        rerender();
      }
    });
  });

  const addBtn = document.getElementById('btn-add-param');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const autoName = nextAutoName();
      currentParameters.push({ Name: autoName, Type: 'String', Value: '', Prompt: autoName });
      notifyChange();
      rerender();
    });
  }
}

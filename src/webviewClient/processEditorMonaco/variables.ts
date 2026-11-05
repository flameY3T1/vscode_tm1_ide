import { escapeAttr } from '../htmlUtils';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

/**
 * One datasource column. A column with `Ignored` is skipped by TM1 during
 * processing and is invisible to the TI code — it has no entry in the REST
 * `Variables` collection at all and lives purely in `VariablesUIData`
 * (see `utils/processVariablesUi.ts`).
 */
export interface ProcessVariable {
  Name: string;
  Type: 'Numeric' | 'String';
  Position: number;
  StartByte?: number;
  EndByte?: number;
  Ignored?: boolean;
  [k: string]: unknown;
}

let current: ProcessVariable[] = [];
let onChangeCb: (() => void) | null = null;

/** Every datasource column, ignored ones included — the shape that must be saved. */
export function getVariables(): ProcessVariable[] {
  return current.map(v => ({ ...v }));
}

/**
 * Only the columns the TI code can actually read. Use this for completions,
 * highlighting and linting; an ignored column's name is not a variable.
 */
export function getUsedVariables(): ProcessVariable[] {
  return current.filter(v => !v.Ignored).map(v => ({ ...v }));
}

export function setOnChange(cb: () => void): void {
  onChangeCb = cb;
}

function notifyChange(): void {
  updateCount();
  if (onChangeCb) { onChangeCb(); }
}

function updateCount(): void {
  const el = document.getElementById('vars-count');
  if (el) {
    el.textContent = current.length > 0 ? String(current.length) : '';
  }
}

export function renderVariables(vars: ProcessVariable[]): void {
  current = vars.map(v => ({ ...v }));
  rerender();
}

export function setTabVisible(visible: boolean): void {
  const tab = document.getElementById('tab-variables');
  if (tab) {
    tab.style.display = visible ? '' : 'none';
  }
}

function rerender(): void {
  const container = document.getElementById('vars-container');
  if (!container) { return; }

  const parts: string[] = [];

  if (current.length === 0) {
    parts.push(`<p class="params-empty">${L.varNoneDefined}</p>`);
  } else {
    parts.push('<table class="params-table"><thead><tr>');
    parts.push('<th style="width: 40%">Name</th>');
    parts.push(`<th style="width: 20%">${L.paramColType}</th>`);
    parts.push(`<th style="width: 70px">${L.varContentsIgnore}</th>`);
    parts.push('<th style="width: 22%">Position</th>');
    parts.push('<th style="width: 40px"></th>');
    parts.push('</tr></thead><tbody>');
    for (let i = 0; i < current.length; i++) {
      const v = current[i];
      const ignored = v.Ignored === true;
      parts.push(`<tr${ignored ? ' class="var-ignored"' : ''}>`);
      parts.push(`<td><input type="text" data-idx="${i}" data-field="Name" value="${escapeAttr(v.Name)}"></td>`);
      parts.push(`<td><select data-idx="${i}" data-field="Type">`);
      parts.push(`<option value="String"${v.Type === 'String' ? ' selected' : ''}>String</option>`);
      parts.push(`<option value="Numeric"${v.Type === 'Numeric' ? ' selected' : ''}>Numeric</option>`);
      parts.push('</select></td>');
      parts.push(
        `<td class="var-ignore-cell"><input type="checkbox" data-idx="${i}" data-field="Ignored"` +
        `${ignored ? ' checked' : ''} title="${escapeAttr(L.varContentsHint)}"></td>`,
      );
      parts.push(`<td><input type="number" data-idx="${i}" data-field="Position" value="${v.Position}"></td>`);
      parts.push(`<td><button class="params-remove" data-idx="${i}" title="${L.varRemove}">✕</button></td>`);
      parts.push('</tr>');
    }
    parts.push('</tbody></table>');
    if (current.some(v => v.Ignored)) {
      parts.push(`<p class="params-empty">${L.varIgnoredNote}</p>`);
    }
  }

  parts.push(`<div style="margin-top: 12px;"><button id="btn-add-var" class="add-param-btn">${L.varAdd}</button></div>`);
  container.innerHTML = parts.join('');

  updateCount();
  bindEvents();
}

function bindEvents(): void {
  const container = document.getElementById('vars-container');
  if (!container) { return; }

  container.querySelectorAll<HTMLInputElement>('input[data-field="Ignored"]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = Number(el.dataset.idx);
      if (!Number.isFinite(idx) || !current[idx]) { return; }
      if (el.checked) { current[idx].Ignored = true; } else { delete current[idx].Ignored; }
      notifyChange();
      // The row's greying and the note below the table follow the new state.
      rerender();
    });
  });

  container.querySelectorAll<HTMLInputElement>('input[data-idx]:not([type="checkbox"])').forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.idx);
      const field = el.dataset.field as keyof ProcessVariable;
      if (!Number.isFinite(idx) || !current[idx]) { return; }
      if (field === 'Position') {
        current[idx].Position = Number(el.value) || 0;
      } else if (field === 'Name') {
        current[idx].Name = el.value;
      }
      // Type comes from select-handler below. StartByte/EndByte not edited
      // via input — only set programmatically when seeded by host.
      notifyChange();
    });
  });

  container.querySelectorAll<HTMLSelectElement>('select[data-idx]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = Number(el.dataset.idx);
      if (!Number.isFinite(idx) || !current[idx]) { return; }
      current[idx].Type = (el.value === 'Numeric' ? 'Numeric' : 'String');
      notifyChange();
    });
  });

  container.querySelectorAll<HTMLButtonElement>('.params-remove').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      if (Number.isFinite(idx) && current[idx]) {
        current.splice(idx, 1);
        notifyChange();
        rerender();
      }
    });
  });

  const addBtn = document.getElementById('btn-add-var');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const nextPos = current.length === 0 ? 1 : Math.max(...current.map(v => v.Position || 0)) + 1;
      current.push({ Name: '', Type: 'String', Position: nextPos });
      notifyChange();
      rerender();
    });
  }
}

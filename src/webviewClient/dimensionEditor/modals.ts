import { escCloses } from '../_shared/escCloses';
/**
 * Inline modal helpers (askInput, askConfirm) + toast notifications.
 * Replaces native `prompt()`/`confirm()` which are blocked in webviews.
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 *
 * `askConfirm` is a thin adapter over `_shared/confirmDialog.ts` since 2026-08-07;
 * only `askInput` still drives server-rendered markup (`#prompt-modal`).
 */

import { askConfirm as sharedAskConfirm } from '../_shared/confirmDialog';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

/** The cancel handler of the currently open window — `null` if none is open. */
let pendingCancel: (() => void) | null = null;
let escapeWired = false;

function wireEscapeOnce(modal: HTMLElement): void {
  if (escapeWired) { return; }
  escapeWired = true;
  escCloses(modal, () => pendingCancel?.(), 'open');
}

export interface AskInputField {
  id: string;
  label?: string;
  value?: string | number;
  placeholder?: string;
  type?: string;
  /**
   * Set = the field becomes a select field instead of an input field.
   * `value` preselects; if it matches no option, the first one applies.
   */
  options?: Array<{ value: string; label: string }>;
}

export interface AskInputOpts {
  title?: string;
  prompt?: string;
  value?: string;
  placeHolder?: string;
  okLabel?: string;
  fields?: AskInputField[];
}

export function askInput(opts: AskInputOpts): Promise<Record<string, string> | null> {
  return new Promise(resolve => {
    const modal = document.getElementById('prompt-modal') as HTMLElement;
    const titleEl = document.getElementById('prompt-modal-title') as HTMLElement;
    const fieldsEl = document.getElementById('prompt-modal-fields') as HTMLElement;
    const errEl = document.getElementById('prompt-modal-error') as HTMLElement;
    const okBtn = document.getElementById('prompt-modal-ok') as HTMLButtonElement;
    const cancelBtn = document.getElementById('prompt-modal-cancel') as HTMLButtonElement;
    const form = document.getElementById('prompt-form') as HTMLFormElement;

    const fields: AskInputField[] = Array.isArray(opts.fields)
      ? opts.fields
      : [{ id: 'value', label: opts.prompt || '', value: opts.value || '', placeholder: opts.placeHolder || '' }];

    titleEl.textContent = opts.title || '';
    titleEl.style.display = opts.title ? '' : 'none';
    okBtn.textContent = opts.okLabel || 'OK';
    errEl.textContent = '';

    fieldsEl.innerHTML = '';
    for (const f of fields) {
      const label = document.createElement('label');
      label.style.display = 'block';
      label.style.margin = '8px 0 4px 0';
      label.style.fontSize = '12px';
      label.textContent = f.label || '';
      fieldsEl.appendChild(label);
      if (f.options) {
        const sel = document.createElement('select');
        for (const o of f.options) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          sel.appendChild(opt);
        }
        // Set the preselection only if it matches an option — otherwise the
        // browser would silently fall back to the first one, and `value` would feign something.
        const want = f.value != null ? String(f.value) : '';
        if (f.options.some(o => o.value === want)) { sel.value = want; }
        sel.dataset.fieldId = f.id;
        sel.style.width = '100%';
        sel.style.boxSizing = 'border-box';
        fieldsEl.appendChild(sel);
        continue;
      }
      const inp = document.createElement('input');
      inp.type = f.type || 'text';
      inp.value = f.value != null ? String(f.value) : '';
      inp.placeholder = f.placeholder || '';
      inp.dataset.fieldId = f.id;
      inp.style.width = '100%';
      inp.style.boxSizing = 'border-box';
      fieldsEl.appendChild(inp);
    }

    function close(result: Record<string, string> | null) {
      modal.classList.remove('open');
      form.onsubmit = null;
      cancelBtn.onclick = null;
      pendingCancel = null;
      resolve(result);
    }
    // Escape goes through the shared `escCloses` — but ONCE for the
    // window, not per call: the helper attaches its listener permanently to
    // `document`, and `showModal` is called often. Hence the detour via
    // `pendingCancel`; the old version attached and removed an
    // own listener on every call, without capture and without `stopImmediatePropagation`.
    wireEscapeOnce(modal);
    pendingCancel = () => close(null);
    cancelBtn.onclick = (e) => { e.preventDefault(); close(null); };
    form.onsubmit = (e) => {
      e.preventDefault();
      const out: Record<string, string> = {};
      // `input, select`: since select fields exist, a plain
      // `input` query would silently drop the value of a `<select>`.
      const inputs = fieldsEl.querySelectorAll('input, select');
      inputs.forEach(inp => {
        const el = inp as HTMLInputElement | HTMLSelectElement;
        out[el.dataset.fieldId!] = el.value;
      });
      close(out);
    };

    modal.classList.add('open');
    // Focus belongs on the first field, even if that is a select field.
    // `select()` exists only on the input field.
    const first = fieldsEl.querySelector('input, select') as HTMLInputElement | HTMLSelectElement | null;
    if (first) {
      first.focus();
      if (first instanceof HTMLInputElement) { first.select(); }
    }
  });
}

export interface AskConfirmOpts {
  message?: string;
  detail?: string;
  yes?: string;
  /**
   * Destructive action (delete / discard / overwrite). Arms the harmless answer:
   * initial focus goes to „Cancel" and the box becomes `role="alertdialog"`.
   */
  danger?: boolean;
}

/**
 * Yes/no dialog — adapter over `_shared/confirmDialog.ts`.
 *
 * This used to drive its own server-rendered `#confirm-modal` markup, which had
 * neither `role`/`aria-modal` nor a focus trap, and dereferenced five element ids
 * without a null check. It also had no Enter handler at all, so the answer was
 * whatever the browser's native „Enter activates the focused button" produced —
 * the shared dialog handles Enter itself and follows the focused button in the
 * capture phase, which is the only thing that survives Monaco's key handlers.
 *
 * Labels come from `window.__l10n` (injected by `dimensionEditorWebview.ts`); the
 * literals are the fallback for the theoretical case of a missing map, not a
 * translation gap.
 */
export function askConfirm(opts: AskConfirmOpts): Promise<boolean> {
  return sharedAskConfirm({
    message: opts.message || '',
    detail: opts.detail,
    confirmLabel: opts.yes || L.ok || 'OK',
    cancelLabel: L.cancel || 'Cancel',
    danger: opts.danger,
  });
}

export function showToast(text: string, kind: 'error' | 'info' | string): void {
  const t = document.createElement('div');
  t.textContent = text;
  t.className = 'dim-toast ' + (kind === 'error' ? 'err' : 'ok');
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

export function showError(message: unknown): void { showToast(String(message), 'error'); }
export function showInfo(message: unknown): void { showToast(String(message), 'info'); }

// src/webviewClient/workbenchPicker/index.ts
// Bundle of the workbench picker ("Save workbench"). Until 10-04 this was an
// inline script string in the host template — without type checking and lint.
import type { PickerConfig, WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<WebviewToHost>();

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const cfg = JSON.parse(byId('wbcfg').textContent ?? '') as PickerConfig;
const existing = new Set((cfg.existing || []).map(n => n.toLowerCase()));
const nameEl = byId<HTMLInputElement>('wbname');
const saveEl = byId<HTMLButtonElement>('wbsave');
const boxes = (): HTMLInputElement[] =>
  Array.from(document.querySelectorAll<HTMLInputElement>('#wblist input[type=checkbox]'));

function sync(): void {
  const all = boxes();
  const on = all.filter(b => b.checked);
  // Every occurrence, not just the first: a translation may repeat a
  // placeholder, otherwise the counter would be left half filled.
  // (split/join because the webview lib target is ES2020, no replaceAll.)
  byId('wbcount').textContent = cfg.counter
    .split('{0}').join(String(on.length))
    .split('{1}').join(String(all.length))
    .split('{2}').join(String(cfg.max));
  for (const s of Array.from(document.querySelectorAll('#wblist section'))) {
    const bs = Array.from(s.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    const count = s.querySelector('.wbgcount');
    if (count) { count.textContent = bs.filter(b => b.checked).length + '/' + bs.length; }
  }
  // The conflict shows up while typing, not only after the click.
  const clash = existing.has(nameEl.value.trim().toLowerCase());
  nameEl.classList.toggle('clash', clash);
  saveEl.textContent = clash ? cfg.overwrite : cfg.save;
  saveEl.disabled = on.length === 0 || on.length > cfg.max;
}

byId('wblist').addEventListener('change', sync);
nameEl.addEventListener('input', sync);
// Enter in the name field saves, as the button would — via the button, so that
// a greyed-out Save still does nothing.
nameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveEl.click(); }
});
// Escape cancels, like the Cancel button — from anywhere in the form.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') { return; }
  e.preventDefault();
  vscode.postMessage({ type: 'cancel' });
});
byId('wblist').addEventListener('click', (e) => {
  const target = e.target as Element;
  const all = target.closest('[data-group-all]');
  const none = target.closest('[data-group-none]');
  if (!all && !none) { return; }
  const id = (all || none)!.getAttribute(all ? 'data-group-all' : 'data-group-none');
  for (const b of Array.from(document.querySelectorAll<HTMLInputElement>('#wblist section[data-group="' + id + '"] input[type=checkbox]'))) {
    b.checked = !!all;
  }
  sync();
});
byId('wbcancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
saveEl.addEventListener('click', () => vscode.postMessage({
  type: 'save',
  name: nameEl.value.trim(),
  ids: boxes().filter(b => b.checked).map(b => b.value),
}));
sync();

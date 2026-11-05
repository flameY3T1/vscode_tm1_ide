// src/webviewClient/snippetEditor/index.ts
// Bundle of the snippet editor form (snippets/snippetEditorWebview.ts). Until
// 2026-10 an inline script in the host's template literal.
import { getVsCodeApi } from '../_shared/vscodeApi';

type WebviewToHost =
  | { type: 'save'; trigger: string; name: string; description: string; servers: string; body: string }
  | { type: 'cancel' };
const vscode = getVsCodeApi<WebviewToHost>();
const { isNew } = (window as unknown as { __snippetEditor: { isNew: boolean } }).__snippetEditor;

const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const triggerEl = byId<HTMLInputElement>('trigger');
const nameEl = byId<HTMLInputElement>('name');
const descEl = byId<HTMLInputElement>('description');
const serversEl = byId<HTMLInputElement>('servers');
const bodyEl = byId<HTMLTextAreaElement>('body');

// Tab key → 2 spaces in textarea (TI code often indented with 2 spaces)
bodyEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') { return; }
  e.preventDefault();
  const s = bodyEl.selectionStart, val = bodyEl.value;
  bodyEl.value = val.slice(0, s) + '  ' + val.slice(bodyEl.selectionEnd);
  bodyEl.selectionStart = bodyEl.selectionEnd = s + 2;
});

byId('btn-save').onclick = () => {
  const trigger = triggerEl.value.trim();
  const name = nameEl.value.trim();
  byId('err-trigger').className = trigger ? 'err' : 'err show';
  byId('err-name').className = name ? 'err' : 'err show';
  if (!trigger || !name) { return; }
  vscode.postMessage({
    type: 'save', trigger, name,
    description: descEl.value.trim(), servers: serversEl.value.trim(), body: bodyEl.value,
  });
};

byId('btn-cancel').onclick = () => {
  vscode.postMessage({ type: 'cancel' });
};

if (isNew) { triggerEl.focus(); } else { bodyEl.focus(); bodyEl.setSelectionRange(0, 0); }

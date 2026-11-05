// src/webviewClient/tm1Top/index.ts
// Bundle of the TM1 Top window. Until 2026-10 this was an inline script in the
// host's template literal, invisible to tsc and eslint. Writes text only via
// textContent: thread rows carry native data (user names, contexts).
import type { HostToWebview, Tm1TopBootstrap, Tm1TopRowView, WebviewToHost } from './protocol';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const { labels, prefill } = window as unknown as Tm1TopBootstrap;
let verified = false;
let busy = false;
let rows: Tm1TopRowView[] = [];
const el = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

el('refresh').textContent = labels.refresh;
el('pause-label').textContent = labels.pause;
el('user-label').textContent = labels.user;
el('password-label').textContent = labels.password;
el('verify').textContent = labels.verify;
for (const label of labels.columns) {
  const th = document.createElement('th');
  th.textContent = label;
  el('head').appendChild(th);
}
el<HTMLInputElement>('user').value = prefill.user || '';
if (prefill.saved) { el<HTMLInputElement>('password').placeholder = '••••••'; }

function render(): void {
  el('status').textContent = verified ? labels.verified : labels.unverified;
  el<HTMLButtonElement>('verify').disabled = busy;
  el('rows').replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of [row.threadId, row.session, row.principal, row.context, row.state, row.details.join(' · '), row.elapsed]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    tr.children[4].className = row.stateClass;
    const td = document.createElement('td');
    const button = document.createElement('button');
    button.textContent = labels.kill;
    button.className = 'kill';
    button.disabled = !verified || busy || !row.threadId;
    button.onclick = () => vscode.postMessage({ command: 'kill', threadId: row.threadId });
    td.appendChild(button);
    tr.appendChild(td);
    el('rows').appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.textContent = labels.empty;
    tr.appendChild(td);
    el('rows').appendChild(tr);
  }
}

el('locate').textContent = labels.locate;
el('refresh').onclick = () => vscode.postMessage({ command: 'refresh' });
el('locate').onclick = () => vscode.postMessage({ command: 'locate' });
el('paused').onchange = () => vscode.postMessage({ command: 'pause', paused: el<HTMLInputElement>('paused').checked });
el('login').onsubmit = (e) => {
  e.preventDefault();
  const password = el<HTMLInputElement>('password').value;
  el<HTMLInputElement>('password').value = '';
  verified = false;
  vscode.postMessage({ command: 'verify', username: el<HTMLInputElement>('user').value, password });
  render();
};
el('user').oninput = el('password').oninput = () => {
  verified = false;
  vscode.postMessage({ command: 'invalidate' });
  render();
};
window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  const m = e.data;
  if (m.rows) rows = m.rows;
  if (typeof m.verified === 'boolean') verified = m.verified;
  if (typeof m.busy === 'boolean') busy = m.busy;
  if (typeof m.error === 'string') {
    el('error').textContent = m.error;
    el('locate').hidden = m.locate !== true;
  }
  render();
});
render();
vscode.postMessage({ command: 'refresh' });

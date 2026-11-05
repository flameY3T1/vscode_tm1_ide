// src/webviewClient/cellSecurityBuilder/index.ts
// Bundle of the cell-security builder. Until 2026-10 an inline script in
// commands/security/cellSecurityBuilderHtml.ts. Enables Create when at least
// one box is checked; posts the checked dimensions in source order.
import type { CellSecurityToHost, CellSecurityToWebview } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<CellSecurityToHost>();
const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const order = JSON.parse(byId('csb-data').textContent ?? '[]') as string[];
const elCreate = byId<HTMLButtonElement>('create');
const elResult = byId('result');

function checkedDims(): string[] {
  const set = new Set(Array.from(document.querySelectorAll<HTMLInputElement>('input.dim:checked')).map((c) => c.value));
  return order.filter((d) => set.has(d));
}
function sync(): void { elCreate.disabled = checkedDims().length === 0; }
byId('dims').addEventListener('change', sync);
elCreate.addEventListener('click', () => {
  elCreate.disabled = true;
  vscode.postMessage({ type: 'create', selected: checkedDims() });
});
window.addEventListener('message', (ev: MessageEvent<CellSecurityToWebview>) => {
  const m = ev.data;
  if (m.type === 'error') { elResult.textContent = m.message; elResult.className = 'result err'; elCreate.disabled = false; }
});
sync();

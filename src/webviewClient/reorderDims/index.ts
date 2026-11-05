// src/webviewClient/reorderDims/index.ts
// Bundle of the reorder-dimensions window. Until 2026-10 an inline script in
// commands/cube/reorderDimsHtml.ts. Reads the embedded JSON, renders the
// editable list, handles up/down + "use recommended" + apply, toggles the
// last-dimension warning.
import type { ReorderData, ReorderDimsToHost, ReorderDimsToWebview } from './protocol';
import { escapeHtml } from '../htmlUtils';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<ReorderDimsToHost>();
const byId = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;
const data = JSON.parse(byId('reorder-data').textContent ?? '{}') as ReorderData;
const L = JSON.parse(byId('reorder-labels').textContent ?? '{}') as { up: string; down: string };
let editable = data.current.slice();
let current = data.current.slice();
const elEditable = byId('editable');
const elApply = byId<HTMLButtonElement>('apply');
const elWarn = byId('last-warn');
const elResult = byId('result');

const sameOrder = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

function render(): void {
  elEditable.innerHTML = editable.map((n, i) => {
    const c = data.counts[n];
    const badge = (c === null || c === undefined) ? '?' : String(c);
    return '<li data-i="' + i + '"><span class="dn">' + escapeHtml(n) + '</span>'
      + '<span class="cnt">' + escapeHtml(badge) + '</span>'
      + '<span class="mv"><button class="up" title="' + escapeHtml(L.up) + '" ' + (i === 0 ? 'disabled' : '') + '>▲</button>'
      + '<button class="down" title="' + escapeHtml(L.down) + '" ' + (i === editable.length - 1 ? 'disabled' : '') + '>▼</button></span></li>';
  }).join('');
  elApply.disabled = sameOrder(editable, current);
  elWarn.classList.toggle('hidden', editable[editable.length - 1] === current[current.length - 1]);
}
function move(i: number, delta: number): void {
  const j = i + delta; if (j < 0 || j >= editable.length) return;
  [editable[i], editable[j]] = [editable[j], editable[i]];
  render();
}
elEditable.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const li = t.closest('li'); if (!li) return;
  const i = parseInt(li.getAttribute('data-i') ?? '', 10);
  if (t.classList.contains('up')) move(i, -1);
  else if (t.classList.contains('down')) move(i, 1);
});
byId('use-recommended').addEventListener('click', () => {
  editable = data.recommended.slice(); render();
});
elApply.addEventListener('click', () => {
  elApply.disabled = true;
  vscode.postMessage({ type: 'apply', order: editable });
});
window.addEventListener('message', (ev: MessageEvent<ReorderDimsToWebview>) => {
  const m = ev.data;
  if (m.type === 'applied') {
    // Rebaseline: after a successful reorder the new order is the current one,
    // so Apply disables again until the next edit.
    data.current = m.current.slice();
    current = m.current.slice();
    editable = m.current.slice();
    data.counts = m.counts || data.counts;
    elResult.textContent = m.message;
    elResult.className = 'result ok';
    render();
  } else if (m.type === 'error') {
    elResult.textContent = m.message;
    elResult.className = 'result err';
    elApply.disabled = false;
  } else if (m.type === 'info') {
    // Neutral (e.g. cancelled confirmation) — not an error.
    elResult.textContent = m.message;
    elResult.className = 'result';
    elApply.disabled = false;
  }
});
render();

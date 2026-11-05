// src/webviewClient/callGraph/index.ts
// Bundle of the call graph page (references/callGraphWebview.ts). Until
// 2026-10 an inline script in the host's template literal.
import { getVsCodeApi } from '../_shared/vscodeApi';
import { wireMapTab } from '../_shared/mapTab';

type WebviewToHost =
  | { type: 'showMap' }
  | { type: 'selectRun'; startedAt: string }
  | { type: 'openChore'; choreName: string }
  | { type: 'openProcess'; processName: string }
  | { type: 'switchDirection'; direction: string };
const vscode = getVsCodeApi<WebviewToHost>();

wireMapTab(vscode);
const runSel = document.getElementById('run-select') as HTMLSelectElement | null;
if (runSel) {
  runSel.addEventListener('change', () => {
    vscode.postMessage({ type: 'selectRun', startedAt: runSel.value });
  });
}

function setAll(open: boolean): void {
  document.querySelectorAll('.node').forEach((n, idx) => {
    // keep root always open
    if (idx === 0) { n.setAttribute('data-open', '1'); return; }
    if (open) { n.setAttribute('data-open', '1'); } else { n.removeAttribute('data-open'); }
  });
}

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const action = t.dataset && t.dataset.action;
  if (action === 'open') {
    const node = t.closest<HTMLElement>('.node');
    if (!node) return;
    if (node.dataset.kind === 'chore') {
      vscode.postMessage({ type: 'openChore', choreName: node.dataset.proc ?? '' });
    } else {
      vscode.postMessage({ type: 'openProcess', processName: node.dataset.proc ?? '' });
    }
    e.stopPropagation();
    return;
  }
  if (action === 'toggle') {
    const node = t.closest('.node');
    if (!node) return;
    if (node.getAttribute('data-open') === '1') node.removeAttribute('data-open');
    else node.setAttribute('data-open', '1');
    e.stopPropagation();
    return;
  }
  if (action === 'expandAll') { setAll(true); return; }
  if (action === 'collapseAll') { setAll(false); return; }
  // closest(): the tab carries a nested count badge, so the click target is
  // often the <span>, not the button itself.
  const tab = t.closest<HTMLElement>('[data-dir]');
  if (tab) {
    vscode.postMessage({ type: 'switchDirection', direction: tab.dataset.dir ?? '' });
  }
});

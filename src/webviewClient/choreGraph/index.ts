// src/webviewClient/choreGraph/index.ts
// Bundle of the chore graph page (references/choreGraphWebview.ts). Until
// 2026-10 an inline script in the host's template literal.
import { getVsCodeApi } from '../_shared/vscodeApi';
import { wireMapTab } from '../_shared/mapTab';

type WebviewToHost = { type: 'showMap' } | { type: 'openProcess'; processName: string };
const vscode = getVsCodeApi<WebviewToHost>();

wireMapTab(vscode);
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.action === 'open') {
    const proc = t.dataset.proc || t.closest<HTMLElement>('[data-proc]')?.dataset.proc || '';
    vscode.postMessage({ type: 'openProcess', processName: proc });
  }
});

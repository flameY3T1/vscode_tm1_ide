// src/webviewClient/usageGraph/index.ts
// Bundle of the usage list page (references/usageGraphWebview.ts). Until
// 2026-10 an inline script in the host's template literal.
import { getVsCodeApi } from '../_shared/vscodeApi';
import { wireMapTab } from '../_shared/mapTab';

type WebviewToHost =
  | { type: 'showMap' }
  | { type: 'openSource'; sourceKind: string; sourceName: string };
const vscode = getVsCodeApi<WebviewToHost>();

wireMapTab(vscode);
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const openTarget = t.closest('[data-action="open"]');
  if (openTarget) {
    const grp = openTarget.closest<HTMLElement>('.group');
    vscode.postMessage({ type: 'openSource', sourceKind: grp?.dataset.kind ?? '', sourceName: grp?.dataset.source ?? '' });
    return;
  }
  const header = t.closest('.group-header');
  if (header) {
    header.parentElement?.classList.toggle('collapsed');
  }
});

const filterInput = document.getElementById('filter') as HTMLInputElement;
filterInput.addEventListener('input', () => {
  const needle = filterInput.value.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('.group').forEach((grp) => {
    const source = (grp.dataset.source || '').toLowerCase();
    let anyVisible = false;
    grp.querySelectorAll('.ref').forEach((r) => {
      const text = (r.textContent || '').toLowerCase();
      const match = !needle || source.includes(needle) || text.includes(needle);
      r.classList.toggle('hidden', !match);
      if (match) { anyVisible = true; }
    });
    grp.classList.toggle('hidden', !anyVisible);
  });
});

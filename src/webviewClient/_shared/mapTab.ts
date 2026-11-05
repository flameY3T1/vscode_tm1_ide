// src/webviewClient/_shared/mapTab.ts
// The "Lineage" tab of the three reference graphs (call, chore, usage): a click
// asks the host to swap the page for the model map of the same object.
import type { VsCodeApi } from './vscodeApi';

export function wireMapTab(vscode: VsCodeApi<{ type: 'showMap' }>): void {
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('[data-map-tab]')) { vscode.postMessage({ type: 'showMap' }); }
  });
}

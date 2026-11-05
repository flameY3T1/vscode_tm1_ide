// src/webviewClient/tiTestSummary/index.ts
// Bundle of the TI test folder-run summary (webviews/renderSummaryHtml.ts).
// Until 2026-10 an inline script. Every action button posts its data-action
// with the test folder it belongs to.
import { getVsCodeApi } from '../_shared/vscodeApi';

type WebviewToHost = { type: string; folder: string | null };
const vscode = getVsCodeApi<WebviewToHost>();

document.querySelectorAll('button[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => {
    vscode.postMessage({ type: btn.getAttribute('data-action') ?? '', folder: btn.getAttribute('data-folder') });
  });
});

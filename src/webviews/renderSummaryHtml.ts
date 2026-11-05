/**
 * Pure HTML renderer for the Folder-Run Summary Webview. Tabular display
 * of test-name, status, diff-count, duration. Bulk-action buttons emit
 * postMessage events the manager translates into command invocations.
 */

import * as vscode from 'vscode';
import type { DiffSummary } from '../tiTestFramework/diff/diffResult';
import { escapeHtml } from '../utils/escapeHtml';

export type SummaryRow = {
  testFolder: string;
  testName: string;
  pass: boolean;
  summary: DiffSummary;
  durationMs: number;
  error?: string;
};

export type SummaryViewInput = {
  folderLabel: string;
  rows: SummaryRow[];
  cspNonce?: string;
  /** Webview URI of out/webview/tiTestSummary.js; omitted in unit tests. */
  scriptUri?: string;
};

const STYLES = `
  :root {
    color-scheme: var(--vscode-color-scheme);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  body { margin: 0; padding: 12px 16px; }
  header { margin-bottom: 12px; }
  header h1 { margin: 0; font-size: 1.1rem; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85rem; margin-top: 4px; }
  .pill { padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 0.85rem; }
  .pill.pass { background: var(--vscode-testing-iconPassed, #2da44e); color: #fff; }
  .pill.fail { background: var(--vscode-testing-iconFailed, #cf222e); color: #fff; }
  .pill.error { background: var(--vscode-errorForeground, #cf222e); color: #fff; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
  .toolbar button { padding: 4px 10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; font-size: 0.85rem; }
  .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { font-weight: 600; color: var(--vscode-descriptionForeground); }
  td.test-name { font-family: var(--vscode-editor-font-family); font-size: 0.9rem; }
  td.diff-count, td.duration { text-align: right; font-family: var(--vscode-editor-font-family); }
  tr.row-fail { background: rgba(207, 34, 46, 0.08); }
  tr.row-error { background: rgba(207, 34, 46, 0.16); }
  td .show-diff { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: underline; background: none; border: none; padding: 0; font: inherit; }
`;

export function renderSummaryHtml(input: SummaryViewInput): string {
  const { folderLabel, rows, cspNonce, scriptUri } = input;

  const total = rows.length;
  const passCount = rows.filter((r) => !r.error && r.pass).length;
  const failCount = rows.filter((r) => !r.error && !r.pass).length;
  const errorCount = rows.filter((r) => r.error).length;
  const totalDuration = rows.reduce((acc, r) => acc + r.durationMs, 0);

  const nonceAttr = cspNonce ? ` nonce="${escapeHtml(cspNonce)}"` : '';
  // CSP is always emitted. With a nonce, scripts run under it; without one
  // (misconfigured caller) scripts are locked out ('none') rather than leaving
  // the page with no policy at all — this view renders TM1 data via innerHTML.
  const scriptSrc = cspNonce ? `'nonce-${escapeHtml(cspNonce)}'` : `'none'`;
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptSrc};">`;

  const failedFolders = rows.filter((r) => r.error || !r.pass).map((r) => r.testFolder);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${cspMeta}
  <title>${escapeHtml(vscode.l10n.t('{0} — Summary', folderLabel))}</title>
  <style>${STYLES}</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(folderLabel)}</h1>
    <div class="meta">
      ${escapeHtml(vscode.l10n.t('{0} tests · {1} pass · {2} fail · {3} error · total {4} ms', total, passCount, failCount, errorCount, totalDuration))}
    </div>
  </header>
  <div class="toolbar">
    <button data-action="rerunAll">${escapeHtml(vscode.l10n.t('Re-run all'))}</button>
    ${failedFolders.length > 0 ? `<button data-action="rerunFailed">${escapeHtml(vscode.l10n.t('Re-run failed ({0})', failedFolders.length))}</button>` : ''}
  </div>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(vscode.l10n.t('Test'))}</th>
        <th>${escapeHtml(vscode.l10n.t('Status'))}</th>
        <th class="diff-count">${escapeHtml(vscode.l10n.t('Diffs'))}</th>
        <th class="duration">${escapeHtml(vscode.l10n.t('Duration'))}</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((r) => {
          const rowClass = r.error ? 'row-error' : r.pass ? '' : 'row-fail';
          const statusPill = r.error
            ? `<span class="pill error">${escapeHtml(vscode.l10n.t('ERROR'))}</span>`
            : r.pass
              ? `<span class="pill pass">${escapeHtml(vscode.l10n.t('PASS'))}</span>`
              : `<span class="pill fail">${escapeHtml(vscode.l10n.t('FAIL'))}</span>`;
          return `
            <tr class="${rowClass}">
              <td class="test-name">${escapeHtml(r.testName)}</td>
              <td>${statusPill}${r.error ? ` <span class="meta">${escapeHtml(r.error)}</span>` : ''}</td>
              <td class="diff-count">${r.summary.totalDiffs}</td>
              <td class="duration">${escapeHtml(vscode.l10n.t('{0} ms', r.durationMs))}</td>
              <td><button class="show-diff" data-action="showDiff" data-folder="${escapeHtml(r.testFolder)}">${escapeHtml(vscode.l10n.t('show'))}</button></td>
            </tr>
          `;
        })
        .join('')}
    </tbody>
  </table>
  ${scriptUri ? `<script${nonceAttr} src="${escapeHtml(scriptUri)}"></script>` : ''}
</body>
</html>`;
}

import * as vscode from 'vscode';
import { STATS_MEASURES } from './cubeStatsTypes';
import type { CubeStatsBootstrap } from '../webviewClient/cubeStats/protocol';
import { renderWebviewShell } from '../webviews/webviewShell';
import { escapeHtml as esc } from '../utils/escapeHtml';

/**
 * HTML/CSS for the RAM dashboard; the logic is the bundle webviewClient/cubeStats/.
 * Data arrives via postMessage.
 */
export function getCubeStatsHtml(serverLabel: string, cspSource: string, scriptUri: string): string {

  const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
  }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--vscode-editorGroup-border); }
  .header h2 { font-size: 1.1em; font-weight: 600; }
  .header .server { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .header .spacer { flex: 1; }
  button {
    padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    cursor: pointer; font-size: inherit; border-radius: 3px;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }

  .tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 16px; }
  .tile { background: var(--vscode-editorGroupHeader-tabsBackground); border: 1px solid var(--vscode-editorGroup-border); border-radius: 6px; padding: 12px; }
  .tile .label { color: var(--vscode-descriptionForeground); font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .tile .value { font-size: 1.4em; font-weight: 600; }

  .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .controls input[type=text] {
    flex: 0 0 240px; padding: 4px 8px; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px;
  }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; }
  th { cursor: pointer; user-select: none; background: var(--vscode-editorGroupHeader-tabsBackground); position: sticky; top: 0; }
  th:hover { background: var(--vscode-list-hoverBackground); }
  th.sorted { color: var(--vscode-textLink-foreground); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .sys { color: var(--vscode-descriptionForeground); font-style: italic; }

  .empty { padding: 32px; text-align: center; color: var(--vscode-descriptionForeground); }
  .error { padding: 12px; color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 3px; margin-bottom: 12px; }
  .loading { padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); }
`;
  const body = `
<div class="header">
  <h2>📊 ${vscode.l10n.t('RAM Dashboard')}</h2>
  <span class="server">Server: ${esc(serverLabel)}</span>
  <span class="spacer"></span>
  <button id="btn-refresh" class="primary">⟳ Refresh</button>
  <button id="btn-csv">📥 CSV</button>
</div>

<div id="error-box"></div>
<div id="loading" class="loading" style="display:none;">${vscode.l10n.t('Loading stats…')}</div>

<div class="tiles" id="tiles"></div>

<div class="controls">
  <input id="filter" type="text" placeholder="${vscode.l10n.t('Filter (cube name)…')}" />
  <span class="spacer" style="flex:1"></span>
  <span id="row-count" style="color:var(--vscode-descriptionForeground); font-size:0.9em;"></span>
</div>

<div class="table-wrap">
  <table id="stats-table">
    <thead><tr id="th-row"></tr></thead>
    <tbody id="stats-body"></tbody>
  </table>
</div>
<div id="empty-msg" class="empty" style="display:none;">${vscode.l10n.t('No cubes.')}</div>

`;
  const bootstrap: CubeStatsBootstrap = {
    measures: STATS_MEASURES.map(m => ({ ...m, label: vscode.l10n.t(m.label) })),
    texts: { cube: vscode.l10n.t('Cube'), totalRam: vscode.l10n.t('Total RAM'), cubeCount: vscode.l10n.t('Cube Count'), cubes: vscode.l10n.t('Cubes') },
  };
  return renderWebviewShell({ cspSource, css, body, globals: { __cubeStats: bootstrap }, scriptUris: [scriptUri] });
}

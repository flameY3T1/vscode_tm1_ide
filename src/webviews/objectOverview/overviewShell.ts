import * as vscode from 'vscode';
import { renderWebviewShell } from '../webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../columnResize';
import { savedColumnWidths } from '../columnWidthStore';
import { escapeHtml } from '../../utils/escapeHtml';

/**
 * Static HTML for an overview page. Columns/rows/KPIs arrive at runtime via
 * postMessage after the client sends `ready` — the shell only lays out the
 * header, tiles container, controls, and an empty table.
 */
export function getOverviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  opts: { title: string; serverLabel: string; widthKind: string },
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'objectOverview.js'),
  );
  const css = [
    'html, body { height: 100%; }',
    'body { padding: 0; margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); display: flex; flex-direction: column; overflow: hidden; }',
    '.ov-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }',
    '.ov-title { font-size: 14px; font-weight: 600; }',
    '.ov-server { color: var(--vscode-descriptionForeground); font-size: 13px; }',
    '.ov-spacer { flex: 1; }',
    '.ov-btn { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }',
    '.ov-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }',
    '.ov-tiles { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; flex-shrink: 0; }',
    '.ov-tile { display: inline-flex; align-items: baseline; gap: 6px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 3px 10px; }',
    '.ov-tile .v { font-size: 14px; font-weight: 700; }',
    '.ov-tile-click { cursor: pointer; }',
    '.ov-tile-click:hover { border-color: var(--vscode-focusBorder); }',
    '.ov-tile-active { border-color: var(--vscode-focusBorder); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }',
    '.ov-tile .l { font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .04em; }',
    '.ov-controls { display: flex; align-items: center; gap: 12px; padding: 0 16px 8px; flex-shrink: 0; }',
    '.ov-filter { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 8px; font-size: 12px; min-width: 220px; }',
    '.ov-count { color: var(--vscode-descriptionForeground); font-size: 12px; }',
    '.ov-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--vscode-descriptionForeground); }',
    '.ov-table-wrap { overflow: auto; padding: 0 8px 16px; flex: 1 1 auto; min-height: 0; }',
    'table.ov-table { border-collapse: collapse; width: 100%; font-size: 12px; }',
    '.ov-table th, .ov-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }',
    '.ov-table td.ov-badges-cell { white-space: normal; max-width: 460px; line-height: 1.7; }',
    '.ov-table th { position: sticky; top: 0; background: var(--vscode-sideBar-background); cursor: pointer; user-select: none; font-weight: 600; }',
    '.ov-table th.num, .ov-table td.num { text-align: right; font-variant-numeric: tabular-nums; }',
    '.ov-table tbody tr { cursor: pointer; }',
    '.ov-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }',
    '.ov-badge { display: inline-block; padding: 0 5px; margin-right: 3px; font-size: 10px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); cursor: pointer; }',
    '.ov-badge:hover { outline: 1px solid var(--vscode-focusBorder); }',
    '.ov-badge-active { outline: 1px solid var(--vscode-focusBorder); font-weight: 700; }',
    '.ov-filterbar { display: inline-flex; align-items: center; gap: 8px; margin-left: 12px; padding: 2px 4px 2px 10px; font-size: 12px; border-radius: 4px; background: var(--vscode-editorInfo-background, rgba(0,122,204,0.12)); border: 1px solid var(--vscode-focusBorder); }',
    '.ov-filter-clear { font-size: 11px; padding: 1px 8px; border: none; border-radius: 3px; cursor: pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }',
    '.ov-filter-clear:hover { background: var(--vscode-button-secondaryHoverBackground); }',
    '.ov-chip { display: inline-block; margin-left: 8px; padding: 0 8px; font-size: 11px; border-radius: 9px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); cursor: pointer; }',
    '.ov-chip:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.2)); }',
    '.ov-flag-yes { color: var(--vscode-charts-green, #4caf50); }',
    '.ov-flag-no { color: var(--vscode-descriptionForeground); opacity: .5; }',
    '.ov-spin { display: inline-block; width: 10px; height: 10px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: ov-rot .8s linear infinite; }',
    '@keyframes ov-rot { to { transform: rotate(360deg); } }',
    '.ov-error { margin: 12px 16px; padding: 8px 12px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border-radius: 4px; flex-shrink: 0; }',
    '.ov-error:empty { display: none; }',
  ].join('\n');

  const body = [
    '<div class="ov-head">',
    `  <span class="ov-title">${escapeHtml(opts.title)}</span>`,
    `  <span class="ov-server">${opts.serverLabel ? `Server: ${escapeHtml(opts.serverLabel)}` : ''}</span>`,
    '  <span class="ov-spacer"></span>',
    '  <button class="ov-btn" id="ov-refresh">⟳</button>',
    '</div>',
    '<div class="ov-tiles" id="ov-tiles"></div>',
    '<div class="ov-controls">',
    '  <input class="ov-filter" id="ov-filter" type="text" autocomplete="off" spellcheck="false" />',
    '  <span class="ov-count" id="ov-count"></span>',
    '  <label class="ov-toggle"><input type="checkbox" id="ov-showctrl" /> <span id="ov-showctrl-label"></span></label>',
    '</div>',
    '<div class="ov-error" id="ov-error"></div>',
    '<div class="ov-table-wrap"><table class="ov-table" data-resizable><thead id="ov-thead"></thead><tbody id="ov-tbody"></tbody></table></div>',
  ].join('\n');

  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: css + COLUMN_RESIZE_CSS,
    body,
    scriptUris: [scriptUri.toString()],
    inlineScript: columnResizeScript(opts.widthKind, savedColumnWidths(opts.widthKind)),
  });
}


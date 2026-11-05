import * as vscode from 'vscode';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../../webviews/columnResize';
import { savedColumnWidths } from '../../webviews/columnWidthStore';
import { buildMdxRunnerL10n } from './mdxRunnerL10n';
import type { L10nMap } from '../../webviewClient/_shared/l10n';
import { escapeHtml } from '../../utils/escapeHtml';

/**
 * MDX Runner webview HTML — Phase 4 (Monaco-based).
 * Loads the bundled `mdxRunnerMonaco.js` + CSS from `out/webview/`.
 */
export function getMdxRunnerHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  serverLabel: string,
): string {
  const safeLabel = escapeHtml(serverLabel);
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'mdxRunnerMonaco.js'),
  );
  const monacoVendorUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'monaco-vendor.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'monaco-vendor.css'),
  );
  const l10n = buildMdxRunnerL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: 'TM1 MDX Runner',
    styleUris: [String(styleUri)],
    css: MDX_RUNNER_CSS + COLUMN_RESIZE_CSS,
    body: mdxRunnerBody(safeLabel, l10n),
    globals: { __l10n: l10n },
    scriptUris: [String(monacoVendorUri), String(scriptUri)],
    inlineScript: columnResizeScript('mdxRunner', savedColumnWidths('mdxRunner')),
  });
}

const MDX_RUNNER_CSS = `
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    overflow: hidden;
  }
  body { display: flex; flex-direction: column; }

  .top { display: flex; flex-direction: row; flex: 0 0 auto; min-height: 120px; height: 30%; overflow: hidden; }
  /* Drag bar on the edge between editor and result — like
     #debug-vars-resizer in the process editor, only horizontal. 5px hit area,
     1px visible edge, color only on hover (VS Code sash behavior). */
  #split { flex: 0 0 auto; height: 5px; margin-top: -2px; margin-bottom: -2px; cursor: row-resize; user-select: none; z-index: 3; border-top: 1px solid var(--vscode-panel-border); }
  #split:hover { background: var(--vscode-panel-border); }
  #split.dragging { background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder)); }
  body.splitting { cursor: row-resize; }
  .editor-pane { flex: 1; min-width: 0; overflow: hidden; }
  #mdx-editor { width: 100%; height: 100%; }
  .history-pane { width: 260px; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; flex-shrink: 0; }
  .history-header { padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; justify-content: space-between; }
  .history-header button { background: transparent; color: var(--vscode-descriptionForeground); border: none; cursor: pointer; font-size: 11px; padding: 1px 6px; border-radius: 2px; }
  .history-header button:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
  #history-list { flex: 1; overflow: auto; }
  .history-empty { padding: 12px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; text-align: center; }
  .history-item { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); cursor: pointer; font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
  .history-item:hover { background: var(--vscode-list-hoverBackground); }
  .history-item .hi-meta { color: var(--vscode-descriptionForeground); font-size: 10px; display: flex; justify-content: space-between; align-items: center; }
  .history-item .hi-meta .hi-delete { background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 0 4px; font-size: 12px; opacity: 0; transition: opacity 0.1s; }
  .history-item:hover .hi-delete { opacity: 0.6; }
  .history-item .hi-delete:hover { opacity: 1 !important; color: var(--vscode-errorForeground); }
  .history-item .hi-mdx { font-family: var(--vscode-editor-font-family); color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .history-item.error .hi-meta { color: var(--vscode-errorForeground); }
  .history-item.error .hi-mdx { opacity: 0.75; }

  .toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  select.snippet-select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-panel-border))); padding: 3px 6px; font-size: 12px; border-radius: 2px; max-width: 240px; }
  select.snippet-select:focus { outline: 1px solid var(--vscode-focusBorder); }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    border-radius: 2px;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  #status { color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: auto; font-variant-numeric: tabular-nums; }

  #context { padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); display: none; flex-shrink: 0; }
  #context.visible { display: block; }
  #context .ctx-item { display: inline-block; margin-right: 12px; }
  #context .ctx-hier { opacity: 0.7; }

  .result-pane { flex: 1; overflow: auto; position: relative; }
  #error {
    padding: 16px;
    color: var(--vscode-errorForeground);
    border-left: 3px solid var(--vscode-errorForeground);
    margin: 16px;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    white-space: pre-wrap;
    display: none;
  }
  #error.visible { display: block; }
  #error .err-code { font-weight: 600; color: var(--vscode-errorForeground); margin-bottom: 4px; }

  #empty { padding: 32px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }

  table.pivot { border-collapse: collapse; font-size: 12px; }
  table.pivot th, table.pivot td {
    border: 1px solid var(--vscode-panel-border);
    padding: 3px 6px;
    white-space: nowrap;
    font-weight: normal;
  }
  table.pivot th {
    background: var(--vscode-editorGroupHeader-tabsBackground);
    font-weight: 600;
    text-align: left;
  }
  table.pivot th.col-head { text-align: right; }
  table.pivot td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.pivot td.num.zero, table.pivot td.num.null { color: var(--vscode-descriptionForeground); }
  table.pivot tr:hover td:not(.rowhead) { background: var(--vscode-list-hoverBackground); }
  table.pivot td.rowhead { background: var(--vscode-editorGroupHeader-tabsBackground); font-weight: 600; position: sticky; left: 0; z-index: 1; }
  table.pivot thead th { position: sticky; top: 0; z-index: 2; }
  table.pivot thead th.corner { z-index: 3; left: 0; }

  footer { padding: 4px 8px; font-size: 11px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); display: flex; gap: 16px; flex-shrink: 0; }
  footer .server { margin-left: auto; opacity: 0.7; }
`;

const mdxRunnerBody = (safeLabel: string, t: L10nMap) => `
<div class="top">
  <div class="editor-pane"><div id="mdx-editor"></div></div>
  <aside class="history-pane">
    <div class="history-header">
      <span>${t.history}</span>
      <button id="history-clear" title="${t.clearAllHistoryTitle}">${t.clearAll}</button>
    </div>
    <div id="history-list"><div class="history-empty">${t.noHistory}</div></div>
  </aside>
</div>
<div id="split" title="${t.splitTitle}"></div>
<div class="toolbar">
  <button id="run" title="${t.runTitle}">${t.run}</button>
  <button id="clear" class="secondary" title="${t.clearEditorTitle}">${t.clear}</button>
  <button id="format" class="secondary" title="${t.formatTitle}">${t.format}</button>
  <button id="copy-tsv" class="secondary" title="${t.copyTsvTitle}" disabled>${t.copyTsv}</button>
  <select id="snippet-select" class="snippet-select" title="${t.insertSnippetTitle}">
    <option value="" selected>${t.insertSnippet}</option>
  </select>
  <span id="status"></span>
</div>
<div id="context"></div>
<div class="result-pane">
  <div id="empty">${t.emptyHint}</div>
  <div id="error"></div>
  <div id="table-mount"></div>
</div>
<footer>
  <span id="footer-info"></span>
  <span class="server">${safeLabel}</span>
</footer>
`;


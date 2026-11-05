import * as vscode from 'vscode';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { FILTER_COMBO_CSS } from '../../webviews/filterComboCss';

/** L10n map injected as window.__l10n for the builder webview. */
function buildL10n(): Record<string, string> {
  return {
    title: vscode.l10n.t('Area/DB Builder'),
    modeArea: vscode.l10n.t('Area []'),
    modeDb: vscode.l10n.t('DB()'),
    targetCube: vscode.l10n.t('Target cube'),
    searchPlaceholder: vscode.l10n.t('Search element or alias…'),
    insert: vscode.l10n.t('Insert'),
    cancel: vscode.l10n.t('Cancel'),
    loadMore: vscode.l10n.t('Load more'),
    emptyArea: vscode.l10n.t('No element selected — area is empty.'),
    // filterCombo.ts (target cube picker) reads these three.
    selectPlaceholder: vscode.l10n.t('Select…'),
    filterElements: vscode.l10n.t('Filter by name…'),
    noMatches: vscode.l10n.t('No matches'),
  };
}

export function getAreaDbBuilderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'areaDbBuilder.js'),
  );
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: vscode.l10n.t('Area/DB Builder'),
    css: AREA_DB_BUILDER_CSS,
    body: AREA_DB_BUILDER_BODY,
    globals: { __l10n: buildL10n() },
    scriptUris: [String(scriptUri)],
  });
}

const AREA_DB_BUILDER_CSS = `
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px; font-size: 13px; }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  select, input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 3px; cursor: pointer; font-size: 12px; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .seg { display: inline-flex; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: hidden; }
  .seg button { background: transparent; color: var(--vscode-foreground); border: none; border-radius: 0; padding: 4px 12px; }
  .seg button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .dim { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 6px; }
  .dim-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; user-select: none; }
  .dim-name { font-weight: 600; }
  .dim-val { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .dim-body { display: none; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border); }
  .dim.open .dim-body { display: block; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 1px 8px; font-size: 11px; }
  .chip .x { cursor: pointer; opacity: 0.7; }
  .chip .x:hover { opacity: 1; }
  .elist { max-height: 200px; overflow-y: auto; border: 1px solid var(--vscode-panel-border); border-radius: 3px; }
  .erow { padding: 3px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
  .erow:hover { background: var(--vscode-list-hoverBackground); }
  .erow.picked { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .erow .alias { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .preview { margin-top: 12px; }
  .preview pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-family: var(--vscode-editor-font-family); font-size: 12px; margin: 4px 0; }
  .hint { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .actions { display: flex; gap: 8px; margin-top: 10px; }
  /* The select stays the value carrier; the filterable combo renders on top. */
  #cube-select { display: none; }
  #cube-wrap .title-combo-btn { border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 18px 3px 6px; font-size: 12px; max-width: 320px; }
  ${FILTER_COMBO_CSS}
`;

const AREA_DB_BUILDER_BODY = `
  <div class="row">
    <div class="seg" id="mode-seg">
      <button data-mode="AREA" class="active" id="mode-area"></button>
      <button data-mode="DB" id="mode-db"></button>
    </div>
    <span id="cube-wrap" class="row" style="display:none; margin:0;">
      <label id="cube-label"></label>
      <select id="cube-select"></select>
    </span>
  </div>
  <div id="dims"></div>
  <div class="preview">
    <pre id="preview-text"></pre>
    <div class="hint" id="preview-hint"></div>
  </div>
  <div class="actions">
    <button id="btn-insert"></button>
    <button id="btn-cancel" class="secondary"></button>
  </div>
`;

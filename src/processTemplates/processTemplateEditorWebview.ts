import * as vscode from 'vscode';
import { renderWebviewShell } from '../webviews/webviewShell';
import { buildProcessEditorL10n } from '../commands/processEditor/processEditorL10n';
import type { ProcessTemplate } from './processTemplateTypes';
import { getInlineSignaturesJson } from '../utils/sigsAsset';

export function getProcessTemplateEditorHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  tpl: ProcessTemplate,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'processTemplateEditorMonaco.js'));
  const vendorUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'monaco-vendor.js'));
  const vendorCss = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'monaco-vendor.css'));
  const s = tpl.source;
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: vscode.l10n.t('Edit template'),
    styleUris: [String(vendorCss)],
    css: PROCESS_TEMPLATE_EDITOR_CSS,
    body: buildProcessTemplateEditorBody(),
    globals: {
      // Shared renderers (parameters/dataSource/variables) read `window.__l10n`.
      __l10n: {
        ...buildProcessEditorL10n(),
        // Template-editor-only string (the shared process-editor map has no
        // template-name field). Kept here instead of in processEditorL10n so the
        // process editor's own bundle does not grow a key it never reads.
        tplNameRequired: vscode.l10n.t('Please enter a template name.'),
      },
      __TEMPLATE_INIT__: {
        name: tpl.name, description: tpl.description, servers: tpl.servers ?? '',
        prolog: s.PrologProcedure, metadata: s.MetadataProcedure,
        data: s.DataProcedure, epilog: s.EpilogProcedure,
        params: s.Parameters, variables: s.Variables, dataSource: s.DataSource,
      },
      // `__tm1DocLang` controls the language of the generated IBM doc links.
      __tm1DocLang: vscode.env.language,
    },
    // Without this block `KNOWN_SIGNATURES` stays EMPTY in the client — then
    // `registerTiLanguage` colours no function name. Never noticed, because an
    // empty list looks like a list without hits (2026-09-18).
    jsonData: [{ id: 'tm1-signatures-data', json: getInlineSignaturesJson(extensionUri) }],
    scriptUris: [String(vendorUri), String(scriptUri)],
  });
}

const PROCESS_TEMPLATE_EDITOR_CSS = `
  html, body { height: 100%; margin: 0; padding: 0; font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  body { display: flex; flex-direction: column; overflow: hidden; font-size: var(--vscode-font-size); }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; }
  .toolbar .title { font-weight: 600; margin-right: 16px; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { border: none; padding: 4px 12px; cursor: pointer; font-size: inherit; border-radius: 2px; }
  #btn-save { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #btn-save:hover { background: var(--vscode-button-hoverBackground); }
  #btn-cancel { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #btn-cancel:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  .tabs { display: flex; align-items: stretch; background: var(--vscode-tab-inactiveBackground); border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; overflow-x: auto; }
  .tab { padding: 6px 16px; cursor: pointer; border-right: 1px solid var(--vscode-panel-border); color: var(--vscode-tab-inactiveForeground); font-size: 12px; user-select: none; white-space: nowrap; }
  .tab:hover { background: var(--vscode-tab-hoverBackground); }
  .tab.active { background: var(--vscode-tab-activeBackground); color: var(--vscode-tab-activeForeground); border-bottom: 2px solid var(--vscode-focusBorder); padding-bottom: 4px; }
  .tab-sep { width: 1px; background: var(--vscode-panel-border); margin: 0 4px; align-self: stretch; }
  .tab.code-tab { font-style: italic; }
  .tab.code-tab.active { font-style: normal; }
  .tab-badge { display: inline-block; min-width: 16px; padding: 0 6px; margin-left: 6px; font-size: 10px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-align: center; line-height: 14px; }
  .tab-badge:empty { display: none; }
  #ds-type-indicator { color: var(--vscode-descriptionForeground); font-size: 10px; }
  .panels { flex: 1; min-height: 0; position: relative; }
  .panel { position: absolute; inset: 0; display: none; overflow: auto; }
  .panel.active { display: flex; flex-direction: column; }
  #panel-code { overflow: hidden; }
  #monaco-editor-mount { flex: 1; min-height: 0; }
  .panel-body { padding: 12px 16px; overflow-y: auto; flex: 1; }
  .params-empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .params-table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .params-table th, .params-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .params-table th { background: var(--vscode-sideBar-background); font-weight: 600; }
  .params-table input, .params-table select { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; box-sizing: border-box; }
  .params-table input:focus, .params-table select:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .params-remove { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid transparent; cursor: pointer; padding: 2px 8px; font-size: 12px; border-radius: 2px; }
  .params-remove:hover { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border-color: var(--vscode-inputValidation-errorBorder); }
  .params-move { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid transparent; cursor: pointer; padding: 2px 5px; font-size: 11px; border-radius: 2px; }
  .params-move:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); border-color: var(--vscode-panel-border); }
  .params-move:disabled { opacity: .35; cursor: default; }
  .add-param-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 12px; }
  .add-param-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  .ds-form { display: flex; flex-direction: column; gap: 12px; width: 100%; }
  .ds-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px 20px; max-width: 1200px; }
  .ds-row { display: grid; grid-template-columns: 160px 1fr; gap: 10px; align-items: center; }
  .ds-row.full { grid-column: 1 / -1; }
  .ds-row label { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .ds-row input, .ds-row select, .ds-row textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 4px 8px; font-family: var(--vscode-editor-font-family); font-size: 12px; width: 100%; box-sizing: border-box; }
  .ds-row input:focus, .ds-row select:focus, .ds-row textarea:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .ds-row textarea { min-height: 80px; resize: vertical; }
  .ds-section-title { font-weight: 600; margin-top: 4px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .ds-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 4px 0; }
  #ds-ascii-preview-box { width: 100%; }
  .panel-info-fields { display: flex; flex-direction: column; gap: 14px; max-width: 600px; }
  .panel-info-fields .field-group { display: flex; flex-direction: column; gap: 4px; }
  .panel-info-fields label { font-size: 12px; color: var(--vscode-descriptionForeground); font-weight: 600; }
  .panel-info-fields input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 5px 8px; font-size: inherit; font-family: inherit; box-sizing: border-box; width: 100%; }
  .panel-info-fields input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .panel-info-fields .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .panel-info-fields input.invalid { border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground)); }
  .panel-info-fields .field-error { font-size: 11px; color: var(--vscode-errorForeground); margin-top: 2px; }
`;

const buildProcessTemplateEditorBody = (): string => `
<div class="toolbar">
  <span class="title">${vscode.l10n.t('Edit template')}</span>
  <span class="spacer"></span>
  <button id="btn-save">${vscode.l10n.t('Save')}</button>
  <button id="btn-cancel">${vscode.l10n.t('Cancel')}</button>
</div>
<div class="tabs">
  <div class="tab active" data-tab="template-info">${vscode.l10n.t('Template info')}</div>
  <div class="tab-sep"></div>
  <div class="tab" data-tab="parameters">Parameters <span class="tab-badge" id="params-count"></span></div>
  <div class="tab" data-tab="datasource">DataSource <span id="ds-type-indicator"></span></div>
  <div class="tab" id="tab-variables" data-tab="variables">Variables <span class="tab-badge" id="vars-count"></span></div>
  <div class="tab-sep" id="sep-before-code"></div>
  <div class="tab code-tab" data-tab="code" data-section="prolog">Prolog <span class="tab-badge" id="lc-prolog"></span></div>
  <div class="tab code-tab" data-tab="code" data-section="metadata">Metadata <span class="tab-badge" id="lc-metadata"></span></div>
  <div class="tab code-tab" data-tab="code" data-section="data">Data <span class="tab-badge" id="lc-data"></span></div>
  <div class="tab code-tab" data-tab="code" data-section="epilog">Epilog <span class="tab-badge" id="lc-epilog"></span></div>
</div>
<div class="panels">
  <div class="panel active" id="panel-template-info">
    <div class="panel-body">
      <div class="panel-info-fields">
        <div class="field-group">
          <label>${vscode.l10n.t('Template name *')}</label>
          <input id="tpl-name" type="text" placeholder="${vscode.l10n.t('Name')}" aria-describedby="tpl-name-error">
          <div class="field-error" id="tpl-name-error" role="alert" style="display:none"></div>
        </div>
        <div class="field-group">
          <label>${vscode.l10n.t('Description')}</label>
          <input id="tpl-desc" type="text" placeholder="${vscode.l10n.t('Short description (optional)')}">
        </div>
        <div class="field-group">
          <label>${vscode.l10n.t('For specific servers only')}</label>
          <input id="tpl-servers" type="text" placeholder="${vscode.l10n.t('Server1;Server2 (empty = always show)')}">
          <div class="hint">${vscode.l10n.t('Semicolon-separated TM1 server names. Empty = template available on all servers.')}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="panel" id="panel-parameters">
    <div class="panel-body" id="params-container">
      <p class="params-empty">${vscode.l10n.t('Loading parameters…')}</p>
    </div>
  </div>
  <div class="panel" id="panel-datasource">
    <div class="panel-body" id="ds-container">
      <p class="params-empty">${vscode.l10n.t('Loading data source…')}</p>
    </div>
  </div>
  <div class="panel" id="panel-variables">
    <div class="panel-body" id="vars-container">
      <p class="params-empty">${vscode.l10n.t('Loading variables…')}</p>
    </div>
  </div>
  <div class="panel" id="panel-code">
    <div id="monaco-editor-mount"></div>
  </div>
</div>
`;

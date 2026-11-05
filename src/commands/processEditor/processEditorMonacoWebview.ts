import * as vscode from 'vscode';
import { getInlineSignaturesJson, getInlineSignatureDocsJson } from '../../utils/sigsAsset';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { MONACO_GUTTER_CSS } from '../../webviews/monacoGutterCss';
import { FILTER_COMBO_CSS } from '../../webviews/filterComboCss';
import { monacoEditorUris, editMenuIcons, editMenuHtml, xfindHtml, MONACO_XFIND_CSS, MONACO_REFERENCES_CSS } from '../../webviews/monacoEditorChrome';
import { buildProcessEditorL10n } from './processEditorL10n';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

/**
 * Returns the complete HTML document string for the Monaco-based Process Editor webview.
 * Phase 2: toolbar + tab bar (Code/Parameters) + Monaco mount + parameters panel.
 */
export function getMonacoHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const { scriptUri, monacoVendorUri, styleUri, iconUri } = monacoEditorUris(webview, extensionUri, 'processEditorMonaco.js');
  const icons = {
    saveLight:      iconUri('light', 'save'),
    saveDark:       iconUri('dark',  'save'),
    saveAsLight:    iconUri('light', 'save-as'),
    saveAsDark:     iconUri('dark',  'save-as'),
    runLight:       iconUri('light', 'run'),
    runDark:        iconUri('dark',  'run'),
    debugLight:     iconUri('light', 'debug'),
    debugDark:      iconUri('dark',  'debug'),
    formatLight:    iconUri('light', 'format'),
    formatDark:     iconUri('dark',  'format'),
    continueLight:  iconUri('light', 'continue'),
    continueDark:   iconUri('dark',  'continue'),
    stepOverLight:  iconUri('light', 'step-over'),
    stepOverDark:   iconUri('dark',  'step-over'),
    stepIntoLight:  iconUri('light', 'step-into'),
    stepIntoDark:   iconUri('dark',  'step-into'),
    stepOutLight:   iconUri('light', 'step-out'),
    stepOutDark:    iconUri('dark',  'step-out'),
    stopLight:      iconUri('light', 'stop'),
    stopDark:       iconUri('dark',  'stop'),
    ...editMenuIcons(iconUri),
  };
  const l10n = buildProcessEditorL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: vscode.l10n.t('TM1 Process Editor (Monaco)'),
    styleUris: [String(styleUri)],
    css: PROCESS_EDITOR_CSS,
    body: processEditorBody(icons, l10n),
    // __tm1DocLang controls the language of the generated IBM documentation links
    // (sigsBootstrap filters to the codes that IBM actually serves).
    globals: { __l10n: l10n, __tm1DocLang: vscode.env.language },
    jsonData: [
      { id: 'tm1-signature-docs-data', json: getInlineSignatureDocsJson(extensionUri) },
      { id: 'tm1-signatures-data', json: getInlineSignaturesJson(extensionUri) },
    ],
    scriptUris: [String(monacoVendorUri), String(scriptUri)],
  });
}

const PROCESS_EDITOR_CSS = `
  html, body { height: 100%; margin: 0; padding: 0; font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  body { display: flex; flex-direction: column; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; }
  .toolbar .title { font-weight: 600; margin-right: 16px; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); border-color: var(--vscode-toolbar-hoverOutline, transparent); }
  .toolbar button:active { background: var(--vscode-toolbar-activeBackground, rgba(128,128,128,0.28)); }
  .toolbar button.icon-btn { display: inline-flex; align-items: center; gap: 6px; }
  .toolbar button .btn-icon { width: 16px; height: 16px; flex-shrink: 0; pointer-events: none; }
  .toolbar button .btn-icon.dark-only { display: none; }
  body.vscode-dark .toolbar button .btn-icon.light-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .toolbar button .btn-icon.light-only { display: none; }
  body.vscode-dark .toolbar button .btn-icon.dark-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .toolbar button .btn-icon.dark-only { display: inline-flex; }
  .toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .toolbar button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  #status { padding: 4px 12px; font-size: 11px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  /* Empty = nothing to report: remove the bar entirely, do not leave it standing as a 9px strip. */
  #status:empty { display: none; }
  #status.dirty::before { content: '● '; color: var(--vscode-gitDecoration-modifiedResourceForeground); }

  .tabs { display: flex; align-items: stretch; background: var(--vscode-tab-inactiveBackground); border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .tab { padding: 6px 16px; cursor: pointer; border-right: 1px solid var(--vscode-panel-border); color: var(--vscode-tab-inactiveForeground); font-size: 12px; user-select: none; }
  .tab:hover { background: var(--vscode-tab-hoverBackground); }
  .tab.active { background: var(--vscode-tab-activeBackground); color: var(--vscode-tab-activeForeground); border-bottom: 2px solid var(--vscode-focusBorder); padding-bottom: 4px; }
  .tab-sep { width: 1px; background: var(--vscode-panel-border); margin: 0 4px; }
  .tab.code-tab { font-style: italic; }
  .tab.code-tab.active { font-style: normal; }

  .panels { flex: 1; min-height: 0; position: relative; }
  .panel { position: absolute; inset: 0; display: none; overflow: auto; }
  .panel.active { display: flex; flex-direction: column; }
  #monaco-editor-mount { flex: 1; min-height: 0; }
  #content-row { display: flex; flex: 1; min-height: 0; }
  .panels { flex: 1; min-width: 0; }
  #debug-vars-panel { display: none; flex-direction: column; width: 300px; flex: 0 0 auto;
    border-left: 1px solid var(--vscode-panel-border); position: relative; overflow: hidden; }
  body.debugging #debug-vars-panel { display: flex; }
  #debug-vars-panel.running { opacity: 0.65; }
  #debug-vars-resizer { position: absolute; left: 0; top: 0; width: 5px; height: 100%;
    cursor: col-resize; user-select: none; z-index: 2; }
  #debug-vars-resizer:hover { background: var(--vscode-sash-hoverBorder, var(--vscode-focusBorder)); }
  .dv-header { display: flex; align-items: center; gap: 6px; padding: 4px 6px 4px 10px;
    border-bottom: 1px solid var(--vscode-panel-border); }
  .dv-title { font-weight: 600; }
  .dv-count { opacity: 0.7; font-size: 0.9em; }
  /* Only visible while something is pinned -- a button that never does anything
     costs the filter its space in a narrow header row. [hidden] here
     explicitly with !important, because the header row is a flex layout and
     every author rule with display beats the browser stylesheet (docs/architecture/webview-templates.md). */
  .dv-unpin-all { flex: 0 0 auto; background: transparent; border: none; padding: 2px 4px;
    cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1; }
  .dv-unpin-all:hover { color: var(--vscode-foreground); }
  .dv-unpin-all[hidden] { display: none !important; }
  .dv-filter { flex: 1; min-width: 0; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    padding: 2px 6px; }
  #debug-vars-body { flex: 1; min-height: 0; overflow: auto; }
  .dv-table { width: max-content; min-width: 100%; border-collapse: collapse; }
  .dv-table td { padding: 2px 6px; vertical-align: top; white-space: nowrap; }
  .dv-table td.dv-name { color: var(--vscode-symbolIcon-variableForeground, inherit); }
  .dv-table tr:hover { background: var(--vscode-list-hoverBackground); }
  /* Pin column: fixed width, so that names and values do not shift depending on
     how many rows are currently pinned. The pin is only in the text for
     pinned rows; for the others it appears faintly on
     hover, otherwise the column would be an invisible click target. */
  .dv-table td.dv-pin { width: 16px; padding: 2px 0 2px 4px; cursor: pointer; user-select: none;
    color: var(--vscode-descriptionForeground); text-align: center; }
  .dv-table tr.pinned td.dv-pin { color: var(--vscode-textLink-foreground, inherit); }
  .dv-table tr:hover td.dv-pin::before { content: '\\2691'; opacity: 0.35; }
  .dv-table tr.pinned:hover td.dv-pin::before { content: none; }
  .dv-table tr.changed td { background: var(--vscode-diffEditor-insertedTextBackground,
    rgba(155, 185, 85, 0.2)); }
  .dv-empty { padding: 10px; opacity: 0.7; }

  ${MONACO_XFIND_CSS}

  .panel-body { padding: 12px 16px; }
  .params-empty { color: var(--vscode-descriptionForeground); font-style: italic; }
  .params-table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .params-table th, .params-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  .params-table th { background: var(--vscode-sideBar-background); font-weight: 600; }
  .params-table input, .params-table select { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-family: var(--vscode-editor-font-family); font-size: 12px; box-sizing: border-box; }
  .params-table input:focus, .params-table select:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .params-table td.readonly { color: var(--vscode-descriptionForeground); }
  /* Datasource column with Contents="Ignore" — TM1 skips it, so it reads as
     inactive without being hidden; its name exists only in VariablesUIData. */
  .params-table tr.var-ignored td input, .params-table tr.var-ignored td select { opacity: 0.6; }
  /* The generic rule stretches every input to 100% — a checkbox must not follow. */
  .params-table td.var-ignore-cell { text-align: center; }
  .params-table td.var-ignore-cell input { width: auto; padding: 0; }
  .params-table tr.var-ignored td input[data-field="Name"] { text-decoration: line-through; }
  .params-remove { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid transparent; cursor: pointer; padding: 2px 8px; font-size: 12px; border-radius: 2px; }
  .params-remove:hover { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border-color: var(--vscode-inputValidation-errorBorder); }
  .params-move { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid transparent; cursor: pointer; padding: 2px 5px; font-size: 11px; border-radius: 2px; }
  .params-move:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); border-color: var(--vscode-panel-border); }
  .params-move:disabled { opacity: .35; cursor: default; }
  .add-param-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 12px; }
  .add-param-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  /* Dynamic identifier highlighting (Monaco inline decorations).
     Monarch token colors have higher default specificity; override with !important. */
  .ti-ident-param { color: var(--vscode-symbolIcon-variableForeground, #4fc1ff) !important; font-style: italic; }
  .ti-ident-dsvar { color: var(--vscode-debugTokenExpression-name, #c586c0) !important; font-style: italic; }

  .ds-form { display: flex; flex-direction: column; gap: 12px; width: 100%; }
  .ds-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 10px 20px; max-width: 1200px; }
  .ds-row { display: grid; grid-template-columns: 160px 1fr; gap: 10px; align-items: center; }
  .ds-row.full { grid-column: 1 / -1; }
  .ds-row label { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .ds-row input, .ds-row select, .ds-row textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 4px 8px; font-family: var(--vscode-editor-font-family); font-size: 12px; width: 100%; box-sizing: border-box; }
  .ds-row input:focus, .ds-row select:focus, .ds-row textarea:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  /* Server object pickers: the select stays the value carrier, the filterable combo renders on top. */
  .ds-row select.combo-carrier { display: none; }
  .ds-row .title-combo { width: 100%; }
  .ds-row .title-combo-btn { width: 100%; max-width: none; font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 4px 18px 4px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
  ${FILTER_COMBO_CSS}
  .ds-row textarea { min-height: 80px; resize: vertical; font-family: var(--vscode-editor-font-family); }
  .ds-section-title { font-weight: 600; margin-top: 4px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .ds-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 4px 0; }
  #ds-type-indicator { color: var(--vscode-descriptionForeground); font-size: 10px; }
  #ds-ascii-preview-box { width: 100%; }

  /* Linter tab */
  .tab-badge { display: inline-block; min-width: 16px; padding: 0 6px; margin-left: 6px; font-size: 10px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-align: center; line-height: 14px; cursor: pointer; }
  .tab-badge:empty { display: none; }
  .tab-badge.has-error   { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); }
  .tab-badge.has-warning { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .tab-badge.has-hint    { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); }
  .tab-badge.filter-active { outline: 1.5px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .lint-filter-bar { display: flex; gap: 6px; padding: 6px 0 8px 0; flex-wrap: wrap; }
  .lint-filter-btn { padding: 3px 10px; font-size: 11px; border-radius: 10px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
  .lint-filter-btn:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  .lint-filter-btn:disabled { opacity: 0.45; cursor: default; }
  .lint-filter-btn.active { outline: 1.5px solid var(--vscode-focusBorder); outline-offset: 1px; font-weight: 600; }
  .lint-filter-btn.sev-error.active   { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); }
  .lint-filter-btn.sev-warning.active { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .lint-filter-btn.sev-hint.active    { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); }
  .linter-empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px 0; }
  #linter-info { color: var(--vscode-descriptionForeground); font-size: 11px; padding: 0 0 8px 0; }
  /* Breakpoints overview tab */
  .bp-empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px 0; }
  .bp-table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: auto; }
  .bp-table th, .bp-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
  .bp-table th { background: var(--vscode-sideBar-background); font-weight: 600; }
  .bp-table tbody tr { cursor: pointer; }
  .bp-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  .bp-table .bp-c-section { width: 90px; white-space: nowrap; }
  .bp-table .bp-c-line { width: 48px; text-align: right; font-variant-numeric: tabular-nums; }
  .bp-table .bp-c-status { width: 90px; }
  .bp-table input.bp-cond, .bp-table input.bp-hit { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; padding: 2px 4px; font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .bp-table .bp-c-hit { width: 110px; }
  .bp-table .bp-c-del { width: 28px; text-align: center; }
  .bp-toolbar { display: flex; justify-content: flex-end; margin-bottom: 6px; }
  .bp-clear-all { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
  .bp-clear-all:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); border-color: var(--vscode-focusBorder); }
  .bp-del { background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 13px; line-height: 1; padding: 2px 4px; border-radius: 3px; }
  .bp-del:hover { color: var(--vscode-errorForeground); background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); }
  .bp-status { display: inline-block; padding: 1px 6px; font-size: 10px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
  .bp-status-active { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); }
  .bp-status-pending { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .bp-status-unverified { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .linter-table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: auto; }
  .linter-table th, .linter-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  .linter-table th { background: var(--vscode-sideBar-background); font-weight: 600; }
  .linter-table tbody tr { cursor: pointer; }
  .linter-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  .linter-table .lt-section { width: 90px; white-space: nowrap; }
  .linter-table .lt-line { width: 48px; text-align: right; font-variant-numeric: tabular-nums; }
  .linter-table .lt-sev { width: 80px; }
  .linter-table .lt-rule { width: 180px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: nowrap; }
  .lt-sev-badge { display: inline-block; padding: 1px 6px; font-size: 10px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
  .lt-sev-badge.error   { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-inputValidation-errorBorder); }
  .lt-sev-badge.warning { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
  .lt-sev-badge.hint    { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); border: 1px solid var(--vscode-inputValidation-infoBorder); }
  .lt-sev-badge.info    { background: var(--vscode-editorInfo-foreground, #3794ff); color: #fff; border: 1px solid var(--vscode-editorInfo-foreground, #3794ff); }

  /* Linter sub-tabs */
  .lint-subtabs { display: flex; gap: 4px; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .lint-subtab { padding: 4px 12px; cursor: pointer; background: none; border: none; color: var(--vscode-tab-inactiveForeground); font-size: 12px; border-bottom: 2px solid transparent; }
  .lint-subtab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
  .lint-subpanel { display: none; }
  .lint-subpanel.active { display: block; }
  .tab-badge.has-info { background: var(--vscode-editorInfo-foreground, #3794ff); color: #fff; }
  .lint-filter-btn.sev-info.active { background: var(--vscode-editorInfo-foreground, #3794ff); color: #fff; }

  /* Lint rule config rows */
  #lint-config-host { font-size: 12px; }
  .lint-group-head { font-weight: 600; margin: 10px 0 4px; padding-bottom: 2px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
  .lint-rule-row { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 3px; }
  .lint-rule-row:hover { background: var(--vscode-list-hoverBackground); }
  .lint-rule-name { flex: 0 1 auto; color: var(--vscode-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lint-rule-sev { margin-left: 12px; flex: 0 0 auto; }
  .lint-rule-sections { display: inline-flex; gap: 6px; flex: 0 0 auto; }
  .lint-sec-toggle { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; color: var(--vscode-descriptionForeground); }
  .lint-prefix { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: 6px; }
  .lint-prefix-input { width: 34px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px; padding: 0 3px; font-size: 11px; }
  /* Dark-theme: form controls must follow the editor theme, not default white. */
  #lint-config-host select, #lint-config-host input, .format-menu select, .format-menu input,
  #lint-config-host, .format-menu { color: var(--vscode-foreground); }
  #lint-config-host select, .format-menu select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); border-radius: 3px; padding: 1px 4px; }
  #lint-config-host option, .format-menu option { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
  .lint-config-footer { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 4px; padding-top: 10px; border-top: 1px solid var(--vscode-panel-border); }
  .lint-config-io-heading { font-size: 11px; font-weight: 600; opacity: 0.85; }
  .lint-config-io-row { display: flex; gap: 8px; }
  .lint-cfg-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 4px 12px; font-size: 11px; cursor: pointer; border-radius: 2px; }
  .lint-cfg-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }

  /* References tab */
  ${MONACO_REFERENCES_CSS}
  .ti-proc-link { text-decoration: underline; text-underline-offset: 2px; cursor: pointer !important; color: var(--vscode-textLink-foreground) !important; }

  /* Resolver tab — shares .linter-table styles, adds arg coloring */
  .resolver-toolbar { display: flex; gap: 8px; align-items: center; padding: 0 0 8px 0; font-size: 12px; }
  .resolver-toolbar input[type="text"] { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; }
  .resolver-toolbar input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .resolver-toolbar button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 10px; font-size: 11px; cursor: pointer; border-radius: 2px; }
  .resolver-toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  #resolver-info { color: var(--vscode-descriptionForeground); font-size: 11px; padding: 0 0 8px 0; }
  .resolver-table .rt-func { font-family: var(--vscode-editor-font-family); font-size: 11px; color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); white-space: nowrap; }
  .resolver-table .rt-args { font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; word-break: break-word; }
  .resolver-arg-name     { color: var(--vscode-descriptionForeground); }
  .resolver-arg-literal  { color: var(--vscode-debugTokenExpression-string, #ce9178); }
  .resolver-arg-param    { color: var(--vscode-symbolIcon-variableForeground, #4fc1ff); font-style: italic; }
  .resolver-arg-datasource { color: var(--vscode-debugTokenExpression-name, #c586c0); font-style: italic; }
  .resolver-arg-dynamic  { color: var(--vscode-descriptionForeground); font-style: italic; }
  .resolver-arg-parts    { color: var(--vscode-descriptionForeground); margin-left: 4px; }
  .rap-ident             { color: var(--vscode-foreground); }
  .rap-literal           { color: var(--vscode-debugTokenExpression-string, #ce9178); }
  .rap-param             { color: var(--vscode-symbolIcon-variableForeground, #4fc1ff); font-style: italic; }
  .rap-datasource        { color: var(--vscode-debugTokenExpression-name, #c586c0); font-style: italic; }

  /* Gutter: breakpoints | line numbers | code — rationale in
     src/webviews/monacoGutterCss.ts, shared with the rule editor. */
  ${MONACO_GUTTER_CSS}

  /* Ghost dot when hovering over the breakpoint column: shows THAT the column
     is clickable and WHERE the dot will land. Same size as the real one, only
     faint — so the line does not jump when it is set. */
  .bp-gutter-hover { display: flex; align-items: center; justify-content: center; }
  .bp-gutter-hover::before {
    content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    background: var(--vscode-debugIcon-breakpointForeground, #e51400); opacity: 0.32;
  }

  /* Breakpoint marker in the glyph margin. Flex-center the dot inside Monaco's
     line-height glyph cell so it sits on the line's vertical middle — a fixed
     margin-top aligned it to the text baseline, so the dot rode too high. */
  .bp-gutter-active,
  .bp-gutter-pending,
  .bp-gutter-unverified { display: flex; align-items: center; justify-content: center; }
  .bp-gutter-active::before,
  .bp-gutter-pending::before,
  .bp-gutter-unverified::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(255,255,255,0.2); }
  .bp-gutter-active::before     { background: var(--vscode-debugIcon-breakpointForeground, #e51400); }
  .bp-gutter-pending::before    { background: var(--vscode-debugIcon-breakpointForeground, #e51400); }
  .bp-gutter-unverified::before { background: transparent; border: 2px solid var(--vscode-debugIcon-breakpointForeground, #e51400); width: 6px; height: 6px; box-sizing: content-box; }
  /* Conditional breakpoint: render "=" centered INSIDE the dot's own box
     (override the empty dot content) so it always aligns with the dot,
     independent of how Monaco positions the glyph cell. */
  .bp-cond::before { content: '='; text-align: center; line-height: 8px; font-size: 8px; font-weight: bold; color: var(--vscode-editor-background, #1e1e1e); }
  /* Inline condition editor (content widget). */
  .bp-cond-editor { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border, #454545); padding: 3px; border-radius: 3px; z-index: 50; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
  .bp-cond-input { width: 280px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 2px 4px; font-family: var(--vscode-editor-font-family); }
  .bp-cond-hit-input { margin-top: 4px; }
  .bp-cond-suggest { max-height: 140px; overflow-y: auto; }
  .bp-cond-suggest-item { padding: 2px 6px; cursor: pointer; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .bp-cond-suggest-item:hover { background: var(--vscode-list-hoverBackground); }

  /* Active line (cursor line) in the color of the user's theme. Monaco's
     bundled vs/vs-dark only paints a faint border and does not know the
     VS Code theme colors; as a CSS variable the color also follows the theme
     on its own, without redefining the Monaco theme.
     Fallback chain, because many themes do not set lineHighlightBackground.
     !important, because Monaco writes the same rule from its theme
     stylesheet. */
  .monaco-editor .view-overlays .current-line { background: var(--vscode-editor-lineHighlightBackground, var(--vscode-editor-rangeHighlightBackground, rgba(128, 128, 128, 0.12))) !important; }
  .monaco-editor .view-overlays .current-line { border-color: var(--vscode-editor-lineHighlightBorder, transparent) !important; }

  /* Current debug line highlight */
  .ti-debug-current-line { background: var(--vscode-editor-stackFrameHighlightBackground, rgba(255, 193, 7, 0.18)) !important; }
  .ti-debug-current-glyph::after { content: '\u25B6'; color: var(--vscode-debugIcon-breakpointCurrentStackframeForeground, #ffc107); font-size: 11px; margin-left: 2px; }

  /* Debug toolbar buttons — hidden in edit mode, shown when debugging */
  .debug-only { display: none; }
  .toolbar button.icon-btn.debug-only { display: none; }
  body.debug-running .debug-only.running,
  body.debug-paused  .debug-only.paused,
  body.debug-paused  .debug-only.stop,
  body.debug-running .debug-only.stop { display: inline-block; }
  body.debug-running .toolbar button.icon-btn.debug-only.running,
  body.debug-paused  .toolbar button.icon-btn.debug-only.paused,
  body.debug-paused  .toolbar button.icon-btn.debug-only.stop,
  body.debug-running .toolbar button.icon-btn.debug-only.stop { display: inline-flex; }
  body.debug-running .edit-only,
  body.debug-paused  .edit-only { display: none; }
  body.executing #btn-execute { opacity: 0.45; pointer-events: none; }
  body.loading #btn-debug { opacity: 0.45; pointer-events: none; }
  .debug-status { font-size: 11px; color: var(--vscode-foreground); margin-right: 8px; }
  .debug-status.has-error { color: var(--vscode-errorForeground); font-weight: 600; }
  .debug-detail { display: none; padding: 5px 12px; font-size: 11px; flex-shrink: 0; white-space: pre-wrap; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-foreground); font-variant-numeric: tabular-nums; }
  .debug-detail.visible { display: block; }
  .debug-detail.error { color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); background: var(--vscode-inputValidation-errorBackground, rgba(229,20,0,0.08)); }
  .resolver-arg-live { color: #6a9955; font-weight: 600; }
  .save-banner { display: none; padding: 6px 12px; font-size: 12px; flex-shrink: 0; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
  .save-banner.visible { display: block; }
  /* Pair the error-background with its matching validation foreground (falls back to
     the theme foreground). charts-red is a saturated accent and was unreadable on the
     pale error background of light themes. Same for the success twin, which additionally
     abused charts-green as a border color. */
  .save-banner.error   { background: var(--vscode-inputValidation-errorBackground, rgba(229,20,0,0.12)); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, rgba(229,20,0,0.3)); }
  .save-banner.success { background: color-mix(in srgb, var(--vscode-charts-green, #4caf50) 12%, transparent); color: var(--vscode-foreground); border-bottom: 1px solid color-mix(in srgb, var(--vscode-charts-green, #4caf50) 40%, transparent); }
  .format-menu { position: fixed; z-index: 50; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); padding: 8px; border-radius: 4px; font-size: 12px; }
  .format-menu label { display: block; margin: 2px 0; white-space: nowrap; }
  .format-menu select { margin-left: 4px; }
  .format-menu button.act { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 190px; background: transparent; color: var(--vscode-foreground); border: none; padding: 4px 6px; font-size: 12px; cursor: pointer; text-align: left; border-radius: 3px; }
  .format-menu button.act:hover { background: var(--vscode-list-hoverBackground); }
  .format-menu button.act .lbl { flex: 1; }
  .format-menu button.act .kbd { margin-left: auto; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
  .format-menu .menu-sep { height: 1px; background: var(--vscode-panel-border); margin: 5px 0; }
`;

const processEditorBody = (icons: Record<string, string>, t: L10nMap) => `
  <div class="toolbar">
    <span class="title" id="title">${t.titleProcess}</span>
    <button id="btn-edit-menu" class="edit-only icon-btn" title="${t.editMenuTitle}"><img class="btn-icon light-only" src="${icons.editStackLight}" alt=""><img class="btn-icon dark-only" src="${icons.editStackDark}" alt="">${t.editMenuLabel} ▾</button>
    ${editMenuHtml(icons, t)}
    <div class="spacer"></div>
    <span class="debug-status" id="debug-status"></span>
    <button id="btn-save" class="edit-only icon-btn" title="${t.saveTitle}"><img class="btn-icon light-only" src="${icons.saveLight}" alt=""><img class="btn-icon dark-only" src="${icons.saveDark}" alt="">${t.save}</button>
    <button id="btn-save-as" class="edit-only icon-btn" title="${t.saveAsTitle}"><img class="btn-icon light-only" src="${icons.saveAsLight}" alt=""><img class="btn-icon dark-only" src="${icons.saveAsDark}" alt="">${t.saveAs}</button>
    <button id="btn-format" class="edit-only icon-btn" title="${t.formatTitle}"><img class="btn-icon light-only" src="${icons.formatLight}" alt=""><img class="btn-icon dark-only" src="${icons.formatDark}" alt="">Formatter ▾</button>
    <div id="format-menu" class="format-menu" hidden></div>
    <button id="btn-execute" class="edit-only icon-btn" title="${t.executeTitle}"><img class="btn-icon light-only" src="${icons.runLight}" alt=""><img class="btn-icon dark-only" src="${icons.runDark}" alt="">${t.execute}</button>
    <button id="btn-debug" class="edit-only icon-btn" title="${t.debugTitle}"><img class="btn-icon light-only" src="${icons.debugLight}" alt=""><img class="btn-icon dark-only" src="${icons.debugDark}" alt="">Debug</button>
    <button id="btn-debug-continue" class="debug-only paused icon-btn" title="${t.debugContinueTitle}"><img class="btn-icon light-only" src="${icons.continueLight}" alt=""><img class="btn-icon dark-only" src="${icons.continueDark}" alt="">${t.debugContinue}</button>
    <button id="btn-debug-step-over" class="debug-only paused icon-btn" title="${t.debugStepOverTitle}"><img class="btn-icon light-only" src="${icons.stepOverLight}" alt=""><img class="btn-icon dark-only" src="${icons.stepOverDark}" alt="">Step Over</button>
    <button id="btn-debug-step-in"   class="debug-only paused icon-btn" title="${t.debugStepInTitle}"><img class="btn-icon light-only" src="${icons.stepIntoLight}" alt=""><img class="btn-icon dark-only" src="${icons.stepIntoDark}" alt="">Step In</button>
    <button id="btn-debug-step-out"  class="debug-only paused icon-btn" title="${t.debugStepOutTitle}"><img class="btn-icon light-only" src="${icons.stepOutLight}" alt=""><img class="btn-icon dark-only" src="${icons.stepOutDark}" alt="">Step Out</button>
    <button id="btn-debug-stop" class="debug-only stop icon-btn" title="${t.debugStopTitle}"><img class="btn-icon light-only" src="${icons.stopLight}" alt=""><img class="btn-icon dark-only" src="${icons.stopDark}" alt="">Stop</button>
  </div>
  <div id="debug-detail" class="debug-detail"></div>
  <div id="save-banner" class="save-banner"></div>
  <div class="tabs">
    <div class="tab" data-tab="parameters">Parameters <span class="tab-badge lc-badge" id="params-count"></span></div>
    <div class="tab" data-tab="datasource">DataSource <span id="ds-type-indicator"></span></div>
    <div class="tab" data-tab="variables" id="tab-variables">Variables <span class="tab-badge lc-badge" id="vars-count"></span></div>
    <div class="tab-sep"></div>
    <div class="tab code-tab active" data-tab="code" data-section="prolog">Prolog <span class="tab-badge lc-badge" id="lc-prolog"></span></div>
    <div class="tab code-tab" data-tab="code" data-section="metadata">Metadata <span class="tab-badge lc-badge" id="lc-metadata"></span></div>
    <div class="tab code-tab" data-tab="code" data-section="data">Data <span class="tab-badge lc-badge" id="lc-data"></span></div>
    <div class="tab code-tab" data-tab="code" data-section="epilog">Epilog <span class="tab-badge lc-badge" id="lc-epilog"></span></div>
    <div class="tab-sep"></div>
    <div class="tab" data-tab="linter">Linter <span class="tab-badge has-error" id="linter-errors"></span><span class="tab-badge has-warning" id="linter-warnings"></span><span class="tab-badge has-info" id="linter-infos"></span><span class="tab-badge has-hint" id="linter-hints"></span></div>
    <div class="tab" data-tab="references">References <span class="tab-badge" id="ref-badge"></span></div>
    <div class="tab" data-tab="resolver">Resolver</div>
    <div class="tab" data-tab="breakpoints">${t.bpTab ?? 'Breakpoints'} <span class="tab-badge" id="bp-count"></span></div>
  </div>
  <div id="content-row">
  <div class="panels">
    <div class="panel active" id="panel-code">
      ${xfindHtml(t)}
      <div id="monaco-editor-mount"></div>
    </div>
    <div class="panel" id="panel-parameters">
      <div class="params-security-row" style="padding: 8px 4px; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 8px;">
        <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
          <input type="checkbox" id="chk-has-security"> ${t.securityAccess}
        </label>
        <div class="params-security-hint" style="opacity: 0.7; font-size: 0.9em; margin-top: 4px;">${t.securityAccessHint}</div>
      </div>
      <div class="panel-body" id="params-container">
        <p class="params-empty">${t.loadingParameters}</p>
      </div>
    </div>
    <div class="panel" id="panel-datasource">
      <div class="panel-body" id="ds-container">
        <p class="params-empty">${t.loadingDatasource}</p>
      </div>
    </div>
    <div class="panel" id="panel-variables">
      <div class="panel-body" id="vars-container">
        <p class="params-empty">${t.loadingVariables}</p>
      </div>
    </div>
    <div class="panel" id="panel-linter">
      <div class="panel-body">
        <div class="lint-subtabs">
          <button type="button" id="lint-subtab-results" class="lint-subtab active">${t.lintResults}</button>
          <button type="button" id="lint-subtab-rules" class="lint-subtab">${t.lintRules}</button>
        </div>
        <div id="lint-sub-results" class="lint-subpanel active">
          <div class="lint-filter-bar">
            <button type="button" id="lint-filter-all" class="lint-filter-btn active">${t.lintFilterAll}</button>
            <button type="button" id="lint-filter-error" class="lint-filter-btn sev-error">Errors</button>
            <button type="button" id="lint-filter-warning" class="lint-filter-btn sev-warning">Warnings</button>
            <button type="button" id="lint-filter-info" class="lint-filter-btn sev-info">Infos</button>
            <button type="button" id="lint-filter-hint" class="lint-filter-btn sev-hint">Hints</button>
          </div>
          <div id="linter-info">${t.loading}</div>
          <div id="linter-table-host"></div>
        </div>
        <div id="lint-sub-rules" class="lint-subpanel">
          <div id="lint-config-host"></div>
        </div>
      </div>
    </div>
    <div class="panel" id="panel-references">
      <div class="panel-body">
        <div class="ref-toolbar">
          <span id="ref-word-info"></span>
          <input type="text" id="ref-filter" placeholder="${t.refFilterPlaceholder}">
          <button id="ref-clear" title="${t.refClearTitle}">${t.refClear}</button>
        </div>
        <div id="ref-info"></div>
        <div id="ref-table-host"></div>
      </div>
    </div>
    <div class="panel" id="panel-resolver">
      <div class="panel-body">
        <div class="resolver-toolbar">
          <input type="text" id="resolver-filter" placeholder="${t.resolverFilterPlaceholder}">
          <button id="btn-resolver-refresh" title="${t.resolverRefreshTitle}">${t.resolverRefresh}</button>
        </div>
        <div id="resolver-info"></div>
        <div id="resolver-table-host"></div>
      </div>
    </div>
    <div class="panel" id="panel-breakpoints">
      <div class="panel-body">
        <div id="bp-table-host"></div>
      </div>
    </div>
  </div>
    <aside id="debug-vars-panel" aria-label="${t.debugVarsTitle}">
      <div id="debug-vars-resizer" title=""></div>
      <div class="dv-header">
        <span class="dv-title">${t.debugVarsTitle}</span>
        <span class="dv-count" id="debug-vars-count"></span>
        <input class="dv-filter" id="debug-vars-filter" type="text"
          placeholder="${t.debugVarsFilterPlaceholder}" autocomplete="off" spellcheck="false" />
        <button class="dv-unpin-all" id="debug-vars-unpin-all" type="button"
          title="${t.debugVarsUnpinAll}" hidden>&#10007;&#9873;</button>
      </div>
      <div id="debug-vars-body"></div>
    </aside>
  </div>
  <!-- The initial state is LOADING, not "Ready": until monacoSetContent arrives, the
       editor has no content. The line was fixed to "Ready." and thereby claimed
       the opposite in precisely the case in which the user needs
       information — fetch hanging, code area empty, everything else there.
       (No backtick in this comment: it would end the template
       literal, see docs/architecture/webview-templates.md.) -->
  <div id="status">${t.loading}</div>
`;


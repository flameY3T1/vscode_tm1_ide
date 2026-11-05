import * as vscode from 'vscode';
import { getInlineSignaturesJson, getInlineSignatureDocsJson } from '../../utils/sigsAsset';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { MONACO_GUTTER_CSS } from '../../webviews/monacoGutterCss';
import { monacoEditorUris, editMenuIcons, editMenuHtml, xfindHtml, MONACO_XFIND_CSS, MONACO_REFERENCES_CSS } from '../../webviews/monacoEditorChrome';
import { buildRuleEditorMonacoL10n } from './ruleEditorMonacoL10n';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

/**
 * Returns the complete HTML document string for the Monaco-based Rule Editor webview.
 */
export function getRuleEditorMonacoHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  v12 = false,
): string {
  const { scriptUri, monacoVendorUri, styleUri, iconUri } = monacoEditorUris(webview, extensionUri, 'ruleEditorMonaco.js');
  const icons = {
    saveLight:         iconUri('light', 'save'),
    saveDark:          iconUri('dark',  'save'),
    dimensionLight:    iconUri('light', 'dimension'),
    dimensionDark:     iconUri('dark',  'dimension'),
    formatLight:       iconUri('light', 'format'),
    formatDark:        iconUri('dark',  'format'),
    areaDbBuilderLight: iconUri('light', 'cube-rule'),
    areaDbBuilderDark:  iconUri('dark',  'cube-rule'),
    ...editMenuIcons(iconUri),
  };
  const l10n = buildRuleEditorMonacoL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: 'TM1 Rule-Editor (Monaco)',
    styleUris: [String(styleUri)],
    css: RULE_EDITOR_CSS,
    body: ruleEditorBody(icons, l10n),
    // __tm1DocLang controls the language of the generated IBM documentation links
    // (sigsBootstrap filters to the codes that IBM actually serves); __v12 picks the 3.1.0 pages.
    globals: { __l10n: l10n, __tm1DocLang: vscode.env.language, __v12: v12 },
    jsonData: [
      { id: 'tm1-signature-docs-data', json: getInlineSignatureDocsJson(extensionUri) },
      { id: 'tm1-signatures-data', json: getInlineSignaturesJson(extensionUri) },
    ],
    scriptUris: [String(monacoVendorUri), String(scriptUri)],
  });
}

const RULE_EDITOR_CSS = `
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  body { display: flex; flex-direction: column; }

  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; }
  .toolbar button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); border-color: var(--vscode-toolbar-hoverOutline, transparent); }
  .toolbar button:active:not(:disabled) { background: var(--vscode-toolbar-activeBackground, rgba(128,128,128,0.28)); }
  .toolbar button:disabled { opacity: 0.5; cursor: default; }
  .toolbar button.icon-btn { display: inline-flex; align-items: center; gap: 6px; }
  .toolbar button .btn-icon { width: 16px; height: 16px; flex-shrink: 0; pointer-events: none; }
  .toolbar button .btn-icon.dark-only { display: none; }
  body.vscode-dark .toolbar button .btn-icon.light-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .toolbar button .btn-icon.light-only { display: none; }
  body.vscode-dark .toolbar button .btn-icon.dark-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .toolbar button .btn-icon.dark-only { display: inline-flex; }
  .format-menu { position: fixed; z-index: 50; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); padding: 8px; border-radius: 4px; font-size: 12px; color: var(--vscode-foreground); }
  .format-menu label { display: block; margin: 2px 0; white-space: nowrap; }
  .format-menu select { margin-left: 4px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); border-radius: 3px; padding: 1px 4px; }
  .format-menu option { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }
  /* Linter sub-tabs (Results | Rules) — the same split as in the process editor. */
  .lint-subtabs { display: flex; gap: 4px; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .lint-subtab { padding: 4px 12px; cursor: pointer; background: none; border: none; color: var(--vscode-tab-inactiveForeground); font-size: 12px; border-bottom: 2px solid transparent; }
  .lint-subtab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
  .lint-subpanel { display: none; }
  .lint-subpanel.active { display: block; }
  /* Rule list — layout one to one as in the process editor: checkbox, name, and the
     severity select close to the name instead of at the right edge (flex 0 1 auto). */
  #lint-menu { font-size: 12px; }
  .lint-group-head { font-weight: 600; margin: 10px 0 4px; padding-bottom: 2px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 11px; letter-spacing: .04em; }
  .lint-group-head:first-child { margin-top: 0; }
  .lint-rule-row { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: 3px; }
  .lint-rule-row:hover { background: var(--vscode-list-hoverBackground); }
  .lint-rule-name { flex: 0 1 auto; color: var(--vscode-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lint-rule-sev { margin-left: 12px; flex: 0 0 auto; }
  #lint-menu select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); border-radius: 3px; padding: 1px 4px; }
  #lint-menu option { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); }

  /* Severity filter of the findings list — the same pill buttons as over there. */
  .lint-filter-bar { display: flex; gap: 6px; padding: 6px 0 8px 0; flex-wrap: wrap; }
  .lint-filter-btn { padding: 3px 10px; font-size: 11px; border-radius: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-foreground); cursor: pointer; }
  .lint-filter-btn:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
  .lint-filter-btn:disabled { opacity: 0.45; cursor: default; }
  .lint-filter-btn.active { outline: 1.5px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .lint-filter-btn.sev-error.active   { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); }
  .lint-filter-btn.sev-warning.active { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .lint-filter-btn.sev-info.active    { background: var(--vscode-editorInfo-foreground, #3794ff); color: #fff; }
  .lint-filter-btn.sev-hint.active    { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); }
  .format-menu button.act { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 190px; background: transparent; color: var(--vscode-foreground); border: none; padding: 4px 6px; font-size: 12px; cursor: pointer; text-align: left; border-radius: 3px; }
  .format-menu button.act:hover { background: var(--vscode-list-hoverBackground); }
  .format-menu button.act .btn-icon { width: 16px; height: 16px; flex-shrink: 0; pointer-events: none; }
  .format-menu button.act .btn-icon.dark-only { display: none; }
  body.vscode-dark .format-menu button.act .btn-icon.light-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .format-menu button.act .btn-icon.light-only { display: none; }
  body.vscode-dark .format-menu button.act .btn-icon.dark-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) .format-menu button.act .btn-icon.dark-only { display: inline-flex; }
  .format-menu button.act .lbl { flex: 1; }
  .format-menu button.act .kbd { margin-left: auto; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; }
  .format-menu .menu-sep { height: 1px; background: var(--vscode-panel-border); margin: 5px 0; }
  .toolbar .title { font-weight: 600; margin-right: 16px; }
  .toolbar .separator { width: 1px; height: 18px; background: var(--vscode-panel-border); margin: 0 2px; }
  .toolbar .dirty-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-button-background)); display: none; flex-shrink: 0; }
  .toolbar .dirty-dot.visible { display: block; }

  /* Theme tokens, not hard-coded reds/greens: the compile-error banner was unreadable
     on light themes. Error-background pairs with the matching validation foreground
     (falls back to the theme foreground), success is a tinted charts-green. */
  #error-banner { display: none; padding: 6px 12px; background: var(--vscode-inputValidation-errorBackground, rgba(229,20,0,0.12)); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); font-size: 12px; border-bottom: 1px solid var(--vscode-inputValidation-errorBorder, rgba(229,20,0,0.3)); flex-shrink: 0; white-space: pre-wrap; max-height: 200px; overflow-y: auto; }
  #error-banner.visible { display: block; }
  #success-banner { display: none; padding: 6px 12px; background: color-mix(in srgb, var(--vscode-charts-green, #4caf50) 12%, transparent); color: var(--vscode-foreground); font-size: 12px; border-bottom: 1px solid color-mix(in srgb, var(--vscode-charts-green, #4caf50) 40%, transparent); flex-shrink: 0; }
  #success-banner.visible { display: block; }
  #loading { text-align: center; padding: 40px; color: var(--vscode-descriptionForeground); flex: 1; }

  .tabs { display: flex; align-items: stretch; background: var(--vscode-tab-inactiveBackground); border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0; }
  .tab { padding: 6px 16px; cursor: pointer; border-right: 1px solid var(--vscode-panel-border); color: var(--vscode-tab-inactiveForeground); font-size: 12px; user-select: none; }
  .tab:hover { background: var(--vscode-tab-hoverBackground); }
  .tab.active { background: var(--vscode-tab-activeBackground); color: var(--vscode-tab-activeForeground); border-bottom: 2px solid var(--vscode-focusBorder); padding-bottom: 4px; }

  #main-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  .panels { flex: 1; min-height: 0; position: relative; }
  .panel { position: absolute; inset: 0; display: none; overflow: auto; }
  .panel.active { display: flex; flex-direction: column; }
  #monaco-editor-mount { flex: 1; min-height: 0; }

  /* Active line (cursor line) in the color of the user's theme — the same rule
     as in the process editor. Monaco's bundled vs/vs-dark only paints a
     faint border and does not know the VS Code theme colors; as a CSS variable
     the color follows the theme on its own, without redefining the Monaco
     theme. Fallback chain, because many themes do not set lineHighlightBackground.
     !important, because Monaco writes the same rule from its theme stylesheet. */
  .monaco-editor .view-overlays .current-line { background: var(--vscode-editor-lineHighlightBackground, var(--vscode-editor-rangeHighlightBackground, rgba(128, 128, 128, 0.12))) !important; }
  .monaco-editor .view-overlays .current-line { border-color: var(--vscode-editor-lineHighlightBorder, transparent) !important; }

  /* Gutter: breakpoints | line numbers | code — rationale in
     src/webviews/monacoGutterCss.ts, shared with the process editor. */
  ${MONACO_GUTTER_CSS}

  .panel-body { padding: 12px 16px; }

  /* Linter tab */
  .tab-badge { display: inline-block; min-width: 16px; padding: 0 6px; margin-left: 6px; font-size: 10px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); text-align: center; line-height: 14px; }
  .tab-badge:empty { display: none; }
  .tab-badge.has-error   { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); }
  .tab-badge.has-warning { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); }
  .tab-badge.has-hint    { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); }
  .linter-empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px 0; }
  #linter-info { color: var(--vscode-descriptionForeground); font-size: 11px; padding: 0 0 8px 0; }
  .linter-toolbar { display: flex; gap: 8px; align-items: center; padding: 0 0 8px 0; font-size: 12px; }
  .linter-toolbar input[type="text"] { flex: 1; max-width: 320px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; }
  .linter-toolbar input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .linter-table { border-collapse: collapse; width: 100%; font-size: 12px; table-layout: auto; }
  .linter-table th, .linter-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  .linter-table th { background: var(--vscode-sideBar-background); font-weight: 600; }
  .linter-table tbody tr { cursor: pointer; }
  .linter-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }
  .linter-table .lt-line { width: 48px; text-align: right; font-variant-numeric: tabular-nums; }
  .linter-table .lt-sev { width: 80px; }
  .linter-table .lt-rule { width: 180px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: nowrap; }
  .lt-sev-badge { display: inline-block; padding: 1px 6px; font-size: 10px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px; }
  .lt-sev-badge.error   { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-inputValidation-errorBorder); }
  .lt-sev-badge.warning { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); border: 1px solid var(--vscode-inputValidation-warningBorder); }
  .lt-sev-badge.hint    { background: var(--vscode-inputValidation-infoBackground); color: var(--vscode-inputValidation-infoForeground); border: 1px solid var(--vscode-inputValidation-infoBorder); }

  /* References tab */
  ${MONACO_REFERENCES_CSS}

  ${MONACO_XFIND_CSS}
`;

const ruleEditorBody = (icons: Record<string, string>, t: L10nMap) => `
  <div class="toolbar">
    <span class="title" id="title">${t.titleRules}</span>
    <button id="btn-edit-menu" class="icon-btn" title="${t.editMenuTitle}"><img class="btn-icon light-only" src="${icons.editStackLight}" alt=""><img class="btn-icon dark-only" src="${icons.editStackDark}" alt="">${t.editMenuLabel} ▾</button>
    <div class="separator"></div>
    <button id="btn-save" class="icon-btn" title="${t.saveTitle}" disabled><img class="btn-icon light-only" src="${icons.saveLight}" alt=""><img class="btn-icon dark-only" src="${icons.saveDark}" alt="">${t.save}</button>
    <button id="btn-qualify" class="icon-btn" title="${t.qualifyTitle}"><img class="btn-icon light-only" src="${icons.dimensionLight}" alt=""><img class="btn-icon dark-only" src="${icons.dimensionDark}" alt=""><span class="btn-label">${t.elementQualifier}</span></button>
    <button id="btn-area-db-builder" class="icon-btn" title="${t.areaDbBuilderTitle}"><img class="btn-icon light-only" src="${icons.areaDbBuilderLight}" alt=""><img class="btn-icon dark-only" src="${icons.areaDbBuilderDark}" alt="">${t.areaDbBuilder}</button>
    <button id="btn-format" class="icon-btn" title="${t.formatTitle}"><img class="btn-icon light-only" src="${icons.formatLight}" alt=""><img class="btn-icon dark-only" src="${icons.formatDark}" alt="">${t.format} ▾</button>
    <div class="separator"></div>
    <div class="dirty-dot" id="dirty-dot" title="${t.unsavedChanges}"></div>
  </div>
  <div id="format-menu" class="format-menu" hidden></div>
  ${editMenuHtml(icons, t)}
  <div id="error-banner"></div>
  <div id="success-banner">${t.rulesSavedSuccessfully}</div>
  <div id="loading">${t.loadingRules}</div>
  <div id="main-area" style="display:none;">
    <div class="tabs">
      <div class="tab active" data-tab="code">${t.tabEditor} <span class="tab-badge lc-badge" id="lc-rules"></span></div>
      <div class="tab" data-tab="linter">${t.tabLinter} <span class="tab-badge has-error" id="linter-errors"></span><span class="tab-badge has-warning" id="linter-warnings"></span><span class="tab-badge has-hint" id="linter-hints"></span></div>
      <div class="tab" data-tab="references">${t.tabReferences} <span class="tab-badge" id="ref-badge"></span></div>
    </div>
    <div class="panels">
      <div class="panel active" id="panel-code">
        ${xfindHtml(t)}
        <div id="monaco-editor-mount"></div>
      </div>
      <div class="panel" id="panel-linter">
        <div class="panel-body">
          <div class="lint-subtabs">
            <button type="button" id="lint-subtab-results" class="lint-subtab active">${t.rlSubtabResults}</button>
            <button type="button" id="lint-subtab-rules" class="lint-subtab">${t.rlSubtabRules}</button>
          </div>
          <div id="lint-sub-results" class="lint-subpanel active">
            <div class="lint-filter-bar">
              <button type="button" id="lint-filter-all" class="lint-filter-btn active">${t.rlFilterAll}</button>
              <button type="button" id="lint-filter-error" class="lint-filter-btn sev-error">${t.rlFilterErrors}</button>
              <button type="button" id="lint-filter-warning" class="lint-filter-btn sev-warning">${t.rlFilterWarnings}</button>
              <button type="button" id="lint-filter-info" class="lint-filter-btn sev-info">${t.rlFilterInfos}</button>
              <button type="button" id="lint-filter-hint" class="lint-filter-btn sev-hint">${t.rlFilterHints}</button>
            </div>
            <div class="linter-toolbar">
              <input type="text" id="linter-filter" placeholder="${t.linterFilterPlaceholder}" />
              <span id="linter-info"></span>
            </div>
            <div id="linter-table-host"></div>
          </div>
          <div id="lint-sub-rules" class="lint-subpanel">
            <div id="lint-menu"></div>
          </div>
        </div>
      </div>
      <div class="panel" id="panel-references">
        <div class="panel-body">
          <div class="ref-toolbar">
            <span id="ref-word-info"></span>
            <input type="text" id="ref-filter" placeholder="${t.refFilterPlaceholder}">
            <button id="ref-clear" title="${t.clearHighlightsTitle}">${t.clear}</button>
          </div>
          <div id="ref-info"></div>
          <div id="ref-table-host"></div>
        </div>
      </div>
    </div>
  </div>
`;

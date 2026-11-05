/**
 * New process wizard — HTML builder.
 *
 * Since 2026-08-30 built via `renderWebviewShell` instead of its own
 * `<!DOCTYPE>` (Codex finding B7, here for the second time): the document had
 * neither a CSP nor a nonce. Consequence of the nonce CSP: handlers as
 * attributes no longer run — the fixed buttons hang off their id, and the
 * rows of both tables and the template list run delegated through their
 * container. The script is the bundle `webviewClient/newProcess/` since 2026-10.
 */

import * as vscode from 'vscode';
import { renderWebviewShell } from '../../webviews/webviewShell';
import type { DatasourceType } from '../datasource/types';
import { escapeHtml as esc } from '../../utils/escapeHtml';
import type { NewProcessBootstrap } from '../../webviewClient/newProcess/protocol';

function datalist(id: string, items: string[]): string {
  if (!items.length) { return ''; }
  return `<datalist id="${id}">${items.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}

export interface WizardTemplate { id: string; name: string; description: string; }

export function buildWizardHtml(
  cubes: string[], dimensions: string[], templates: WizardTemplate[], odbcDsns: string[], cspSource: string, scriptUri: string,
): string {
  // Order and labels match the process editor
  // (`webviewClient/processEditorMonaco/dataSource.ts#TYPES`). The wizard
  // internally works with the `.pro` names from line 562 — `toApiDataSource`
  // converts them to the REST names on creation —, but the user should not
  // have to read two different words for the same thing depending on the
  // window ("VIEW" here, "TM1CubeView" there).
  const DS_TYPES: Array<{ value: DatasourceType; label: string }> = [
    { value: 'NULL', label: 'None' },
    { value: 'CHARACTERDELIMITED', label: 'ASCII' },
    { value: 'ODBC', label: 'ODBC' },
    { value: 'VIEW', label: 'TM1CubeView' },
    { value: 'SUBSET', label: 'TM1DimensionSubset' },
  ];
  const hasTemplates = templates.length > 0;

  const css = `
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 0; display: flex; flex-direction: column; height: 100vh; }

  /* Step bar */
  .stepbar { display: flex; gap: 0; border-bottom: 1px solid var(--vscode-panel-border, #444); flex-shrink: 0; }
  .stepbar .s { flex: 1; padding: 10px 8px; text-align: center; font-size: 0.85em; color: var(--vscode-descriptionForeground); border-right: 1px solid var(--vscode-panel-border, #444); cursor: default; }
  .stepbar .s:last-child { border-right: none; }
  .stepbar .s.active { color: var(--vscode-foreground); border-bottom: 2px solid var(--vscode-focusBorder, #007acc); font-weight: 600; }
  .stepbar .s.done { color: var(--vscode-descriptionForeground); }
.tpl-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.tpl-item { padding: 8px 12px; border: 1px solid var(--vscode-input-border, #555); border-left: 3px solid transparent; cursor: pointer; border-radius: 2px; }
.tpl-item:hover { background: var(--vscode-list-hoverBackground); }
.tpl-item:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007acc); outline-offset: -1px; }
.tpl-item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); border-left-color: var(--vscode-focusBorder, #007acc); }
.tpl-name { font-weight: 600; }
.tpl-desc { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 2px; }

  /* Content */
  .content { flex: 1; overflow-y: auto; padding: 24px 5%; }
  h3 { margin: 0 0 18px; font-size: 1.05em; font-weight: 600; }

  /* Fields */
  .field { display: flex; align-items: center; margin-bottom: 12px; }
  .field label { width: 32%; color: var(--vscode-descriptionForeground); padding-right: 12px; flex-shrink: 0; }
  .field input, .field select, .field textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 5px 9px; font-size: inherit; font-family: inherit; }
  .field textarea { resize: vertical; min-height: 90px; }
  .field input:focus, .field select:focus, .field textarea:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  /* Without its own rule the renderer paints the dropdown list in the colors of
     the operating system — so white in a dark theme. This affects every
     select field, but only becomes noticeable once JS loads entries later (views
     after the cube choice, subsets after the dimension choice). */
  select option { background: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); }

  /* DS sections */
  .dssec { display: none; }
  .dssec.active { display: block; }
  .row2 { display: flex; gap: 20px; }
  .row2 .field { flex: 1; }

  /* Tables for params / vars */
  table.edit { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.edit th { text-align: left; font-weight: normal; color: var(--vscode-descriptionForeground); padding: 4px 6px; font-size: 0.88em; border-bottom: 1px solid var(--vscode-panel-border, #444); }
  table.edit td { padding: 3px 4px; }
  table.edit input, table.edit select { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 4px 6px; font-size: inherit; font-family: inherit; }
  table.edit .del { background: none; border: none; color: var(--vscode-errorForeground); cursor: pointer; font-size: 1.1em; padding: 2px 6px; }

  /* Buttons */
  .footer { border-top: 1px solid var(--vscode-panel-border, #444); padding: 12px 5%; display: flex; gap: 10px; flex-shrink: 0; align-items: center; }
  .footer .spacer { flex: 1; }
  button { padding: 6px 22px; border: none; cursor: pointer; font-size: inherit; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  button.small { padding: 4px 14px; font-size: 0.9em; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.small:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  .hint { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
  .error { color: var(--vscode-errorForeground); font-size: 0.88em; min-height: 18px; margin-bottom: 4px; }
`;

  const body = `

<div class="stepbar">
  ${hasTemplates ? `<div class="s active" id="sb0">${vscode.l10n.t('Template')}</div>` : ''}
  <div class="s${hasTemplates ? '' : ' active'}" id="sb1">${vscode.l10n.t('1 · Name')}</div>
  <div class="s" id="sb2">${vscode.l10n.t('2 · Data source')}</div>
  <div class="s" id="sb3">${vscode.l10n.t('3 · Parameters')}</div>
  <div class="s" id="sb4">${vscode.l10n.t('4 · Variables')}</div>
</div>

<div class="content">

  ${hasTemplates ? `
  <!-- STEP 0: Template -->
  <div id="step0">
    <h3>${vscode.l10n.t('Start from template')}</h3>
    <div class="hint">${vscode.l10n.t('Pick a template to pre-fill the process sections, or start with an empty process.')}</div>
    <div class="tpl-list" id="tplList">
      <div class="tpl-item selected" data-id="" tabindex="0">
        <div class="tpl-name">${vscode.l10n.t('Empty process')}</div>
        <div class="tpl-desc">${vscode.l10n.t('Start with blank sections.')}</div>
      </div>
      ${templates.map(tpl => `<div class="tpl-item" data-id="${esc(tpl.id)}" tabindex="0"><div class="tpl-name">${esc(tpl.name)}</div>${tpl.description ? `<div class="tpl-desc">${esc(tpl.description)}</div>` : ''}</div>`).join('')}
    </div>
  </div>` : ''}

  <!-- STEP 1: Name -->
  <div id="step1">
    <h3>${vscode.l10n.t('Process name')}</h3>
    <div class="field">
      <label>${vscode.l10n.t('Name')}</label>
      <input id="processName" type="text" placeholder="${vscode.l10n.t('e.g. myImport')}" autocomplete="off">
    </div>
    <div class="error" id="errName"></div>
  </div>

  <!-- STEP 2: Datasource -->
  <div id="step2" style="display:none">
    <h3>${vscode.l10n.t('Data source')}</h3>
    <div class="field">
      <label>${vscode.l10n.t('Data source type')}</label>
      <select id="dsType">${DS_TYPES.map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('')}</select>
    </div>

    <div class="dssec" id="dssec-VIEW">
      <div class="field"><label>${vscode.l10n.t('Cube')}</label><input id="cubeInput" type="text" name="datasourceName" list="cubeList" autocomplete="off"></div>
      <div class="field"><label>${vscode.l10n.t('View')}</label><select id="viewSelect" name="viewSubsetName"><option value="">—</option></select></div>
    </div>

    <div class="dssec" id="dssec-SUBSET">
      <div class="field"><label>${vscode.l10n.t('Dimension')}</label><input id="dimInput" type="text" name="datasourceName" list="dimList" autocomplete="off"></div>
      <div class="field"><label>${vscode.l10n.t('Subset')}</label><select id="subsetSelect" name="viewSubsetName"><option value="">—</option></select></div>
    </div>

    <div class="dssec" id="dssec-CHARACTERDELIMITED">
      <div class="field"><label>${vscode.l10n.t('File path')}</label><input id="cdFile" type="text" autocomplete="off"></div>
      <div class="row2">
        <div class="field"><label>${vscode.l10n.t('Delimiter')}</label><input id="cdDelim" type="text" maxlength="4" value="," autocomplete="off"></div>
        <div class="field"><label>${vscode.l10n.t('Quote character')}</label><input id="cdQuote" type="text" maxlength="2" value="&quot;" autocomplete="off"></div>
      </div>
      <div class="row2">
        <div class="field"><label>${vscode.l10n.t('Decimal separator')}</label><input id="cdDecimal" type="text" maxlength="2" value="." autocomplete="off"></div>
        <div class="field"><label>${vscode.l10n.t('Thousands separator')}</label><input id="cdThousand" type="text" maxlength="2" value="," autocomplete="off"></div>
      </div>
      <div class="field"><label>${vscode.l10n.t('Header rows')}</label><input id="cdTitleRows" type="number" min="0" step="1" value="0"></div>
    </div>

    <div class="dssec" id="dssec-ODBC">
      <div class="field"><label>${vscode.l10n.t('DSN / Data source')}</label><input id="odbcDsn" type="text" list="odbcDsnList" autocomplete="off" placeholder="${odbcDsns.length ? '' : vscode.l10n.t('TM1 11.2+ required for the DSN list')}"></div>
      <div class="field"><label>${vscode.l10n.t('Username')}</label><input id="odbcUser" type="text" autocomplete="off"></div>
      <div class="field"><label>${vscode.l10n.t('Password')}</label><input id="odbcPw" type="password" autocomplete="off"></div>
      <!-- checked by default: a create that omits usesUnicode comes back as true
           from TM1 11.8, so an unchecked default would silently disagree with
           what the server does (measured 2026-08-17). -->
      <div class="field"><label>Unicode (UTF-8)</label><input id="odbcUnicode" type="checkbox" checked></div>
      <div class="field" style="align-items:flex-start"><label style="padding-top:6px">${vscode.l10n.t('SQL query')}</label><textarea id="odbcSql"></textarea></div>
      <!-- No delimiter field here: TM1 rejects a Delimiter property on an ODBC
           data source (400 code 248, taking the whole PATCH down), so the payload
           builder never sent it and the input was decoration. -->
    </div>

    ${datalist('cubeList', cubes)}
    ${datalist('dimList', dimensions)}
    ${datalist('odbcDsnList', odbcDsns)}
  </div>

  <!-- STEP 3: Parameters -->
  <div id="step3" style="display:none">
    <h3>${vscode.l10n.t('Parameters')} <span style="font-size:0.85em;font-weight:normal;color:var(--vscode-descriptionForeground)">${vscode.l10n.t('(optional)')}</span></h3>
    <table class="edit" id="paramTable">
      <thead><tr><th>${vscode.l10n.t('Name')}</th><th>${vscode.l10n.t('Type')}</th><th>${vscode.l10n.t('Default value')}</th><th>${vscode.l10n.t('Description')}</th><th></th></tr></thead>
      <tbody id="paramBody"></tbody>
    </table>
    <button class="small" id="btnAddParam">${vscode.l10n.t('+ Add parameter')}</button>
    <div class="error" id="errParams"></div>
  </div>

  <!-- STEP 4: Variables -->
  <div id="step4" style="display:none">
    <h3>${vscode.l10n.t('Variables')} <span id="varHint" style="font-size:0.85em;font-weight:normal;color:var(--vscode-descriptionForeground)"></span></h3>
    <div class="hint" id="varNote"></div>
    <table class="edit" id="varTable">
      <thead><tr><th>${vscode.l10n.t('Variable name')}</th><th>${vscode.l10n.t('Type')}</th><th>${vscode.l10n.t('Column')}</th><th title="${vscode.l10n.t('Column is skipped and invisible to the TI code')}">${vscode.l10n.t('Ignore')}</th><th></th></tr></thead>
      <tbody id="varBody"></tbody>
    </table>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="small" id="btnAddVar">${vscode.l10n.t('+ Add variable')}</button>
      <button class="small" id="btnAutoDetect" style="display:none">${vscode.l10n.t('Auto-detect from SQL')}</button>
    </div>
  </div>

</div>

<div class="footer">
  <button class="secondary" id="btnBack" style="display:none">${vscode.l10n.t('← Back')}</button>
  <div class="spacer"></div>
  <button class="secondary" id="btnCancel">${vscode.l10n.t('Cancel')}</button>
  <button class="primary" id="btnNext">${vscode.l10n.t('Next →')}</button>
  <button class="primary" id="btnCreate" style="display:none">${vscode.l10n.t('Create')}</button>
</div>
`;

  const texts: NewProcessBootstrap['texts'] = {
    nameRequired: vscode.l10n.t('Please enter a process name.'),
    description: vscode.l10n.t('Description'),
    paramDup: vscode.l10n.t('Parameter name "{0}" appears more than once.'),
    varsFromCube: vscode.l10n.t('Variables were loaded automatically from the cube dimensions.'),
    varsEnterCube: vscode.l10n.t('Please enter the cube dimensions as variables.'),
    varsCubeHint: vscode.l10n.t('(cube dimensions)'),
    varsSubset: vscode.l10n.t('Please enter variables for the subset data source.'),
    varsSqlHint: vscode.l10n.t('(from SQL columns)'),
    varsAscii: vscode.l10n.t('Column names cannot be retrieved automatically from the file — please enter them manually.'),
    varsNone: vscode.l10n.t('No variables are required for this data source type.'),
  };

  return renderWebviewShell({
    cspSource, css, body,
    globals: { __newProcess: { texts } satisfies NewProcessBootstrap },
    scriptUris: [scriptUri],
  });
}

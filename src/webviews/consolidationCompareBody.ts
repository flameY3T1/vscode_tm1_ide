import type { L10nMap } from '../webviewClient/_shared/l10n';
import { FILTER_COMBO_CSS } from './filterComboCss';

// Class colours come from VS Code's chart palette so they follow every theme.
export const CONSOLIDATION_COMPARE_CSS = [
  'body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }',
  'body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }',
  '[hidden] { display: none !important; }',
  'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 0; }',
  '.wrap { padding: 12px 16px 40px; display: flex; flex-direction: column; gap: 12px; }',
  '.intro { color: var(--vscode-descriptionForeground); margin: 0; max-width: 90ch; line-height: 1.45; }',
  '.mono { font-family: var(--vscode-editor-font-family, monospace); }',
  '.muted { color: var(--vscode-descriptionForeground); }',
  '.bar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: flex-end; }',
  '.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
  '.field > span { font-size: 12px; color: var(--vscode-descriptionForeground); }',
  '.grow { flex: 1 1 300px; }',
  // Hierarchy above reference, so the compared roots keep the row width.
  '.stack { display: flex; flex-direction: column; gap: 8px; }',
  '.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
  'select, input[type=number] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; padding: 2px 6px; font-family: inherit; font-size: 13px; height: 26px; box-sizing: border-box; }',
  'input[type=number] { width: 80px; font-family: var(--vscode-editor-font-family, monospace); }',
  'button { background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 3px 10px; font-family: inherit; font-size: 13px; cursor: pointer; }',
  'button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }',
  'button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }',
  'button.primary:hover { background: var(--vscode-button-hoverBackground); }',
  'button:disabled { opacity: .45; cursor: default; }',
  ':focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }',
  '.chipset { display: flex; flex-wrap: wrap; gap: 6px; }',
  // Wrappers inside a flex row: their children take part in the row's gap.
  '.flat { display: contents; }',
  '.pick { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 2px 8px; cursor: pointer; }',
  '.pick.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-inactiveSelectionBackground); }',
  '.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }',
  '.tile { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; display: flex; flex-direction: column; gap: 6px; background: var(--vscode-editorWidget-background); }',
  '.tile.ref { border-style: dashed; }',
  '.tile h3 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); }',
  '.tile .name { overflow-wrap: anywhere; }',
  '.tile .warnText { color: var(--vscode-editorWarning-foreground); font-size: 12px; }',
  '.chip { font-size: 12px; border-radius: 10px; padding: 0 8px; border: 1px solid transparent; cursor: pointer; font-variant-numeric: tabular-nums; }',
  '.chip.sel { border-color: currentColor; }',
  '.chip:disabled { opacity: .45; cursor: default; }',
  '.k-ok { color: var(--vscode-charts-green); }',
  '.k-missing { color: var(--vscode-charts-red); }',
  '.k-double { color: var(--vscode-charts-orange); }',
  '.k-extra { color: var(--vscode-charts-purple); }',
  '.k-wrongWeight { color: var(--vscode-charts-yellow); }',
  '.chip.k-ok, .pill.k-ok, td.cell span.k-ok { background: color-mix(in srgb, var(--vscode-charts-green) 16%, transparent); }',
  '.chip.k-missing, .pill.k-missing, td.cell span.k-missing { background: color-mix(in srgb, var(--vscode-charts-red) 16%, transparent); }',
  '.chip.k-double, .pill.k-double, td.cell span.k-double { background: color-mix(in srgb, var(--vscode-charts-orange) 18%, transparent); }',
  '.chip.k-extra, .pill.k-extra, td.cell span.k-extra { background: color-mix(in srgb, var(--vscode-charts-purple) 18%, transparent); }',
  '.chip.k-wrongWeight, .pill.k-wrongWeight, td.cell span.k-wrongWeight { background: color-mix(in srgb, var(--vscode-charts-yellow) 18%, transparent); }',
  '.pill { font-size: 12px; border-radius: 10px; padding: 0 8px; }',
  '.main { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 14px; align-items: start; }',
  '@media (max-width: 900px) { .main { grid-template-columns: minmax(0, 1fr); } }',
  '.panel { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }',
  '.panel h2 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); }',
  '.scroll { overflow: auto; max-height: 70vh; }',
  'table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }',
  'th, td { padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border); text-align: right; white-space: nowrap; }',
  'th { font-size: 12px; font-weight: 500; color: var(--vscode-descriptionForeground); position: sticky; top: 0; background: var(--vscode-editor-background); }',
  'th:first-child, td:first-child { text-align: left; }',
  'td.soll { color: var(--vscode-descriptionForeground); border-right: 1px solid var(--vscode-panel-border); }',
  'td.cell { cursor: pointer; }',
  'td.cell span { display: inline-block; min-width: 40px; text-align: center; border-radius: 3px; padding: 0 6px; }',
  'td.cell.cur span { outline: 1px solid var(--vscode-focusBorder); }',
  'tbody tr:hover td { background: var(--vscode-list-hoverBackground); }',
  '.path { display: flex; flex-wrap: wrap; align-items: center; gap: 3px; padding: 5px 0; border-bottom: 1px dashed var(--vscode-panel-border); }',
  '.path:last-child { border-bottom: 0; }',
  '.path .w { margin-left: auto; color: var(--vscode-descriptionForeground); }',
  '.edge { font-size: 11px; padding: 0 4px; }',
  '.edge.sel { outline: 1px solid var(--vscode-focusBorder); }',
  '.warn { font-size: 12px; border-left: 3px solid var(--vscode-editorWarning-foreground); padding: 4px 8px; background: var(--vscode-inputValidation-warningBackground, transparent); }',
  '.err { font-size: 12px; border-left: 3px solid var(--vscode-errorForeground); padding: 4px 8px; background: var(--vscode-inputValidation-errorBackground, transparent); }',
  'ol.changes { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 2px; }',
  'ol.changes button { font-size: 11px; padding: 0 6px; margin-left: 6px; }',
  'th.imp-col, .tile.imp-tile .name { font-style: italic; }',
  '#importText { min-height: 90px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 6px; }',
  '.srcgroup { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; border: 1px dashed var(--vscode-panel-border); border-radius: 3px; padding: 2px 4px; }',
  '.srcname { font-size: 11px; color: var(--vscode-descriptionForeground); }',
  '.srcwarn { font-size: 11px; color: var(--vscode-editorWarning-foreground); cursor: help; }',
  '.srcx { padding: 0 5px; font-size: 11px; }',
  '.pick.src .mono { font-style: italic; }',
  'input[type=search] { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; padding: 2px 6px; height: 26px; box-sizing: border-box; font-family: inherit; min-width: 200px; }',
  'tr.grp td { cursor: pointer; font-weight: 600; background: var(--vscode-editorWidget-background); text-align: left; }',
  'tr.grp .muted { font-weight: 400; margin-left: 8px; }',
  '.tile .bulk { font-size: 12px; }',
  '.tile .apply { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; font-size: 12px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px; }',
  '.tile .apply .title-combo-btn { min-width: 120px; max-width: 180px; }',
  '.tile .applyNote { font-size: 12px; color: var(--vscode-descriptionForeground); }',
  FILTER_COMBO_CSS,
  // The combo is sized for the cube viewer's title chips; here it sits in a form row.
  // The select stays as the value carrier but is never shown; each page hides it itself.
  '.title-combo > select { display: none; }',
  '.title-combo-btn { font-size: 13px; height: 26px; max-width: 320px; min-width: 160px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }',
].join('\n');

export function consolidationCompareBody(t: L10nMap): string {
  return `<div class="wrap">
  <p class="intro">${t.intro}</p>
  <div class="bar">
    <div class="stack">
      <label class="field"><span>${t.hierarchy}</span><select id="hier"></select></label>
      <label class="field"><span>${t.reference}</span><select id="ref"></select></label>
    </div>
    <div class="stack">
      <label class="field"><span>${t.alias}</span><select id="alias"><option value="">${t.noAlias}</option></select></label>
      <div class="field" id="scopeField"><span>${t.scope}</span><div class="row"><select id="scopeAttr"></select><span id="scopeValueBox" hidden><select id="scopeValue"></select></span></div></div>
    </div>
    <div class="field grow"><span>${t.compared}</span><div class="chipset" id="cmp"><span id="cmpChips" class="flat"></span><select id="addRoot"></select><span id="srcGroups" class="flat"></span></div></div>
    <button id="addSrcBtn" style="align-self:flex-end">${t.addSource}</button>
    <div class="stack">
      <label class="row"><input type="checkbox" id="onlyDiff" checked> ${t.onlyDiff}</label>
      <label class="row"><input type="checkbox" id="groupRows"> ${t.groupRows}</label>
    </div>
    <button id="compare" class="primary">${t.compare}</button>
    <button id="reload">${t.reload}</button>
  </div>
  <section class="panel" id="addSrc" hidden>
    <div class="row"><h2>${t.srcHierarchies}</h2><span id="hierBtns" class="chipset"></span></div>
    <div class="row"><h2>${t.srcServer}</h2><button id="loadServer">${t.loadServer}</button><span class="muted">${t.serverHint}</span></div>
    <div class="row"><h2>${t.srcList}</h2><button id="importFile">${t.importFile}</button><span class="muted">${t.importHint}</span></div>
    <textarea id="importText" spellcheck="false" aria-label="${t.srcList}"></textarea>
    <div class="row"><button id="importPaste" class="primary">${t.importUse}</button><span id="importMsg" class="muted"></span></div>
  </section>
  <div id="status" class="muted">${t.loading}</div>
  <section class="tiles" id="tiles"></section>
  <div class="main" id="main" hidden>
    <section class="panel">
      <div class="row" style="justify-content:space-between">
        <h2 id="matrixTitle"></h2>
        <div class="row"><input type="search" id="rowSearch" placeholder="${t.search}" aria-label="${t.search}"><button id="exportResult">${t.exportResult}</button></div>
      </div>
      <div class="scroll"><table id="matrix"></table></div>
      <div id="filterNote" class="muted"></div>
    </section>
    <aside class="panel-col" style="display:flex;flex-direction:column;gap:14px;min-width:0">
      <section class="panel" id="detail"></section>
      <section class="panel">
        <div class="row" style="justify-content:space-between">
          <h2>${t.draft}</h2>
          <div class="row"><button id="undo">${t.undo}</button><button id="discard">${t.discard}</button></div>
        </div>
        <ol class="changes" id="changes"></ol>
        <div class="row"><button id="save" class="primary">${t.saveToServer}</button><button id="exportChanges">${t.exportChanges}</button></div>
        <div id="saveMsg"></div>
        <div id="exportMsg" class="muted"></div>
      </section>
      <section class="panel">
        <h2>${t.exportTitle}</h2>
        <div class="muted">${t.exportHint}</div>
        <div class="row">
          <label class="field"><span>${t.subtreeOf}</span><select id="treeRoot"></select></label>
          <button id="exportSubtree" style="align-self:flex-end">${t.exportSubtree}</button>
        </div>
        <div id="subtreeMsg" class="muted"></div>
      </section>
    </aside>
  </div>
</div>`;
}

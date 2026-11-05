/**
 * HTML body markup for the TM1 Dimension Editor webview (v1.6.0). Rendered
 * server-side from the shared l10n map (`buildDimensionEditorL10n`) so all static
 * text is pre-translated. The manager populates content via postMessage after the
 * panel opens.
 */
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildDimensionEditorBody(t: L10nMap): string {
  return `
<div class="toolbar">
  <select id="hier-select" title="${t.hierarchyTitle}" disabled></select>
  <button id="new-hier-btn" class="btn-ghost" title="${t.newHierBtnTitle}" disabled>${t.newHierBtn}</button>
  <span class="sep"></span>
  <button id="add-element-btn" title="${t.addElementBtnTitle}" disabled>${t.addElementBtn}</button>
  <button id="bulk-add-btn" title="${t.bulkAddBtnTitle}" disabled>${t.bulkAddBtn}</button>
  <button id="manage-attr-btn" title="${t.manageAttrBtnTitle}" disabled>${t.manageAttrBtn}</button>
  <button id="open-attr-cube-btn" title="${t.openAttrCubeBtnTitle}" disabled>${t.openAttrCubeBtn}</button>
  <button id="sort-order-btn" title="${t.sortOrderBtnTitle}" disabled>${t.sortOrderBtn}</button>
  <span class="sep"></span>
  <button id="collapse-all-btn" class="btn-ghost" title="${t.collapseAllBtnTitle}" disabled>${t.collapseAllBtn}</button>
  <button id="expand-all-btn" class="btn-ghost" title="${t.expandAllBtnTitle}" disabled>${t.expandAllBtn}</button>
  <span class="sep"></span>
  <label style="display:flex; align-items:center; gap:3px; font-size:11px; color:var(--vscode-descriptionForeground)">${t.aliasLabel}
    <select id="alias-select" title="${t.aliasSelectTitle}" disabled><option value="">${t.aliasNone}</option></select>
  </label>
  <span class="sep"></span>
  <input id="search-box" type="text" placeholder="${t.searchPlaceholder}" disabled>
  <span id="validation-status" style="color:var(--vscode-errorForeground); font-size:11px; margin-left:4px"></span>
  <span style="flex:1"></span>
  <span id="dirty-indicator" class="dirty-dot" title="${t.dirtyIndicatorTitle}" style="display:none">&#9679;</span>
  <button id="discard-btn" class="btn-ghost" disabled>${t.discardBtn}</button>
  <button id="save-as-btn" class="btn-ghost" title="${t.saveAsBtnTitle}" disabled>${t.saveAsBtn}</button>
  <button id="save-btn" class="btn-primary" disabled>${t.saveBtn}</button>
</div>
<div class="container">
  <div class="tree-pane">
    <div id="tree-root"><div class="placeholder">${t.loadingDimension}</div></div>
  </div>
  <div class="detail-pane">
    <div id="detail"><div class="placeholder">${t.noElementSelected}</div></div>
  </div>
</div>

<div id="attr-modal" class="modal-backdrop">
  <div class="modal-box">
    <h3>${t.manageAttrTitle}</h3>
    <ul id="attr-list"></ul>
    <div style="display:flex; gap:4px; align-items:center; margin-bottom:12px">
      <input id="new-attr-name" placeholder="${t.newAttrNamePlaceholder}" style="flex:1">
      <select id="new-attr-type">
        <option value="String">String</option>
        <option value="Numeric">Numeric</option>
        <option value="Alias">Alias</option>
      </select>
      <button id="new-attr-add">+</button>
    </div>
    <div style="text-align:right">
      <button id="attr-modal-close">${t.done}</button>
    </div>
  </div>
</div>

<div id="prompt-modal" class="modal-backdrop">
  <form class="modal-box" id="prompt-form">
    <h3 id="prompt-modal-title" style="margin:0 0 12px 0"></h3>
    <div id="prompt-modal-fields"></div>
    <div id="prompt-modal-error" style="color:var(--vscode-errorForeground); font-size:11px; min-height:16px; margin:4px 0 8px 0"></div>
    <div style="display:flex; gap:8px; justify-content:flex-end">
      <button type="button" id="prompt-modal-cancel">${t.cancel}</button>
      <button type="submit" id="prompt-modal-ok">${t.ok}</button>
    </div>
  </form>
</div>

<!-- No #confirm-modal here: the yes/no dialog is built in the client by
     _shared/confirmDialog.ts (focus trap, role/aria-modal, Enter follows the
     focused button). #prompt-modal above is the last server-rendered modal. -->

<div id="bulk-modal" class="modal-backdrop">
  <div class="modal-box" style="min-width:440px">
    <h3>${t.insertListTitle}</h3>
    <div style="font-size:11px; color:var(--vscode-descriptionForeground); margin-bottom:6px">
      ${t.bulkHint}
    </div>
    <textarea id="bulk-textarea"
      placeholder="HS1&#10;HS2&#10;HS3&#10;SR101&#10;SR102"
      style="width:100%; height:180px; box-sizing:border-box; font-family: var(--vscode-editor-font-family); font-size: 12px; padding:6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); resize: vertical;"></textarea>
    <div style="display:flex; gap:12px; align-items:center; margin-top:10px; font-size:12px">
      <label>${t.bulkTypeLabel}
        <select id="bulk-type" style="margin-left:4px">
          <option value="N" selected>${t.bulkTypeNumeric}</option>
          <option value="S">${t.bulkTypeString}</option>
          <option value="C">${t.bulkTypeConsolidated}</option>
        </select>
      </label>
      <label id="bulk-parent-wrap" style="display:none">
        <input type="checkbox" id="bulk-as-child"> ${t.bulkAsChildPrefix} <span id="bulk-parent-name" style="font-weight:600"></span>
      </label>
    </div>
    <div id="bulk-preview" style="font-size:11px; color:var(--vscode-descriptionForeground); margin-top:8px; min-height:16px"></div>
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px">
      <button id="bulk-cancel" class="btn-secondary">${t.bulkCancel}</button>
      <button id="bulk-submit" class="btn-primary">${t.bulkSubmit}</button>
    </div>
  </div>
</div>
`;
}

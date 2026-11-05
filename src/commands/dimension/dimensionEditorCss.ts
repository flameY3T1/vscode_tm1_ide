/**
 * CSS for the TM1 Dimension Editor webview (v1.6.0). Loaded inline by
 * `dimensionEditorWebview.ts` — separated so the shell can focus on
 * CSP + script wiring.
 */
export const DIMENSION_EDITOR_CSS = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); align-items: center; background: var(--vscode-editor-background); }
.toolbar .sep { width: 1px; height: 18px; background: var(--vscode-panel-border); margin: 0 4px; flex: 0 0 1px; }
.toolbar button, .toolbar select, .toolbar input[type="text"] {
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid transparent;
  padding: 3px 9px;
  font-size: inherit;
  font-family: inherit;
  border-radius: 2px;
  cursor: pointer;
  line-height: 1.3;
  min-height: 24px;
  box-sizing: border-box;
}
.toolbar button:hover:not(:disabled), .toolbar select:hover:not(:disabled) {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
  border-color: var(--vscode-panel-border);
}
.toolbar button:disabled, .toolbar select:disabled, .toolbar input:disabled {
  opacity: 0.5;
  cursor: default;
}
.toolbar select { padding-right: 20px; background: var(--vscode-input-background); border-color: var(--vscode-input-border, var(--vscode-panel-border)); color: var(--vscode-input-foreground); cursor: pointer; }
.toolbar select:hover:not(:disabled) { background: var(--vscode-input-background); }
.toolbar input[type="text"] { background: var(--vscode-input-background); border-color: var(--vscode-input-border, var(--vscode-panel-border)); color: var(--vscode-input-foreground); cursor: text; }
.toolbar input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.toolbar .btn-primary, .modal-box .btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: 1px solid var(--vscode-button-background);
  font-weight: 500;
  padding: 4px 14px;
  font-size: inherit;
  border-radius: 2px;
  cursor: pointer;
}
.toolbar .btn-primary:hover:not(:disabled), .modal-box .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); border-color: var(--vscode-button-hoverBackground); color: var(--vscode-button-foreground); }
.toolbar .btn-primary:disabled, .modal-box .btn-primary:disabled { background: var(--vscode-button-background); border-color: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 0.5; cursor: default; }
.toolbar .btn-ghost { color: var(--vscode-descriptionForeground); }
.toolbar .btn-ghost:hover:not(:disabled) { color: var(--vscode-foreground); }
.container { display: grid; grid-template-columns: 1fr 380px; height: calc(100vh - 44px); }
.tree-pane { overflow: auto; border-right: 1px solid var(--vscode-panel-border); }
.detail-pane { overflow: auto; padding: 12px; }
#tree-root { padding: 8px; font-size: 13px; }
.tree-node { display: flex; align-items: center; gap: 6px; padding: 2px 6px; cursor: pointer; user-select: none; line-height: 20px; }
.tree-node:hover { background: var(--vscode-list-hoverBackground); }
.tree-node.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.tree-node.new { color: var(--vscode-gitDecoration-addedResourceForeground); }
.tree-node.changed { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
.tree-node.deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); text-decoration: line-through; }
.type-badge { padding: 0 4px; border-radius: 2px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 10px; margin-right: 4px; }
.twisty { cursor: pointer; display: inline-block; width: 12px; text-align: center; font-size: 9px; opacity: 0.7; user-select: none; }
.twisty:hover { opacity: 1; }
.twisty-spacer { display: inline-block; width: 12px; }
.placeholder { padding: 40px; text-align: center; opacity: 0.6; }
.dirty-dot { color: var(--vscode-gitDecoration-modifiedResourceForeground); margin-left: 4px; }
.detail-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
.detail-header .name { font-size: 15px; font-weight: 600; color: var(--vscode-symbolIcon-variableForeground, var(--vscode-foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-pane h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--vscode-foreground); }
.detail-pane h4 { margin: 18px 0 6px 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
.detail-pane ul { padding-left: 0; margin: 4px 0; list-style: none; }
.detail-pane ul li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 6px; border-radius: 2px; font-size: 12px; }
.detail-pane ul li:hover { background: var(--vscode-list-hoverBackground); }
.detail-pane ul li .weight { color: var(--vscode-descriptionForeground); font-size: 11px; }
.detail-pane label { font-size: 12px; color: var(--vscode-descriptionForeground); }
.detail-pane label .attr-type { opacity: 0.7; font-size: 10px; margin-left: 4px; }
.detail-pane input[type="text"], .detail-pane select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; }
.detail-pane input[type="text"]:focus, .detail-pane select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px; color: var(--vscode-descriptionForeground); }
.detail-empty { font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 6px; }
.icon-btn { background: transparent; border: 1px solid transparent; color: var(--vscode-descriptionForeground); padding: 2px 6px; cursor: pointer; font-size: 12px; border-radius: 2px; line-height: 1.2; }
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); border-color: var(--vscode-panel-border); }
.icon-btn.danger:hover { color: var(--vscode-errorForeground); }
.btn-secondary { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); padding: 3px 10px; font-size: 12px; cursor: pointer; border-radius: 2px; }
.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
.btn-secondary:disabled { opacity: 0.5; cursor: default; }
.modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 100; }
.modal-backdrop.open { display: flex; }
.modal-box { background: var(--vscode-editor-background); padding: 16px; min-width: 360px; border: 1px solid var(--vscode-panel-border); max-height: 70vh; overflow: auto; }
.modal-box h3 { margin: 0 0 10px 0; }
.modal-box ul { list-style: none; padding: 0; margin: 0 0 10px 0; }
.modal-box li { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.modal-box li.new { color: var(--vscode-gitDecoration-addedResourceForeground); }
.dim-toast { position: fixed; bottom: 20px; right: 20px; padding: 8px 14px; border-radius: 4px; z-index: 200; font-size: 13px; transition: opacity 0.3s; max-width: 400px; word-wrap: break-word; }
.dim-toast.ok { background: var(--vscode-editor-selectionBackground); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); }
.dim-toast.err { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-inputValidation-errorBorder); }
.tree-node.drag-over { outline: 2px dashed var(--vscode-focusBorder); outline-offset: -2px; }
.tree-node.drag-over-before { box-shadow: inset 0 2px 0 0 var(--vscode-focusBorder); }
.tree-node.drag-over-after { box-shadow: inset 0 -2px 0 0 var(--vscode-focusBorder); }
.tree-node.drag-source { opacity: 0.4; }
#search-box { flex: 0 0 180px; }
.dm-mark { margin-left: 6px; font-size: 11px; }
.dm-explicit { color: var(--vscode-charts-yellow, #d7ba7d); }
.dm-derived { color: var(--vscode-descriptionForeground); opacity: 0.7; }
`;

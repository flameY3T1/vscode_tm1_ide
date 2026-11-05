import { FILTER_COMBO_CSS } from '../../webviews/filterComboCss';

// src/commands/security/userGroupManagerCss.ts
export const USER_GROUP_MANAGER_CSS = `
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0; padding: 16px;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px; padding-bottom: 8px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.header h2 { margin: 0; font-size: 1.2em; font-weight: 500; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.filter-input { width: 200px; }
.list-table tr[hidden], .matrix tr[hidden] { display: none; }
.alias-row { display: flex; gap: 6px; align-items: center; }
.alias-row[hidden] { display: none; }
.alias-row select { width: auto; min-width: 140px; }
.tab-bar {
  display: flex; gap: 0; margin-bottom: 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.tab {
  padding: 8px 16px; cursor: pointer; border: none;
  background: transparent; color: var(--vscode-foreground);
  border-bottom: 2px solid transparent;
  font-family: inherit; font-size: inherit;
}
.tab:hover { background: var(--vscode-list-hoverBackground); }
.tab.active {
  border-bottom: 2px solid var(--vscode-focusBorder);
  color: var(--vscode-focusBorder);
}
.tab.dirty::after { content: ' •'; color: var(--vscode-charts-yellow, gold); }
.tab-actions {
  display: flex; gap: 8px; margin-bottom: 8px;
}
button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none; padding: 6px 12px; cursor: pointer;
  font-family: inherit; font-size: inherit; border-radius: 2px;
}
button:hover { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
button.danger {
  background: var(--vscode-inputValidation-errorBackground, #c33);
  color: var(--vscode-button-foreground);
}
.list-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.list-table th, .list-table td {
  text-align: left; padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.list-table th { font-weight: 600; background: var(--vscode-editorWidget-background); }
.list-table tr.system td { color: var(--vscode-descriptionForeground); font-style: italic; }
.user-status { font-weight: 600; }
.user-status.active { color: var(--vscode-testing-iconPassed, #2e7d32); }
.user-status.inactive { color: var(--vscode-descriptionForeground); font-weight: 400; }
.list-table tr.selected td { background: var(--vscode-list-activeSelectionBackground); }
.list-table tr:hover td { background: var(--vscode-list-hoverBackground); cursor: pointer; }
.matrix-wrap { max-height: calc(100vh - 220px); overflow: auto; border: 1px solid var(--vscode-panel-border); margin-top: 8px; }
.matrix { border-collapse: collapse; font-size: 0.85em; }
.matrix th, .matrix td {
  padding: 4px 8px; border-right: 1px solid var(--vscode-panel-border); border-bottom: 1px solid var(--vscode-panel-border);
  white-space: nowrap;
}
.matrix th { background: var(--vscode-editorWidget-background); font-weight: 600; position: sticky; top: 0; }
.matrix th.row-head, .matrix td.row-head {
  text-align: left; position: sticky; left: 0; z-index: 2;
  background: var(--vscode-editorWidget-background); font-weight: 500;
}
.matrix td.row-head { background: var(--vscode-editor-background); }
.matrix input[type=checkbox] { cursor: pointer; }
.matrix tr.pinned td { background: var(--vscode-list-inactiveSelectionBackground); }
.matrix tr.pinned:nth-child(2) td { border-bottom: 2px solid var(--vscode-panel-border); }
.pin-tag { font-size: 0.85em; color: var(--vscode-descriptionForeground); font-weight: normal; }
.input {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 4px 8px; font-family: inherit; font-size: inherit;
}
.modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: none;
  justify-content: center; align-items: center; z-index: 1000;
}
.modal-bg.visible { display: flex; }
.modal {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  padding: 16px;
  /* A form for a name, a type and a few groups — not as wide as the matrix
     behind it. Shrinks with a narrow panel; scrolls when the group list is long. */
  width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
  box-sizing: border-box;
}
.modal h3 { margin: 0 0 12px; }
.modal .form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.modal label { font-size: 0.85em; }
.modal .form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.modal .cg-preview { white-space: pre-line; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
.modal .form-error { color: var(--vscode-errorForeground); font-size: 0.85em; min-height: 1em; }
.status { margin-top: 12px; padding: 8px 12px; border-radius: 2px; display: none; }
.status.ok { display: block; background: rgba(0, 200, 0, 0.12); }
.status.error { display: block; background: rgba(255, 80, 80, 0.12); }
.dirty-badge {
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  padding: 2px 6px; border-radius: 8px; font-size: 0.85em; margin-left: 8px; display: none;
}
.dirty-badge.visible { display: inline-block; }
.empty-state { padding: 24px; text-align: center; color: var(--vscode-descriptionForeground); }
.checkboxes { display: flex; flex-wrap: wrap; gap: 6px; max-height: 200px; overflow: auto; padding: 4px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
.checkboxes label { display: flex; align-items: center; gap: 4px; padding: 2px 6px; }
/* User pickers: the select stays the value carrier, the filterable combo renders on top. */
#nu-copy-from, #cg-source { display: none; }
.form-row .title-combo { display: flex; width: 100%; }
.form-row .title-combo-btn { width: 100%; max-width: none; font-size: 12px; padding: 4px 18px 4px 6px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
${FILTER_COMBO_CSS}
`;

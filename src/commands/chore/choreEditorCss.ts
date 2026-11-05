/**
 * CSS for the TM1 Chore Editor webview. Loaded inline by the shell in
 * `choreEditorWebview.ts` — separated out so the shell stays slim and
 * the styling can be linted/edited without scrolling past the markup + script.
 */
import { FILTER_COMBO_CSS } from '../../webviews/filterComboCss';

export const CHORE_EDITOR_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Toolbar ── */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-editorGroup-border);
    flex-shrink: 0;
  }
  .toolbar-title {
    flex: 1;
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .toolbar button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    border-radius: 2px;
  }
  .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
  .toolbar button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .toolbar button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  .toolbar button:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }

  /* ── Main layout ── */
  .editor-body {
    flex: 1;
    /* min-height:0 lets this flex item shrink below content height so its own
       overflow-y:auto scrolls — without it the column overflows and body
       (overflow:hidden) clips the tail, making lower tasks unreachable. */
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* ── Section ── */
  .section {
    border: 1px solid var(--vscode-editorGroup-border);
    border-radius: 4px;
    overflow: hidden;
    /* .editor-body is a flex column; without this its section children get
       flex-shrunk to fit the viewport instead of overflowing, so the Tasks
       list is clipped and .editor-body's overflow-y:auto never scrolls. */
    flex-shrink: 0;
  }
  .section-header {
    background: var(--vscode-editorGroupHeader-tabsBackground);
    padding: 6px 12px;
    font-weight: 600;
    font-size: 12px;
    border-bottom: 1px solid var(--vscode-editorGroup-border);
  }
  .section-body { padding: 12px; }

  /* ── Form fields ── */
  .field-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .field-row:last-child { margin-bottom: 0; }
  .field-label {
    min-width: 110px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  input[type="text"], input[type="number"], input[type="date"], select, textarea {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorGroup-border));
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    border-radius: 2px;
    outline: none;
  }
  input[type="text"]:focus, input[type="number"]:focus, input[type="date"]:focus, select:focus {
    border-color: var(--vscode-focusBorder);
  }
  input[type="date"]::-webkit-calendar-picker-indicator { cursor: pointer; }
  /* Native date picker popup + spinners follow color-scheme; bind it to the VS Code theme. */
  body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
  body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
  input[type="text"].readonly-name {
    background: var(--vscode-input-background);
    opacity: 0.65;
    cursor: not-allowed;
  }
  input[type="number"] { width: 60px; text-align: center; }
  input[inputmode="numeric"] { text-align: center; }
  select { min-width: 180px; }

  /* Checkbox */
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .checkbox-row label { font-size: 12px; cursor: pointer; user-select: none; }

  /* Time inputs */
  .time-inputs { display: flex; align-items: center; gap: 4px; }
  .time-sep { font-size: 14px; font-weight: bold; }

  /* ── Tasks ── */
  .task-card {
    border: 1px solid var(--vscode-editorGroup-border);
    border-radius: 3px;
    margin-bottom: 8px;
    overflow: hidden;
  }
  .task-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--vscode-list-inactiveSelectionBackground);
    border-bottom: 1px solid var(--vscode-editorGroup-border);
  }
  .task-step-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
    min-width: 70px;
  }
  .task-process-select { flex: 1; min-width: 0; }
  .task-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 5px;
    color: var(--vscode-foreground);
    opacity: 0.7;
    font-size: 13px;
    border-radius: 2px;
  }
  .task-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }
  .task-btn.danger:hover { color: var(--vscode-errorForeground); }

  .task-params { padding: 8px 10px; }
  .params-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .params-table th {
    text-align: left;
    padding: 3px 8px;
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
    border-bottom: 1px solid var(--vscode-editorGroup-border);
  }
  .params-table td { padding: 3px 8px; }
  .params-table input[type="text"] { width: 100%; }
  .params-table .type-cell { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .no-params { color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; padding: 4px 0; }

  #btn-add-task {
    background: none;
    border: 1px dashed var(--vscode-editorGroup-border);
    color: var(--vscode-foreground);
    opacity: 0.7;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 12px;
    width: 100%;
    border-radius: 3px;
    margin-top: 4px;
  }
  #btn-add-task:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground); }

  .validation-error {
    /* Pair the error-background with its matching validation foreground (falls
       back to the theme foreground) — using errorForeground here renders red
       text on the red error background, unreadable in several dark themes. */
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    font-size: 11px;
    padding: 6px 12px;
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-radius: 2px;
    display: none;
  }

  #loading { padding: 24px; color: var(--vscode-descriptionForeground); font-style: italic; }
  /* #main is shown via JS as flex-column filling the body. flex:1 + min-height:0
   make it a proper intermediate flex item so its child .editor-body can shrink
   below content and scroll — without min-height:0 here the default min-height:auto
   propagates the full task list up and defeats .editor-body's overflow. */
#main { display: none; flex: 1; min-height: 0; }
  /* The select stays the value carrier; the filterable combo renders on top. */
  .task-process-select { display: none; }
  .task-card-header .title-combo { flex: 1; min-width: 0; }
  .task-card-header .title-combo-btn { width: 100%; max-width: none; font-size: 12px; padding: 3px 18px 3px 6px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
  ${FILTER_COMBO_CSS}
`;

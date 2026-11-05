// src/webviews/bulkTableCss.ts
//
// The stylesheet of the two bulk pages (delete and migration).
//
// Until 2026-09-20 it was an export in `bulkDeleteWebview.ts`; the
// migration page was thereby tied to a vscode-heavy module that it does
// not otherwise need — for 130 lines of CSS.

export const BULK_TABLE_CSS = [
  // Same scaffold as `findReplaceWebview.ts` and `tiValueNamingBody.ts`:
  // color scheme per theme, font size from the environment, input fields and
  // buttons 26 px high with 2 px radius and a visible focus frame.
  'body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }',
  'body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }',
  'html, body { height: 100%; }',
  'body { margin: 0; padding: 0; font-family: var(--vscode-font-family);',
  '  font-size: var(--vscode-font-size);',
  '  color: var(--vscode-foreground); display: flex; flex-direction: column; overflow: hidden; }',
  '[hidden] { display: none !important; }',
  '.bd-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px;',
  '  border-bottom: 1px solid var(--vscode-panel-border); flex: 0 0 auto; }',
  '.bd-title { font-size: 14px; font-weight: 600; }',
  '.bd-server { color: var(--vscode-descriptionForeground); }',
  '.bd-spacer { flex: 1; }',
  '.bd-hint { padding: 8px 16px 0; color: var(--vscode-descriptionForeground);',
  '  font-size: 12px; line-height: 1.5; }',
  // Numbered steps as in `tiValueNamingBody.ts` — the page has two,
  // and that searching and checking are NOT the same thing is its structure.
  '.bd-step { display: flex; align-items: center; gap: 8px; font-weight: 600; }',
  '.bd-step-num { display: inline-flex; align-items: center; justify-content: center;',
  '  width: 18px; height: 18px; border-radius: 50%; background: var(--vscode-badge-background);',
  '  color: var(--vscode-badge-foreground); font-size: 11px; font-weight: 600; flex: none; }',
  '.bd-sep { height: 1px; background: var(--vscode-panel-border); margin: 4px 0; }',
  '.bd-controls { display: flex; flex-direction: column; gap: 8px; padding: 10px 16px; flex: 0 0 auto; }',
  '.bd-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }',
  '.bd-label { min-width: 62px; color: var(--vscode-descriptionForeground); font-size: 12px; }',
  '.bd-kinds { display: flex; gap: 14px; flex-wrap: wrap; }',
  '.bd-check { display: inline-flex; align-items: center; gap: 4px; font-size: 12px;',
  '  cursor: pointer; }',
  'input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground);',
  '  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));',
  '  border-radius: 2px; padding: 3px 6px; height: 26px; box-sizing: border-box;',
  '  font-family: inherit; font-size: 13px; min-width: 280px; }',
  'input[type=text]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;',
  '  border-color: var(--vscode-focusBorder); }',
  'input::placeholder { color: var(--vscode-input-placeholderForeground); }',
  // Select field as in `tiConsistencyBody.ts`: dropdown colors, not
  // input-field colors — otherwise the page shows a control in the style
  // of the operating system instead of in that of the theme.
  'select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);',
  '  border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));',
  '  border-radius: 2px; padding: 3px 6px; height: 26px; box-sizing: border-box;',
  '  font-family: inherit; font-size: 13px; cursor: pointer; }',
  'select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;',
  '  border-color: var(--vscode-focusBorder); }',
  'select:disabled { opacity: .5; cursor: default; }',
  'input[type=checkbox] { vertical-align: -1px; margin: 0; }',
  'input[type=checkbox]:focus-visible { outline: 1px solid var(--vscode-focusBorder);',
  '  outline-offset: 1px; }',
  'button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);',
  '  border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px;',
  '  padding: 4px 12px; height: 26px; cursor: pointer;',
  '  font-family: inherit; font-size: 13px; }',
  'button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground,',
  '  var(--vscode-button-background)); }',
  'button:disabled { opacity: .5; cursor: default; }',
  'button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }',
  // Tool button in the header row — the same form as `.ov-btn` of the
  // object overviews: borderless, only colors under the pointer.
  '.bd-iconbtn { background: transparent; color: var(--vscode-foreground);',
  '  border: 1px solid transparent; border-radius: 4px; padding: 4px 8px; font-size: 13px; }',
  '.bd-iconbtn:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground,',
  '  rgba(128,128,128,0.18)); }',
  'button.secondary { background: var(--vscode-button-secondaryBackground,',
  '  var(--vscode-button-background)); color: var(--vscode-button-secondaryForeground); }',
  'button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground,',
  '  var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }',
  'button.danger { background: var(--vscode-inputValidation-errorBackground);',
  '  color: var(--vscode-foreground);',
  '  border: 1px solid var(--vscode-inputValidation-errorBorder, transparent); }',
  // Without this rule the red button inherits the blue `button:hover` — the
  // pointer turned "Delete" into the ordinary button.
  'button.danger:hover:not(:disabled) { background: var(--vscode-inputValidation-errorBackground);',
  '  border-color: var(--vscode-inputValidation-errorBorder,',
  '    var(--vscode-editorError-foreground));',
  '  filter: brightness(1.15); }',
  '.bd-help { color: var(--vscode-descriptionForeground); font-size: 11px; }',
  '.bd-count { color: var(--vscode-descriptionForeground); font-size: 12px; }',
  '.bd-note { margin: 0 16px 8px; padding: 6px 10px; border-radius: 3px; font-size: 12px;',
  '  background: var(--vscode-inputValidation-warningBackground);',
  '  color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground)); }',
  '.bd-error { margin: 0 16px 8px; padding: 6px 10px; border-radius: 3px; font-size: 12px;',
  '  background: var(--vscode-inputValidation-errorBackground);',
  '  color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); }',
  '.bd-wrap { overflow: auto; padding: 0 8px 16px; flex: 1 1 auto; min-height: 0; }',
  // `min-width: max-content` belongs with `white-space: nowrap` in the cells:
  // without it the table box stays at 100% of the window, while
  // a long name sticks out beyond it — and the row background (selection,
  // mouse pointer) ends exactly at this edge, in the middle of the row. With it
  // the table grows to its content, the frame scrolls, and the tint
  // covers the whole row.
  'table.bd-table { border-collapse: collapse; width: 100%; min-width: max-content;',
  '  font-size: 12px; }',
  '.bd-table th, .bd-table td { text-align: left; padding: 4px 8px;',
  '  border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }',
  '.bd-table th { position: sticky; top: 0; background: var(--vscode-sideBar-background);',
  '  font-weight: 600; user-select: none; }',
  '.bd-table tbody tr:hover { background: var(--vscode-list-hoverBackground); }',
  '.bd-table td.bd-kind { color: var(--vscode-descriptionForeground); }',
  '.bd-table td.bd-usage { white-space: normal; color: var(--vscode-descriptionForeground); }',
  '.bd-blocked { color: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground)); }',
  '.bd-owner { color: var(--vscode-descriptionForeground); }',
  '.bd-usage-link { color: var(--vscode-textLink-foreground); cursor: pointer; white-space: nowrap; }',
  '.bd-usage-link:hover { color: var(--vscode-textLink-activeForeground); }',
  // Number columns right-aligned and tabular-numbered: otherwise
  // 7 and 12 drift against each other and the column can no longer be skimmed.
  '.bd-table th.bd-num, .bd-table td.bd-num { text-align: right;',
  '  font-variant-numeric: tabular-nums; }',
  '.bd-table td.bd-status { color: var(--vscode-descriptionForeground); }',
  // Only a muted color, NO additional `opacity`: muted twice,
  // the dash disappears on a dark background (~#5e5e5e on #1f1f1f),
  // and the row looks as if the table ended before the column.
  '.bd-zero { color: var(--vscode-descriptionForeground); }',
  '.bd-exp { cursor: pointer; user-select: none; text-align: center;',
  '  color: var(--vscode-descriptionForeground); }',
  '.bd-exp:hover { color: var(--vscode-foreground); }',
  // Marked: the whole row, not just the checkbox on the far left.
  '.bd-table tbody tr.bd-sel > td { background: var(--vscode-list-inactiveSelectionBackground); }',
  // Blocked: a bar at the start of the row. Colored text in the last
  // column is not noticed when skimming.
  '.bd-table tbody tr.bd-locked > td:first-child {',
  '  border-left: 3px solid var(--vscode-inputValidation-errorBorder,',
  '    var(--vscode-editorError-foreground)); }',
  '.bd-table tbody tr.bd-detail > td { white-space: normal;',
  '  background: var(--vscode-editorWidget-background); }',
  '.bd-dline { display: flex; gap: 8px; padding: 1px 0; }',
  '.bd-dlabel { flex: 0 0 96px; color: var(--vscode-descriptionForeground); }',
  '.bd-empty { padding: 20px 16px; color: var(--vscode-descriptionForeground); font-style: italic; }',
  '.bd-busy { padding: 6px 16px; color: var(--vscode-descriptionForeground); font-size: 12px; }',
].join('\n');

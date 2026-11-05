export const CELL_TRACE_CSS = `
  :root {
    --ct-accent: var(--vscode-charts-blue, #3794ff);
    --ct-line: var(--vscode-panel-border, rgba(127,127,127,0.35));
    --ct-row-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.10));
  }
  body {
    font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    font-size: var(--vscode-font-size); background: var(--vscode-editor-background);
    margin: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }

  /* ── Toolbar: same shape as the message-log analysis panel ────────────── */
  .toolbar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0;
    padding: 8px 12px; background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--ct-line);
  }
  .toolbar .title { font-weight: 600; font-size: 13px; margin-right: 8px; }
  .toolbar .spacer { flex: 1; }
  .tab {
    background: transparent; color: var(--vscode-foreground);
    border: 1px solid transparent; border-bottom: 2px solid transparent;
    padding: 4px 12px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px;
  }
  .tab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .tab.active { border-bottom-color: var(--ct-accent); font-weight: 600; }
  .act {
    background: transparent; color: var(--vscode-foreground); border: 1px solid transparent;
    padding: 4px 8px; cursor: pointer; border-radius: 4px; font-size: 12px;
  }
  .act:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .act[hidden], .trace-zero[hidden] { display: none; }
  .trace-zero { font-size: 11px; color: var(--vscode-descriptionForeground); display: inline-flex; align-items: center; gap: 4px; }
  #trace-spinner { display: none; font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* Cell coordinates get their own line: they are long, and keeping them in the
     toolbar title pushed the tabs off-screen on narrow panels. */
  #trace-subtitle {
    flex-shrink: 0; padding: 6px 12px; border-bottom: 1px solid var(--ct-line);
    font-family: var(--vscode-editor-font-family); font-size: 11px;
    color: var(--vscode-descriptionForeground); white-space: nowrap; overflow-x: auto;
  }
  #trace-subtitle:empty { display: none; }
  #trace-content { padding: 8px 12px 16px; overflow: auto; flex: 1 1 auto; min-height: 0; }

  /* ── Section headings shared by all three modes ───────────────────────── */
  .trace-section { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 4px; }
  .trace-section:first-child { margin-top: 0; }
  .trace-section h3 { margin: 0; font-size: 12px; font-weight: 600; }
  .trace-section .count { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }

  /* ── Calculation tree ─────────────────────────────────────────────────── */
  ul.trace-tree { list-style: none; margin: 0; padding-left: 14px; }
  ul.trace-tree.root { padding-left: 0; }
  /* Grid instead of flex: the value column then lines up across ALL depths,
     which is what makes a deep consolidation readable. */
  .trace-row {
    display: grid; grid-template-columns: 14px auto 1fr minmax(90px, auto);
    align-items: center; gap: 6px; padding: 2px 4px; border-radius: 3px;
  }
  .trace-row:hover { background: var(--ct-row-hover); }
  .trace-toggle { cursor: pointer; user-select: none; color: var(--vscode-descriptionForeground); font-size: 10px; }
  .trace-toggle.leaf { cursor: default; opacity: 0.35; }
  .trace-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trace-value { text-align: right; font-variant-numeric: tabular-nums; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .trace-value.zero { color: var(--vscode-descriptionForeground); }

  /* Outline chips rather than filled pills: at one badge per row, filled colour
     blocks dominated the tree instead of the numbers. */
  .trace-badge {
    font-size: 10px; padding: 0 5px; border-radius: 3px; border: 1px solid currentColor;
    text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap;
  }
  .trace-badge-rule { color: var(--vscode-charts-purple, #a074c4); }
  .trace-badge-consolidation { color: var(--vscode-charts-blue, #4e94ce); }
  .trace-badge-simple { color: var(--vscode-descriptionForeground); }
  .trace-badge-error {
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    background: var(--vscode-inputValidation-errorBackground);
    border-color: var(--vscode-inputValidation-errorBorder, transparent);
  }

  /* ── Rule / feeder statements ─────────────────────────────────────────── */
  .trace-stmt-wrap { margin: 2px 0 6px 34px; }
  .trace-stmt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .trace-stmt-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em;
    color: var(--vscode-descriptionForeground);
  }
  pre.trace-stmt {
    margin: 0 0 4px; padding: 4px 8px; background: var(--vscode-textCodeBlock-background);
    border-left: 2px solid var(--vscode-charts-purple, #a074c4); border-radius: 0 3px 3px 0;
    white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 12px;
  }
  pre.trace-stmt-values { border-left-color: var(--vscode-charts-green, #89d185); }
  .trace-stmt-line { font-size: 11px; color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  .trace-stmt-line:hover { text-decoration: underline; }
  .trace-more { color: var(--vscode-descriptionForeground); font-style: italic; padding-left: 18px; }

  /* ── Cell tables (fed cells / unfed components) ───────────────────────── */
  table.trace-table { border-collapse: collapse; width: 100%; font-size: 12px; }
  table.trace-table th {
    text-align: left; font-weight: 600; font-size: 11px; padding: 3px 8px;
    color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--ct-line);
    position: sticky; top: 0; background: var(--vscode-editor-background);
  }
  table.trace-table th.num, table.trace-table td.num { text-align: right; }
  table.trace-table th.mid, table.trace-table td.mid { text-align: center; }
  table.trace-table td { padding: 2px 8px; border-bottom: 1px solid var(--ct-line); }
  table.trace-table tbody tr:hover { background: var(--ct-row-hover); }
  table.trace-table td.cell { font-family: var(--vscode-editor-font-family); }
  .fed-yes { color: var(--vscode-charts-green, #89d185); }
  .fed-no  { color: var(--vscode-charts-red, #f14c4c); font-weight: 600; }

  /* ── States ───────────────────────────────────────────────────────────── */
  .trace-hint, .trace-empty {
    margin: 4px 0 8px; padding: 6px 10px; border-radius: 3px; font-style: italic;
    color: var(--vscode-descriptionForeground);
    background: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
  }
  .trace-ok {
    margin: 4px 0 8px; padding: 6px 10px; border-radius: 3px;
    border-left: 3px solid var(--vscode-charts-green, #89d185);
    background: color-mix(in srgb, var(--vscode-charts-green, #89d185) 12%, transparent);
  }
  .trace-error {
    margin: 10px 0; padding: 8px 12px; border-radius: 3px;
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-inputValidation-errorBorder, transparent);
  }
`;

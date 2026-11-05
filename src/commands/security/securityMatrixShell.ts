// src/commands/security/securityMatrixShell.ts
//
// CSS and markup of the security matrices (cube, dimension, process, element).
//
// Until 2026-08-30 they lived in six files that were BYTE-IDENTICAL: a
// `diff` between the cube and the dimension version reported exactly two
// lines — the path comment and the name of the constant. That sharing is
// the right call here was already shown by their neighborhood beforehand:
// the three `*Webview.ts` already pull their labels jointly from
// `securityMatrixL10n.ts`, and the webview client shares
// `_shared/securityMatrixCore.ts` — there, the three `index.ts` are down to
// just 42 lines of configuration.
export const SECURITY_MATRIX_CSS = `
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
.toolbar { display: flex; gap: 8px; }
.tab-bar {
  display: flex; gap: 0; margin-bottom: 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
}
.tab-bar .tab {
  background: transparent; color: var(--vscode-foreground);
  border: none; padding: 6px 14px; cursor: pointer;
  border-bottom: 2px solid transparent; border-radius: 0;
  font-family: inherit; font-size: inherit;
}
.tab-bar .tab:hover { background: var(--vscode-list-hoverBackground); }
.tab-bar .tab.active {
  border-bottom-color: var(--vscode-focusBorder);
  color: var(--vscode-focusBorder);
}
.tab-bar .tab-action { margin-left: auto; color: var(--vscode-textLink-foreground); }
.filters {
  display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;
}
.filters label { font-weight: 500; }
.filter-input {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  padding: 4px 8px; font-family: inherit; font-size: inherit;
  min-width: 220px;
}
.chip-bar {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px;
  padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border);
}
.chip {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  padding: 3px 10px; border-radius: 12px; cursor: pointer; user-select: none;
  border: 1px solid transparent; font-size: 0.85em;
}
.chip:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
.chip.selected {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-focusBorder);
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
.matrix-wrap {
  max-height: calc(100vh - 200px); overflow: auto;
  border: 1px solid var(--vscode-panel-border);
}
.matrix {
  width: 100%; border-collapse: collapse; font-size: 0.9em;
}
.matrix th, .matrix td {
  padding: 4px 8px;
  border-right: 1px solid var(--vscode-panel-border);
  border-bottom: 1px solid var(--vscode-panel-border);
  white-space: nowrap;
}
.matrix th {
  background: var(--vscode-editorWidget-background);
  font-weight: 600; position: sticky; top: 0;
}
.matrix th.row-col {
  text-align: left; left: 0; z-index: 2;
}
.matrix td.row-col {
  text-align: left;
  background: var(--vscode-editor-background);
  position: sticky; left: 0; font-weight: 500;
}
.matrix tr.dirty td.row-col {
  background: rgba(255, 200, 0, 0.08);
}
.cell-dropdown {
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
  padding: 2px 4px; font-family: inherit; font-size: inherit;
  width: 100%; min-width: 90px;
}
td.error .cell-dropdown { border-color: var(--vscode-errorForeground); }
td.dirty .cell-dropdown { border-color: var(--vscode-charts-yellow, gold); }
.status { margin-top: 12px; padding: 8px 12px; border-radius: 2px; display: none; }
.status.ok { display: block; background: rgba(0, 200, 0, 0.12); color: var(--vscode-foreground); }
.status.error { display: block; background: rgba(255, 80, 80, 0.12); color: var(--vscode-foreground); }
.dirty-badge {
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  padding: 2px 6px; border-radius: 8px; font-size: 0.85em; margin-left: 8px; display: none;
}
.dirty-badge.visible { display: inline-block; }
.empty-state {
  padding: 32px; text-align: center; color: var(--vscode-descriptionForeground);
}
`;

import type { L10nMap } from '../../webviewClient/_shared/l10n';

/** Element-matrix additions to SECURITY_MATRIX_CSS (missing-cube banner). */
export const MISSING_BANNER_CSS = `
.missing-banner {
  background: rgba(255, 180, 0, 0.12);
  border: 1px solid var(--vscode-charts-yellow, gold);
  padding: 12px 16px; margin-bottom: 12px;
  display: flex; gap: 12px; align-items: center; justify-content: space-between;
}
.missing-banner button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none; padding: 6px 12px; cursor: pointer;
  font-family: inherit; font-size: inherit; border-radius: 2px;
}
.missing-banner button.primary:hover { background: var(--vscode-button-hoverBackground); }
`;

/**
 * `titleSuffix` is appended inside the heading, `afterTabs` sits between the
 * tab bar and the filter row. `t.filterLabel` overrides the default
 * "<entityLabel>:" filter label.
 */
export function buildSecurityMatrixBody(
  t: L10nMap,
  extra: { titleSuffix?: string; afterTabs?: string } = {},
): string {
  return `
<div class="header">
  <div>
    <h2>${t.title}${extra.titleSuffix ?? ''}</h2>
    <span id="dirty-badge" class="dirty-badge">${t.unsavedChanges}</span>
  </div>
  <div class="toolbar">
    <button id="btn-refresh" class="secondary">${t.refresh}</button>
    <button id="btn-revert" class="secondary" disabled>${t.revert}</button>
    <button id="btn-save" disabled>${t.save}</button>
  </div>
</div>

<div class="tab-bar">
  <button class="tab active" data-tab="select">${t.tabSelection}</button>
  <button class="tab" data-tab="matrix">${t.tabMatrix}</button>
  <button id="btn-view" class="tab tab-action">${t.tabView}</button>
</div>
${extra.afterTabs ?? ''}
<div class="filters">
  <label for="row-filter">${t.filterLabel ?? `${t.entityLabel}:`}</label>
  <input id="row-filter" class="filter-input" type="search" placeholder="${t.filterPlaceholder}" autocomplete="off">
</div>

<div id="chip-bar" class="chip-bar">
  <span class="empty-state" style="padding:0">${t.noGroupsLoaded}</span>
</div>

<div id="matrix-wrap" class="matrix-wrap">
  <div class="empty-state">${t.loading}</div>
</div>

<div id="status" class="status"></div>
`;
}

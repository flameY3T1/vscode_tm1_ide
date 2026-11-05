import * as vscode from 'vscode';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../../webviews/columnResize';
import { savedColumnWidths } from '../../webviews/columnWidthStore';
import type { ChoreOverviewBootstrap } from '../../webviewClient/choreOverview/protocol';
import { escapeHtml as esc } from '../../utils/escapeHtml';

/**
 * HTML/CSS for the Chore Overview panel; the logic is the bundle
 * `webviewClient/choreOverview/`. Rows arrive via postMessage as
 * `ChoreOverviewRow[]`. Row click posts `openChore`.
 */
export function getChoreOverviewHtml(serverLabel: string, cspSource: string, scriptUri: string): string {

  const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px;
  }
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--vscode-editorGroup-border); }
  .header h2 { font-size: 14px; font-weight: 600; }
  .header .server { color: var(--vscode-descriptionForeground); font-size: 13px; }
  .header .spacer { flex: 1; }
  button {
    padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    cursor: pointer; font-size: inherit; border-radius: 3px;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }

  .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .controls input[type=text] {
    flex: 0 0 240px; padding: 4px 8px; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 3px;
  }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; }
  th { cursor: pointer; user-select: none; background: var(--vscode-editorGroupHeader-tabsBackground); position: sticky; top: 0; }
  th[title] { text-decoration: underline dotted var(--vscode-descriptionForeground); text-underline-offset: 3px; }
  th:hover { background: var(--vscode-list-hoverBackground); }
  th.sorted { color: var(--vscode-textLink-foreground); }
  tbody tr { cursor: pointer; }
  tbody tr:hover td { background: var(--vscode-list-hoverBackground); }
  .badge { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .badge.on { background: var(--vscode-testing-iconPassed, #3fb950); }
  .badge.off { background: var(--vscode-descriptionForeground); }
  .inactive td { color: var(--vscode-descriptionForeground); }
  .mono { font-variant-numeric: tabular-nums; }
  .num { text-align: right; }

  .empty { padding: 32px; text-align: center; color: var(--vscode-descriptionForeground); }
  .error { padding: 12px; color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground)); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 3px; margin-bottom: 12px; }
  .loading { padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 8px; }

  [hidden] { display: none !important; }
  .seg { display: inline-flex; }
  .seg button { border-radius: 0; }
  .seg button:first-child { border-radius: 3px 0 0 3px; }
  .seg button:last-child { border-radius: 0 3px 3px 0; }
  .seg button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .cal-range { font-variant-numeric: tabular-nums; min-width: 220px; padding: 0 8px; text-align: center; }
  .cal { position: relative; font-size: 0.9em; }
  .cal-row { display: grid; grid-template-columns: 220px 1fr; align-items: center; min-height: 22px; border-bottom: 1px solid var(--vscode-editorGroup-border); }
  .cal-row.head { position: sticky; top: 0; z-index: 2; background: var(--vscode-editor-background); min-height: 26px; }
  .cal-name { padding: 2px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
  .cal-name:hover { text-decoration: underline; }
  .cal-row.inactive .cal-name { color: var(--vscode-descriptionForeground); }
  .track { position: relative; height: 22px; }
  .head .track { height: 26px; }
  .tick { position: absolute; top: 0; bottom: 0; border-left: 1px solid var(--vscode-editorGroup-border); }
  .tick span { position: absolute; top: 5px; left: 3px; color: var(--vscode-descriptionForeground); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .now { position: absolute; top: 0; bottom: 0; border-left: 2px solid var(--vscode-editorError-foreground, #f14c4c); z-index: 1; pointer-events: none; }
  .bar { position: absolute; top: 5px; height: 12px; min-width: 2px; border-radius: 2px; }
  .bar.run { background: var(--vscode-charts-blue, #3794ff); }
  .bar.open { background: repeating-linear-gradient(45deg, var(--vscode-charts-blue, #3794ff) 0 4px, transparent 4px 8px); border: 1px solid var(--vscode-charts-blue, #3794ff); }
  .bar.plan { top: 7px; height: 8px; background: transparent; border: 1px solid var(--vscode-descriptionForeground); }
  .bar.band { top: 9px; height: 4px; background: var(--vscode-descriptionForeground); opacity: 0.5; border: 0; }
  .bar.overlap { background: var(--vscode-charts-orange, #d18616); border-color: var(--vscode-charts-orange, #d18616); }
  .legend { display: flex; gap: 16px; align-items: center; color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 8px; flex-wrap: wrap; }
  .legend .bar { position: static; display: inline-block; width: 18px; vertical-align: middle; margin-right: 4px; }
`;

  const body = `
<div class="header">
  <h2>${vscode.l10n.t('Chore Overview')}</h2>
  <span class="server">Server: ${esc(serverLabel)}</span>
  <span class="spacer"></span>
  <button id="btn-refresh" class="primary">⟳ ${vscode.l10n.t('Refresh')}</button>
</div>

<div id="error-box"></div>
<div id="loading" class="loading" style="display:none;">${vscode.l10n.t('Loading chores…')}</div>

<div class="controls">
  <span class="seg"><button id="view-table" class="on">${vscode.l10n.t('Table')}</button><button id="view-cal">${vscode.l10n.t('Calendar')}</button></span>
  <input id="filter" type="text" placeholder="${vscode.l10n.t('Filter (name)…')}" />
  <span id="cal-controls" hidden>
    <span class="seg"><button id="span-day" class="on">${vscode.l10n.t('Day')}</button><button id="span-week">${vscode.l10n.t('Week')}</button></span>
    <button id="cal-prev">◀</button><span id="cal-range" class="cal-range"></span><button id="cal-next">▶</button>
    <button id="cal-today">${vscode.l10n.t('Today')}</button>
    <label><input id="cal-active" type="checkbox" checked /> ${vscode.l10n.t('Active only')}</label>
  </span>
  <span class="spacer" style="flex:1"></span>
  <span id="row-count" style="color:var(--vscode-descriptionForeground); font-size:0.9em;"></span>
</div>

<div id="table-view">
<div class="table-wrap">
  <table id="chore-table" data-resizable>
    <thead><tr id="th-row"></tr></thead>
    <tbody id="chore-body"></tbody>
  </table>
</div>
<div id="empty-msg" class="empty" style="display:none;">${vscode.l10n.t('No chores found on server.')}</div>
<div class="hint">${vscode.l10n.t('Click a row to open the chore in the editor. Hover a column header to see where its values come from.')}</div>
</div>
<div id="cal-view" hidden>
  <div id="cal" class="cal"></div>
  <div class="legend">
    <span><span class="bar run"></span>${vscode.l10n.t('Run (message log)')}</span>
    <span><span class="bar open"></span>${vscode.l10n.t('Running or end not logged')}</span>
    <span><span class="bar plan"></span>${vscode.l10n.t('Scheduled (width = last duration)')}</span>
    <span><span class="bar overlap"></span>${vscode.l10n.t('Overlaps another chore')}</span>
  </div>
  <div class="hint">${vscode.l10n.t('Local time. Scheduled starts ignore daylight-saving sensitivity. Runs reach back only as far as the message log.')}</div>
</div>
`;

  const L: ChoreOverviewBootstrap['texts'] = {
    active: vscode.l10n.t('Active'),
    name: vscode.l10n.t('Name'),
    status: vscode.l10n.t('Status'),
    start: vscode.l10n.t('Start'),
    frequency: vscode.l10n.t('Frequency'),
    nextRun: vscode.l10n.t('Next run'),
    mode: vscode.l10n.t('Mode'),
    lastRun: vscode.l10n.t('Last run'),
    duration: vscode.l10n.t('Duration'),
    lastState: vscode.l10n.t('Last run state'),
    inactive: vscode.l10n.t('Inactive'),
    chores: vscode.l10n.t('chores'),
    // Column tooltips. The two time columns sit side by side but come from
    // different places, which is exactly what needs saying on hover.
    tipSchedule: vscode.l10n.t('From the chore definition. All times are shown in your local time zone; the chore editor shows the start time in UTC, the way TM1 stores it.'),
    tipNextRun: vscode.l10n.t('Computed from start time and frequency — TM1 stores no next-run field and never advances the start time.'),
    tipLog: vscode.l10n.t('From the server message log, not from a control cube.'),
    tipState: vscode.l10n.t('Whether the last run has ended. TM1 does not log whether it succeeded.'),
    scheduled: vscode.l10n.t('scheduled'),
    ran: vscode.l10n.t('ran'),
    noEnd: vscode.l10n.t('no end logged'),
    every: vscode.l10n.t('every {0}'),
    noChoresInView: vscode.l10n.t('No chores to show.'),
  };

  return renderWebviewShell({
    cspSource,
    css: css + COLUMN_RESIZE_CSS,
    body,
    globals: { __choreOverview: { texts: L } satisfies ChoreOverviewBootstrap },
    scriptUris: [scriptUri],
    // Column width via drag (webviews/columnResize.ts) runs after the bundle.
    inlineScript: columnResizeScript('choreOverview', savedColumnWidths('choreOverview')),
  });
}

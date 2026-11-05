// src/webviews/feederAuditBodyPure.ts
//
// Markup and style of the overfeeding window. Pure template literals, no
// imports — the labels come in as an l10n object.
//
// CAUTION template literal: no single backtick in comments inside
// these constants, it ends the literal (TS1005 far behind the spot).

export interface FeederAuditL10n {
  heading: string;
  what: string;
  cost: string;
  cacheLabel: string;
  cacheHint: string;
  caveatCost: string;
  caveatUndocumented: string;
  scope: string;
  hits: string;
  noHits: string;
  noHitsHint: string;
  capped: string;
  rangeFrom: string;
  rangeTo: string;
  rangeBad: string;
  next: string;
  dropped: string;
  colNr: string;
  openCell: string;
  feederHeading: string;
  feederNone: string;
  feederUnsure: string;
  feederSearching: string;
  feederFailed: string;
  openRule: string;
  line: string;
  running: string;
  failed: string;
  rerun: string;
  details: string;
}

export const FEEDER_AUDIT_CSS = `
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
    margin: 0; padding: 16px 20px 32px;
  }
  h1 { font-size: 1.25em; margin: 0 0 4px; font-weight: 600; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 16px; }
  .explain {
    border-left: 3px solid var(--vscode-textLink-foreground);
    background: var(--vscode-textBlockQuote-background);
    padding: 10px 14px; margin: 0 0 12px; border-radius: 0 3px 3px 0;
  }
  .explain p { margin: 0 0 8px; }
  .explain p:last-child { margin-bottom: 0; }
  details.caveats { margin: 0 0 14px; }
  details.caveats > summary {
    cursor: pointer; color: var(--vscode-descriptionForeground);
    padding: 4px 0; user-select: none;
  }
  details.caveats ul { margin: 6px 0 0; padding-left: 20px; }
  details.caveats li { margin: 0 0 6px; line-height: 1.45; }
  .status { margin: 0 0 12px; }
  .status.err { color: var(--vscode-errorForeground); }
  .count { font-weight: 600; }
  .gekappt { color: var(--vscode-editorWarning-foreground); }
  table { border-collapse: collapse; width: 100%; }
  th, td {
    text-align: left; padding: 5px 10px 5px 0; vertical-align: top;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; white-space: nowrap; }
  td.nr { color: var(--vscode-descriptionForeground); width: 3em; }
  tr.zelle { cursor: pointer; }
  tr.zelle:hover { background: var(--vscode-list-hoverBackground); }
  tr.zelle.offen { background: var(--vscode-list-inactiveSelectionBackground); }
  td.coord { font-family: var(--vscode-editor-font-family); word-break: break-word; }
  tr.feeder td { border-bottom: none; padding-top: 0; }
  .feeder-box { margin: 2px 0 10px 1em; }
  .feeder-head { color: var(--vscode-descriptionForeground); margin: 0 0 4px; }
  .feeder-head.err { color: var(--vscode-errorForeground); }
  .feeder-item {
    display: flex; gap: 8px; align-items: baseline;
    padding: 2px 0; cursor: pointer;
  }
  .feeder-item:hover { background: var(--vscode-list-hoverBackground); }
  .feeder-line {
    color: var(--vscode-textLink-foreground); white-space: nowrap;
    font-family: var(--vscode-editor-font-family);
  }
  .feeder-text {
    font-family: var(--vscode-editor-font-family); word-break: break-word;
  }
  .feeder-item.unsure .feeder-text { color: var(--vscode-descriptionForeground); }
  .wrap { overflow-x: auto; }
  .empty { color: var(--vscode-descriptionForeground); padding: 12px 0; }
  button {
    font: inherit; color: var(--vscode-button-foreground);
    background: var(--vscode-button-background); border: none;
    padding: 5px 12px; border-radius: 2px; cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .controls {
    display: flex; gap: 8px; align-items: baseline;
    flex-wrap: wrap; margin: 4px 0 10px;
  }
  .controls input {
    font: inherit; width: 8em;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    padding: 4px 6px; border-radius: 2px;
  }
  .controls label { color: var(--vscode-descriptionForeground); }
  .controls label.check {
    display: flex; gap: 5px; align-items: center; cursor: pointer;
  }
  p.err { color: var(--vscode-errorForeground); margin: 0 0 10px; }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  [hidden] { display: none !important; }
`;

/** Static markup; everything variable is filled by the inline script. */
export function feederAuditBody(l: FeederAuditL10n): string {
  return `
  <h1>${l.heading}</h1>
  <p class="sub" id="scope"></p>

  <div class="explain">
    <p>${l.what}</p>
    <p>${l.cost}</p>
  </div>

  <details class="caveats">
    <summary>${l.details}</summary>
    <ul>
      <li>${l.caveatUndocumented}</li>
      <li>${l.caveatCost}</li>
    </ul>
  </details>

  <div class="controls" id="controls" hidden>
    <label for="von">${l.rangeFrom}</label>
    <input id="von" type="number" min="1" max="100000000" step="1000">
    <label for="bis">${l.rangeTo}</label>
    <input id="bis" type="number" min="2" max="100000000" step="1000">
    <button id="rerun">${l.rerun}</button>
    <button id="weiter" class="secondary">${l.next}</button>
    <label class="check" title="${l.cacheHint}"><input id="cache" type="checkbox">${l.cacheLabel}</label>
  </div>
  <p class="err" id="bereichFehler" hidden>${l.rangeBad}</p>

  <p class="status" id="status">${l.running}</p>

  <div class="wrap">
    <table id="tbl" data-resizable hidden>
      <thead><tr id="head"></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <p class="empty" id="empty" hidden></p>
`;
}

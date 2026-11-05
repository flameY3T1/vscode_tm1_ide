// src/webviews/processGroupingBody.ts
// Static markup + CSS for the process-grouping panel. All text comes from the
// resolved l10n map (see processGroupingL10n.ts) so the body is already
// translated when it reaches the sandbox; the client only fills the dynamic
// parts (server name, preview, errors).

import type { L10nMap } from '../webviewClient/_shared/l10n';

export const PROCESS_GROUPING_CSS = [
  'body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); padding: 14px 18px 24px; }',
  'h2 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }',
  '.intro { color: var(--vscode-descriptionForeground); margin: 0 0 16px; line-height: 1.5; }',
  '.sec { margin-bottom: 16px; }',
  '.sec-h { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; }',
  '.modes { display: flex; flex-wrap: wrap; gap: 6px; }',
  '.mode { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 4px 10px; cursor: pointer; }',
  '.mode.on { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }',
  '.hint { color: var(--vscode-descriptionForeground); margin-top: 6px; line-height: 1.4; }',
  'input.txt { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; padding: 4px 6px; font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; height: 26px; width: 260px; box-sizing: border-box; }',
  'input.txt:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }',
  '.syntax { margin-top: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 8px 10px; }',
  '.syntax table { border-collapse: collapse; }',
  '.syntax td, .syntax th { padding: 1px 12px 1px 0; vertical-align: top; text-align: left; }',
  '.syntax th { font-weight: 600; font-size: 11px; color: var(--vscode-descriptionForeground); }',
  '.syntax td.k { font-family: var(--vscode-editor-font-family, monospace); }',
  '.syntax td.d { color: var(--vscode-descriptionForeground); }',
  '.syntax td.x { font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); }',
  // `pre-line`, because the examples come as multi-line plain texts from the l10n bundle
  // — as markup they could not be translated without shipping HTML along.
  '.demo { margin-top: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 8px 10px; }',
  '.demo pre { margin: 4px 0 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; color: var(--vscode-descriptionForeground); }',
  '.pitfalls { margin-top: 8px; }',
  '.pitfalls ul { margin: 4px 0 0; padding-left: 18px; }',
  '.pitfalls li { color: var(--vscode-descriptionForeground); line-height: 1.45; margin-bottom: 2px; }',
  '.err { color: var(--vscode-errorForeground); margin-top: 6px; min-height: 16px; }',
  '.pv { border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 8px 10px; max-height: 340px; overflow: auto; }',
  '.pv-empty { color: var(--vscode-descriptionForeground); }',
  '.grp { margin-bottom: 6px; }',
  '.grp-h { font-weight: 600; font-family: var(--vscode-editor-font-family, monospace); }',
  '.grp-h.none { font-family: var(--vscode-font-family); font-weight: 400; color: var(--vscode-descriptionForeground); }',
  '.grp-c { color: var(--vscode-descriptionForeground); margin-left: 6px; font-size: 12px; }',
  '.grp-kids { margin: 2px 0 0 14px; color: var(--vscode-descriptionForeground); font-size: 12px; display: flex; flex-direction: column; }',
  '.sum { color: var(--vscode-descriptionForeground); margin-top: 6px; }',
  '.actions { display: flex; gap: 8px; margin-top: 18px; }',
  'button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 4px 14px; font-size: 13px; height: 26px; cursor: pointer; font-family: inherit; }',
  'button:hover { background: var(--vscode-button-hoverBackground); }',
  'button.sec-btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }',
  'button.sec-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }',
  '.hidden { display: none; }',
].join('\n');

/** Static body markup; `l10n` supplies every visible string. */
export function processGroupingBody(l10n: L10nMap): string {
  const mode = (id: string, key: string): string =>
    `<label class="mode" data-mode="${id}"><input type="radio" name="pgmode" value="${id}">${l10n[key]}</label>`;
  const syn = (k: string, desc: string, ex: string): string =>
    `<tr><td class="k">${k}</td><td class="d">${l10n[desc]}</td><td class="x">${l10n[ex]}</td></tr>`;
  return [
    '<h2 id="hd"></h2>',
    `<p class="intro">${l10n.intro}</p>`,

    '<div class="sec">',
    `<span class="sec-h">${l10n.modeHead}</span>`,
    '<div class="modes">',
    mode('patternPrefix', 'modePatternPrefix'),
    mode('patternSuffix', 'modePatternSuffix'),
    mode('prefix', 'modePrefix'),
    mode('suffix', 'modeSuffix'),
    '</div>',
    '<div class="hint" id="hint"></div>',
    '</div>',

    '<div class="sec">',
    '<span class="sec-h" id="tokLbl"></span>',
    '<input class="txt" id="tok" spellcheck="false" autocomplete="off">',
    '<div class="syntax hidden" id="syntax">',
    `<div class="sec-h">${l10n.syntaxHead}</div>`,
    '<table>',
    `<tr><th></th><th>${l10n.synColMeaning}</th><th>${l10n.synColExample}</th></tr>`,
    syn('{n}', 'synN', 'synNEx'),
    syn('{n:3}', 'synN3', 'synN3Ex'),
    syn('{a}', 'synA', 'synAEx'),
    syn('{*}', 'synStar', 'synStarEx'),
    syn('{{', 'synBrace', 'synBraceEx'),
    '</table>',
    '</div>',
    // Example and pitfalls change with the mode — the client fills both
    // (`webviewClient/processGrouping/index.ts#selectMode`), because only
    // there is it known which mode is chosen.
    '<div class="demo">',
    `<span class="sec-h">${l10n.exampleHead}</span>`,
    '<pre id="demo"></pre>',
    '</div>',
    '<div class="pitfalls">',
    `<span class="sec-h">${l10n.pitfallHead}</span>`,
    '<ul id="pitfalls"></ul>',
    '</div>',
    '<div class="err" id="err"></div>',
    '</div>',

    '<div class="sec">',
    `<span class="sec-h">${l10n.previewHead}</span>`,
    '<div class="pv" id="pv"></div>',
    '<div class="sum" id="sum"></div>',
    '</div>',

    '<div class="actions">',
    `<button id="save">${l10n.save}</button>`,
    `<button id="reset" class="sec-btn">${l10n.reset}</button>`,
    '</div>',
  ].join('\n');
}

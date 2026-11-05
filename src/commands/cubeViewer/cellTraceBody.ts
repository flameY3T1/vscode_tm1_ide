// src/commands/cubeViewer/cellTraceBody.ts
import type { L10nMap } from '../../webviewClient/_shared/l10n';

/**
 * Toolbar + content shell for the cell-trace panel. The toolbar follows the
 * house layout of the analysis panels (title · tabs · spacer · actions). One
 * panel serves one cell, and the three tabs are the three questions you can ask
 * about it: how is it calculated, what does it feed, is it fed properly.
 */
export function buildCellTraceBody(l10n: L10nMap): string {
  return `
  <div class="toolbar">
    <span class="title" id="trace-title"></span>
    <button class="tab" id="tab-rule" data-kind="rule" title="${l10n.traceTabRuleHint}">${l10n.traceTabRule}</button>
    <button class="tab" id="tab-feeders" data-kind="feeders" title="${l10n.traceTabFeedersHint}">${l10n.traceTabFeeders}</button>
    <button class="tab" id="tab-check" data-kind="check" title="${l10n.traceTabCheckHint}">${l10n.traceTabCheck}</button>
    <span id="trace-spinner">${l10n.traceLoading}</span>
    <span class="spacer"></span>
    <label class="trace-zero" id="trace-zero-wrap"><input type="checkbox" id="trace-zero-toggle"> ${l10n.traceZeroToggle}</label>
    <button class="act" id="trace-expand">${l10n.traceExpandAll}</button>
    <button class="act" id="trace-collapse">${l10n.traceCollapseAll}</button>
  </div>
  <div id="trace-subtitle"></div>
  <div id="trace-content"></div>`;
}

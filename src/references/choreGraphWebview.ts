import * as vscode from 'vscode';
import type { ChoreGraph, ChoreTaskTree } from './choreGraph';
import type { EffectiveValue } from './callGraph';
import { flattenCallGraph } from './callGraph';
import { renderWebviewShell } from '../webviews/webviewShell';
import { makeIconRenderer, NO_ICONS, ICON_THEME_CSS, type IconRenderer } from '../webviews/webviewIcons';
import { escapeHtml as esc } from '../utils/escapeHtml';

function sectionLabel(s: string): string {
  switch (s) {
    case 'prolog':   return 'Prolog';
    case 'metadata': return 'Metadata';
    case 'data':     return 'Data';
    case 'epilog':   return 'Epilog';
    default:         return s;
  }
}

function renderEffective(eff: EffectiveValue, valueRaw: string): string {
  switch (eff.kind) {
    case 'literal': {
      const wasQuoted = valueRaw.trim().startsWith("'");
      const txt = wasQuoted ? `'${eff.value}'` : eff.value;
      return `<span class="val-literal">${esc(txt)}</span>`;
    }
    case 'unknown': return `<span class="val-unknown" title="${vscode.l10n.t('Value depends on a parameter of the root process')}">«${esc(eff.viaParam)}»</span>`;
    case 'dynamic': return `<span class="val-dynamic" title="${vscode.l10n.t('Dynamic (CellGet, concatenation, loop, …)')}">?</span>`;
  }
}

function renderChoreParams(task: ChoreTaskTree): string {
  if (task.choreParams.length === 0) { return ''; }
  const parts = task.choreParams.map(p => {
    const disp = p.type === 'string' ? `'${p.value}'` : p.value;
    return `${esc(p.name)}=<span class="val-literal">${esc(disp)}</span>`;
  });
  return `<span class="params">${parts.join(', ')}</span>`;
}

function renderTaskBlock(task: ChoreTaskTree, icon: IconRenderer): string {
  const flat = flattenCallGraph(task.tree);
  const rows: string[] = [];
  for (const { node, depth } of flat) {
    const indent = depth * 20;
    const proc = esc(node.process);
    const cycleBadge = node.cycle ? `<span class="badge cycle" title="${vscode.l10n.t('Cycle — expansion stopped here')}">↻ ${vscode.l10n.t('Cycle')}</span>` : '';
    const depthBadge = node.depthLimitReached ? `<span class="badge depth" title="${vscode.l10n.t('Maximum depth reached — deeper levels omitted')}">⋯ ${vscode.l10n.t('more')}</span>` : '';

    if (depth === 0) {
      // Root task row analogous to the process graph root: `#N ● ProcessName pX='…'`
      rows.push(`<div class="row root" data-proc="${proc}" style="padding-left:${indent}px">
        <span class="step">#${task.step + 1}</span><span class="icon">${icon('process')}</span>
        <span class="proc" data-action="open">${proc}</span>${renderChoreParams(task)}${depthBadge}
      </div>`);
      continue;
    }

    const edge = node.incomingEdge!;
    const meta = `<span class="meta">${sectionLabel(edge.section)}:${edge.line + 1} · ${esc(edge.funcName)}</span>`;
    const params = edge.effectiveParams && edge.effectiveParams.length
      ? `<span class="params">${edge.effectiveParams.map(ep => `${esc(ep.name)}=${renderEffective(ep.effective, ep.valueRaw)}`).join(', ')}</span>`
      : '';

    rows.push(`<div class="row" data-proc="${proc}" style="padding-left:${indent}px">
      <span class="connector">└</span><span class="icon">${icon('process')}</span>
      <span class="proc" data-action="open">${proc}</span>
      ${meta}${params}${cycleBadge}${depthBadge}
    </div>`);
  }
  return rows.join('\n');
}

export function getChoreGraphHtml(
  graph: ChoreGraph,
  /** Panel handle + extension root for the tree's SVG icons; omitted in tests. */
  opts?: { webview: vscode.Webview; extensionUri: vscode.Uri; mapTab?: string },
): string {
  const icon = opts ? makeIconRenderer(opts.webview, opts.extensionUri) : NO_ICONS;
  const body = graph.tasks.length === 0
    ? `<div class="empty">${vscode.l10n.t('This chore contains no tasks.')}</div>`
    : graph.tasks.map(t => renderTaskBlock(t, icon)).join('\n<div class="spacer"></div>\n');

  const css = `
  ${ICON_THEME_CSS}
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
         color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; }
  .header { position: sticky; top: 0; background: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border); z-index: 10; }
  /* Same toolbar shape as the call-graph and analysis panels. */
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 12px; }
  .toolbar .title { font-weight: 600; font-size: 13px; margin-right: 8px; }
  .toolbar .count { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .tree { padding: 8px 16px 16px 16px; }
  .row { display: flex; align-items: baseline; gap: 6px; padding: 2px 4px; border-radius: 3px;
         line-height: 1.5; white-space: nowrap; overflow-x: auto; }
  .row:hover { background: var(--vscode-list-hoverBackground); }
  .row.root .proc { font-weight: 600; }
  .row.root .step { color: var(--vscode-descriptionForeground); font-family: monospace; margin-right: 4px; font-weight: 600; }
  .connector { color: var(--vscode-descriptionForeground); font-family: monospace; }
  .icon { display: inline-flex; align-items: center; align-self: center; }
  .proc { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .proc:hover { text-decoration: underline; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .params { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  .val-literal { color: var(--vscode-charts-green, #89D185); }
  .val-unknown { color: var(--vscode-charts-blue, #75beff); font-style: italic; }
  .val-dynamic { color: var(--vscode-charts-orange, #e8ab53); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.8em; margin-left: 6px; }
  .badge.cycle { background: var(--vscode-inputValidation-warningBackground);
                 color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
                 border: 1px solid var(--vscode-inputValidation-warningBorder); }
  .badge.depth { background: var(--vscode-editorWidget-background); color: var(--vscode-descriptionForeground); }
  .spacer { height: 8px; }
  .empty { color: var(--vscode-descriptionForeground); padding: 16px; font-style: italic; }
  .maptab { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; border-bottom: 2px solid transparent;
            padding: 4px 12px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; }
  .maptab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  /* With the Lineage tab next to it, the title reads as the active tab — same underline as there. */
  .title.tabbed { font-size: 12px; padding: 4px 12px; margin-right: 0; border: 1px solid transparent; border-bottom: 2px solid var(--vscode-focusBorder); }
`;

  const bodyHtml = `<div class="header">
  <div class="toolbar">
    <span class="title${opts?.mapTab ? ' tabbed' : ''}">${vscode.l10n.t('Chore')}: ${esc(graph.choreName)}</span>
  ${opts?.mapTab ? `<button class="maptab" data-map-tab title="${vscode.l10n.t('Dependencies and data flow around this object')}">${esc(opts.mapTab)}</button>` : ''}
    <span class="count">${vscode.l10n.t('{0} tasks', String(graph.tasks.length))}</span>
  </div>
</div>
<div class="tree">${body}</div>`;


  return renderWebviewShell({
    cspSource: opts?.webview.cspSource ?? '', css, body: bodyHtml, 
    scriptUris: opts ? [String(opts.webview.asWebviewUri(vscode.Uri.joinPath(opts.extensionUri, 'out', 'webview', 'choreGraph.js')))] : [],
  });
}

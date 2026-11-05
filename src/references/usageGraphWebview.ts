import * as vscode from 'vscode';
import { UsageRef } from './callGraph';
import { renderWebviewShell } from '../webviews/webviewShell';
import { makeIconRenderer, NO_ICONS, ICON_THEME_CSS, type IconRenderer } from '../webviews/webviewIcons';
import { escapeHtml as esc } from '../utils/escapeHtml';

function sectionLabel(s: string): string {
  switch (s) {
    case 'prolog':   return 'Prolog';
    case 'metadata': return 'Metadata';
    case 'data':     return 'Data';
    case 'epilog':   return 'Epilog';
    case 'rules':    return 'Rules';
    case 'feeders':  return 'Feeders';
    case 'subset':   return 'Subset';
    case 'view':     return 'MDX-View';
    default:         return s;
  }
}

function kindLabel(kind: 'cube' | 'dimension'): string {
  return kind === 'cube' ? vscode.l10n.t('Cube') : vscode.l10n.t('Dimension');
}

interface Group {
  sourceKind: 'process' | 'rule' | 'subset' | 'view';
  sourceName: string;
  refs: UsageRef[];
}

function groupBySource(refs: UsageRef[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of refs) {
    const key = `${r.sourceKind}:${r.sourceName.toLowerCase()}`;
    let g = map.get(key);
    if (!g) { g = { sourceKind: r.sourceKind, sourceName: r.sourceName, refs: [] }; map.set(key, g); }
    g.refs.push(r);
  }
  const order: Record<Group['sourceKind'], number> = { process: 0, rule: 1, subset: 2, view: 3 };
  return Array.from(map.values()).sort((a, b) =>
    (order[a.sourceKind] - order[b.sourceKind]) || a.sourceName.localeCompare(b.sourceName));
}

function renderGroup(g: Group, icon: IconRenderer): string {
  // Same icons as the object explorer, so a row is recognizable at a glance.
  const iconMap: Record<Group['sourceKind'], string> = {
    process: 'process', rule: 'cube-rule', subset: 'subset', view: 'cube-view',
  };
  const titleMap: Record<Group['sourceKind'], string> = {
    process: vscode.l10n.t('Process'), rule: vscode.l10n.t('Rule cube'),
    subset: vscode.l10n.t('Subset'), view: vscode.l10n.t('MDX view'),
  };
  const iconGlyph = icon(iconMap[g.sourceKind]);
  const sourceAttr = esc(g.sourceName);
  const kindAttr = g.sourceKind;
  const countLabel = vscode.l10n.t('{0} hits', String(g.refs.length));
  const rows = g.refs.map(r => {
    const structural = g.sourceKind === 'subset' || g.sourceKind === 'view';
    const meta = structural
      ? sectionLabel(r.section)
      : `${sectionLabel(r.section)} · ${vscode.l10n.t('Line {0}', String(r.line + 1))}${r.funcName ? ` · ${esc(r.funcName)}` : ''}`;
    const snippet = r.snippet ? `<div class="snippet">${esc(r.snippet)}</div>` : '';
    return `<div class="ref" data-source="${sourceAttr}" data-kind="${kindAttr}">
      <div class="ref-meta">${meta}</div>
      ${snippet}
    </div>`;
  }).join('');
  return `<div class="group collapsed" data-source="${sourceAttr}" data-kind="${kindAttr}">
    <div class="group-header" data-action="toggle">
      <span class="caret"></span>
      <span class="source-icon" title="${titleMap[g.sourceKind]}">${iconGlyph}</span>
      <span class="source-name" data-action="open" title="${vscode.l10n.t('Open')}">${esc(g.sourceName)}</span>
      <span class="count">${countLabel}</span>
    </div>
    <div class="group-body">${rows}</div>
  </div>`;
}

export function getUsageGraphHtml(
  targetKind: 'cube' | 'dimension',
  targetName: string,
  refs: UsageRef[],
  /** Panel handle + extension root for the tree's SVG icons; omitted in tests. */
  opts?: { webview: vscode.Webview; extensionUri: vscode.Uri; mapTab?: string },
): string {
  const icon = opts ? makeIconRenderer(opts.webview, opts.extensionUri) : NO_ICONS;
  const groups = groupBySource(refs);
  const count = (k: Group['sourceKind']) => groups.filter(g => g.sourceKind === k).length;
  const procCount = count('process'), ruleCount = count('rule');
  const subsetCount = count('subset'), viewCount = count('view');
  const total = refs.length;

  const bodyHtml = groups.length === 0
    ? `<div class="empty">${vscode.l10n.t('No usages of {0} "{1}" found.', kindLabel(targetKind), esc(targetName))}</div>`
    : groups.map(g => renderGroup(g, icon)).join('');

  const summary = total === 0
    ? vscode.l10n.t('{0} hits', '0')
    : `${vscode.l10n.t('{0} hits', String(total))} · ${vscode.l10n.t('{0} processes', String(procCount))}`
      + ` · ${vscode.l10n.t('{0} rule cubes', String(ruleCount))} · ${vscode.l10n.t('{0} subsets', String(subsetCount))}`
      + ` · ${vscode.l10n.t('{0} views', String(viewCount))}`;

  const css = `
  ${ICON_THEME_CSS}
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0; margin: 0;
  }
  /* Same toolbar shape as the call-graph and analysis panels. */
  .header {
    position: sticky; top: 0; z-index: 10;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 12px; }
  .toolbar .title { font-weight: 600; font-size: 13px; margin-right: 8px; }
  .toolbar .summary { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .toolbar .spacer { flex: 1; }
  .toolbar input {
    width: 260px; padding: 3px 6px; font-size: 12px; border-radius: 2px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  }
  .toolbar input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  .list { padding: 8px 16px 16px 16px; }
  .group { margin-bottom: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 3px; overflow: hidden; }
  .group-header {
    padding: 6px 10px; display: flex; align-items: center; gap: 8px;
    background: var(--vscode-sideBar-background); cursor: pointer; user-select: none;
  }
  .group-header:hover { background: var(--vscode-list-hoverBackground); }
  .group.collapsed .group-body { display: none; }
  .caret::before { content: '▾'; }
  .group.collapsed .caret::before { content: '▸'; }
  .caret { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .source-icon { display: inline-flex; align-items: center; }
  .source-name { color: var(--vscode-textLink-foreground); cursor: pointer; font-weight: 600; }
  .source-name:hover { text-decoration: underline; }
  .count { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: auto; }
  .group-body { padding: 0; }
  .ref { padding: 6px 12px 6px 36px; border-top: 1px solid var(--vscode-panel-border); }
  .ref-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
  .snippet {
    font-family: var(--vscode-editor-font-family); font-size: 0.9em;
    white-space: pre-wrap; margin-top: 2px; color: var(--vscode-editor-foreground);
  }
  .empty { color: var(--vscode-descriptionForeground); padding: 16px; font-style: italic; }
  .hidden { display: none !important; }
  .maptab { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; border-bottom: 2px solid transparent;
            padding: 4px 12px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; }
  .maptab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  /* With the Lineage tab next to it, the title reads as the active tab — same underline as there. */
  .title.tabbed { font-size: 12px; padding: 4px 12px; margin-right: 0; border: 1px solid transparent; border-bottom: 2px solid var(--vscode-focusBorder); }
`;

  const body = `<div class="header">
  <div class="toolbar">
    <span class="title${opts?.mapTab ? ' tabbed' : ''}">${vscode.l10n.t('Used by')}: ${kindLabel(targetKind)} ${esc(targetName)}</span>
  ${opts?.mapTab ? `<button class="maptab" data-map-tab title="${vscode.l10n.t('Dependencies and data flow around this object')}">${esc(opts.mapTab)}</button>` : ''}
    <span class="summary">${summary}</span>
    <span class="spacer"></span>
    <input type="text" id="filter" placeholder="${vscode.l10n.t('Filter (source / section / snippet)…')}" />
  </div>
</div>
<div class="list" id="list">${bodyHtml}</div>`;


  return renderWebviewShell({
    cspSource: opts?.webview.cspSource ?? '', css, body, 
    scriptUris: opts ? [String(opts.webview.asWebviewUri(vscode.Uri.joinPath(opts.extensionUri, 'out', 'webview', 'usageGraph.js')))] : [],
  });
}

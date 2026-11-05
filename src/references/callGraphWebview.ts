import * as vscode from 'vscode';
import { CallGraphNode, Direction, EffectiveValue, flattenCallGraph } from './callGraph';
import { CallParam } from './referenceTypes';
import type { OverlayNode, EdgeTiming } from './runOverlayPure';
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

function renderResolutionFallback(p: CallParam): string {
  switch (p.resolution.kind) {
    case 'literal': {
      const wasQuoted = p.valueRaw.trim().startsWith("'");
      const txt = wasQuoted ? `'${p.resolution.value}'` : p.resolution.value;
      return `<span class="val-literal">${esc(txt)}</span>`;
    }
    case 'passthrough': return `<span class="val-unknown">«${esc(p.resolution.paramName)}»</span>`;
    case 'dynamic':     return `<span class="val-dynamic">?</span>`;
  }
}

function renderParams(edge: NonNullable<CallGraphNode['incomingEdge']>): string {
  if (edge.effectiveParams && edge.effectiveParams.length > 0) {
    return edge.effectiveParams
      .map(ep => `${esc(ep.name)}=${renderEffective(ep.effective, ep.valueRaw)}`)
      .join(', ');
  }
  if (edge.params.length > 0) {
    return edge.params.map(p => `${esc(p.name)}=${renderResolutionFallback(p)}`).join(', ');
  }
  return '';
}

function renderRootEffective(eff: EffectiveValue): string {
  switch (eff.kind) {
    case 'literal': return `<span class="val-literal">${esc(eff.value)}</span>`;
    case 'unknown': return `<span class="val-unknown">«${esc(eff.viaParam)}»</span>`;
    case 'dynamic': return `<span class="val-dynamic">?</span>`;
  }
}

function renderRootParams(env: Map<string, EffectiveValue> | undefined): string {
  if (!env || env.size === 0) { return ''; }
  const parts: string[] = [];
  for (const [lcKey, v] of env) {
    const name = v.kind === 'unknown' ? v.viaParam : lcKey;
    parts.push(`${esc(name)}=${renderRootEffective(v)}`);
  }
  return `<span class="params">${parts.join(', ')}</span>`;
}

/**
 * What the expand field shows per run.
 *
 * Deliberately not imported from `runSource` here: the webview should not
 * depend on the data source — `runSource.RunHead` is structurally compatible.
 */
export interface RunOption {
  startedAt: string;
  elapsedSec: number | null;
  status: 'ok' | 'error' | 'running';
}

/** Sekunden deutsch-lesbar, zwei Nachkommastellen wie im TM1-Log. */
function secs(n: number): string { return n.toFixed(2).replace('.', ','); }

/** The number columns of a row. `null` means: did not run in this run. */
function renderTiming(t: EdgeTiming | null, isRoot: boolean): string {
  const wrap = (content: string): string => `<span class="cg-cols">${content}</span>`;

  if (!t) {
    return wrap(`<span class="cg-time cg-never" title="${vscode.l10n.t('not in this run')}">—</span>`);
  }

  // Asynchronous: count and sum instead of share. The time of the parent
  // process does not include them, a percentage would be far above 100 %. And
  // NO concurrency figure: the log writes only start and end, a thread waiting
  // on a lock appears in it like one that is computing.
  if (t.certainty === 'async') {
    const total = t.elapsedSec !== null ? `${secs(t.elapsedSec)} s` : '—';
    return wrap(
      `<span class="cg-time cg-async" title="${vscode.l10n.t('asynchronous (RunProcess) — matched by time window, not by a log link')}">⇥ ${total}</span>`
      + `<span class="cg-count">${esc(vscode.l10n.t('{0} runs', String(t.count)))}</span>`);
  }

  // The marked caller: no numeric value, but demonstrably the path this run
  // came from. An invented time would be worse here than none.
  if (!isRoot && t.elapsedSec === null && t.occurrences.length === 0 && t.certainty === 'exact') {
    return wrap(`<span class="cg-time cg-origin" title="${vscode.l10n.t('this run was started from here')}">↗</span>`);
  }

  const time = t.elapsedSec !== null ? `${secs(t.elapsedSec)} s` : '—';
  // Bar AND number: the bar makes the shares comparable, the number remains
  // for the exact value.
  const share = t.pctOfRoot !== null
    ? `<span class="cg-bar" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, t.pctOfRoot)).toFixed(0)}%"></i></span>`
      + `<span class="cg-pct">${Math.round(t.pctOfRoot)} %</span>`
    : '<span class="cg-bar" aria-hidden="true"></span><span class="cg-pct"></span>';
  const repeated = t.count > 1
    ? `<span class="cg-count" title="${esc(t.occurrences.map(secs).join(' / '))}">×${t.count}</span>`
    : '';
  const mark = t.certainty === 'ambiguous'
    ? `<span class="cg-warn" title="${vscode.l10n.t('call site not decidable from the log')}">⚠</span>`
    : '';
  const selfTime = isRoot && t.selfSec !== null
    ? `<span class="cg-self">${esc(vscode.l10n.t('self {0} s', secs(t.selfSec)))}</span>`
    : '';
  return wrap(`<span class="cg-time cg-${t.status}">${time}</span>${share}${repeated}${mark}${selfTime}`);
}

/**
 * The expand field of the runs. Empty when there are none.
 *
 * Usable on BOTH tabs: the runs belong to the process in question, not to the
 * viewing direction. On the callers tab the choice shows the process's own
 * runtime and marks the caller the run came from — until 2026-08-26 the field
 * was greyed out there, although for a subprocess without calls of its own
 * the call graph is exactly where it has its only useful information
 * (finding by flameY3T1).
 */
function renderRunSelect(runs: readonly RunOption[], _direction: Direction): string {
  if (!runs.length) { return ''; }
  const opts = [`<option value="">${vscode.l10n.t('— no run —')}</option>`].concat(
    runs.map(r => {
      const d = r.elapsedSec !== null ? ` · ${secs(r.elapsedSec)} s` : '';
      const when = esc(r.startedAt.replace('T', ' ').slice(0, 19));
      return `<option value="${esc(r.startedAt)}">${when}${d} · ${esc(r.status)}</option>`;
    }));
  return `<label class="cg-runs">${vscode.l10n.t('Run:')} `
    + `<select id="run-select">${opts.join('')}</select></label>`;
}

/**
 * Render one node as a nested element. Depth 0 (root) is always open. Depth 1
 * (direct calls) is open by default so the user sees direct relations first.
 * Depth ≥ 2 is collapsed; clicking the chevron expands one level.
 */
function renderNode(node: CallGraphNode, depth: number, icon: IconRenderer, ov?: OverlayNode): string {
  const proc = esc(node.process);
  const isRoot = depth === 0;
  // A chore is not a process: its own symbol, its own action on click.
  const isChore = node.kind === 'chore';
  const nodeIcon = icon(isChore ? 'chore-active' : 'process');
  const hasChildren = node.children.length > 0;
  const openByDefault = depth <= 1;
  const cycleBadge = node.cycle ? `<span class="badge cycle" title="${vscode.l10n.t('Cycle — expansion stopped here')}">↻ ${vscode.l10n.t('Cycle')}</span>` : '';
  const depthBadge = node.depthLimitReached ? `<span class="badge depth" title="${vscode.l10n.t('Maximum depth reached — deeper levels omitted')}">⋯ ${vscode.l10n.t('more')}</span>` : '';

  const time = ov ? renderTiming(ov.timing, isRoot) : '';

  let rowInner: string;
  if (isRoot) {
    const paramsStr = renderRootParams(node.env);
    rowInner = `<span class="icon">${nodeIcon}</span><span class="proc" data-action="open">${proc}</span>${paramsStr}${depthBadge}${time}`;
  } else {
    const edge = node.incomingEdge;
    // For a chore, `line` is the step of the task, not a source line —
    // the label has to say so, otherwise someone goes looking for line 3.
    const meta = edge
      ? (isChore
        ? `<span class="meta">${vscode.l10n.t('Step {0}', String(edge.line + 1))}</span>`
        : `<span class="meta">${sectionLabel(edge.section)}:${edge.line + 1} · ${esc(edge.funcName)}</span>`)
      : '';
    const paramsHtml = edge ? renderParams(edge) : '';
    const params = paramsHtml ? `<span class="params">${paramsHtml}</span>` : '';
    rowInner = `<span class="icon">${nodeIcon}</span><span class="proc" data-action="open">${proc}</span>${meta}${params}${cycleBadge}${depthBadge}${time}`;
  }

  const childCount = node.children.length;
  const chevron = hasChildren
    ? `<span class="chevron" data-action="toggle" title="${vscode.l10n.t('{0} direct', String(childCount))}">▶</span>`
    : `<span class="chevron leaf"></span>`;

  // Pass children through INDEX-ALIGNED: `buildRunOverlay` builds the child list
  // in parallel with the static tree.
  const extraHtml = (ov?.extra ?? []).map(e =>
    `<div class="node cg-extra"><div class="row">`
    + `<span class="chevron leaf"></span>`
    + `<span class="proc">⟨${vscode.l10n.t('only in the log')}⟩ ${esc(e.name)}</span>`
    + renderTiming(e.timing, false)
    + `</div></div>`).join('');
  const childrenHtml = hasChildren || extraHtml
    ? `<div class="children">${node.children.map((c, i) => renderNode(c, depth + 1, icon, ov?.children[i])).join('')}${extraHtml}</div>`
    : '';

  const openAttr = openByDefault ? ' data-open="1"' : '';
  const kindAttr = isChore ? ' data-kind="chore"' : '';
  return `<div class="node" data-proc="${proc}"${kindAttr}${openAttr}>` +
    `<div class="row">${chevron}${rowInner}</div>` +
    childrenHtml +
    `</div>`;
}

export function getCallGraphHtml(
  root: CallGraphNode,
  direction: Direction,
  startProcess: string,
  /** Direct-neighbour counts for BOTH directions, so each tab shows its own
   *  size and the user need not switch just to find out it is empty. */
  counts?: { downstream: number; upstream: number },
  /** Panel handle + extension root, needed to serve the tree's SVG icons.
   *  Omitted in unit tests, which then render without icons. */
  opts?: { webview: vscode.Webview; extensionUri: vscode.Uri; mapTab?: string },
  /** The selectable runs. Empty = no switcher, view as before. */
  runs?: readonly RunOption[],
  /** Die Zeiten des GEWAEHLTEN Laufs. Ohne sie rendert die Ansicht wie bisher. */
  overlay?: OverlayNode,
): string {
  const icon = opts ? makeIconRenderer(opts.webview, opts.extensionUri) : NO_ICONS;
  const treeHtml = renderNode(root, 0, icon, overlay);
  const cnt = flattenCallGraph(root).length - 1; // minus root
  const directCnt = root.children.length;
  const downCnt = counts?.downstream ?? (direction === 'downstream' ? directCnt : 0);
  const upCnt   = counts?.upstream   ?? (direction === 'upstream'   ? directCnt : 0);

  const css = `
  :root {
    --cg-accent: var(--vscode-charts-blue, #3794ff);
  }
  /* ── Laufzeiten ───────────────────────────────────────────────────────
     Feste Spaltenbreiten statt eines rechtsbuendigen Klumpens: nur so stehen
     Zeit unter Zeit und Prozent unter Prozent, auch wenn die Namen daneben
     verschieden lang sind. tabular-nums haelt die Ziffern gleich breit,
     sonst wandert das Komma. Die Gruppe wird EINMAL nach rechts geschoben
     (.cg-cols), die Spalten darin nicht mehr einzeln. */
  .cg-cols {
    /* FIXED width, not a percentage: the tree levels indent by 10px each, so a
       percentage would land a few pixels elsewhere at every depth. With a
       fixed width and margin-left:auto the number group starts at the same
       place on EVERY row -- a vertical line through the tree, roughly the
       right quarter at a usual panel width. */
    flex: 0 0 236px;
    width: 236px;
    margin-left: auto;
    padding-left: 12px;
    display: inline-flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: 10px;
  }
  .cg-time {
    flex: 0 0 64px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .cg-pct {
    flex: 0 0 38px;
    text-align: right;
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
  }
  /* The bar makes the share comparable at a glance -- the number alone has
     to be read row by row. */
  .cg-bar {
    flex: 0 0 46px;
    width: 46px;
    height: 5px;
    border-radius: 3px;
    background: var(--vscode-editorWidget-border, rgba(128,128,128,0.25));
    overflow: hidden;
    align-self: center;
    flex: none;
  }
  .cg-bar > i {
    display: block;
    height: 100%;
    background: var(--cg-accent);
  }
  .cg-count, .cg-self {
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
    flex: 0 0 auto;
  }
  .cg-self { font-style: italic; }
  .cg-never { color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground)); }
  .cg-error { color: var(--vscode-errorForeground); }
  .cg-running { font-style: italic; }
  .cg-warn { cursor: help; color: var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground)); }
  .cg-async { cursor: help; color: var(--vscode-descriptionForeground); }
  .cg-origin { cursor: help; color: var(--cg-accent); font-weight: 600; }
  .cg-extra .proc { font-style: italic; color: var(--vscode-descriptionForeground); }

  /* ── Laufumschalter ──────────────────────────────────────────────────
     Das select-Element erbt sonst die Farben des Browsers und steht in jedem
     dunklen Theme WEISS da. VS Code stellt eigene Tokens dafuer bereit. */
  .cg-runs {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-descriptionForeground);
  }
  .cg-runs select {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
    border-radius: 2px;
    padding: 2px 6px;
    max-width: 280px;
  }
  .cg-runs select:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .cg-runs select:disabled { opacity: 0.5; cursor: not-allowed; }
  /* The operating system draws the option list -- without these two lines it
     stays light on Linux/Windows even when the field is dark. */
  .cg-runs option {
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
  }
  ${ICON_THEME_CSS}
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 0;
    margin: 0;
  }
  /* Toolbar mirrors the analysis panels (message-log analysis) so the whole
     extension reads as one product: title, tab row, right-aligned actions. */
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .toolbar .title { font-weight: 600; font-size: 13px; margin-right: 8px; }
  .toolbar .spacer { flex: 1; }
  .toolbar .count {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-variant-numeric: tabular-nums;
  }
  .tab {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid transparent;
    border-bottom: 2px solid transparent;
    padding: 4px 12px;
    cursor: pointer;
    border-radius: 4px 4px 0 0;
    font-size: 12px;
  }
  .tab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .tab.active { border-bottom-color: var(--cg-accent); font-weight: 600; }
  .tab .n { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  .tab.active .n { color: inherit; }
  .act {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid transparent;
    padding: 4px 8px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
  }
  .act:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .tree {
    padding: 4px 8px 8px 8px;
  }
  .node > .children {
    display: none;
    border-left: 1px dotted var(--vscode-panel-border);
    margin-left: 5px;
    padding-left: 5px;
  }
  .node[data-open="1"] > .children {
    display: block;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 4px;
    padding: 0 2px;
    border-radius: 3px;
    line-height: 1.25;
    white-space: nowrap;
    overflow-x: auto;
  }
  .row:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .node:first-child > .row .proc { font-weight: 600; }
  .chevron {
    display: inline-block;
    width: 10px;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    user-select: none;
    transition: transform 0.1s;
    font-size: 0.75em;
    text-align: center;
  }
  .chevron.leaf {
    cursor: default;
  }
  .node[data-open="1"] > .row > .chevron {
    transform: rotate(90deg);
  }
  /* Holds the tree's process SVG — inline-flex keeps it centred on the row
     even though .row aligns on the text baseline. */
  .icon {
    display: inline-flex;
    align-items: center;
    align-self: center;
  }
  .proc {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
  }
  .proc:hover { text-decoration: underline; }
  .meta {
    color: var(--vscode-descriptionForeground);
    font-size: 0.8em;
  }
  .params {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.8em;
  }
  .val-literal { color: var(--vscode-charts-green, #89D185); }
  .val-unknown { color: var(--vscode-charts-blue, #75beff); font-style: italic; }
  .val-dynamic { color: var(--vscode-charts-orange, #e8ab53); }
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.8em;
    margin-left: 6px;
  }
  .badge.cycle {
    background: var(--vscode-inputValidation-warningBackground);
    color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-inputValidation-warningBorder);
  }
  .badge.depth {
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-descriptionForeground);
  }
  .empty {
    color: var(--vscode-descriptionForeground);
    padding: 16px;
    font-style: italic;
  }
  .maptab { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; border-bottom: 2px solid transparent;
            padding: 4px 12px; cursor: pointer; border-radius: 4px 4px 0 0; font-size: 12px; }
  .maptab:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  /* With the Lineage tab next to it, the title reads as the active tab — same underline as there. */
  .title.tabbed { font-size: 12px; padding: 4px 12px; margin-right: 0; border: 1px solid transparent; border-bottom: 2px solid var(--vscode-focusBorder); }
`;

  const body = `<div class="toolbar">
  <span class="title${opts?.mapTab ? ' tabbed' : ''}">${vscode.l10n.t('Call graph')}: ${esc(startProcess)}</span>
  <button class="tab ${direction === 'downstream' ? 'active' : ''}" data-dir="downstream"
          title="${vscode.l10n.t('Processes this process calls')}">${vscode.l10n.t('Calls')} <span class="n">${downCnt}</span></button>
  <button class="tab ${direction === 'upstream' ? 'active' : ''}" data-dir="upstream"
          title="${vscode.l10n.t('Processes that call this process')}">${vscode.l10n.t('Called by')} <span class="n">${upCnt}</span></button>
  ${opts?.mapTab ? `<button class="maptab" data-map-tab title="${vscode.l10n.t('Dependencies and data flow around this object')}">${esc(opts.mapTab)}</button>` : ''}
  <span class="count">${vscode.l10n.t('{0} direct · {1} in total', String(directCnt), String(cnt))}</span>
  ${renderRunSelect(runs ?? [], direction)}
  <span class="spacer"></span>
  <button class="act" data-action="expandAll">${vscode.l10n.t('Expand all')}</button>
  <button class="act" data-action="collapseAll">${vscode.l10n.t('Collapse all')}</button>
</div>
<div class="tree">
  ${directCnt === 0 ? `<div class="empty">${direction === 'downstream' ? vscode.l10n.t('No called processes found.') : vscode.l10n.t('No calling processes found.')}</div>` : treeHtml}
</div>`;


  return renderWebviewShell({
    cspSource: opts?.webview.cspSource ?? '', css, body, 
    scriptUris: opts ? [String(opts.webview.asWebviewUri(vscode.Uri.joinPath(opts.extensionUri, 'out', 'webview', 'callGraph.js')))] : [],
  });
}

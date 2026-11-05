import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { buildCallGraph, buildCubeOrDimUsages, countDirectCalls, Direction } from './callGraph';
import { buildChoreGraph } from './choreGraph';
import { getOrBuildIndex } from './referenceIndexService';
import { refLog, refWarn } from './refLog';
import { getCallGraphHtml } from './callGraphWebview';
import { listRuns, loadRun, type RunHead } from './runSource';
import { buildRunOverlay, buildUpstreamOverlay, type OverlayNode } from './runOverlayPure';
import { getChoreGraphHtml } from './choreGraphWebview';
import { getUsageGraphHtml } from './usageGraphWebview';
import { getLineageHtml, handleLineageMessage } from './lineage';
import { errMsg } from '../utils/errMsg';
import { splitQualifiedName } from '../utils/qualifiedName';
import { escapeHtml } from '../utils/escapeHtml';
import { renderWebviewShell } from '../webviews/webviewShell';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import type { ReferenceIndex, RefTargetKind } from './referenceTypes';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';

export type UsageTargetKind = RefTargetKind | 'chore';


export interface UsageTarget {
  kind: UsageTargetKind;
  name: string;
}

/**
 * The lifecycle lies with the host: key space `${serverUrl}::…`, so that
 * `disposePanelsForServer` finds the windows of a disconnected server. Before
 * that it was a map of its own without this path — the windows stayed open on
 * disconnect and held their `Tm1Config` in the closure.
 */
const host = new WebviewPanelHost<unknown>('tm1.usageGraph', 'Usage graph');

/** Close all usage/call graphs of this server (on disconnect). */
export function disposeUsageGraphPanelsForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

registerServerDisposer('usageGraph', (url) => disposeUsageGraphPanelsForServer(url));

function panelKey(
  serverUrl: string | undefined,
  kind: UsageTargetKind,
  name: string,
  includeSystem: boolean,
): string {
  // The control-object decision belongs in the key: otherwise
  // `reveal` shows a window that was built with the other setting, and
  // the sources because of which it was opened are missing in it.
  return `${serverUrl ?? '__default__'}::${kind}::${name.toLowerCase()}${includeSystem ? '::sys' : ''}`;
}

function kindLabel(kind: UsageTargetKind): string {
  if (kind === 'cube')      { return vscode.l10n.t('Cube'); }
  if (kind === 'dimension') { return vscode.l10n.t('Dimension'); }
  if (kind === 'chore')     { return vscode.l10n.t('Chore'); }
  return vscode.l10n.t('Process');
}

function targetFromNode(node: Tm1TreeNode | undefined): UsageTarget | null {
  if (!node) { return null; }
  const m = node.meta ?? {};
  switch (node.nodeType) {
    case 'cube':          return m.cubeName    ? { kind: 'cube',      name: String(m.cubeName) }    : null;
    case 'cubeDimension': return m.dimName     ? { kind: 'dimension', name: String(m.dimName) }     : null;
    case 'dimension':     return m.dimName     ? { kind: 'dimension', name: String(m.dimName) }     : null;
    case 'hierarchy':     return m.dimName     ? { kind: 'dimension', name: String(m.dimName) }     : null;
    case 'process':       return m.processName ? { kind: 'process',   name: String(m.processName) } : null;
    case 'chore':         return m.choreName   ? { kind: 'chore',     name: String(m.choreName) }   : null;
    default:              return null;
  }
}

async function loadIndex(cfg: Tm1Config): Promise<ReferenceIndex | null> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: vscode.l10n.t('TM1: Analyzing references…') },
      () => getOrBuildIndex(cfg),
    );
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 reference analysis failed: {0}', errMsg(err)));
    return null;
  }
}

export async function showUsageGraphCommand(
  node: Tm1TreeNode | undefined,
  getServerConfig: (serverId: string) => Tm1Config | undefined,
  isHidingSystemObjects?: (serverId: string) => boolean,
  /** Extension root — lets the panels serve the object explorer's SVG icons. */
  extensionUri?: vscode.Uri,
): Promise<void> {
  const target = targetFromNode(node);
  if (!target) {
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: No Cube, Dimension, Process or Chore selected.'));
    return;
  }
  const serverId = node!.meta?.serverId as string | undefined;
  const cfg = serverId ? getServerConfig(serverId) : undefined;
  if (!cfg) { return; }
  // `meta.includeSystem` forces the control objects, regardless of what the tree
  // currently shows. The mass delete needs that: its column names
  // `}Drill_test` as a dependency, because a control process breaks just like
  // any other — a window that then filters it away contradicts the
  // row it was opened from.
  const includeSystem = node!.meta?.includeSystem === true
    || !(serverId && isHidingSystemObjects?.(serverId) === true);

  const key = panelKey(cfg?.serverUrl, target.kind, target.name, includeSystem);
  if (host.reveal(key)) { return; }

  const idx = await loadIndex(cfg);
  if (!idx) { return; }

  const title = target.kind === 'process'
    ? vscode.l10n.t('Call graph: {0}', target.name)
    : target.kind === 'chore'
      ? vscode.l10n.t('Chore: {0}', target.name)
      : vscode.l10n.t('Usages: {0} {1}', kindLabel(target.kind), target.name);

  // The host wants to know a root once; from it it sets the
  // `localResourceRoots` [out, media] that the symbol <img> need.
  host.initialize(extensionUri ?? vscode.Uri.file('/'));
  const panel = host.open({
    key,
    title,
    // The content is set by the three renderers below themselves — they know the graphic,
    // the host only knows the window.
    html: () => '',
    // Likewise the messages: each renderer attaches its own receiver.
    onMessage: () => {},
  });
  if (!panel) { return; }

  const mapTab = vscode.l10n.t('Lineage');
  const icons = extensionUri ? { webview: panel.webview, extensionUri, mapTab } : undefined;
  // The "Map" tab swaps this panel's page for the model map focused on the same
  // object, and back. The list page is remembered as it was when left.
  let mapShown = false;
  let listHtml = '';
  // The process page redraws on "back" instead: runs that arrived while the
  // map was shown are not in the remembered page.
  let redrawList: (() => void) | undefined;
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === 'showMap') {
      listHtml = panel.webview.html;
      mapShown = true;
      panel.webview.html = getLineageHtml(panel.webview, extensionUri ?? vscode.Uri.file('/'), {
        focusId: `${target.kind}:${target.name.toLowerCase()}`,
        focusName: target.name,
        backLabel: title,
      });
    } else if (msg?.type === 'mapBack') {
      mapShown = false;
      if (redrawList) { redrawList(); } else { panel.webview.html = listHtml; }
    } else if (msg && typeof msg.type === 'string') {
      await handleLineageMessage(msg, panel, cfg, serverId, includeSystem);
    }
  });
  if (target.kind === 'chore') {
    renderChoreGraph(panel, idx, target.name, serverId, includeSystem, icons);
  } else if (target.kind === 'process') {
    redrawList = renderProcessGraph(panel, idx, target.name, serverId, includeSystem, icons, cfg, () => mapShown);
  } else {
    renderCubeOrDimUsages(panel, idx, target.kind, target.name, serverId, includeSystem, icons);
  }
}

/** Exported for the guard of the error page (`usageGraphErrorPage.test.ts`). */
export function renderChoreGraph(
  panel: vscode.WebviewPanel,
  idx: ReferenceIndex,
  choreName: string,
  serverId: string | undefined,
  includeSystem: boolean,
  icons?: { webview: vscode.Webview; extensionUri: vscode.Uri; mapTab?: string },
): void {
  const graph = buildChoreGraph(idx, choreName, { includeSystem });
  if (!graph) {
    const keysSample = [...idx.choreTasks.keys()].slice(0, 5);
    refWarn(
      `Chore "${choreName}" not in the index (${idx.choreTasks.size} chores loaded, `
      + `sample keys: ${keysSample.join(', ') || '<empty>'}).`,
    );
    // The chore name comes from the server and so far went unescaped into a
    // document without any CSP (Codex finding B12). Via the shell the error
    // page too has the same rule as every other webview.
    panel.webview.html = renderWebviewShell({
      cspSource: panel.webview.cspSource,
      css: 'body{padding:16px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}',
      body: `${vscode.l10n.t('Chore "{0}" not found in the index.', `<strong>${escapeHtml(choreName)}</strong>`)}<br><br>
      <em>${vscode.l10n.t('The index contains {0} chores.', String(idx.choreTasks.size))}</em> ${vscode.l10n.t('See the Developer Tools console for details.')}`,
    });
    return;
  }
  refLog(`Chore-Graph "${choreName}": ${graph.tasks.length} Tasks (includeSystem=${includeSystem})`);
  panel.webview.html = getChoreGraphHtml(graph, icons);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === 'openProcess' && typeof msg.processName === 'string') {
      const n = new Tm1TreeNode('process', msg.processName, vscode.TreeItemCollapsibleState.None, {
        processName: msg.processName, serverId,
      });
      await vscode.commands.executeCommand('tm1.openProcessEditor', n);
    }
  });
}

function renderProcessGraph(
  panel: vscode.WebviewPanel,
  idx: ReferenceIndex,
  processName: string,
  serverId: string | undefined,
  includeSystem: boolean,
  icons?: { webview: vscode.Webview; extensionUri: vscode.Uri; mapTab?: string },
  cfg?: Tm1Config,
  /** True while the panel shows the map tab — a late re-render must not replace it. */
  mapShown: () => boolean = () => false,
): () => void {
  let direction: Direction = 'downstream';
  // The runs of the process from the log. Empty until they are loaded — the
  // view then looks as before.
  let runs: RunHead[] = [];
  let overlay: OverlayNode | undefined;

  // Diagnostic log: which refs does the root process have?
  const lc = processName.toLowerCase();
  const outgoing = (idx.bySourceProcess.get(lc) ?? []).filter(r => r.targetKind === 'process').length;
  const incoming = (idx.byProcess.get(lc) ?? []).filter(r => r.sourceKind === 'process').length;
  refLog(
    `Graph for "${processName}": ${outgoing} outgoing, ${incoming} incoming (includeSystem=${includeSystem})`,
  );
  if (outgoing === 0 && direction === 'downstream') {
    const keyCandidates = [...idx.bySourceProcess.keys()].filter(k => k.includes(lc) || lc.includes(k));
    if (keyCandidates.length > 0) {
      refLog(`ähnliche Keys in bySourceProcess: ${keyCandidates.slice(0, 5).join(', ')}`);
    } else {
      refLog(`"${lc}" NICHT in bySourceProcess gefunden.`);
    }
  }

  const render = () => {
    const tree = buildCallGraph(idx, processName, { direction, includeSystem });
    // The inactive tab is labelled with its size so the user does not have to
    // click to discover an empty view. Only the DIRECT children are needed, so
    // count them instead of building the whole opposite tree and throwing it
    // away — that recursion goes 20 levels deep without memoization and used to
    // run on every panel open AND every direction switch.
    const otherCount = countDirectCalls(idx, processName, {
      direction: direction === 'downstream' ? 'upstream' : 'downstream', includeSystem,
    });
    const counts = direction === 'downstream'
      ? { downstream: tree.children.length, upstream: otherCount }
      : { downstream: otherCount, upstream: tree.children.length };
    panel.webview.html = getCallGraphHtml(tree, direction, processName, counts, icons, runs, overlay);
  };
  render();

  // The runs come AFTER the first draw: the panel should not wait for a
  // log query, and without runs the view looks as before.
  if (cfg) {
    void (async () => {
      try {
        runs = await listRuns(processName, cfg);
        if (runs.length && !mapShown()) { render(); }
      } catch (err) {
        refWarn(`Laeufe nicht ladbar: ${errMsg(err)}`);
      }
    })();
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === 'openProcess' && typeof msg.processName === 'string') {
      const n = new Tm1TreeNode('process', msg.processName, vscode.TreeItemCollapsibleState.None, {
        processName: msg.processName, serverId,
      });
      await vscode.commands.executeCommand('tm1.openProcessEditor', n);
    } else if (msg?.type === 'openChore' && typeof msg.choreName === 'string') {
      // "Called by" can now name a chore — a process editor on
      // this name would find nothing.
      const n = new Tm1TreeNode('chore', msg.choreName, vscode.TreeItemCollapsibleState.None, {
        choreName: msg.choreName, serverId,
      });
      await vscode.commands.executeCommand('tm1.editChore', n);
    } else if (msg?.type === 'switchDirection' && (msg.direction === 'downstream' || msg.direction === 'upstream')) {
      direction = msg.direction;
      // The overlay belongs to the direction — continuing to show the old one would mean
      // attaching numbers to edges for which they were never computed.
      overlay = undefined;
      render();
    } else if (msg?.type === 'selectRun') {
      const startedAt = typeof msg.startedAt === 'string' ? msg.startedAt : '';
      const chosen = runs.find(r => r.startedAt === startedAt);
      if (!chosen || !cfg) { overlay = undefined; render(); return; }
      try {
        const { tree: measured, roots } = await loadRun(processName, chosen, cfg);
        // Build the static tree ANEW: the overlay attaches to it index by
        // index, and a direction change in between would have left a
        // different tree behind.
        const staticGraph = buildCallGraph(idx, processName, { direction, includeSystem });
        // Two viewing directions, two overlays: downwards the times of the
        // called processes, upwards the own runtime plus the one
        // caller this run demonstrably came from.
        overlay = !measured ? undefined
          : direction === 'upstream'
            ? buildUpstreamOverlay(staticGraph, measured, chosen.parent)
            : buildRunOverlay(staticGraph, measured, { roots, originator: chosen.originator });
      } catch (err) {
        overlay = undefined;
        vscode.window.showWarningMessage(
          vscode.l10n.t('TM1: run could not be loaded: {0}', errMsg(err)));
      }
      render();
    }
  });
  return render;
}

function renderCubeOrDimUsages(
  panel: vscode.WebviewPanel,
  idx: ReferenceIndex,
  kind: 'cube' | 'dimension',
  name: string,
  serverId: string | undefined,
  includeSystem: boolean,
  icons?: { webview: vscode.Webview; extensionUri: vscode.Uri; mapTab?: string },
): void {
  const refs = buildCubeOrDimUsages(idx, kind, name, { includeSystem });
  panel.webview.html = getUsageGraphHtml(kind, name, refs, icons);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type !== 'openSource') { return; }
    const sourceKind = msg.sourceKind as 'process' | 'rule' | 'subset' | 'view';
    const sourceName = String(msg.sourceName ?? '');
    if (!sourceName) { return; }
    if (sourceKind === 'process') {
      const n = new Tm1TreeNode('process', sourceName, vscode.TreeItemCollapsibleState.None, {
        processName: sourceName, serverId,
      });
      await vscode.commands.executeCommand('tm1.openProcessEditor', n);
    } else if (sourceKind === 'rule') {
      const n = new Tm1TreeNode('cubeRule', 'Rules', vscode.TreeItemCollapsibleState.None, {
        cubeName: sourceName, serverId,
      });
      await vscode.commands.executeCommand('tm1.openCubeRules', n);
    } else if (sourceKind === 'subset') {
      const [dimName, hierName, subsetName] = splitQualifiedName(sourceName, 3);
      if (!dimName || !subsetName) { return; }
      const n = new Tm1TreeNode('subset', subsetName, vscode.TreeItemCollapsibleState.None, {
        dimName, subsetName, isPrivate: false, serverId,
        // Carry the real hierarchy so alternate-hierarchy subsets resolve
        // (index key is Dim:Hier:Sub). Falls back to dimName in the handler.
        hierName: hierName || undefined,
      });
      await vscode.commands.executeCommand('tm1.openSubset', n);
    } else if (sourceKind === 'view') {
      const [cubeName, viewName] = splitQualifiedName(sourceName, 2);
      if (!cubeName || !viewName) { return; }
      const n = new Tm1TreeNode('cubeView', viewName, vscode.TreeItemCollapsibleState.None, {
        cubeName, viewName, serverId,
      });
      await vscode.commands.executeCommand('tm1.openCubeViewer', n);
    }
  });
}

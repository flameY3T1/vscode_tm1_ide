// MUST be the FIRST import — populates KNOWN_SIGNATURES from media/tiSignatures.json
// before any transitive module-load consumer (tiParser BARE_KEYWORDS IIFE,
// provider top-level Sets, etc.). See tiSignaturesNodeBoot.ts for details.
import './tiLogicVisualizer/tiSignaturesNodeBoot';
import * as vscode from 'vscode';
import {
  restoreConnectedServers, migrateLegacyPasswords,
  onServerChanged, onConnected, onDisconnected,
  getActiveServerName, getAllServers, isConnected, getServerConfig,
  setServerNameResolver,
  initServerManager, runStateMigrations, getGitProfile, watchBrowserSessionExpiry,
} from './commands/serverManager';
import { setExtensionContext } from './utils/extensionContext';
import { setGitEnabledResolver, setV12Resolver, setImpersonationResolver } from './providers/tm1TreeNodes';
import { initializeGitConfigPanel, openGitConfigPanel } from './commands/git/gitConfigPanel';
import { registerFileCommands } from './commands/fileCommands';
import { registerApplicationCommands } from './commands/applicationCommands';
import { initializeTransactionLog } from './commands/transactionLog';
import { initializeProcessCoverage } from './commands/processCoverage';
import { initPanelIcons } from './webviews/panelIcons';
import { applyMaxSocketsSetting } from './tm1Rest/transport/agent';
import { MdxRunnerManager } from './commands/mdx/mdxRunner';
import { warmCache, invalidateCache } from './providers/fetchNames';
import { logBestEffort } from './providers/bestEffortLog';
import { stepBestEffort } from './activation/stepBestEffort';
import { Tm1TreeDataProvider } from './providers/tm1TreeDataProvider';
import { TreeExpansionStore } from './providers/treeExpansionStore';
import { SandboxTracker, setSandboxTrackerSingleton, setServerIdResolver } from './tm1Rest/sandboxTracker';
import { registerSandboxCommands } from './commands/sandbox/sandboxCommands';
import { getServerIdByConfig, onProfileRemoved, setDeferredRestore } from './serverState/state';
import { _clearSandboxEnabledCache } from './tm1Rest/sandboxApi';
import { closeAllSessions } from './tm1Client';
import { Tm1TreeDragDropController } from './providers/tm1TreeDragDrop';
import { CubeStatsDashboardManager } from './commands/cubeViewer/cubeStatsDashboard';
import { ProcessEditorManager } from './commands/processEditor/manager';
import { TiDiagnosticsProvider } from './providers/tiDiagnosticsProvider';
import { initializeDimensionBrowser } from './commands/dimension/dimensionBrowser';
import { DimensionEditorManager } from './commands/dimension/dimensionEditor';
import { RuleEditorManager } from './commands/rule/ruleEditor';
import { RecentTreeProvider } from './recentTreeProvider';
import { createRunStatusBarItem } from './runState/runningTreeProvider';
import { cancelRun, dropRunsForServer, forgetRun, listRuns, type RunEntry } from './runState/runRegistry';
import { ChoreEditorManager } from './commands/chore/choreEditor';
import { CubeViewerManager } from './commands/cubeViewer/manager';
import { initializeCellTracePanel } from './commands/cubeViewer/cellTracePanel';
import { SnippetStorage } from './snippets/snippetStorage';
import { initializeAddServerPanel, disposeAllAddServerPanels } from './commands/serverConfig/addServerPanel';
import { ReorderDimsWebview } from './webviews/reorderDimsWebview';
import { CellSecurityBuilderWebview } from './commands/security/cellSecurityBuilderWebview';
import { OverviewPanelManager } from './webviews/objectOverview/overviewManager';
import { buildProcessOverviewConfig } from './commands/process/processOverviewConfig';
import { buildDimensionOverviewConfig } from './commands/dimension/dimensionOverviewConfig';
import { buildApplicationOverviewConfig } from './commands/applicationOverviewConfig';
import { buildCubeOverviewConfig } from './commands/cubeViewer/cubeOverviewConfig';

import type { ActivationContext } from './activation/context';
import { disposeAllForServer } from './serverState/serverDisposeRegistry';
import { registerDiagnostics } from './activation/registerDiagnostics';
import { registerV12Mode } from './activation/registerV12Mode';
import { registerWorkspaceHandlers } from './activation/registerWorkspaceHandlers';
import { registerTreeCommands } from './activation/registerTreeCommands';
import { registerAdminServerCommands } from './activation/registerAdminServerCommands';
import { registerServerCommands } from './activation/registerServerCommands';
import { registerProcessCommands } from './activation/registerProcessCommands';
import { registerChoreCommands } from './activation/registerChoreCommands';
import { registerCubeCommands } from './activation/registerCubeCommands';
import { registerDimensionCommands } from './activation/registerDimensionCommands';
import { registerSecurityCommands } from './activation/registerSecurityCommands';
import { registerGitCommands } from './activation/registerGitCommands';
import { registerOtherCommands } from './activation/registerOtherCommands';
import { registerTm1Notebook } from './notebook/tm1Notebook';
import { registerSnippetCommands } from './activation/registerSnippetCommands';
import { registerRecentCommands } from './activation/registerRecentCommands';
import { registerGoToObject } from './activation/registerGoToObject';
import { registerProcessTemplateCommands } from './activation/registerProcessTemplateCommands';
import { registerBedrockCommands } from './activation/registerBedrockCommands';
import { registerWorkbenchCommands } from './activation/registerWorkbenchCommands';
import { initializeWorkbenchPicker } from './commands/workbench/saveFlow';
import { WorkbenchStore } from './commands/workbench/workbenchStore';
import { ProcessTemplateStorage } from './processTemplates/processTemplateStorage';
import { ProcessTemplateEditorManager } from './processTemplates/processTemplateEditor';
import { registerLanguageProviders } from './activation/registerLanguageProviders';
import { registerTiTestActivation } from './activation/registerTiTestActivation';
import { restoreAtActivation } from './activation/restoreTriggerPure';
import { registerFindReplaceCommand } from './commands/findReplace/findReplaceCommand';
import { registerConsistencyCommand } from './commands/tiConsistency/tiConsistencyCommand';
import { registerV12ReadinessCommand } from './commands/v12Readiness/command';
import { registerValueNamingCommand } from './commands/tiValueNaming/tiValueNamingCommand';
import { registerConsolidationCompareCommand } from './commands/consolidationCompare/consolidationCompareCommand';
import { registerReleaseNotesCommand } from './commands/releaseNotes/releaseNotesCommand';
import { setUiLanguage } from './webviews/webviewShell';
import { disposeAllOutputChannels, outputChannel } from './utils/outputChannel';
import { setIntegratedLoginLog } from './tm1Rest/transport/integratedSession';
import { setBestEffortSink } from './tm1Rest/bestEffort';

let _treeDataProvider: Tm1TreeDataProvider | undefined;

interface PhaseSample { name: string; ms: number; }

/**
 * Optional cold-start tracer. Enabled via `tm1.diagnostics.logActivationTiming`.
 * Wraps a phase, records elapsed ms, logs a sorted summary on completion.
 */
function makeTimer(enabled: boolean) {
  const samples: PhaseSample[] = [];
  return {
    async run<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
      if (!enabled) { return fn(); }
      const t0 = performance.now();
      try { return await fn(); }
      finally { samples.push({ name, ms: performance.now() - t0 }); }
    },
    flush(out: vscode.OutputChannel, totalMs: number): void {
      if (!enabled) { return; }
      samples.sort((a, b) => b.ms - a.ms);
      out.appendLine('── TM1 activation timing ───────────────────');
      for (const s of samples) {
        const pct = totalMs > 0 ? ` (${((s.ms / totalMs) * 100).toFixed(1)}%)` : '';
        out.appendLine(`  ${s.ms.toFixed(1).padStart(7)} ms  ${s.name}${pct}`);
      }
      out.appendLine(`  ${totalMs.toFixed(1).padStart(7)} ms  TOTAL`);
      out.appendLine('────────────────────────────────────────────');
    },
  };
}

/**
 * Surface a one-time warning if the user still relies on the deprecated
 * `tm1.password` plaintext setting. Server-Profile credentials live in
 * the OS Secret Storage; the inline setting wanders into committed
 * settings.json files (P0-4, project review 2026-05-25).
 *
 * Toast is shown once per workspace; users can dismiss it permanently via
 * the "Nicht mehr anzeigen" action.
 */
function warnIfPlaintextPasswordSetting(context: vscode.ExtensionContext): void {
  const DISMISS_KEY = 'tm1.passwordDeprecation.dismissed';
  if (context.globalState.get<boolean>(DISMISS_KEY)) { return; }
  const inline = vscode.workspace.getConfiguration('tm1').get<string>('password') ?? '';
  if (!inline) { return; }
  const OPEN_PROFILES = vscode.l10n.t('Open Server Profiles');
  const OPEN_SETTING = vscode.l10n.t('Open Setting');
  const DONT_SHOW_AGAIN = vscode.l10n.t("Don't show again");
  void vscode.window.showWarningMessage(
    vscode.l10n.t('tm1.password is deprecated and no longer used — its plaintext value in settings.json is ignored (leak risk if committed to git). Use Server Profiles (passwords in the OS secret storage).'),
    OPEN_PROFILES,
    OPEN_SETTING,
    DONT_SHOW_AGAIN,
  ).then((choice) => {
    if (choice === OPEN_PROFILES) {
      void vscode.commands.executeCommand('tm1.selectServer');
    } else if (choice === OPEN_SETTING) {
      void vscode.commands.executeCommand('workbench.action.openSettings', 'tm1.password');
    } else if (choice === DONT_SHOW_AGAIN) {
      void context.globalState.update(DISMISS_KEY, true);
    }
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initPanelIcons(context.extensionUri);
  const traceEnabled = vscode.workspace.getConfiguration('tm1').get<boolean>('diagnostics.logActivationTiming', false);
  const timer = makeTimer(traceEnabled);
  const tActivateStart = performance.now();

  setExtensionContext(context);
  setBestEffortSink((line) => outputChannel('TM1 Background').appendLine(line));
  // `tm1.maxSockets` caps the concurrent requests per server. TM1 binds
  // the worker thread to the TCP socket, so the value limits the threads
  // we occupy on the server — see docs/architecture/thread-stability.md.
  applyMaxSocketsSetting();
  // Integrated login (direct and through PAW) traces every leg here.
  const loginLog = outputChannel('TM1 Connection');
  setIntegratedLoginLog(line => loginLog.appendLine(`[${new Date().toISOString()}] ${line}`));
  // Browser login: an expired session offers "Log in again", never reconnects by itself.
  context.subscriptions.push(watchBrowserSessionExpiry(context));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('tm1.maxSockets')) { applyMaxSocketsSetting(); }
  }));
  await stepBestEffort('migrateLegacyPasswords',
    () => timer.run('migrateLegacyPasswords', () => migrateLegacyPasswords(context)));
  // Fire-and-forget: a slow/unreachable server must not hang extension activation.
  // restoreConnectedServers fires onServerChanged on completion → tree refreshes (see below).
  // Single-shot (no retry, rule 07-16); deferred while only an offline TM1 file
  // is open (review V8) — the TM1 views below or a server picker
  // (`getConnectedIdsRestored`) start it.
  let restoring: Promise<void> | undefined;
  const restoreOnce = (): Promise<void> => {
    restoring ??= timer.run('restoreConnectedServers', () => restoreConnectedServers(context))
      .catch(e => logBestEffort('Activation', 'restoreConnectedServers', e));
    return restoring;
  };
  setDeferredRestore(restoreOnce);
  context.subscriptions.push({ dispose: () => setDeferredRestore(undefined) });
  const restoreWhenVisible = (view: vscode.TreeView<unknown>): void => {
    if (view.visible) { void restoreOnce(); return; }
    context.subscriptions.push(view.onDidChangeVisibility(e => { if (e.visible) { void restoreOnce(); } }));
  };
  if (restoreAtActivation({
    openLanguageIds: vscode.workspace.textDocuments.map(d => d.languageId),
    tm1NotebookOpen: vscode.workspace.notebookDocuments.some(n => n.notebookType === 'tm1-notebook'),
  })) { void restoreOnce(); }
  warnIfPlaintextPasswordSetting(context);

  const snippetStorage = new SnippetStorage(context);
  const tplStorage = new ProcessTemplateStorage(context);
  // `<html lang>` aller Webview-Shells (B17).
  setUiLanguage(vscode.env.language);

  const expansionStore = new TreeExpansionStore(context.workspaceState);
  context.subscriptions.push({ dispose: () => { void expansionStore.dispose(); } });

  const sandboxTracker = new SandboxTracker(context.workspaceState);
  setSandboxTrackerSingleton(sandboxTracker);
  setServerIdResolver((cfg) => getServerIdByConfig(cfg));
  context.subscriptions.push({ dispose: () => {
    setSandboxTrackerSingleton(null);
    setServerIdResolver(null);
  }});

  // Per-server Git init — must run BEFORE Tm1TreeDataProvider (node .git suffix depends on resolver).
  initServerManager(context);
  setGitEnabledResolver((serverId) => getGitProfile(serverId)?.enabled ?? false);
  // Same timing constraint: node contextValues carry a `-v12` suffix for the
  // v11-only actions, so the resolver must exist before the tree provider runs.
  setV12Resolver((serverId) => getServerConfig(serverId)?.version === 'v12');
  // Same timing condition: the `-imp` suffix on the server node decides
  // whether "Impersonate User…" or "Stop Impersonating" appears in the menu.
  setImpersonationResolver((serverId) => getServerConfig(serverId)?.impersonate !== undefined);
  initializeGitConfigPanel(context.extensionUri);
  // One-time globalState migrations, gated by `tm1.state.version` (legacy git
  // settings → per-server profiles, then the process-grouping overrides).
  {
    const g = vscode.workspace.getConfiguration('tm1.git');
    await stepBestEffort('runStateMigrations', () => runStateMigrations({
      enabled: g.get<boolean>('enabled') ?? false,
      repoPath: g.get<string>('repoPath') ?? '${workspaceFolder}/tm1',
      parallelFetch: g.get<number>('parallelFetch') ?? 8,
    }));
  }

  const treeDataProvider = await timer.run('Tm1TreeDataProvider:construct', () => new Tm1TreeDataProvider(
    () => getAllServers(context),
    (id) => isConnected(id),
    (id) => getServerConfig(id),
    () => snippetStorage.getFiltered(getActiveServerName(context)),
    () => tplStorage.getAll(),
    context.extensionUri,
    expansionStore,
    sandboxTracker,
    context.workspaceState,
  ));
  _treeDataProvider = treeDataProvider;

  const treeView = vscode.window.createTreeView('tm1Explorer', {
    treeDataProvider,
    dragAndDropController: new Tm1TreeDragDropController(),
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);
  restoreWhenVisible(treeView);
  context.subscriptions.push(treeView.onDidExpandElement(e => {
    if (typeof e.element.id === 'string') { expansionStore.setExpanded(e.element.id); }
  }));
  context.subscriptions.push(treeView.onDidCollapseElement(e => {
    if (typeof e.element.id === 'string') { expansionStore.setCollapsed(e.element.id); }
  }));
  registerSandboxCommands(context, sandboxTracker, treeDataProvider);
  registerProcessTemplateCommands(context, () => treeDataProvider.refresh(), tplStorage);
  registerBedrockCommands(context);

  const sandboxStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  sandboxStatusItem.tooltip = vscode.l10n.t('TM1: active sandbox for the active server');
  context.subscriptions.push(sandboxStatusItem);
  const refreshSandboxStatus = (): void => {
    const activeServer = getActiveServerName(context);
    if (!activeServer) { sandboxStatusItem.hide(); return; }
    const servers = getAllServers(context);
    const sid = servers.find(s => s.name === activeServer)?.id;
    if (!sid) { sandboxStatusItem.hide(); return; }
    const active = sandboxTracker.getActive(sid);
    sandboxStatusItem.text = active ? `$(layers) Sandbox: ${active}` : '$(layers) Base';
    sandboxStatusItem.show();
  };
  refreshSandboxStatus();
  context.subscriptions.push({ dispose: sandboxTracker.onDidChange(() => refreshSandboxStatus()) });
  context.subscriptions.push(onServerChanged.event((kind) => { if (kind !== 'profiles') { refreshSandboxStatus(); } }));

  // Running executions sit at the TOP of the "Recent" view plus a status bar
  // item, instead of the progress notification that used to cover the
  // dimension browser and the view element pickers for the whole run.
  const recentProvider = new RecentTreeProvider(context);
  const recentView = vscode.window.createTreeView('tm1.recent', { treeDataProvider: recentProvider });
  restoreWhenVisible(recentView);
  context.subscriptions.push(recentProvider, recentView, createRunStatusBarItem());
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.cancelRun', (item?: RunEntry) => {
      // The palette entry is hidden (`when: false`), so `item` is the tree node.
      if (item?.id) { cancelRun(item.id); }
    }),
    vscode.commands.registerCommand('tm1.forgetRun', async (item?: RunEntry) => {
      // Emergency exit: the connection breaks WITHOUT a disconnect (Wi-Fi gone,
      // machine goes to sleep), the run never settles — neither `finishRun`
      // nor the cancel button can reach the entry anymore.
      if (!item?.id) { return; }
      const ok = await vscode.window.showWarningMessage(
        vscode.l10n.t('Discard the entry for "{0}"?', item.objectName),
        {
          modal: true,
          detail: vscode.l10n.t('Removes the entry from the IDE only. The execution is not cancelled — if it is still alive, it keeps running on TM1.'),
        },
        vscode.l10n.t('Discard entry'),
      );
      if (ok) { forgetRun(item.id); }
    }),
    vscode.commands.registerCommand('tm1.running.focus', async () => {
      const first = listRuns()[0];
      if (first) { await recentView.reveal(first, { focus: true, select: false }); }
    }),
  );

  const workbenchStore = new WorkbenchStore(context);
  treeDataProvider.setWorkbenchStore(workbenchStore);
  context.subscriptions.push(
    workbenchStore,
    // Saving, renaming and deleting must refresh the tree — otherwise
    // the new workbench only shows up after a click elsewhere.
    workbenchStore.onDidChange(() => treeDataProvider.refresh()),
  );

  const resolveServerName = (serverId?: string): string | undefined => {
    if (!serverId) { return undefined; }
    const all = getAllServers(context);
    return all.find(s => s.id === serverId)?.name
        ?? all.find(s => s.serverUrl === serverId)?.name;
  };

  treeDataProvider.setVisibilityProbe(() => treeView.visible);
  const autoRefreshMs = vscode.workspace.getConfiguration('tm1').get<number>('objectExplorerAutoRefreshMs', 0);
  if (autoRefreshMs > 0) {
    treeDataProvider.startAutoRefresh(autoRefreshMs);
  }

  const getActiveServer = () => getActiveServerName(context);
  const getServerNameForUrl = (serverUrl: string) =>
    getAllServers(context).find(s => s.serverUrl === serverUrl)?.name;
  setServerNameResolver(getServerNameForUrl);

  const processEditorManager = await timer.run('ProcessEditorManager:construct', () => new ProcessEditorManager(
    (srv) => snippetStorage.getFiltered(srv),
    getActiveServer,
    context.extensionUri,
    getServerNameForUrl,
    context,
  ));
  await timer.run('managers:initialize', () => {
    RuleEditorManager.initialize(context.extensionUri, context);
    CubeViewerManager.initialize(context.extensionUri);
    initializeCellTracePanel(context.extensionUri);
    initializeDimensionBrowser(context.extensionUri);
    DimensionEditorManager.initialize(context.extensionUri);
    ChoreEditorManager.initialize(context.extensionUri);
    ProcessTemplateEditorManager.initialize(context.extensionUri);
    MdxRunnerManager.initialize(context);
    initializeAddServerPanel(context.extensionUri);
    ReorderDimsWebview.initialize(context.extensionUri);
    CellSecurityBuilderWebview.initialize(context.extensionUri);
    initializeWorkbenchPicker(context.extensionUri);
    initializeTransactionLog(context.extensionUri);
    initializeProcessCoverage(context.extensionUri);
  });
  const cubeStatsDashboardManager = new CubeStatsDashboardManager(context.extensionUri);

  const processOverviewManager = new OverviewPanelManager(buildProcessOverviewConfig());
  processOverviewManager.initialize(context.extensionUri);
  context.subscriptions.push({ dispose: () => processOverviewManager.disposeAll() });

  const dimensionOverviewManager = new OverviewPanelManager(buildDimensionOverviewConfig());
  dimensionOverviewManager.initialize(context.extensionUri);
  context.subscriptions.push({ dispose: () => dimensionOverviewManager.disposeAll() });

  const cubeOverviewManager = new OverviewPanelManager(buildCubeOverviewConfig());
  cubeOverviewManager.initialize(context.extensionUri);
  context.subscriptions.push({ dispose: () => cubeOverviewManager.disposeAll() });

  const tiDiagnostics = await timer.run('TiDiagnosticsProvider:construct', () => new TiDiagnosticsProvider());
  context.subscriptions.push(tiDiagnostics);

  registerFileCommands(context, {
    getConfig: (serverId?: string) => serverId ? getServerConfig(serverId) : undefined,
    refreshNode: (n) => treeDataProvider.refreshNode(n),
  });

  registerApplicationCommands(context, {
    getConfig: (serverId?: string) => serverId ? getServerConfig(serverId) : undefined,
    refreshNode: (n) => treeDataProvider.refreshNode(n),
    refresh: () => treeDataProvider.refresh(),
  });
  const applicationOverviewManager = new OverviewPanelManager(buildApplicationOverviewConfig());
  applicationOverviewManager.initialize(context.extensionUri);
  context.subscriptions.push(
    { dispose: () => applicationOverviewManager.disposeAll() },
    vscode.commands.registerCommand('tm1.applicationOverview', (node?: { meta?: { serverId?: string } }) => {
      const cfg = node?.meta?.serverId ? getServerConfig(node.meta.serverId) : undefined;
      if (cfg) { applicationOverviewManager.open(cfg); }
    }),
  );

  // workspaceState stores keyed by profile id. Not in SERVER_STATE_KEYS:
  // purgeServerState only sees globalState, and both stores hold their set in
  // memory and write it back whole — purging the memento underneath them would
  // be undone by the next write. They forget the profile themselves instead.
  context.subscriptions.push(onProfileRemoved.event(({ kind, id }) => {
    if (kind !== 'server') { return; }
    expansionStore.clearForServer(id);
    treeDataProvider.forgetServer(id);
  }));

  context.subscriptions.push(onConnected.event((serverId) => {
    // Reconnect starts fresh: drop any remembered tree expansion for this
    // server so it doesn't reopen the previously expanded nodes.
    expansionStore.clearForServer(serverId);
    treeDataProvider.refresh();
    // Warm the name-completion cache with the connected profile. Previously
    // this fired at activate-time against the fallback `tm1.*` settings —
    // a wasted 5-REST burst that would 401 if no profile matched the
    // default URL (P1-7).
    const cfg = getServerConfig(serverId);
    if (cfg) { invalidateCache(undefined, cfg.serverUrl); warmCache(cfg); }
  }));

  context.subscriptions.push(onDisconnected.event(({ serverId, serverUrl }) => {
    treeDataProvider.clearCategoryCacheForServer(serverId);
    treeDataProvider.refresh();
    _clearSandboxEnabledCache(serverUrl);
    if (!serverUrl) { return; }
    // Give up this server's run indicator. Its regular exit is the
    // `finally` of the execution — but that waits for a response that no longer
    // arrives after the disconnect (Execute runs with `timeoutMs = 0`).
    // The process keeps running on TM1; only the spinner stops.
    dropRunsForServer(serverUrl);
    disposeAllForServer(serverUrl);
  }));
  context.subscriptions.push(onServerChanged.event(() => {
    treeDataProvider.refresh();
  }));

  const ctx: ActivationContext = {
    context,
    treeDataProvider,
    processEditorManager,
    processOverviewManager,
    dimensionOverviewManager,
    cubeOverviewManager,
    recentProvider,
    snippetStorage,
    tplStorage,
    cubeStatsDashboardManager,
    tiDiagnostics,
    getActiveServer,
    getServerNameForUrl,
    resolveServerName,
  };

  await timer.run('registerV12Mode', () => registerV12Mode(context, tiDiagnostics, processEditorManager));
  await timer.run('registerDiagnostics', () => registerDiagnostics(context));
  await timer.run('registerWorkspaceHandlers', () => registerWorkspaceHandlers(context, treeDataProvider));
  await timer.run('registerTreeCommands', () => registerTreeCommands(ctx));
  await timer.run('registerAdminServerCommands', () => registerAdminServerCommands(ctx));
  await timer.run('registerServerCommands', () => registerServerCommands(ctx));
  await timer.run('registerProcessCommands', () => registerProcessCommands(ctx));
  await timer.run('registerChoreCommands', () => registerChoreCommands(ctx));
  await timer.run('registerCubeCommands', () => registerCubeCommands(ctx));
  await timer.run('registerDimensionCommands', () => registerDimensionCommands(ctx));
  await timer.run('registerSecurityCommands', () => registerSecurityCommands(ctx));
  await timer.run('registerGitCommands', () => registerGitCommands(context));
  await timer.run('registerWorkbenchCommands', () => registerWorkbenchCommands(ctx, workbenchStore));
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.configureGit', (node?: { meta?: { serverId?: string } }) => {
      const serverId = node?.meta?.serverId;
      if (!serverId) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: right-click a server to configure Git.'));
        return;
      }
      return openGitConfigPanel(serverId);
    }),
  );
  await timer.run('registerOtherCommands', () => registerOtherCommands(ctx));
  await timer.run('registerSnippetCommands', () => registerSnippetCommands(ctx));
  await timer.run('registerRecentCommands', () => registerRecentCommands(ctx));
  await timer.run('registerGoToObject', () => registerGoToObject(ctx));
  await timer.run('registerLanguageProviders', () => registerLanguageProviders(ctx));
  await timer.run('registerTm1Notebook', () => registerTm1Notebook(context));
  await timer.run('registerTiTestActivation', () => registerTiTestActivation(context));
  await timer.run('registerFindReplaceCommand', () => registerFindReplaceCommand(context));
  await timer.run('registerConsistencyCommand', () => registerConsistencyCommand(context));
  await timer.run('registerV12ReadinessCommand', () => registerV12ReadinessCommand(context));
  await timer.run('registerValueNamingCommand', () => registerValueNamingCommand(context));
  await timer.run('registerConsolidationCompareCommand', () => registerConsolidationCompareCommand(context));
  await timer.run('registerReleaseNotesCommand', () => registerReleaseNotesCommand(context));

  if (traceEnabled) {
    const totalMs = performance.now() - tActivateStart;
    const out = outputChannel('TM1 Activation');
    timer.flush(out, totalMs);
    out.show(true);
  }
}

export async function deactivate(): Promise<void> {
  // Most webview managers (process/cube/chore/snippet/security/mdx/tiTest) and their
  // pollers self-dispose via context.subscriptions (registered with a
  // `{ dispose: () => Manager.disposeAll() }` wrapper) or their panel onDidDispose.
  // Only the singletons NOT wired into subscriptions + the async session close are
  // handled explicitly here.
  _treeDataProvider?.stopAutoRefresh();
  _treeDataProvider = undefined;
  DimensionEditorManager.disposeAll();
  ProcessTemplateEditorManager.disposeAll();
  disposeAllAddServerPanels();
  // The OutputChannels were registered neither in `context.subscriptions` nor here — after
  // five reloads there were up to 25 TM1 entries in the Output dropdown (2026-08-30).
  disposeAllOutputChannels();
  // Awaited so VS Code closes TM1 sessions on graceful deactivation (reload /
  // disable / uninstall). Bounded internally (3s) so a dead server can't stall
  // shutdown. Hard window/app close kills the host before this resolves — TM1
  // reaps the orphaned session server-side after HTTPSessionTimeout.
  await closeAllSessions();
}

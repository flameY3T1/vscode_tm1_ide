import * as vscode from 'vscode';
import { showThreadsCommand } from '../commands/threads';
import { showTm1TopCommand } from '../commands/tm1Top';
import { MdxRunnerManager } from '../commands/mdx/mdxRunner';
import { TiConsolePanel } from '../webviews/tiConsoleWebview';
import { BulkDeletePanel } from '../webviews/bulkDeleteWebview';
import { BulkDeployPanel } from '../webviews/bulkDeployWebview';
import { RuleEditorManager } from '../commands/rule/ruleEditor';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { showMessageLogCommand } from '../commands/messageLog';
import { showTransactionLogCommand } from '../commands/transactionLog';
import { showMessageLogAnalysisCommand } from '../commands/messageLogAnalysis';
import { showMessageLogStartupCommand } from '../commands/messageLogStartup';
import { showUsageGraphCommand } from '../references/showUsageGraph';
import { openLineageOverview } from '../references/lineage';
import { getAllServers, getServerConfig, requireServerConfig, serverIdForCommand } from '../commands/serverManager';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { wrap } from './wrap';
import type { ActivationContext } from './context';
import { initColumnWidthStore } from '../webviews/columnWidthStore';

/**
 * Registers misc commands:
 *   findReferences ("Usage & Call Graph")
 *   showThreads / showMessageLog / mdx.open
 */
export function registerOtherCommands(ctx: ActivationContext): void {
  const { context, treeDataProvider, recentProvider, resolveServerName, processEditorManager } = ctx;

  TiConsolePanel.initialize(context);
  initColumnWidthStore(context.globalState);
  registerServerDisposer('tiConsole', (url) => TiConsolePanel.disposePanelsForServer(url));

  // The same follow-up work as when deleting from the tree (`tm1.deleteCube`,
  // `tm1.deleteProcess`). A rule editor that keeps the deleted cube open
  // keeps writing under its name on save — and hits a newly created
  // cube of the same name.
  BulkDeletePanel.initialize(context.extensionUri, () => treeDataProvider.refresh(),
    (item, cfg, serverId) => {
      if (item.kind === 'cube') {
        RuleEditorManager.disposePanelForCube(item.name, cfg.serverUrl ?? '');
      } else if (item.kind === 'process') {
        processEditorManager.disposePanel(item.name, cfg.serverUrl ?? '');
        void recentProvider.remove({ kind: 'process', serverId, name: item.name });
      }
    });
  registerServerDisposer('bulkDelete', (url) => BulkDeletePanel.disposePanelsForServer(url));

  // The bulk migration writes on the TARGET — the target's tree must be re-read
  // afterwards, and that is the same call.
  BulkDeployPanel.initialize(context.extensionUri, () => treeDataProvider.refresh());
  registerServerDisposer('bulkDeploy', (url) => BulkDeployPanel.disposePanelsForServer(url));

  context.subscriptions.push(
    // Single entry point for the usage/call-graph panel. The pre-rename alias
    // `tm1.showCallGraph` invoked the identical handler and was referenced by no
    // menu, `when` clause or keybinding — it only duplicated the palette entry
    // under the old name, so it is gone (contribution + nls keys removed too).
    vscode.commands.registerCommand('tm1.findReferences', wrap(vscode.l10n.t('Usage & Call Graph'),
      (node?: Tm1TreeNode) => showUsageGraphCommand(node, getServerConfig, (id) => !treeDataProvider.isShowingAnyControlObjects(id), context.extensionUri))),
    vscode.commands.registerCommand('tm1.showLineage', (node?: Pick<Tm1TreeNode, 'meta'>) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!serverId || !cfg) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: No server selected.')); return; }
      openLineageOverview(context.extensionUri, cfg, serverId, resolveServerName(serverId) ?? cfg.serverUrl,
        node?.meta?.includeSystem === true || treeDataProvider.isShowingAnyControlObjects(serverId),
        node?.meta?.highlightId as string | undefined);
    }),
    vscode.commands.registerCommand('tm1.showThreads', async (node?: Tm1TreeNode) => {
      await showThreadsCommand(context, node);
      // Record in "Recently opened" (only when a concrete server is known — the
      // picker path has no serverId to route a re-open back to).
      const serverId = node?.meta?.serverId as string | undefined;
      if (serverId) {
        void recentProvider.addRecent({ kind: 'threads', serverId, serverName: resolveServerName(serverId), name: 'Threads' });
      }
    }),
    vscode.commands.registerCommand('tm1.showTm1Top', (node?: Tm1TreeNode) => showTm1TopCommand(context, node)),
    vscode.commands.registerCommand('tm1.showLockChain', (node?: Tm1TreeNode) => showThreadsCommand(context, node)),
    vscode.commands.registerCommand('tm1.showMessageLog', (node?: Tm1TreeNode) => showMessageLogCommand(context, node)),
    vscode.commands.registerCommand('tm1.showTransactionLog', (node?: Tm1TreeNode) => {
      const cfg = requireServerConfig(node?.meta?.serverId as string | undefined);
      if (!cfg) { return; }
      showTransactionLogCommand(cfg);
    }),
    // `arg` is either a tree node (palette/context-menu invocation) or a direct
    // { cfg, initialTop } payload (posted from the Message Log webview's
    // "Analyze" button via messageLog.ts — that file can't import
    // messageLogAnalysis.ts directly without forming a circular dependency
    // with it, since messageLogAnalysis.ts already imports
    // fetchMessageLogEntries from messageLog.ts).
    vscode.commands.registerCommand('tm1.showMessageLogAnalysis',
      (arg?: Tm1TreeNode | { cfg: Tm1Config; initialTop?: number }) => {
        if (arg && 'cfg' in arg) {
          void showMessageLogAnalysisCommand(context, arg.cfg, arg.initialTop);
          return;
        }
        const node = arg as Tm1TreeNode | undefined;
        const cfg = requireServerConfig(node?.meta?.serverId as string | undefined);
        if (!cfg) { return; }
        void showMessageLogAnalysisCommand(context, cfg);
      }),
    // From a chore node: only that chore's runs. 2000 deep, because on v11 the chore
    // can only be picked out after the log window is read (its process lines do
    // not name it).
    vscode.commands.registerCommand('tm1.analyzeChoreRuns', (node?: Tm1TreeNode) => {
      const name = node?.meta?.choreName as string | undefined;
      const cfg = requireServerConfig(node?.meta?.serverId as string | undefined);
      if (!name || !cfg) { return; }
      void showMessageLogAnalysisCommand(context, cfg, 2000, name);
    }),
    // Startup analysis. Same two entry shapes as the analysis command above:
    // a `{ cfg }` payload from the Message Log webview's "Startup" button, or a
    // tree node.
    vscode.commands.registerCommand('tm1.showMessageLogStartup',
      (arg?: Tm1TreeNode | { cfg: Tm1Config }) => {
        if (arg && 'cfg' in arg) {
          void showMessageLogStartupCommand(context, arg.cfg);
          return;
        }
        const node = arg as Tm1TreeNode | undefined;
        const cfg = requireServerConfig(node?.meta?.serverId as string | undefined);
        if (!cfg) { return; }
        void showMessageLogStartupCommand(context, cfg);
      }),
    vscode.commands.registerCommand('tm1.mdx.open', async (node?: Tm1TreeNode) => {
      const serverId = await serverIdForCommand(node);
      if (!serverId) { return; }
      const cfg = getServerConfig(serverId);
      if (!cfg) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server not connected.')); return; }
      const profile = getAllServers(context).find(s => s.id === serverId);
      const label = profile?.name ?? serverId;
      MdxRunnerManager.open(context, serverId, cfg, label);
    }),
    vscode.commands.registerCommand('tm1.tiConsole.open', async (node?: Tm1TreeNode) => {
      const serverId = await serverIdForCommand(node);
      if (!serverId) { return; } // already reported, or cancelled
      const cfg = requireServerConfig(serverId);
      if (!cfg) { return; }
      const profile = getAllServers(context).find(s => s.id === serverId);
      TiConsolePanel.open(cfg, serverId, profile?.name ?? serverId);
    }),
    vscode.commands.registerCommand('tm1.bulkDelete.open', (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = requireServerConfig(serverId);
      if (!cfg || !serverId) { return; }
      const profile = getAllServers(context).find(s => s.id === serverId);
      BulkDeletePanel.open(cfg, serverId, profile?.name ?? serverId);
    }),
    vscode.commands.registerCommand('tm1.bulkDeploy.open', (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = requireServerConfig(serverId);
      if (!cfg || !serverId) { return; }
      const profile = getAllServers(context).find(s => s.id === serverId);
      BulkDeployPanel.open(cfg, serverId, profile?.name ?? serverId);
    }),
    { dispose: () => TiConsolePanel.disposeAll() },
    { dispose: () => BulkDeletePanel.disposeAll() },
    { dispose: () => BulkDeployPanel.disposeAll() },
    // Dispose all open MDX-runner panels + caches on deactivate (matches the
    // disposeAll wiring of the other webview managers).
    { dispose: () => MdxRunnerManager.disposeAll() },
  );
}

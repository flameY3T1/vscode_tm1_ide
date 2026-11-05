import * as vscode from 'vscode';
import { getAllServers, getServerConfig } from '../serverState/state';
import { RuleEditorManager } from '../commands/rule/ruleEditor';
import { openThreadsPanelForConfig } from '../commands/threads';
import type { RecentItem } from '../recentTreeProvider';
import type { ActivationContext } from './context';

/**
  * Registers "Recent" tree commands:
 *   tm1.recent.open / tm1.recent.remove / tm1.recent.pin / tm1.recent.unpin / tm1.recent.clear
 *
 * Re-opening an item moves it to the top of the list.
 */
export function registerRecentCommands(ctx: ActivationContext): void {
  const { context, processEditorManager, recentProvider, resolveServerName, treeDataProvider } = ctx;

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.recent.open', async (item: RecentItem) => {
      if (!item || !item.serverId) { return; }
      let cfg = getServerConfig(item.serverId);
      if (!cfg) {
        const label = item.serverName ?? item.serverId;
        // `getServerConfig` only knows connected servers. A profile that still
        // exists is merely disconnected — the normal case right after startup.
        if (!getAllServers(context).some(s => s.id === item.serverId)) {
          vscode.window.showWarningMessage(vscode.l10n.t("TM1: Server '{0}' is no longer available.", label));
          return;
        }
        const connectLabel = vscode.l10n.t('Connect');
        const choice = await vscode.window.showWarningMessage(
          vscode.l10n.t("TM1: Server '{0}' is not connected.", label), connectLabel);
        if (choice !== connectLabel) { return; }
        // The tree's connect command handles credentials, errors and the form.
        await vscode.commands.executeCommand('tm1.server.connect', { meta: { serverId: item.serverId } });
        cfg = getServerConfig(item.serverId);
        if (!cfg) { return; }
      }
      if (item.kind === 'threads') {
        await openThreadsPanelForConfig(context, cfg);
      } else if (item.kind === 'rule') {
        await RuleEditorManager.open(item.name, cfg, undefined, () => {
          treeDataProvider.invalidateCubeRulesCache(item.serverId, item.name);
          treeDataProvider.refreshCategory(item.serverId, 'Cubes');
        });
      } else {
        await processEditorManager.openProcess(item.name, undefined, cfg);
      }
      void recentProvider.addRecent({
        kind: item.kind,
        serverId: item.serverId,
        serverName: item.serverName ?? resolveServerName(item.serverId),
        name: item.name,
      });
    }),
    // The `x` on the row. Removes EXACTLY this entry, in contrast
    // to the `clear-all` in the title bar.
    vscode.commands.registerCommand('tm1.recent.remove', async (item: RecentItem) => {
      if (!item || !item.serverId || !item.name) { return; }
      await recentProvider.remove(item);
    }),
    // Pin: the entry stays at the top and never drops out of the list (favorite).
    vscode.commands.registerCommand('tm1.recent.pin', async (item: RecentItem) => {
      if (item?.serverId && item.name) { await recentProvider.setPinned(item, true); }
    }),
    vscode.commands.registerCommand('tm1.recent.unpin', async (item: RecentItem) => {
      if (item?.serverId && item.name) { await recentProvider.setPinned(item, false); }
    }),
    vscode.commands.registerCommand('tm1.recent.clear', async () => {
      await recentProvider.clear();
    }),
  );
}

import * as vscode from 'vscode';
import { fetchNamesOrThrow } from '../providers/fetchNames';
import { errMsg } from '../utils/errMsg';
import { getConnectedIdsRestored, getServerConfig } from '../serverState/state';
import { getIconForNodeType, type Tm1NodeType } from '../providers/tm1TreeNodes';
import type { ActivationContext } from './context';

/**
 * tm1.goToObject — jump to any object on any connected server by typing its
 * name, like Ctrl+P for files. Reuses the tree's open commands: they only read
 * `node.meta`, so a plain object with the same fields is enough.
 */
const KINDS: Array<{ endpoint: string; nodeType: Tm1NodeType; command: string; metaKey: string }> = [
  { endpoint: 'Processes',  nodeType: 'process',   command: 'tm1.openProcessEditor', metaKey: 'processName' },
  { endpoint: 'Cubes',      nodeType: 'cube',      command: 'tm1.openCubeRules',     metaKey: 'cubeName' },
  { endpoint: 'Dimensions', nodeType: 'dimension', command: 'tm1.browseElements',    metaKey: 'dimName' },
  { endpoint: 'Chores',     nodeType: 'chore',     command: 'tm1.editChore',         metaKey: 'choreName' },
];

interface ObjectPick extends vscode.QuickPickItem {
  command: string;
  node: { meta: Record<string, string> };
}

export function registerGoToObject(ctx: ActivationContext): void {
  const { context, resolveServerName, recentProvider } = ctx;
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.goToObject', async () => {
      const serverIds = await getConnectedIdsRestored();
      if (serverIds.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: No server connected.'));
        return;
      }
      const qp = vscode.window.createQuickPick<ObjectPick | vscode.QuickPickItem>();
      qp.placeholder = vscode.l10n.t('Type to search processes, cubes, dimensions and chores');
      qp.matchOnDescription = true;
      qp.busy = true;
      qp.onDidAccept(() => {
        const pick = qp.selectedItems[0] as ObjectPick | undefined;
        qp.hide();
        if (pick?.command) { void vscode.commands.executeCommand(pick.command, pick.node); }
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();

      const recent: ObjectPick[] = recentProvider.getItems()
        .filter(it => (it.kind === 'process' || it.kind === 'rule') && getServerConfig(it.serverId))
        .map(it => {
          const kind = it.kind === 'process' ? KINDS[0] : KINDS[1];
          return {
            label: it.name,
            description: it.serverName ?? resolveServerName(it.serverId),
            iconPath: getIconForNodeType(kind.nodeType, {}, context.extensionUri),
            command: kind.command,
            node: { meta: { serverId: it.serverId, [kind.metaKey]: it.name } },
          };
        });

      const perServer = await Promise.all(serverIds.map(async serverId => {
        const cfg = getServerConfig(serverId);
        if (!cfg) { return []; }
        const serverName = resolveServerName(serverId) ?? serverId;
        let failure: string | undefined;
        const lists = await Promise.all(KINDS.map(async kind =>
          (await fetchNamesOrThrow(kind.endpoint, cfg).catch((err: unknown) => {
            failure ??= errMsg(err);
            return [] as string[];
          })).map((name): ObjectPick => ({
            label: name,
            description: serverName,
            iconPath: getIconForNodeType(kind.nodeType, {}, context.extensionUri),
            command: kind.command,
            node: { meta: { serverId, [kind.metaKey]: name } },
          }))));
        // A server that did not answer used to just be missing from the list.
        return failure === undefined
          ? lists.flat()
          : [{ label: `${serverName}: ${failure}`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem, ...lists.flat()];
      }));

      qp.items = [
        ...(recent.length ? [{ label: vscode.l10n.t('Recent & Favorites'), kind: vscode.QuickPickItemKind.Separator }, ...recent] : []),
        { label: vscode.l10n.t('All objects'), kind: vscode.QuickPickItemKind.Separator },
        ...perServer.flat(),
      ];
      qp.busy = false;
    }),
  );
}

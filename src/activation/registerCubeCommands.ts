import * as vscode from 'vscode';
import { getServerConfig, requireServerConfig } from '../commands/serverManager';
import { RuleEditorManager } from '../commands/rule/ruleEditor';
import { CubeViewerManager } from '../commands/cubeViewer/manager';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { runCubeMaintenance } from './cubeMaintenance';
import type { ActivationContext } from './context';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { ReorderDimsWebview } from '../webviews/reorderDimsWebview';
import { newMdxViewCommand } from '../commands/cubeViewer/newMdxView';
import { createPicklistCubeCommand, deletePicklistCubeCommand } from '../commands/cube/picklistCube';
import { deleteCubeViewsCommand, deleteCubesCommand } from '../commands/tree/deleteViewsSubsets';
import { deployViewsToServerCommand } from '../commands/tree/deployViewsSubsets';
import { getCubeDimensionNames } from '../tm1Rest/cubeApi';
import { runOverfeedingScan } from '../commands/cubeViewer/feederAudit';
import { FeederAuditPanel } from '../webviews/feederAuditWebview';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';

/**
 * Registers cube commands:
 *   cubeSaveData / cubeUnload / cubeLoad
 *   openCubeRules / openCubeViewer / deleteCubeView
 */
export function registerCubeCommands(ctx: ActivationContext): void {
  const { context, treeDataProvider, recentProvider, resolveServerName, cubeOverviewManager } = ctx;

  FeederAuditPanel.initialize(context.extensionUri);
  registerServerDisposer('feederAudit', (url) => FeederAuditPanel.disposePanelsForServer(url));

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.scanOverfedCells', async (node: Tm1TreeNode) => {
      const cubeName = (node?.meta?.cubeName as string) ?? '';
      if (!cubeName) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = requireServerConfig(serverId);
      if (!cfg) { return; }
      // The dimension order is not decoration: the output of mode 105
      // is a bare coordinate without field names, and only via this list
      // can one check whether the number of positions fits at all.
      const dims = await getCubeDimensionNames(cfg, cubeName);
      await runOverfeedingScan(cubeName, dims, cfg, serverId);
    }),
    vscode.commands.registerCommand('tm1.cubeSaveData', (node: Tm1TreeNode) => runCubeMaintenance(node, 'SaveData', false)),
    vscode.commands.registerCommand('tm1.cubeUnload',   async (node: Tm1TreeNode) => {
      if (await runCubeMaintenance(node, 'Unload', true)) { treeDataProvider.markCubeLoaded(node, false); }
    }),
    vscode.commands.registerCommand('tm1.cubeLoad',     async (node: Tm1TreeNode) => {
      if (await runCubeMaintenance(node, 'Load', false)) { treeDataProvider.markCubeLoaded(node, true); }
    }),
    vscode.commands.registerCommand('tm1.reorderCubeDimensions', async (node: Tm1TreeNode) => {
      const cubeName = node?.meta?.cubeName as string | undefined;
      if (!cubeName) { return; }
      const cfg = getServerConfig(node?.meta?.serverId as string);
      if (!cfg) { return; }
      await ReorderDimsWebview.open(cubeName, cfg);
    }),
    vscode.commands.registerCommand('tm1.openCubeRules', async (node: Tm1TreeNode) => {
      const name = (node?.meta?.cubeName as string) ?? '';
      if (!name) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      await RuleEditorManager.open(name, cfg, undefined, () => {
        if (serverId) {
          treeDataProvider.invalidateCubeRulesCache(serverId, name);
          treeDataProvider.refreshCategory(serverId, 'Cubes');
        }
      });
      if (serverId) {
        void recentProvider.addRecent({
          kind: 'rule',
          serverId,
          serverName: resolveServerName(serverId),
          name,
        });
      }
    }),
    vscode.commands.registerCommand('tm1.openCubeViewer', (node: Tm1TreeNode) => {
      const cubeName = (node?.meta?.cubeName as string) ?? '';
      if (!cubeName) { return; }
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      const viewName = node?.meta?.viewName as string | undefined;
      const isPrivate = !!node?.meta?.isPrivate;
      void CubeViewerManager.open(cubeName, cfg, viewName, isPrivate);
    }),
    // Internal: open a cube by name + config (no Tree node). Used by the
    // dimension browser's "Attribute cube" button to avoid an import cycle.
    vscode.commands.registerCommand('tm1.internal.openCubeByName', (cubeName: string, cfg: Tm1Config) =>
      CubeViewerManager.open(cubeName, cfg),
    ),
    { dispose: () => CubeViewerManager.disposeAll() },
    vscode.commands.registerCommand('tm1.cubeOverview', (node?: Tm1TreeNode) => {
      const cfg = requireServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      cubeOverviewManager.open(cfg);
    }),
    vscode.commands.registerCommand('tm1.newMdxView', (node: Tm1TreeNode) => newMdxViewCommand(node)),
    // Accepts the whole selection in addition to the clicked node — the
    // Explorer allows multi-select, and a second command for the same thing
    // would only be a second menu entry.
    vscode.commands.registerCommand('tm1.deleteCubeView', (node: Tm1TreeNode, selection?: Tm1TreeNode[]) =>
      // Views live under a Cube → refresh the Cubes subtree on this server.
      deleteCubeViewsCommand(node, selection, serverId => treeDataProvider.refreshCategory(serverId, 'Cubes'))),
    vscode.commands.registerCommand('tm1.deployViewsToServer', (node: Tm1TreeNode, selection?: Tm1TreeNode[]) =>
      deployViewsToServerCommand(node, selection)),
    // Picklist control cube: only create and delete. It is edited
    // with Cube Viewer (cells) or Rule Editor (rules) — as in Architect.
    vscode.commands.registerCommand('tm1.createPicklistCube', (node: Tm1TreeNode) =>
      createPicklistCubeCommand(node, () => treeDataProvider.refreshCategory(node?.meta?.serverId, 'Cubes')),
    ),
    vscode.commands.registerCommand('tm1.deletePicklistCube', (node: Tm1TreeNode) =>
      deletePicklistCubeCommand(node, () => treeDataProvider.refreshCategory(node?.meta?.serverId, 'Cubes')),
    ),
    // One or many: the Explorer passes the whole selection as the second argument.
    vscode.commands.registerCommand('tm1.deleteCube', (node: Tm1TreeNode, selection?: Tm1TreeNode[]) =>
      deleteCubesCommand(
        node, selection,
        serverId => treeDataProvider.refreshCategory(serverId, 'Cubes'),
        (cubeName, serverUrl) => RuleEditorManager.disposePanelForCube(cubeName, serverUrl),
      )),
  );
}

import * as vscode from 'vscode';
import { getServerConfig, requireServerConfig } from '../commands/serverManager';
import { openDimensionBrowser } from '../commands/dimension/dimensionBrowser';
import { DimensionEditorManager } from '../commands/dimension/dimensionEditor';
import { formatElementsCommand } from '../commands/dimension/formatElements';
import { createDimensionCommand } from '../commands/dimension/createDimension';
import { createCubeCommand } from '../commands/cubeViewer/createCube';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { listSubsetElementNames, getSubset } from '../tm1Rest/subsetApi';
import {
  createHierarchy as createHierarchyRest,
  deleteHierarchy as deleteHierarchyRest,
} from '../tm1Rest/dimensionApi';
import { noteSubsetRead } from '../commands/dimension/dimensionSubsetSave';
import { deleteSubsetsCommand, deleteDimensionsCommand } from '../commands/tree/deleteViewsSubsets';
import { deploySubsetsToServerCommand } from '../commands/tree/deployViewsSubsets';
import { confirmAndRun } from '../commands/confirmAndRun';
import type { ActivationContext } from './context';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * Registers dimension commands:
 *   createDimension / createCube
 *   browseElements / editDimension / openSubset / deleteSubset
 */
export function registerDimensionCommands(ctx: ActivationContext): void {
  const { context, treeDataProvider, dimensionOverviewManager } = ctx;

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.createDimension', (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      return createDimensionCommand(node, () => treeDataProvider.refreshCategory(serverId, 'Dimensions'));
    }),
    vscode.commands.registerCommand('tm1.createCube', (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      return createCubeCommand(node, () => treeDataProvider.refreshCategory(serverId, 'Cubes'), context.extensionUri);
    }),
    vscode.commands.registerCommand('tm1.browseElements', (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      // Hierarchy-aware: from a hierarchy node, browse that hierarchy directly.
      const hierName = node?.meta?.hierName as string | undefined;
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      void openDimensionBrowser(dimName, cfg, {
        mode: 'standalone',
        multiSelect: false,
        initialHier: hierName,
        onSubsetSaved: () => treeDataProvider.refreshCategory(serverId, 'Dimensions'),
      });
    }),
    vscode.commands.registerCommand('tm1.formatElements', async (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      if (!dimName) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: No Dimension selected.')); return; }
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server not connected.')); return; }
      await formatElementsCommand(dimName, cfg);
    }),
    vscode.commands.registerCommand('tm1.sortOrder', async (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      if (!dimName) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: No Dimension selected.')); return; }
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server not connected.')); return; }
      // Opens the Dimension Editor with its sort dialog on top. From a hierarchy
      // node: that hierarchy; from a dimension node: the default one.
      await DimensionEditorManager.open(dimName, cfg, node?.meta?.hierName as string | undefined, true);
    }),
    vscode.commands.registerCommand('tm1.editDimension', async (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      if (!dimName) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: No Dimension selected.')); return; }
      // Hierarchy-aware: from a hierarchy node, open the editor on that hierarchy.
      const hierName = node?.meta?.hierName as string | undefined;
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server not connected.')); return; }
      await DimensionEditorManager.open(dimName, cfg, hierName);
    }),
    // Internal: open the dimension editor by name + config (no Tree node). Used
    // by the dimension browser's editor button to avoid an import cycle.
    vscode.commands.registerCommand('tm1.internal.openDimensionEditor',
      (dimName: string, cfg: Tm1Config, hierName?: string) => DimensionEditorManager.open(dimName, cfg, hierName),
    ),
    vscode.commands.registerCommand('tm1.openSubset', (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      const subsetName = node?.meta?.subsetName as string | undefined;
      const isPrivate = !!node?.meta?.isPrivate;
      if (!dimName || !subsetName) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      // Alternate-hierarchy subsets: open on the subset's real hierarchy so it
      // resolves (index key is Dim:Hier:Sub). Falls back to the default hier.
      const hierName = node?.meta?.hierName as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      void openDimensionBrowser(dimName, cfg, {
        mode: 'standalone',
        multiSelect: false,
        initialSubset: { name: subsetName, isPrivate },
        initialHier: hierName,
        onSubsetSaved: () => treeDataProvider.refreshCategory(serverId, 'Dimensions'),
      });
    }),
    vscode.commands.registerCommand('tm1.editSubset', async (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      const subsetName = node?.meta?.subsetName as string | undefined;
      const isPrivate = !!node?.meta?.isPrivate;
      if (!dimName || !subsetName) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      // Pre-fetch elements + expression in parallel so they're ready before the panel opens.
      // dimName used as hierName (same convention as tree listing).
      // A failed read (`ok: false`, or the rejected promise below) carries a null
      // Expression and is handed on as such — the browser uses it only to prefill
      // the MDX bar and to offer a dynamic save, so null withholds an offer rather
      // than arming a wrong state. Nothing destructive rides on this value: the
      // overwrite re-reads the subset on the host side before it flattens anything.
      const [elementList, subsetInfo] = await Promise.all([
        listSubsetElementNames(cfg, dimName, dimName, subsetName, isPrivate)
          .catch(() => ({ elements: [] as string[], complete: false })),
        getSubset(cfg, dimName, dimName, subsetName, isPrivate).catch(() => null),
      ]);
      // An unfinished element read must not open an editor whose save would write
      // the truncated list back. Opening read-only would be the friendlier option,
      // but the browser arms its overwrite from the same state — so refuse here.
      if (!elementList.complete) {
        vscode.window.showErrorMessage(vscode.l10n.t(
          'TM1: Subset "{0}" could not be read completely. Editing it now would truncate it on save — try again.',
          subsetName,
        ));
        return;
      }
      const initialElements = elementList.elements;
      noteSubsetRead(cfg, dimName, dimName, subsetName, isPrivate, true);
      void openDimensionBrowser(dimName, cfg, {
        mode: 'selection',
        multiSelect: true,
        initialSelection: initialElements,
        initialSubset: { name: subsetName, isPrivate },
        initialExpression: subsetInfo?.Expression ?? null,
        editSubset: true,
        onSubsetSaved: () => treeDataProvider.refreshCategory(serverId, 'Dimensions'),
      });
    }),
    // As when deleting a view: one command for one as for many.
    vscode.commands.registerCommand('tm1.deleteSubset', (node: Tm1TreeNode, selection?: Tm1TreeNode[]) =>
      deleteSubsetsCommand(node, selection, serverId => treeDataProvider.refreshCategory(serverId, 'Dimensions'))),
    vscode.commands.registerCommand('tm1.deploySubsetsToServer', (node: Tm1TreeNode, selection?: Tm1TreeNode[]) =>
      deploySubsetsToServerCommand(node, selection)),
    // One or many: the Explorer passes the whole selection as the second argument.
    vscode.commands.registerCommand('tm1.deleteDimension', (node: Tm1TreeNode, selection?: Tm1TreeNode[]) =>
      deleteDimensionsCommand(node, selection,
        serverId => treeDataProvider.refreshCategory(serverId, 'Dimensions'))),
    vscode.commands.registerCommand('tm1.createHierarchy', async (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      const serverId = node?.meta?.serverId as string | undefined;
      if (!dimName) { return; }
      const input = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        title: vscode.l10n.t('New hierarchy in dimension "{0}"', dimName),
        prompt: vscode.l10n.t('Hierarchy name'),
        placeHolder: vscode.l10n.t('e.g. ByBrand'),
        validateInput: (v) => (v.trim().length > 0 ? undefined : vscode.l10n.t('Name must not be empty')),
      });
      const hierName = input?.trim();
      if (!hierName) { return; }
      await confirmAndRun({
        // Creating needs no confirmation — the input dialog is the confirmation.
        serverId,
        invalidate: ['Hierarchies'],
        run: (cfg) => createHierarchyRest(cfg, dimName, hierName),
        success: vscode.l10n.t('TM1: Hierarchy "{0}" was created.', hierName),
        failure: (d) => vscode.l10n.t('TM1: Hierarchy "{0}" could not be created: {1}', hierName, d),
        refresh: () => treeDataProvider.refreshCategory(serverId, 'Dimensions'),
      });
    }),
    vscode.commands.registerCommand('tm1.deleteHierarchy', async (node: Tm1TreeNode) => {
      const dimName = node?.meta?.dimName as string | undefined;
      const hierName = node?.meta?.hierName as string | undefined;
      const serverId = node?.meta?.serverId as string | undefined;
      if (!dimName || !hierName) { return; }
      await confirmAndRun({
        confirm: vscode.l10n.t('Really delete hierarchy "{0}" of dimension "{1}"? This cannot be undone.', hierName, dimName),
        serverId,
        invalidate: ['Hierarchies'],
        // The default hierarchy (name == dimension name) is attempted too —
        // whether TM1 allows that is decided by TM1, not the client (spec §6.3).
        run: (cfg) => deleteHierarchyRest(cfg, dimName, hierName),
        success: vscode.l10n.t('TM1: Hierarchy "{0}" was deleted.', hierName),
        failure: (d) => vscode.l10n.t('TM1: Hierarchy "{0}" could not be deleted: {1}', hierName, d),
        refresh: () => treeDataProvider.refreshCategory(serverId, 'Dimensions'),
      });
    }),
    vscode.commands.registerCommand('tm1.dimensionOverview', (node?: Tm1TreeNode) => {
      const cfg = requireServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      dimensionOverviewManager.open(cfg);
    }),
  );
}

import * as vscode from 'vscode';
import { openCubeSecurityMatrix, initializeCubeSecurityMatrix, disposeAllCubeSecurityMatrix, disposeCubeSecurityMatrixForServer } from '../commands/security/cubeSecurityMatrix';
import { openDimSecurityMatrix, initializeDimSecurityMatrix, disposeAllDimSecurityMatrix, disposeDimSecurityMatrixForServer } from '../commands/security/dimSecurityMatrix';
import { openProcessSecurityMatrix, initializeProcessSecurityMatrix, disposeAllProcessSecurityMatrix, disposeProcessSecurityMatrixForServer } from '../commands/security/processSecurityMatrix';
import { openElementSecurity, initializeElementSecurity, disposeAllElementSecurity, disposeElementSecurityForServer } from '../commands/security/elementSecurity';
import { openUserGroupManager, initializeUserGroupManager, disposeAllUserGroupManager, disposeUserGroupManagerForServer } from '../commands/security/userGroupManager';
import { CubeViewerManager } from '../commands/cubeViewer/manager';
import { getServerConfig, getServerIdByUrl } from '../serverState/state';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { cubeExists } from '../security/api/elementSecurityApi';
import { getCubeDimensionNames, getStorageDimensionOrder } from '../tm1Rest/cubeApi';
import { CellSecurityBuilderWebview } from '../commands/security/cellSecurityBuilderWebview';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import type { ActivationContext } from './context';

/**
 * Registers commands for the TM1 Security Manager feature.
 * Cube/Dim/Process security exposed as root-element MATRIX views
 * (groups × resources). Element security still per-dimension.
 * User/Group manager opens per server.
 */
export function registerSecurityCommands(ctx: ActivationContext): void {
  const { context } = ctx;
  initializeCubeSecurityMatrix(context.extensionUri);
  initializeDimSecurityMatrix(context.extensionUri);
  initializeProcessSecurityMatrix(context.extensionUri);
  initializeElementSecurity(context.extensionUri);
  // globalState, so that the alias choice per server holds across workspaces.
  initializeUserGroupManager(context.extensionUri, context.globalState);

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.security.cubes.matrix', async (node: Tm1TreeNode) => {
      const serverId = (node?.meta?.serverId as string) ?? '';
      if (!serverId) {
        vscode.window.showWarningMessage(vscode.l10n.t('Server context required for the Cube Security Matrix'));
        return;
      }
      await openCubeSecurityMatrix(serverId);
    }),
    vscode.commands.registerCommand('tm1.security.dims.matrix', async (node: Tm1TreeNode) => {
      const serverId = (node?.meta?.serverId as string) ?? '';
      if (!serverId) {
        vscode.window.showWarningMessage(vscode.l10n.t('Server context required for the Dimension Security Matrix'));
        return;
      }
      await openDimSecurityMatrix(serverId);
    }),
    vscode.commands.registerCommand('tm1.security.processes.matrix', async (node: Tm1TreeNode) => {
      const serverId = (node?.meta?.serverId as string) ?? '';
      if (!serverId) {
        vscode.window.showWarningMessage(vscode.l10n.t('Server context required for the Process Security Matrix'));
        return;
      }
      await openProcessSecurityMatrix(serverId);
    }),
    vscode.commands.registerCommand('tm1.security.cell', async (node: Tm1TreeNode) => {
      const cubeName = (node?.meta?.cubeName as string) ?? '';
      const serverId = (node?.meta?.serverId as string) ?? '';
      if (!cubeName || !serverId) {
        vscode.window.showWarningMessage(vscode.l10n.t('Cube context required for Cell Security'));
        return;
      }
      const cfg = getServerConfig(serverId);
      if (!cfg) {
        vscode.window.showErrorMessage(vscode.l10n.t('Server config not found for {0}', serverId));
        return;
      }
      const secCube = `}CellSecurity_${cubeName}`;
      const exists = await cubeExists(cfg, secCube);
      if (!exists) {
        // cube missing → open builder so user can pick dimensions.
        //
        // STORAGE order, not the logical one: v12 validates the cell-security
        // cube against the parent's storage order and answers a mismatch with
        // HTTP 400 code 306 ("Cell Security Control Cube should have the
        // dimensions and their order the same as the parent cube") — which is
        // exactly what any cube looks like after "Reorder Dimensions (Storage)".
        // 11.8 accepts either order, so storage order is right on both
        // (live-verified 2026-07-26 on 11.8.02900.8 and on v12).
        // `tm1.DimensionsStorageOrder()` is missing before 11.4 → fall back.
        const sourceDims = await getStorageDimensionOrder(cfg, cubeName)
          .catch(() => getCubeDimensionNames(cfg, cubeName));
        if (!sourceDims.length) {
          void vscode.window.showErrorMessage(vscode.l10n.t('Cube "{0}" has no dimensions.', cubeName));
          return;
        }
        CellSecurityBuilderWebview.open(cubeName, sourceDims, cfg);
        return; // builder handles creation + opening CubeViewer
      }
      await CubeViewerManager.open(secCube, cfg);
    }),
    vscode.commands.registerCommand('tm1.security.element', async (node: Tm1TreeNode) => {
      const dimName = (node?.meta?.dimName as string) ?? '';
      const serverId = (node?.meta?.serverId as string) ?? '';
      if (!dimName || !serverId) {
        vscode.window.showWarningMessage(vscode.l10n.t('Dimension context required for Manage Element Security'));
        return;
      }
      await openElementSecurity(serverId, dimName);
    }),
    vscode.commands.registerCommand('tm1.security.users', async (node?: Tm1TreeNode) => {
      const serverIdFromNode = (node?.meta?.serverId as string) ?? '';
      if (serverIdFromNode) {
        await openUserGroupManager(serverIdFromNode);
        return;
      }
      const cfg = vscode.workspace.getConfiguration('tm1');
      const servers = (cfg.get<Array<{ id: string; name: string }>>('servers') ?? []);
      if (servers.length === 0) {
        vscode.window.showWarningMessage(vscode.l10n.t('No TM1 servers configured'));
        return;
      }
      if (servers.length === 1) {
        await openUserGroupManager(servers[0].id);
        return;
      }
      const pick = await vscode.window.showQuickPick(
        servers.map(s => ({ label: s.name, description: s.id, id: s.id })),
        { placeHolder: 'Select TM1 server' },
      );
      if (pick) await openUserGroupManager(pick.id);
    }),
    { dispose: () => disposeAllCubeSecurityMatrix() },
    { dispose: () => disposeAllDimSecurityMatrix() },
    { dispose: () => disposeAllProcessSecurityMatrix() },
    { dispose: () => disposeAllElementSecurity() },
    { dispose: () => disposeAllUserGroupManager() },
  );

  // Close every security panel of a server when it disconnects. The panels are
  // keyed by serverId, so resolve it from the disconnected serverUrl.
  registerServerDisposer('security', (serverUrl) => {
    const serverId = getServerIdByUrl(serverUrl);
    if (!serverId) return;
    disposeCubeSecurityMatrixForServer(serverId);
    disposeDimSecurityMatrixForServer(serverId);
    disposeProcessSecurityMatrixForServer(serverId);
    disposeElementSecurityForServer(serverId);
    disposeUserGroupManagerForServer(serverId);
  });

  // The cell security builder hangs alongside: it is keyed by the server URL,
  // not by the serverId, because it is handed the Tm1Config directly. A line of
  // its own instead of joining the block above, so that the URL→id
  // resolution does not silently skip it when it fails.
  registerServerDisposer('cellSecurityBuilder', (serverUrl) => {
    CellSecurityBuilderWebview.disposePanelsForServer(serverUrl);
  });
}

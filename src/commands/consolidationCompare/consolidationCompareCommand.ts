import * as vscode from 'vscode';
import { getServerConfig } from '../../serverState/state';
import { listHierarchyNames } from '../../tm1Rest/dimensionApi';
import { defaultHierarchyName } from '../../tm1Rest/elementFormatApi';
import { ConsolidationComparePanel } from '../../webviews/consolidationCompareWebview';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

export function registerConsolidationCompareCommand(context: vscode.ExtensionContext): void {
  ConsolidationComparePanel.initialize(context.extensionUri, context);
  registerServerDisposer('consolidationCompare', (url) => ConsolidationComparePanel.disposePanelsForServer(url));
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.compareConsolidations',
      async (node?: { meta?: { serverId?: string; dimName?: string } }) => {
        const dim = node?.meta?.dimName;
        const serverId = node?.meta?.serverId;
        const cfg = serverId ? getServerConfig(serverId) : undefined;
        if (!dim || !cfg) {
          vscode.window.showErrorMessage(vscode.l10n.t('No server selected'));
          return;
        }
        // `Leaves` is TM1's flat all-leaves hierarchy — it has no consolidations.
        const hiers = (await listHierarchyNames(cfg, dim)).filter(h => h.toLowerCase() !== 'leaves');
        // Opens on the default hierarchy (the same-name one is not guaranteed);
        // the panel itself switches between hierarchies.
        const hier = hiers.length === 1 ? hiers[0] : await defaultHierarchyName(cfg, dim);
        ConsolidationComparePanel.open(cfg, serverId as string, dim, hier);
      }),
  );
}

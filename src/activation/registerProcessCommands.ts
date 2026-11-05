import * as vscode from 'vscode';
import { runProcessCoverageCommand } from '../commands/processCoverage';
import * as path from 'path';
import { executeProcess } from '../tm1Rest/executionApi';
import { getServerConfig, getConnectedIds, requireServerConfig } from '../commands/serverManager';
import { deployCommand, pickDeployTarget, parseProcessName } from '../commands/processEditor/deploy';
import { parseSections, toRestVariables } from '../utils/proFile';
import { executeCommand } from '../commands/processEditor/execute';
import { notifyExecuteResult } from '../commands/processEditor/executeNotify';
import { newProcessCommand } from '../commands/processEditor/newProcess';
import {
  deployProcessToServerCommand, deployMultipleProcessesToServerCommand,
} from '../commands/processEditor/deployToServer';
import { exportSelectedProcessesCommand, loadProcessesCommand } from '../commands/processEditor/loadProcesses';
import { showServerParameterForm } from '../commands/processEditor/processParams';
import { runCancellableProcess } from '../runState/runCancellableProcess';
import { Tm1DebugAdapter, TM1_DEBUG_TYPE } from '../debug/tm1DebugAdapter';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { getProcessParameters } from '../tm1Rest/processApi';
import { deleteProcessesCommand } from '../commands/tree/deleteViewsSubsets';
import { wrap } from './wrap';
import { errMsg } from '../utils/errMsg';
import { outputChannel } from '../utils/outputChannel';
import { setRecentRecorder } from '../commands/processEditor/recentBridge';
import type { ActivationContext } from './context';

/**
 * Registers process-domain commands:
 *   deployProcess / executeProcess / deployAndExecute / debugProcess
 *   newProcess / deployProcessToServer / deployMultipleProcessesToServer / exportSelectedProcesses
 *   executeProcessFromTree / deployProcessFromTree / debugProcessFromTree
 *   deleteProcess / openProcessEditor
 *   + DebugAdapter registration
 */
export function registerProcessCommands(ctx: ActivationContext): void {
  const {
    context, treeDataProvider, processEditorManager, processOverviewManager,
    recentProvider, resolveServerName, tplStorage,
  } = ctx;

  // Let webview panels (Find/Replace, Consistency Normalizer) and the process
  // editor's Ctrl+click navigation, which open an editor via
  // openPanel.openProcess / RuleEditorManager.open, record it in
  // "Recently opened" too.
  setRecentRecorder((kind, serverId, name) => {
    void recentProvider.addRecent({
      kind,
      serverId,
      serverName: resolveServerName(serverId),
      name,
    });
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.loadProcesses',    wrap(vscode.l10n.t('Load'),          () => loadProcessesCommand())),
    vscode.commands.registerCommand('tm1.deployProcess',    wrap('Deploy',         () => deployCommand())),
    vscode.commands.registerCommand('tm1.executeProcess',   wrap('Execute',        () => executeCommand())),
    vscode.commands.registerCommand('tm1.deployAndExecute', wrap('Deploy & Execute', async () => {
      const cfg = await pickDeployTarget();
      if (!cfg) { return; }
      await deployCommand(cfg);
      await executeCommand(cfg);
    })),
    vscode.commands.registerCommand('tm1.debugProcess', wrap('Debug', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const content = editor.document.getText();
      const processName = parseProcessName(content)
        ?? path.basename(editor.document.fileName, path.extname(editor.document.fileName));
      const debugCfg = await pickDeployTarget();
      if (!debugCfg) { return; }
      const { checkAndConfirmSync } = await import('../commands/processEditor/syncCheck');
      const sync = await checkAndConfirmSync(processName, editor.document, debugCfg);
      if (sync === 'cancel') { return; }
      if (sync === 'deploy') { await deployCommand(debugCfg); }

      if (sync !== 'deploy') {
        const { findUndefinedVariables } = await import('../tiLogicVisualizer/tiLinter');
        const { parseParametersFromFileContent: parsePF } = await import('../commands/processEditor/processParams');
        const sections = parseSections(content);
        const allEmpty = !sections.prolog && !sections.metadata && !sections.data && !sections.epilog;
        const sectionsForCheck = allEmpty ? { prolog: content, metadata: '', data: '', epilog: '' } : sections;
        const paramNames = new Set(parsePF(content).map(p => p.Name));
        const dsVarNames = new Set(toRestVariables(content).filter(v => !v.Ignored).map(v => v.Name));
        const undefinedVars = findUndefinedVariables(sectionsForCheck, paramNames, dsVarNames);
        if (undefinedVars.length > 0) {
          const varList = undefinedVars.map(v => `• ${v.name}`).join('\n');
          await vscode.window.showErrorMessage(
            vscode.l10n.t('TM1: Debug not possible — the following variables are not defined:\n\n{0}', varList),
            { modal: true },
            'OK',
          );
          return;
        }
      }

      const { parseParametersFromFileContent, showParameterForm } = await import('../commands/processEditor/processParams');
      const params = parseParametersFromFileContent(content);
      const parameters = await showParameterForm(processName, params, editor.document);
      if (parameters === undefined) { return; }
      // Name the connection by profile id, not by URL: `pickDeployTarget`
      // returns the very Tm1Config object held in the connected-servers map,
      // so reference identity is an exact reverse lookup — unlike matching on
      // serverUrl, which collapses two profiles on one gateway into one.
      // undefined ⇒ nothing connected (pickDeployTarget fell back to the
      // legacy workspace-settings config), which the adapter resolves the
      // same way.
      const serverId = getConnectedIds().find(id => getServerConfig(id) === debugCfg);
      await vscode.debug.startDebugging(undefined, {
        type: TM1_DEBUG_TYPE, request: 'launch', name: `TM1 Debug: ${processName}`, processName, parameters, serverId,
      });
    })),
    vscode.commands.registerCommand('tm1.newProcess',
      wrap(vscode.l10n.t('New process'), (node?: Tm1TreeNode) => newProcessCommand(processEditorManager, tplStorage, context.extensionUri, node))),
    vscode.commands.registerCommand('tm1.deployProcessToServer',
      wrap(vscode.l10n.t('Deploy to server'), (node?: Tm1TreeNode) => deployProcessToServerCommand(node))),
    vscode.commands.registerCommand('tm1.deployMultipleProcessesToServer',
      wrap(vscode.l10n.t('Multi-deploy to server'), (node?: Tm1TreeNode, sel?: Tm1TreeNode[]) => deployMultipleProcessesToServerCommand(node, sel))),
    vscode.commands.registerCommand('tm1.exportSelectedProcesses',
      wrap(vscode.l10n.t('Export processes as .pro'), (node?: Tm1TreeNode, sel?: Tm1TreeNode[]) => exportSelectedProcessesCommand(node, sel))),

    vscode.commands.registerCommand('tm1.executeProcessFromTree', async (node: Tm1TreeNode) => {
      const name = node?.meta?.processName as string;
      if (!name) { return; }
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      try {
        const apiParams = (await getProcessParameters(cfg, name)) as Array<{ Name: string; Type: string; Value: string; Prompt: string }>;

        let parameters: Array<{ Name: string; Value: string | number }> = [];
        if (apiParams.length > 0) {
          const result = await showServerParameterForm(name, apiParams, vscode.l10n.t('Execute'), cfg.serverUrl);
          if (result === undefined) { return; }
          parameters = result;
        }

        const { result, cancelled } = await runCancellableProcess(
          vscode.l10n.t('TM1: Running "{0}"…', name), name, cfg,
          () => executeProcess(name, parameters, cfg),
        );
        if (cancelled) {
          vscode.window.showWarningMessage(vscode.l10n.t('TM1: "{0}" was cancelled.', name));
        } else if (result) {
          await notifyExecuteResult(name, result, cfg);
        }
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 Execute error: {0}', errMsg(err)));
      }
    }),
    vscode.commands.registerCommand('tm1.deployProcessFromTree', (node: Tm1TreeNode) => {
      const name = node?.meta?.processName as string;
      if (!name) { return; }
      vscode.window.showInformationMessage(
        vscode.l10n.t('TM1: To deploy "{0}", open the .pro file in the editor and use the deploy command.', name),
      );
    }),
    vscode.commands.registerCommand('tm1.deleteProcess', (
      node: Tm1TreeNode | undefined,
      selection: Tm1TreeNode[] | undefined,
    ) => deleteProcessesCommand(
      node, selection,
      serverId => treeDataProvider.refreshCategory(serverId, 'Processes'),
      (name, serverId, cfg) => {
        // Close the editor panel if it's still open — the process no longer exists.
        processEditorManager.disposePanel(name, cfg.serverUrl);
        // Remove it from "Recent" as well: otherwise the entry would point to a
        // process that no longer exists on the server. Applies to both
        // paths — deletion happens from the Explorer as well as from the list itself.
        void recentProvider.remove({ kind: 'process', serverId, name });
      },
    )),
    vscode.commands.registerCommand('tm1.debugProcessFromTree', async (node: Tm1TreeNode) => {
      const name = node?.meta?.processName as string;
      if (!name) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      let parameters: Array<{ Name: string; Value: string | number }> = [];
      try {
        const apiParams = (await getProcessParameters(cfg, name)) as Array<{ Name: string; Type: string; Value: string; Prompt: string }>;
        if (apiParams.length > 0) {
          const result = await showServerParameterForm(name, apiParams, vscode.l10n.t('Debug'), cfg.serverUrl);
          if (result === undefined) { return; }
          parameters = result;
        }
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1 Debug error: {0}', errMsg(err)));
        return;
      }
      vscode.debug.startDebugging(undefined, {
        type: TM1_DEBUG_TYPE,
        request: 'launch',
        name: `TM1 Debug: ${name}`,
        processName: name,
        parameters,
        // The cfg above was resolved from this id — hand the id along so the
        // adapter debugs the same profile instead of the last active one.
        serverId,
      });
    }),
    vscode.commands.registerCommand('tm1.runProcessCoverage', (node: Tm1TreeNode) => {
      const name = node?.meta?.processName as string;
      const cfg = getServerConfig(node?.meta?.serverId as string);
      if (!name || !cfg) { return; }
      return runProcessCoverageCommand(cfg, name,
        (c, n, section, line) => processEditorManager.openProcess(n, undefined, c, { section, line }));
    }),
    vscode.commands.registerCommand('tm1.openProcessEditor', (node: Tm1TreeNode) => {
      const name = node?.meta?.processName as string;
      if (!name) { return; }
      const serverId = node?.meta?.serverId as string | undefined;
      const cfg = getServerConfig(serverId as string);
      if (!cfg) { return; }
      void processEditorManager.openProcess(name, node, cfg);
      if (serverId) {
        void recentProvider.addRecent({
          kind: 'process',
          serverId,
          serverName: resolveServerName(serverId),
          name,
        });
      }
    }),
    vscode.commands.registerCommand('tm1.processOverview', (node?: Tm1TreeNode) => {
      const cfg = requireServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      processOverviewManager.open(cfg);
    }),
    { dispose: () => processEditorManager.disposeAll() },
  );

  // Outside the push above, and guarded: `registerDebugAdapterDescriptorFactory`
  // throws when the type is already taken, and inside the argument list of that
  // one push a throw skipped every registration after this function — the
  // reported `command 'tm1.cubeOverview' not found`. Debugging is one feature;
  // losing it must not cost the chores, cubes, dimensions and language
  // providers that `extension.ts` registers afterwards.
  try {
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterDescriptorFactory(TM1_DEBUG_TYPE, {
        createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new Tm1DebugAdapter()),
      }),
    );
  } catch (err) {
    outputChannel('TM1 Debug').appendLine(`[debug] adapter factory for '${TM1_DEBUG_TYPE}' not registered: ${errMsg(err)}`);
  }
}

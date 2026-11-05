import * as vscode from 'vscode';
import {
  getAllServers,
  getServerConfig,
  listServerFolders,
  createServerFolder,
  setServerFolder,
  renameServerFolder,
  deleteServerFolder,
  getProcessGroupOverrides,
  setProcessGroupOverride,
  clearProcessGroupOverride,
} from '../commands/serverManager';
import { getProcessParameters } from '../tm1Rest/processApi';
import { Tm1TreeNode, type Tm1NodeType } from '../providers/tm1TreeNodes';
import { isControlToggleGroup } from '../providers/tm1TreeDataProvider';
import { invalidateCache, fetchNames } from '../providers/fetchNames';
import {
  DEFAULT_PROCESS_GROUP_MODE,
  isProcessGroupingMode,
  type ProcessGroupingMode,
} from '../providers/processGroupingPure';
import { ProcessGroupingPanel } from '../webviews/processGroupingWebview';
import type { ActivationContext } from './context';
import { RuleEditorManager } from '../commands/rule/ruleEditor';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview as ProcessHostToWebview } from '../webviewClient/processEditorMonaco/protocol';
import type { ProcessParamRef } from '../providers/tm1TreeDragDropPure';
import type { HostToWebview as RuleHostToWebview } from '../webviewClient/ruleEditorMonaco/protocol';

/**
 * Registers TM1 Explorer tree commands and node-context commands:
 *   refreshExplorer/filterExplorer/clearFilter/retryNode/toggleSystemObjects
 *   setProcessGrouping/openCubeStatsDashboard/insertNodeRef/copyName
 */
export function registerTreeCommands(ctx: ActivationContext): void {
  const { context, treeDataProvider, processEditorManager, cubeStatsDashboardManager, tiDiagnostics } = ctx;

  // Show/Hide are two menu entries; which one is visible comes from the category
  // node's own `.ctlShown` contextValue, NOT from a context key. The state is
  // per server AND per object group, and a context key is one global value for
  // the whole window — it showed the wrong verb as soon as two groups (or two
  // servers) disagreed.
  const toggleControlObjects = (node?: Tm1TreeNode): void => {
    const serverId = node?.meta?.serverId as string | undefined;
    const group = node?.meta?.categoryKey;
    if (!serverId || !isControlToggleGroup(group)) { return; }
    treeDataProvider.toggleSystemObjects(serverId, group);
    const hidden = treeDataProvider.isHidingSystemObjects(serverId, group);
    vscode.window.setStatusBarMessage(
      hidden
        ? vscode.l10n.t('TM1: Control objects hidden ({0})', group)
        : vscode.l10n.t('TM1: Control objects shown ({0})', group),
      3000,
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.refreshExplorer', () => {
      // A manual refresh must also drop the fetchNames cache (5-min TTL) so the
      // TI linter's known-object sets (Processes/Cubes/Dimensions/…) pick up
      // objects added on the server since the last connect — e.g. a freshly
      // installed Bedrock library. Then re-lint open TI docs so stale
      // "process does not exist" diagnostics clear without an edit.
      invalidateCache();
      tiDiagnostics.refreshAll();
      treeDataProvider.refresh();
    }),
    vscode.commands.registerCommand('tm1.showControlObjects', toggleControlObjects),
    vscode.commands.registerCommand('tm1.hideControlObjects', toggleControlObjects),
    vscode.commands.registerCommand('tm1.filterExplorer', async () => {
      const text = await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('Search objects…'), placeHolder: vscode.l10n.t('Enter search term'), value: treeDataProvider.filterText });
      if (text !== undefined) {
        treeDataProvider.setFilter(text);
        vscode.commands.executeCommand('setContext', 'tm1.filterActive', text !== '');
      }
    }),
    vscode.commands.registerCommand('tm1.clearFilter', () => {
      treeDataProvider.setFilter('');
      vscode.commands.executeCommand('setContext', 'tm1.filterActive', false);
    }),
    vscode.commands.registerCommand('tm1.retryNode', (node: any) => {
      if (node?.meta?.parentNode) {
        treeDataProvider.refreshNode(node.meta.parentNode);
      }
    }),
    vscode.commands.registerCommand('tm1.openCubeStatsDashboard', async (node: Tm1TreeNode) => {
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: Connect to a server first.'));
        return;
      }
      await cubeStatsDashboardManager.open(cfg);
    }),
    // ── Server folders (optional grouping) ───────────────────────────────────
    vscode.commands.registerCommand('tm1.createServerFolder', async () => {
      const name = (await vscode.window.showInputBox({
        ignoreFocusOut: true,
        prompt: vscode.l10n.t('New folder name'),
      }))?.trim();
      if (name) { await createServerFolder(name); }
    }),
    vscode.commands.registerCommand('tm1.server.moveToFolder', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      if (!serverId) { return; }
      const current = getAllServers(context).find(s => s.id === serverId);
      const NEW = vscode.l10n.t('$(new-folder) New Folder…');
      const REMOVE = vscode.l10n.t('$(close) Remove from Folder');
      const items: vscode.QuickPickItem[] = listServerFolders().map(f => ({
        label: f,
        description: current?.folder === f ? vscode.l10n.t('current') : undefined,
      }));
      items.push({ label: NEW });
      if (current?.folder) { items.push({ label: REMOVE }); }
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Move server to folder'),
      });
      if (!pick) { return; }
      if (pick.label === REMOVE) { await setServerFolder(serverId, undefined); return; }
      if (pick.label === NEW) {
        const name = (await vscode.window.showInputBox({
          ignoreFocusOut: true,
          prompt: vscode.l10n.t('New folder name'),
        }))?.trim();
        if (!name) { return; }
        await createServerFolder(name);
        await setServerFolder(serverId, name);
        return;
      }
      await setServerFolder(serverId, pick.label);
    }),
    vscode.commands.registerCommand('tm1.serverFolder.rename', async (node: Tm1TreeNode) => {
      const oldName = node?.meta?.folderName as string | undefined;
      if (!oldName) { return; }
      const next = (await vscode.window.showInputBox({
        ignoreFocusOut: true,
        prompt: vscode.l10n.t('Rename folder'),
        value: oldName,
      }))?.trim();
      if (next && next !== oldName) { await renameServerFolder(oldName, next); }
    }),
    vscode.commands.registerCommand('tm1.serverFolder.delete', async (node: Tm1TreeNode) => {
      const name = node?.meta?.folderName as string | undefined;
      if (!name) { return; }
      const yes = vscode.l10n.t('Delete');
      const ok = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete folder {0}? Servers move back to the root.', name),
        { modal: true }, yes,
      );
      if (ok === yes) { await deleteServerFolder(name); }
    }),
    vscode.commands.registerCommand('tm1.setProcessGrouping', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const profile = serverId ? getAllServers(context).find(s => s.id === serverId) : undefined;
      if (!profile) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: Server profile not found.'));
        return;
      }
      // Prefill from the server's own override; without one there is no grouping,
      // so the token box starts empty.
      const { suffix: tokenOverrides, mode: modeOverrides } = getProcessGroupOverrides();
      const currentToken = Object.prototype.hasOwnProperty.call(tokenOverrides, profile.id)
        ? tokenOverrides[profile.id]
        : '';
      const storedMode = Object.prototype.hasOwnProperty.call(modeOverrides, profile.id)
        ? modeOverrides[profile.id]
        : DEFAULT_PROCESS_GROUP_MODE;
      const currentMode: ProcessGroupingMode =
        isProcessGroupingMode(storedMode) ? storedMode : DEFAULT_PROCESS_GROUP_MODE;

      // The pattern modes are only judgeable against real names, so the panel
      // previews the grouping live. Without a connection the panel still opens
      // (config is editable), just without preview.
      let names: string[] = [];
      try {
        const cfg = getServerConfig(profile.id);
        if (cfg) { names = await fetchNames('Processes', cfg); }
      } catch {
        names = [];
      }

      ProcessGroupingPanel.initialize(context.extensionUri);
      ProcessGroupingPanel.open({
        serverId: profile.id,
        serverName: profile.name,
        token: currentToken,
        mode: currentMode,
        names,
        onSave: async (token, mode) => {
          // Keyed by id, not name — a rename must not orphan the override.
          await setProcessGroupOverride(profile.id, token, mode);
          // refresh() rebuilds the nodes, so the `.grouped` contextValue (and with it
          // the Configure-vs-Reset menu verb) flips synchronously with the tree.
          treeDataProvider.refresh();
          vscode.window.showInformationMessage(
            vscode.l10n.t('Grouping "{0}": {1} = "{2}"', profile.name, mode, token || vscode.l10n.t('(empty = no grouping)')),
          );
        },
        onReset: async () => {
          await clearProcessGroupOverride(profile.id);
          treeDataProvider.refresh();
          vscode.window.showInformationMessage(vscode.l10n.t('Grouping for "{0}" removed.', profile.name));
        },
      });
    }),
    vscode.commands.registerCommand('tm1.resetProcessGrouping', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const profile = serverId ? getAllServers(context).find(s => s.id === serverId) : undefined;
      if (!profile) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: Server profile not found.'));
        return;
      }
      await clearProcessGroupOverride(profile.id);
      treeDataProvider.refresh();
      vscode.window.showInformationMessage(vscode.l10n.t('Grouping for "{0}" removed.', profile.name));
    }),
    vscode.commands.registerCommand('tm1.insertNodeRef', async (node: Tm1TreeNode) => {
      const { buildDropText, buildExecuteProcessWithParams } = await import('../providers/tm1TreeDragDrop');
      const panel = processEditorManager.getActivePanel();
      if (!panel) {
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: No Process Editor active. Open a process and try again.'));
        return;
      }
      let text = '';
      if (node?.nodeType === 'process') {
        const procName = String(node.meta?.processName ?? node.label);
        const cfg = getServerConfig(node.meta?.serverId);
        if (!cfg) { return; }
        try {
          const calleeParams = (await getProcessParameters(cfg, procName)) as ProcessParamRef[];
          const outerParams = await processEditorManager.getActivePanelParameters();
          const outerNames = outerParams.map(p => p.Name).filter(Boolean);
          text = buildExecuteProcessWithParams(procName, calleeParams, outerNames);
        } catch {
          text = buildDropText(node);
        }
      } else {
        text = buildDropText(node);
      }
      if (!text) {
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: Node type is not supported.'));
        return;
      }
      panel.reveal();
      postTo<ProcessHostToWebview>(panel.webview, { type: 'insertText', text, indent: true });
    }),
    // Public API for other extensions: insert text at the cursor of the focused
    // rule editor, else the last active process editor (active section tab).
    // Resolves true once the message is posted, false when no editor is open.
    vscode.commands.registerCommand('tm1.editor.insertText', (arg?: { text?: unknown; snippet?: unknown }) => {
      const text = typeof arg?.text === 'string' ? arg.text : '';
      if (!text) { return Promise.resolve(false); }
      const panel = RuleEditorManager.getActivePanel() ?? processEditorManager.getActivePanel();
      if (!panel) { return Promise.resolve(false); }
      panel.reveal();
      // Rule or process editor: both protocols carry the same `insertText`.
      return postTo<RuleHostToWebview & ProcessHostToWebview>(panel.webview, { type: 'insertText', text, snippet: arg?.snippet === true });
    }),
    vscode.commands.registerCommand('tm1.copyName', async (node: Tm1TreeNode) => {
      const m = node?.meta ?? {};
      const nameByType: Partial<Record<Tm1NodeType, string | undefined>> = {
        process: m.processName,
        processGroup: m.groupName,
        cube: m.cubeName,
        cubeRule: m.cubeName,
        cubeView: m.viewName,
        cubeDimension: m.dimName,
        dimension: m.dimName,
        hierarchy: m.hierName,
        attribute: m.attrName,
        subset: m.subsetName,
        chore: m.choreName,
      };
      const fallback = typeof node?.label === 'string' ? node.label : undefined;
      const name = nameByType[node?.nodeType as Tm1NodeType] ?? fallback;
      if (!name) { return; }
      await vscode.env.clipboard.writeText(name);
      vscode.window.setStatusBarMessage(`TM1: "${name}" kopiert`, 2000);
    }),
  );
}

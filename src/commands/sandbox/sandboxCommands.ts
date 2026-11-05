/**
 * VS Code commands for sandbox management:
 *   - tm1.sandbox.create            (on sandboxesRoot context menu)
 *   - tm1.sandbox.delete            (on sandbox context menu — discards)
 *   - tm1.sandbox.commit            (on sandbox context menu — merges to base)
 *   - tm1.sandbox.setActive         (on sandbox context menu — set as current)
 *   - tm1.sandbox.clearActive       (on sandboxesRoot — back to base)
 *
 * Phase B of Sandbox-Awareness MVP. Phase A delivered REST + tracker;
 * this module wires the user-facing actions and refreshes the tree.
 */
import * as vscode from 'vscode';
import {
  createSandbox, deleteSandbox, commitSandbox,
} from '../../tm1Rest/sandboxApi';
import { getServerConfig } from '../../serverState/state';
import type { SandboxTracker } from '../../tm1Rest/sandboxTracker';
import { errMsg } from '../../utils/errMsg';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import type { Tm1TreeDataProvider } from '../../providers/tm1TreeDataProvider';
import { collect, confirmDelete, runDelete } from '../tree/deleteViewsSubsets';

const VALID_SANDBOX_RE = /^[A-Za-z0-9_\- .]+$/;

export function registerSandboxCommands(
  context: vscode.ExtensionContext,
  tracker: SandboxTracker,
  treeDataProvider: Tm1TreeDataProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.sandbox.create', async (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      if (!serverId) { vscode.window.showErrorMessage(vscode.l10n.t('Sandbox: no server context')); return; }
      const cfg = getServerConfig(serverId);
      if (!cfg) { vscode.window.showErrorMessage(vscode.l10n.t('Sandbox: server config not found')); return; }

      const name = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        prompt: vscode.l10n.t('New Sandbox name'),
        validateInput: (v) => {
          const t = (v ?? '').trim();
          if (t.length === 0) { return vscode.l10n.t('Name must not be empty'); }
          if (!VALID_SANDBOX_RE.test(t)) { return vscode.l10n.t('Allowed: letters, digits, _ - . spaces'); }
          return null;
        },
      });
      if (!name) { return; }
      try {
        await createSandbox(name.trim(), cfg);
        vscode.window.showInformationMessage(vscode.l10n.t('Sandbox "{0}" created.', name.trim()));
        treeDataProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Sandbox creation failed: {0}', errMsg(err)));
      }
    }),

    // One is like many: the explorer passes the whole selection as the second argument.
    vscode.commands.registerCommand('tm1.sandbox.delete',
      async (node?: Tm1TreeNode, selection?: Tm1TreeNode[]) => {
        const items = collect(node, selection)
          .filter(n => n?.meta?.sandboxName && n?.meta?.serverId)
          .map(n => ({ node: n, name: n.meta.sandboxName as string }));
        if (items.length === 0) { return; }
        const ok = await confirmDelete(
          items.map(i => i.name),
          vscode.l10n.t('Discard Sandbox "{0}"? All changes will be lost.', items[0].name),
        );
        if (!ok) { return; }
        await runDelete(items, async (n, cfg) => {
          const name = n.meta.sandboxName as string;
          const serverId = n.meta.serverId as string;
          await deleteSandbox(name, cfg);
          // The discarded sandbox must not stay active — otherwise the next
          // cell value writes into a name that no longer exists.
          if (tracker.getActive(serverId) === name) {
            await tracker.setActive(serverId, undefined);
          }
        }, () => treeDataProvider.refresh(), vscode.l10n.t('sandboxes'), {
          success: name => vscode.l10n.t('Sandbox "{0}" discarded.', name),
          failure: reason => vscode.l10n.t('Sandbox deletion failed: {0}', reason),
        });
      }),

    vscode.commands.registerCommand('tm1.sandbox.commit', async (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const sandboxName = node?.meta?.sandboxName as string | undefined;
      if (!serverId || !sandboxName) { return; }
      const cfg = getServerConfig(serverId);
      if (!cfg) { return; }

      const _commitLabel = vscode.l10n.t('Commit');
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('Merge Sandbox "{0}" into Base? This action CANNOT be undone.', sandboxName),
        { modal: true },
        _commitLabel,
      );
      if (pick !== _commitLabel) { return; }
      try {
        const result = await commitSandbox(sandboxName, cfg);
        if (tracker.getActive(serverId) === sandboxName) {
          await tracker.setActive(serverId, undefined);
        }
        vscode.window.showInformationMessage(vscode.l10n.t('Sandbox "{0}" committed (via {1}).', sandboxName, result.via));
        treeDataProvider.refresh();
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('Sandbox commit failed: {0}', errMsg(err)));
      }
    }),

    vscode.commands.registerCommand('tm1.sandbox.setActive', async (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      const sandboxName = node?.meta?.sandboxName as string | undefined;
      if (!serverId || !sandboxName) { return; }
      await tracker.setActive(serverId, sandboxName);
      vscode.window.showInformationMessage(vscode.l10n.t('Sandbox "{0}" is now active.', sandboxName));
      treeDataProvider.refresh();
    }),

    vscode.commands.registerCommand('tm1.sandbox.clearActive', async (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      if (!serverId) { return; }
      await tracker.setActive(serverId, undefined);
      vscode.window.showInformationMessage(vscode.l10n.t('Sandbox mode deactivated (Base active).'));
      treeDataProvider.refresh();
    }),
  );
}

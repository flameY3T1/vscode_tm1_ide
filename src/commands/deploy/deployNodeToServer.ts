// src/commands/deploy/deployNodeToServer.ts
//
// "Deploy to another server" for rules and chores from the tree — the thing
// that already existed for processes (`processEditor/deployToServer.ts`) and,
// for these two kinds, existed only on the bulk page (`bulkDeployWebview`).
//
// The write path is NOT new: `deployOne` from `deployWrite.ts` is the same
// one the bulk page runs for the same kinds — including the fallback for a
// chore (PATCH APPENDS tasks) and including "written, but not complete".
// What is here is only what a SINGLE click needs on top of that: choose a
// target, read the target's inventory, ask about overwriting, report.
//
// Deliberately NOT taken along: the dependency check (`checkDeployItems`).
// It needs a reference index of the SOURCE server — too expensive for one
// click. What is missing over there gets named by the write run; only the
// one prerequisite that makes a rule impossible without a detour gets
// checked beforehand: the cube has to exist over there.
import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { getServerConfig } from '../../serverState/state';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { readTargetInventory, type DeployItem } from './deployCheck';
import { deployOne } from './deployWrite';
import { pickTargetServer } from './pickTarget';

/** What the clicked node describes — or `undefined` when it does not fit. */
function itemFromNode(node: Tm1TreeNode): DeployItem | undefined {
  const meta = node.meta ?? {};
  if (node.nodeType === 'cubeRule') {
    const cube = meta.cubeName as string | undefined;
    // For a rule, the cube is the name: `deployOne` reads
    // `Cubes('<name>')/Rules` and writes on the cube.
    return cube ? { kind: 'rule', name: cube, parent: cube } : undefined;
  }
  if (node.nodeType === 'chore') {
    const chore = meta.choreName as string | undefined;
    return chore ? { kind: 'chore', name: chore } : undefined;
  }
  return undefined;
}

export async function deployNodeToServerCommand(node?: Tm1TreeNode): Promise<void> {
  const item = node ? itemFromNode(node) : undefined;
  if (!node || !item) {
    vscode.window.showErrorMessage(vscode.l10n.t('Select a rule or a chore first.'));
    return;
  }
  const sourceServerId = node.meta?.serverId as string | undefined;
  const sourceCfg = sourceServerId ? getServerConfig(sourceServerId) : undefined;
  if (!sourceServerId || !sourceCfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Source server is not connected.'));
    return;
  }

  const was = item.kind === 'rule'
    ? vscode.l10n.t('Rules of "{0}"', item.name)
    : vscode.l10n.t('Chore "{0}"', item.name);
  const picked = await pickTargetServer(
    sourceServerId, vscode.l10n.t('Deploy {0} to which server?', was));
  if (!picked) { return; }

  // The same inventory fetch as on the bulk page: it says whether something
  // already exists over there (overwrite confirmation) and whether a rule's
  // cube exists.
  let exists = false;
  try {
    const inv = await readTargetInventory(picked.cfg, [item.kind]);
    // A list that was not read is not an empty inventory: otherwise the
    // overwrite confirmation would be skipped and existing rules would be
    // silently replaced.
    const unread = inv.failed.filter(f => (item.kind === 'rule' ? ['cube', 'rule'] : ['chore']).includes(f));
    if (unread.length > 0) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Reading the target server failed: {0}', unread.join(', ')));
      return;
    }
    if (item.kind === 'rule') {
      const lc = item.name.toLowerCase();
      if (!inv.cubes.has(lc)) {
        vscode.window.showErrorMessage(vscode.l10n.t(
          'Cube "{0}" does not exist on "{1}". Deploy the cube first.', item.name, picked.label));
        return;
      }
      // "Exists" for a rule means: the cube over there already carries
      // rules. A cube without rules loses nothing.
      exists = inv.rules.has(lc);
    } else {
      exists = inv.chores.has(item.name.toLowerCase());
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Reading the target server failed: {0}', errMsg(err)));
    return;
  }

  if (exists) {
    const OVERWRITE = vscode.l10n.t('Overwrite');
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('{0} already exists on "{1}". Overwrite?', was, picked.label),
      { modal: true },
      OVERWRITE,
    );
    if (answer !== OVERWRITE) { return; }
  }

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('TM1: Deploying {0} to {1}…', was, picked.label),
        cancellable: false,
      },
      () => deployOne(item, sourceCfg, picked.cfg, exists),
    );
    if (result === 'cancelled') { return; }
    if (typeof result === 'object') {
      // Written, but not complete — neither an error nor a plain success.
      vscode.window.showWarningMessage(result.warn);
    } else {
      vscode.window.showInformationMessage(
        vscode.l10n.t('TM1: {0} deployed to "{1}".', was, picked.label));
    }
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Deploy failed: {0}', errMsg(err)));
    return;
  }

  await vscode.commands.executeCommand('tm1.refreshExplorer');
}

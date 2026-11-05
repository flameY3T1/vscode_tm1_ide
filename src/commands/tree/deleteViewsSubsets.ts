/**
 * Delete views, subsets, chores, and processes — one or many at once.
 *
 * The explorer allows multi-selection (`canSelectMany`), so VS Code passes
 * the whole selection to the command alongside the clicked node. One
 * command serves both cases: for a single item, its name appears in the
 * confirmation prompt; for several, their count and the first names.
 *
 * `collect`/`confirmDelete`/`runDelete` are the shared multi-delete
 * infrastructure; `deleteChore` was, until 2026-09-02, the only tree node
 * with its own delete command that never accepted the command's second
 * argument (the selection) — with several chores checked and delete
 * pressed, only the clicked one disappeared.
 *
 * Errors on an individual item do NOT abort the run — otherwise the
 * selection would be left half-deleted in the air, and you would have to
 * guess which half.
 */

import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { requireServerConfigOrThrow } from '../serverManager';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { deleteView, deleteCube } from '../../tm1Rest/cubeApi';
import { deleteSubset } from '../../tm1Rest/subsetApi';
import { deleteChore } from '../../tm1Rest/choreApi';
import { deleteProcess } from '../../tm1Rest/processApi';
import { deleteDimension } from '../../tm1Rest/dimensionApi';
import { invalidateCache } from '../../providers/fetchNames';

export function collect(node?: Tm1TreeNode, selection?: Tm1TreeNode[]): Tm1TreeNode[] {
  return (selection && selection.length > 0) ? selection : (node ? [node] : []);
}

/**
 * Ask once, for the whole selection. Returns `false` when nothing should
 * be deleted.
 */
export async function confirmDelete(names: string[], oneLine: string): Promise<boolean> {
  const DELETE = vscode.l10n.t('Delete');
  const question = names.length === 1
    ? oneLine
    : vscode.l10n.t('Really delete {0} objects?', String(names.length));
  const detail = names.length === 1
    ? undefined
    : names.slice(0, 8).map(n => `• ${n}`).join('\n')
      + (names.length > 8 ? `\n… +${names.length - 8}` : '');
  const answer = await vscode.window.showWarningMessage(question, { modal: true, detail }, DELETE);
  return answer === DELETE;
}

interface Deleted {
  done: number;
  successes: string[];
  failures: { name: string; reason: string }[];
}

interface SingleDeleteMessages {
  success: (name: string) => string;
  failure: (reason: string) => string;
}

function report(out: Deleted, kindLabel: string, single?: SingleDeleteMessages): void {
  if (single && out.done + out.failures.length === 1) {
    if (out.failures.length === 1) {
      vscode.window.showErrorMessage(single.failure(out.failures[0].reason));
    } else {
      vscode.window.showInformationMessage(single.success(out.successes[0]));
    }
    return;
  }
  if (out.failures.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('TM1: {0} {1} deleted.', String(out.done), kindLabel));
    return;
  }
  const first = out.failures.slice(0, 3).map(f => `• ${f.name}: ${f.reason}`).join('\n');
  const more = out.failures.length > 3 ? `\n… +${out.failures.length - 3}` : '';
  vscode.window.showWarningMessage(
    vscode.l10n.t('{0} deleted, {1} failed:', String(out.done), String(out.failures.length))
    + `\n${first}${more}`,
  );
}

/**
 * The run itself. `refresh` gets called with each touched server id
 * exactly once — a tree rebuild per deleted item would mean fifteen load
 * operations for the same result with fifteen views.
 */
export async function runDelete(
  items: Array<{ node: Tm1TreeNode; name: string }>,
  remove: (node: Tm1TreeNode, cfg: Tm1Config) => Promise<void>,
  refresh: (serverId: string) => void,
  kindLabel: string,
  single?: SingleDeleteMessages,
): Promise<void> {
  const out: Deleted = { done: 0, successes: [], failures: [] };
  const touched = new Set<string>();
  for (const { node, name } of items) {
    try {
      const serverId = node.meta?.serverId as string | undefined;
      // A throw, not an exit: the `catch` below records THIS entry as
      // failed and moves on to the next one.
      const cfg = requireServerConfigOrThrow(serverId);
      await remove(node, cfg);
      out.done++;
      out.successes.push(name);
      if (serverId) { touched.add(serverId); }
    } catch (err) {
      out.failures.push({ name, reason: errMsg(err) });
    }
  }
  for (const serverId of touched) { refresh(serverId); }
  report(out, kindLabel, single);
}

export async function deleteCubeViewsCommand(
  node: Tm1TreeNode | undefined,
  selection: Tm1TreeNode[] | undefined,
  refresh: (serverId: string) => void,
): Promise<void> {
  const items = collect(node, selection)
    .filter(n => n?.nodeType === 'cubeView' && n?.meta?.cubeName && n?.meta?.viewName)
    .map(n => ({ node: n, name: `${n.meta.cubeName as string} / ${n.meta.viewName as string}` }));
  if (items.length === 0) { return; }

  const first = items[0].node;
  const label = first.meta.isPrivate ? vscode.l10n.t('Private View') : vscode.l10n.t('View');
  const ok = await confirmDelete(
    items.map(i => i.name),
    vscode.l10n.t('Delete {0} "{1}" (Cube "{2}")?', label,
      first.meta.viewName as string, first.meta.cubeName as string),
  );
  if (!ok) { return; }

  await runDelete(items, async (n, cfg) => {
    await deleteView(cfg, n.meta.cubeName as string, n.meta.viewName as string, !!n.meta.isPrivate,
      undefined, vscode.l10n.t('Could not delete View'));
  }, refresh, vscode.l10n.t('views'));
}

export async function deleteSubsetsCommand(
  node: Tm1TreeNode | undefined,
  selection: Tm1TreeNode[] | undefined,
  refresh: (serverId: string) => void,
): Promise<void> {
  const items = collect(node, selection)
    .filter(n => n?.nodeType === 'subset' && n?.meta?.dimName && n?.meta?.subsetName)
    .map(n => ({ node: n, name: `${n.meta.dimName as string} / ${n.meta.subsetName as string}` }));
  if (items.length === 0) { return; }

  const first = items[0].node;
  const label = first.meta.isPrivate ? vscode.l10n.t('Private subset') : vscode.l10n.t('Subset');
  const ok = await confirmDelete(
    items.map(i => i.name),
    vscode.l10n.t('Really delete {0} "{1}" (dimension "{2}")?', label,
      first.meta.subsetName as string, first.meta.dimName as string),
  );
  if (!ok) { return; }

  await runDelete(items, async (n, cfg) => {
    // The tree lists subsets under the default hierarchy — it is named
    // after the dimension, and the other handlers read it the same way.
    const dim = n.meta.dimName as string;
    await deleteSubset(cfg, dim, dim, n.meta.subsetName as string, !!n.meta.isPrivate,
      vscode.l10n.t('Subset could not be deleted'));
  }, refresh, vscode.l10n.t('subsets'));
}

export async function deleteChoresCommand(
  node: Tm1TreeNode | undefined,
  selection: Tm1TreeNode[] | undefined,
  refresh: (serverId: string) => void,
): Promise<void> {
  const items = collect(node, selection)
    .filter(n => n?.nodeType === 'chore' && n?.meta?.choreName)
    .map(n => ({ node: n, name: n.meta.choreName as string }));
  if (items.length === 0) { return; }

  const first = items[0].node;
  const ok = await confirmDelete(
    items.map(i => i.name),
    vscode.l10n.t('Delete Chore "{0}"?', first.meta.choreName as string),
  );
  if (!ok) { return; }

  await runDelete(items, async (n, cfg) => {
    await deleteChore(cfg, n.meta.choreName as string);
  }, refresh, vscode.l10n.t('chores'), {
    success: name => vscode.l10n.t('TM1: Chore "{0}" deleted.', name),
    failure: reason => vscode.l10n.t('TM1 Chore error: {0}', reason),
  });
}

export async function deleteProcessesCommand(
  node: Tm1TreeNode | undefined,
  selection: Tm1TreeNode[] | undefined,
  refresh: (serverId: string) => void,
  onDeleted: (name: string, serverId: string, cfg: Tm1Config) => void,
): Promise<void> {
  const items = collect(node, selection)
    .filter(n => n?.nodeType === 'process' && n?.meta?.processName)
    .map(n => ({ node: n, name: n.meta.processName as string }));
  if (items.length === 0) { return; }

  const ok = await confirmDelete(
    items.map(i => i.name),
    vscode.l10n.t('Really delete process "{0}" from the server?', items[0].name),
  );
  if (!ok) { return; }

  await runDelete(items, async (n, cfg) => {
    const name = n.meta.processName as string;
    const serverId = n.meta.serverId as string;
    await deleteProcess(cfg, name);
    onDeleted(name, serverId, cfg);
  }, refresh, vscode.l10n.t('processes'), {
    success: name => vscode.l10n.t('TM1: Process "{0}" was deleted.', name),
    failure: reason => vscode.l10n.t('TM1 Process error: {0}', reason),
  });
}

export async function deleteCubesCommand(
  node: Tm1TreeNode | undefined,
  selection: Tm1TreeNode[] | undefined,
  refresh: (serverId: string) => void,
  onDeleted: (cubeName: string, serverUrl: string) => void,
): Promise<void> {
  const items = collect(node, selection)
    .filter(n => n?.nodeType === 'cube' && n?.meta?.cubeName)
    .map(n => ({ node: n, name: n.meta.cubeName as string }));
  if (items.length === 0) { return; }

  const ok = await confirmDelete(
    items.map(i => i.name),
    vscode.l10n.t('Really delete cube "{0}" including all its data? This cannot be undone.', items[0].name),
  );
  if (!ok) { return; }

  await runDelete(items, async (n, cfg) => {
    const name = n.meta.cubeName as string;
    await deleteCube(cfg, name);
    invalidateCache('Cubes', cfg.serverUrl);
    // An open rule editor on the deleted cube would, on save, write its old
    // rule text onto a newly created cube of the same name.
    onDeleted(name, cfg.serverUrl ?? '');
  }, refresh, vscode.l10n.t('cubes'), {
    success: name => vscode.l10n.t('TM1: Cube "{0}" was deleted.', name),
    failure: reason => vscode.l10n.t('TM1: Cube could not be deleted: {0}', reason),
  });
}

export async function deleteDimensionsCommand(
  node: Tm1TreeNode | undefined,
  selection: Tm1TreeNode[] | undefined,
  refresh: (serverId: string) => void,
): Promise<void> {
  const items = collect(node, selection)
    .filter(n => n?.nodeType === 'dimension' && n?.meta?.dimName)
    .map(n => ({ node: n, name: n.meta.dimName as string }));
  if (items.length === 0) { return; }

  const ok = await confirmDelete(
    items.map(i => i.name),
    vscode.l10n.t('Really delete dimension "{0}"? This cannot be undone.', items[0].name),
  );
  if (!ok) { return; }

  await runDelete(items, async (n, cfg) => {
    // No dedicated errorMsg passed to the REST helper: assertOk appends the
    // OData message, and that one names the blocking cube.
    await deleteDimension(cfg, n.meta.dimName as string);
    // Its hierarchies disappear along with the dimension — both name lists
    // of autocomplete are stale afterward.
    invalidateCache('Dimensions', cfg.serverUrl);
    invalidateCache('Hierarchies', cfg.serverUrl);
  }, refresh, vscode.l10n.t('dimensions'), {
    success: name => vscode.l10n.t('TM1: Dimension "{0}" was deleted.', name),
    failure: reason => vscode.l10n.t('TM1: Dimension could not be deleted: {0}', reason),
  });
}

/**
 * Bring selected views and subsets over to another server.
 *
 * Called from the explorer's context menu, with one or many nodes selected
 * (with `canSelectMany`, VS Code passes the whole selection through as the
 * second argument — the same pattern as the process deploy).
 *
 * The flow, the same for both object kinds:
 *  1. Collect the selection, determine the source server (exactly ONE).
 *  2. Pick a target server from the connected ones.
 *  3. CHECK what already exists over there — and ask ONCE, not per item.
 *  4. Write one by one, collecting failures per item instead of aborting.
 *  5. Report.
 */

import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { getConnectedIds, getServerConfig, getServerNameByUrl } from '../../serverState/state';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { probeViewKind } from '../../tm1Rest/cubeApi';
import { subsetExists } from '../../tm1Rest/subsetApi';
import { copySubsetToServer, copyViewToServer } from '../deploy/copyOne';

/** What should happen on a name conflict. */
type ConflictChoice = 'overwrite' | 'skip' | 'cancel';

function serverLabel(serverUrl?: string, fallback = ''): string {
  if (!serverUrl) { return fallback; }
  const name = getServerNameByUrl(serverUrl);
  if (name) { return name; }
  try {
    const u = new URL(serverUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return serverUrl;
  }
}

interface Target { id: string; cfg: Tm1Config; label: string }

/**
 * Choose a target server. `null` means "do not continue" — either there is
 * no other connected server, or the user cancelled.
 */
async function pickTarget(sourceServerId: string, title: string): Promise<Target | null> {
  const targetIds = getConnectedIds().filter(id => id !== sourceServerId);
  if (targetIds.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('No other connected servers. Connect a target server first.'));
    return null;
  }
  type Item = vscode.QuickPickItem & { id: string };
  const items: Item[] = targetIds.map(id => {
    const cfg = getServerConfig(id);
    return { id, label: serverLabel(cfg?.serverUrl, id), description: cfg?.serverUrl };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: vscode.l10n.t('Select target server'),
  });
  if (!picked) { return null; }
  const cfg = getServerConfig(picked.id);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Target server configuration not found.'));
    return null;
  }
  return { id: picked.id, cfg, label: picked.label };
}

/**
 * Ask once what should happen to the names that already exist over there.
 *
 * Deliberately ONE prompt for the whole selection: with fifteen views, a
 * prompt per item would no longer be a safeguard but a series of clicks
 * that get dismissed unread.
 */
async function askConflict(existing: string[], targetLabel: string): Promise<ConflictChoice> {
  if (existing.length === 0) { return 'overwrite'; }
  const shown = existing.slice(0, 5).map(n => `• ${n}`).join('\n');
  const more = existing.length > 5 ? `\n… ${existing.length - 5}` : '';
  // Build the labels ONCE and compare against them. A second `l10n.t` call
  // is not the same string, only mostly the same one — and a translation
  // that names both buttons the same silently tipped the choice to the
  // first match.
  const overwrite = vscode.l10n.t('Overwrite');
  const skip = vscode.l10n.t('Skip these');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('{0} of the selected objects already exist on "{1}":', String(existing.length), targetLabel),
    { modal: true, detail: `${shown}${more}` },
    overwrite,
    skip,
  );
  if (answer === overwrite) { return 'overwrite'; }
  if (answer === skip) { return 'skip'; }
  return 'cancel';
}

/**
 * What a single write attempt resulted in.
 *
 * `cancelled` means: the user cancelled inside it (for example dismissed
 * the flatten prompt), and NOTHING was written. Without this distinction,
 * the report would count an empty run as a success.
 */
type WriteResult = 'written' | 'cancelled';

interface Outcome { done: number; skipped: number; failures: { name: string; reason: string }[] }

function report(out: Outcome, targetLabel: string): void {
  const { done, skipped, failures } = out;
  if (failures.length === 0) {
    const msg = skipped > 0
      ? vscode.l10n.t('{0} deployed to "{1}", {2} skipped.', String(done), targetLabel, String(skipped))
      : vscode.l10n.t('{0} deployed to "{1}".', String(done), targetLabel);
    vscode.window.showInformationMessage(msg);
    return;
  }
  const head = skipped > 0
    ? vscode.l10n.t('{0} deployed, {1} skipped, {2} failed:',
      String(done), String(skipped), String(failures.length))
    : vscode.l10n.t('{0} deployed, {1} failed:', String(done), String(failures.length));
  const first = failures.slice(0, 3).map(f => `• ${f.name}: ${f.reason}`).join('\n');
  const more = failures.length > 3 ? `\n… +${failures.length - 3}` : '';
  vscode.window.showWarningMessage(`${head}\n${first}${more}`);
}

/**
 * Shared scaffolding: check the selection, pick a target, collect
 * conflicts, write, report. What makes up a single item is supplied by the
 * caller.
 */
async function runDeploy<T>(
  nodes: T[],
  opts: {
    sourceServerId: string;
    pickTitle: string;
    progressTitle: string;
    nameOf: (item: T) => string;
    existsOnTarget: (item: T, cfg: Tm1Config) => Promise<boolean>;
    write: (item: T, sourceCfg: Tm1Config, targetCfg: Tm1Config, overwrite: boolean)
      => Promise<WriteResult | void>;
    sourceCfg: Tm1Config;
  },
): Promise<void> {
  const target = await pickTarget(opts.sourceServerId, opts.pickTitle);
  if (!target) { return; }

  const out: Outcome = { done: 0, skipped: 0, failures: [] };
  // `aborted` means: there is nothing to report because nothing was
  // started — either the conflict prompt was dismissed, or the checking
  // step itself was cancelled.
  let aborted = false;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: opts.progressTitle,
    cancellable: true,
  }, async (progress, token) => {
    // The checking step runs INSIDE the progress display too. It is a
    // network call per item and used to happen before it — with a large
    // selection, the UI hung there without any comment.
    const existing: T[] = [];
    let checked = 0;
    for (const item of nodes) {
      if (token.isCancellationRequested) { aborted = true; return; }
      checked++;
      progress.report({
        message: vscode.l10n.t('Checking {0} ({1}/{2})…', opts.nameOf(item), String(checked), String(nodes.length)),
      });
      try {
        if (await opts.existsOnTarget(item, target.cfg)) { existing.push(item); }
      } catch {
        // Not determinable means "does not exist": the write attempt will
        // soon say what is actually going on, and a prompt built on guesses
        // would be worthless.
      }
    }

    // Check first, then ask. A conflict that only shows up while writing
    // would already be half written.
    const choice = await askConflict(existing.map(opts.nameOf), target.label);
    if (choice === 'cancel') { aborted = true; return; }
    const existingSet = new Set(existing);

    let i = 0;
    for (const item of nodes) {
      i++;
      const name = opts.nameOf(item);
      // Cancellation does not mean "done": the rest is counted as skipped
      // so the report never names more successes than there actually were.
      if (token.isCancellationRequested) { out.skipped++; continue; }
      progress.report({ message: `${name} (${i}/${nodes.length})`, increment: 100 / nodes.length });
      const conflicting = existingSet.has(item);
      if (conflicting && choice === 'skip') { out.skipped++; continue; }
      try {
        const res = await opts.write(item, opts.sourceCfg, target.cfg, conflicting);
        if (res === 'cancelled') { out.skipped++; } else { out.done++; }
      } catch (e) {
        out.failures.push({ name, reason: errMsg(e) });
      }
    }
  });
  if (aborted) { return; }
  report(out, target.label);
}

/** Source server from the selection. Error if it does not come from one server. */
function singleSource(nodes: Tm1TreeNode[]): { id: string; cfg: Tm1Config } | null {
  const ids = Array.from(new Set(nodes.map(n => n.meta?.serverId).filter(Boolean))) as string[];
  if (ids.length !== 1) {
    vscode.window.showErrorMessage(vscode.l10n.t('All selected objects must come from the same source server.'));
    return null;
  }
  const cfg = getServerConfig(ids[0]);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Source server is not connected.'));
    return null;
  }
  return { id: ids[0], cfg };
}

function collect(node?: Tm1TreeNode, selection?: Tm1TreeNode[]): Tm1TreeNode[] {
  return (selection && selection.length > 0) ? selection : (node ? [node] : []);
}

// ── Views ─────────────────────────────────────────────────────────────────────

export async function deployViewsToServerCommand(node?: Tm1TreeNode, selection?: Tm1TreeNode[]): Promise<void> {
  const views = collect(node, selection)
    .filter(n => n?.nodeType === 'cubeView' && n?.meta?.cubeName && n?.meta?.viewName);
  if (views.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('No views selected.'));
    return;
  }
  const source = singleSource(views);
  if (!source) { return; }

  await runDeploy(views, {
    sourceServerId: source.id,
    sourceCfg: source.cfg,
    pickTitle: vscode.l10n.t('Deploy {0} views to which server?', String(views.length)),
    progressTitle: vscode.l10n.t('Deploying views…'),
    nameOf: n => `${n.meta.cubeName as string} / ${n.meta.viewName as string}`,
    existsOnTarget: async (n, cfg) => await probeViewKind(
      cfg, n.meta.cubeName as string, n.meta.viewName as string, !!n.meta.isPrivate) !== null,
    // The chain itself lives in `deploy/copyOne.ts` — it is the same one
    // that drives the bulk migration. Here without a known target stock:
    // the tree sends a handful of views, not hundreds, and reads no lists
    // beforehand.
    write: async (n, sourceCfg, targetCfg) => {
      await copyViewToServer(
        sourceCfg, targetCfg,
        n.meta.cubeName as string, n.meta.viewName as string, !!n.meta.isPrivate,
      );
    },
  });
}

// ── Subsets ───────────────────────────────────────────────────────────────────

export async function deploySubsetsToServerCommand(node?: Tm1TreeNode, selection?: Tm1TreeNode[]): Promise<void> {
  const subsets = collect(node, selection)
    .filter(n => n?.nodeType === 'subset' && n?.meta?.dimName && n?.meta?.subsetName);
  if (subsets.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('No subsets selected.'));
    return;
  }
  const source = singleSource(subsets);
  if (!source) { return; }

  await runDeploy(subsets, {
    sourceServerId: source.id,
    sourceCfg: source.cfg,
    pickTitle: vscode.l10n.t('Deploy {0} subsets to which server?', String(subsets.length)),
    progressTitle: vscode.l10n.t('Deploying subsets…'),
    nameOf: n => `${n.meta.dimName as string} / ${n.meta.subsetName as string}`,
    existsOnTarget: (n, cfg) => subsetExists(
      cfg, n.meta.dimName as string, n.meta.dimName as string,
      n.meta.subsetName as string, !!n.meta.isPrivate),
    write: async (n, sourceCfg, targetCfg, overwrite) => {
      // The tree lists subsets under the default hierarchy; it is named
      // after the dimension (the other handlers read it the same way) —
      // hence `dim` twice.
      const dim = n.meta.dimName as string;
      return copySubsetToServer(
        sourceCfg, targetCfg, dim, dim,
        n.meta.subsetName as string, !!n.meta.isPrivate, overwrite,
      );
    },
  });
}

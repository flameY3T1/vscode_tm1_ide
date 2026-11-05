import { promises as fsp } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { sanitizeFilename } from '../../git/sanitize';
import { fetchProcess } from '../../git/processFetcher';
import { writeProcess } from '../../git/workspaceWriter';
import type { TM1Process } from '../../git/serializer';
import { fileMatchesServer } from '../processEditor/fileMode/processFilePure';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { getServerConfig, getServerProfile, getGitProfile } from '../serverManager';
import { pullProcessTo, pullRulesTo } from '../../git/pullOrchestrator';
import { writeRules } from '../../git/workspaceWriter';
import { isInsideGitWorkTree } from '../../git/repoGuard';
import { pushProcessFrom, pushRulesFrom } from '../../git/pushOrchestrator';
import { resolveServerGitDir } from '../../providers/serverConfigForFile';
import { errMsg } from '../../utils/errMsg';
import { outputChannel } from '../../utils/outputChannel';
export { diffProcessCommand, diffRulesCommand, registerServerContentProvider } from './diff';

// Lazy and grouped by name — it only comes into being on first access, and
// two modules with the same name share a single channel.
const out = outputChannel('TM1 Git');

interface ResolvedTarget {
  config: import('../../tm1Client').Tm1Config;
  serverId: string;
  serverName: string;
  serverDir: string;
  workspaceFolder: string;
  parallelFetch: number;
}

function resolveTarget(node?: Tm1TreeNode): ResolvedTarget | null {
  const serverId = node?.meta?.serverId as string | undefined;
  if (!serverId) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No server context available (right-click a tree node).'));
    return null;
  }
  const config = getServerConfig(serverId);
  if (!config) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: Server profile "{0}" not found.', serverId));
    return null;
  }
  // The profile's own name, not the first profile on the same URL — must match
  // resolveDir, or open-as-file and the after-save mirror use two folders.
  const serverName = getServerProfile(serverId)?.name ?? serverId;
  const git = getGitProfile(serverId);
  if (!git || !git.enabled) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('TM1 Git: not enabled for server "{0}". Right-click the server → "Configure Git…".', serverName),
    );
    return null;
  }
  const ws = vscode.workspace.workspaceFolders?.[0];
  const serverDir = resolveServerGitDir(git, serverName, ws?.uri.fsPath ?? '');
  if (serverDir === null) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('TM1 Git: No workspace open. Open a folder OR set an absolute repo path in the server\'s Git config.'),
    );
    return null;
  }
  return { config, serverId, serverName, serverDir, workspaceFolder: ws?.uri.fsPath ?? '', parallelFetch: Math.max(1, git.parallelFetch || 8) };
}

export async function pullProcessCommand(node?: Tm1TreeNode): Promise<void> {
  const t = resolveTarget(node);
  if (!t) { return; }
  const processName = node?.meta?.processName as string | undefined;
  if (!processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No process name available.'));
    return;
  }
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: vscode.l10n.t('TM1 Git: Pulling process "{0}"…', processName),
  }, async () => {
    try {
      await pullProcessTo(t.serverDir, t.serverName, processName, t.config);
      out.appendLine(`[pull] process "${processName}" → ${t.serverDir}/processes/`);
      vscode.window.showInformationMessage(vscode.l10n.t('Process "{0}" saved locally.', processName));
    } catch (err) {
      out.appendLine(`[pull-process] error: ${errMsg(err)}`);
      vscode.window.showErrorMessage(vscode.l10n.t('Pull failed: {0}', errMsg(err)));
    }
  });
}

/**
 * Opens the process as its git file in the process editor (CustomTextEditor).
 * Always fetches the server version: no file yet → written; file differs →
 * the user chooses between server version and file.
 */
export async function openProcessAsFileCommand(node?: Tm1TreeNode): Promise<void> {
  const t = resolveTarget(node);
  if (!t) { return; }
  const processName = node?.meta?.processName as string | undefined;
  if (!processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No process name available.'));
    return;
  }
  const uri = vscode.Uri.file(path.join(t.serverDir, 'processes', `${sanitizeFilename(processName)}.ti`));
  const jsonUri = uri.with({ path: uri.path.replace(/\.ti$/, '.json') });
  let server: TM1Process;
  try {
    server = await fetchProcess(processName, t.config);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Pull failed: {0}', errMsg(err)));
    return;
  }
  // An existing file may hold work the server does not have yet (an AI edit,
  // an unpushed change) — never overwrite it unasked.
  let ti: string | undefined;
  let json: string | undefined;
  try {
    [ti, json] = [await readIfExists(uri), await readIfExists(jsonUri)];
  } catch (err) {
    vscode.window.showErrorMessage(errMsg(err));
    return;
  }
  // Half a pair is still local work: only a missing pair is written unasked.
  if (ti === undefined && json === undefined) {
    await writeProcess(t.serverDir, server);
  } else if (ti === undefined || json === undefined || !fileMatchesServer(ti, json, server)) {
    const load = vscode.l10n.t('Load server version');
    const keep = vscode.l10n.t('Keep file');
    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t('The file of "{0}" differs from the server. Load the server version (the file changes are lost unless committed)?', processName),
      { modal: true }, load, keep);
    if (pick === undefined) { return; }
    if (pick === load) { await writeProcess(t.serverDir, server); }
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, 'tm1.processFile');
}

/** The file's text; `undefined` only when it does not exist — any other read error throws. */
async function readIfExists(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return await fsp.readFile(uri.fsPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; }
    throw err;
  }
}

export async function pullRulesCommand(node?: Tm1TreeNode): Promise<void> {
  const t = resolveTarget(node);
  if (!t) { return; }
  const cubeName = node?.meta?.cubeName as string | undefined;
  if (!cubeName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No cube name available.'));
    return;
  }
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: vscode.l10n.t('TM1 Git: Pulling rules "{0}"…', cubeName),
  }, async () => {
    try {
      await pullRulesTo(t.serverDir, t.serverName, cubeName, t.config);
      out.appendLine(`[pull] rules "${cubeName}" → ${t.serverDir}/rules/`);
      vscode.window.showInformationMessage(vscode.l10n.t('Rules "{0}" saved locally.', cubeName));
    } catch (err) {
      out.appendLine(`[pull-rules] error: ${errMsg(err)}`);
      vscode.window.showErrorMessage(vscode.l10n.t('Pull failed: {0}', errMsg(err)));
    }
  });
}

export async function pushProcessCommand(node?: Tm1TreeNode): Promise<void> {
  const t = resolveTarget(node);
  if (!t) { return; }
  const processName = node?.meta?.processName as string | undefined;
  if (!processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No process name available.'));
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t('Overwrite process "{0}" on server "{1}"?', processName, t.serverName),
    { modal: true }, vscode.l10n.t('Yes, push'),
  );
  if (confirm !== vscode.l10n.t('Yes, push')) { return; }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: vscode.l10n.t('TM1 Git: Pushing process "{0}"…', processName),
  }, async () => {
    try {
      await pushProcessFrom(t.serverDir, t.serverName, processName, t.config);
      out.appendLine(`[push] process "${processName}" → server ${t.serverName}`);
      vscode.window.showInformationMessage(vscode.l10n.t('Process "{0}" pushed.', processName));
    } catch (err) {
      out.appendLine(`[push-process] error: ${errMsg(err)}`);
      vscode.window.showErrorMessage(vscode.l10n.t('Push failed: {0}', errMsg(err)));
    }
  });
}

export async function pushRulesCommand(node?: Tm1TreeNode): Promise<void> {
  const t = resolveTarget(node);
  if (!t) { return; }
  const cubeName = node?.meta?.cubeName as string | undefined;
  if (!cubeName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No cube name available.'));
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t('Overwrite rules for cube "{0}" on server "{1}"?', cubeName, t.serverName),
    { modal: true }, vscode.l10n.t('Yes, push'),
  );
  if (confirm !== vscode.l10n.t('Yes, push')) { return; }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: vscode.l10n.t('TM1 Git: Pushing rules "{0}"…', cubeName),
  }, async () => {
    try {
      await pushRulesFrom(t.serverDir, t.serverName, cubeName, t.config);
      out.appendLine(`[push] rules "${cubeName}" → server ${t.serverName}`);
      vscode.window.showInformationMessage(vscode.l10n.t('Rules "{0}" pushed.', cubeName));
    } catch (err) {
      out.appendLine(`[push-rules] error: ${errMsg(err)}`);
      vscode.window.showErrorMessage(vscode.l10n.t('Push failed: {0}', errMsg(err)));
    }
  });
}

export async function pullAllCommand(node?: Tm1TreeNode): Promise<void> {
  const target = resolveTarget(node);
  if (!target) { return; }

  // A mirror outside a repository is a valid state, not an error — just one
  // without a safety net. So the hint belongs in the confirmation dialog
  // that already exists (as `detail`, with its own button text), instead of
  // blocking the way.
  const insideRepo = await isInsideGitWorkTree(target.serverDir);
  if (!insideRepo) {
    out.appendLine(`[pullAll] "${target.serverDir}" is not inside a git repository — no safety net for local changes`);
  }

  const confirmLabel = insideRepo
    ? vscode.l10n.t('Yes, pull all')
    : vscode.l10n.t('Pull anyway');
  const confirm = await vscode.window.showWarningMessage(
    vscode.l10n.t('Pull all processes + rules from server "{0}"? This overwrites local mirror files — uncommitted local changes may be lost.', target.serverName),
    {
      modal: true,
      detail: insideRepo
        ? undefined
        : vscode.l10n.t('"{0}" is not inside a git repository, so there is no way to review or undo the overwrite.', target.serverDir),
    },
    confirmLabel,
  );
  if (confirm !== confirmLabel) { return; }

  const parallel = target.parallelFetch;

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: vscode.l10n.t('TM1 Git: Pulling all processes + rules from "{0}"…', target.serverName),
    cancellable: true,
  }, async (progress, token) => {
    try {
      const { listProcesses } = await import('../../tm1Rest/processApi');
      const { listCubes } = await import('../../tm1Rest/cubeApi');
      const procs = await listProcesses(target.config, { select: 'Name', top: 10000 });
      // List the rule text right away: this establishes, without a single
      // further call, WHICH cubes have rules at all — and the others no
      // longer produce an empty `.rux`. If `Rules` is missing entirely from
      // the response (older servers, a changed projection), the old path
      // below takes over.
      const cubes = await listCubes(target.config, { select: 'Name,Rules', top: 10000 });

      // Control objects belong IN the mirror too. The filter on `}` threw
      // away exactly what makes up a model: the Bedrock library and the
      // custom `}` processes on one side, the rules of the attribute and
      // system cubes on the other — `}ElementAttributes_*` carries
      // attribute logic, `}CellSecurity_*` the cell security rules.
      const procNames: string[] = procs.map(p => p.Name);

      const rulesKnown = cubes.some(c => (c as { Rules?: unknown }).Rules !== undefined);
      const { hasRulesFile } = await import('../../git/workspaceReader');
      // A cube goes into the queue if it HAS rules — or if the mirror
      // already holds a rules file. The second case is the one where
      // someone deleted the rules on the server: the local file then has
      // to become empty, or the repository keeps a text that no longer
      // exists.
      const ruleJobs: Array<{ name: string; text?: string }> = [];
      for (const c of cubes) {
        const name = c.Name;
        if (!rulesKnown) { ruleJobs.push({ name }); continue; }
        const text = String((c as { Rules?: unknown }).Rules ?? '');
        if (text.length > 0) { ruleJobs.push({ name, text }); }
        else if (await hasRulesFile(target.serverDir, name)) { ruleJobs.push({ name, text: '' }); }
      }
      if (!rulesKnown && cubes.length > 0) {
        out.appendLine('[pullAll] cube list carries no Rules property — falling back to one fetch per cube');
      }
      const total = procNames.length + ruleJobs.length;
      let done = 0;
      let failed = 0;

      async function runJob(kind: 'process' | 'rules', name: string, text?: string): Promise<void> {
        if (token.isCancellationRequested) { return; }
        try {
          if (kind === 'process') { await pullProcessTo(target!.serverDir, target!.serverName, name, target!.config); }
          // The rule text is already available from the list — write it
          // directly, instead of fetching it a second time.
          else if (text !== undefined) { await writeRules(target!.serverDir, name, text); }
          else { await pullRulesTo(target!.serverDir, target!.serverName, name, target!.config); }
        } catch (err) {
          failed++;
          out.appendLine(`[pullAll] ${kind} "${name}" failed: ${errMsg(err)}`);
        } finally {
          done++;
          progress.report({ increment: (1 / total) * 100, message: `${done}/${total}` });
        }
      }

      const queue: Array<{ kind: 'process' | 'rules'; name: string; text?: string }> = [
        ...procNames.map(n => ({ kind: 'process' as const, name: n })),
        ...ruleJobs.map(j => ({ kind: 'rules' as const, name: j.name, text: j.text })),
      ];

      let idx = 0;
      const workers: Promise<void>[] = [];
      for (let w = 0; w < parallel; w++) {
        workers.push((async () => {
          while (idx < queue.length && !token.isCancellationRequested) {
            const i = idx++;
            const job = queue[i];
            await runJob(job.kind, job.name, job.text);
          }
        })());
      }
      await Promise.all(workers);

      const success = done - failed;
      const cancelled = token.isCancellationRequested;
      out.appendLine(`[pullAll] done — ${success}/${total} success, ${failed} failed${cancelled ? ' (cancelled)' : ''}`);
      vscode.window.showInformationMessage(
        vscode.l10n.t('Pull complete: {0}/{1} succeeded', success, total) +
        (failed > 0 ? vscode.l10n.t(', {0} failed', failed) : '') +
        (cancelled ? vscode.l10n.t(' — cancelled before completion') : '') + '.',
      );
    } catch (err) {
      out.appendLine(`[pullAll] error: ${errMsg(err)}`);
      vscode.window.showErrorMessage(vscode.l10n.t('Pull-all failed: {0}', errMsg(err)));
    }
  });
}

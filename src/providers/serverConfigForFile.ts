// Which server a file on disk belongs to, by its git folder. Lives below
// commands/ because the language providers (diagnostics, completion) ask it;
// the after-save mirror in commands/git/mirror.ts uses resolveDir from here.
import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import type { GitProfile } from '../serverState/state';
import { getConnectedIds, getServerConfig } from '../serverState/state';
import { getServerProfile } from '../serverState/profiles';
import { _sessionCacheKey } from '../tm1Rest/transport/session';
import { getConfig } from '../tm1Client';
import { expandRepoPath, resolveServerDir } from '../git/gitConfig';

/** Pure: resolve the per-server git directory from a profile. null if ${workspaceFolder} needed but absent. */
export function resolveServerGitDir(git: GitProfile, serverName: string, workspaceFolder: string): string | null {
  if (git.repoPath.includes('${workspaceFolder}') && !workspaceFolder) { return null; }
  const repoPath = expandRepoPath(git.repoPath, workspaceFolder);
  // includeServerFolder defaults to true (undefined on legacy profiles). When
  // explicitly false, mirror straight into repoPath without the server subfolder.
  if (git.includeServerFolder === false) { return repoPath.replace(/\\/g, '/'); }
  return resolveServerDir(repoPath, serverName);
}

/**
 * The connected profile a Tm1Config belongs to — never by URL alone: two
 * profiles on one instance each keep their own git setting and folder. The
 * after-save mirror only carries the config, not a serverId. Panels hold the
 * very object from the connection map, so identity separates even profiles
 * with the same user and password; a copy (e.g. a panel opened before a
 * reconnect) falls back to the full session key.
 */
function profileForConfig(config: Tm1Config) {
  const ids = getConnectedIds();
  let id = ids.find(i => getServerConfig(i) === config);
  if (!id) {
    const key = _sessionCacheKey(config);
    id = ids.find(i => {
      const cfg = getServerConfig(i);
      return cfg !== undefined && _sessionCacheKey(cfg) === key;
    });
  }
  return id ? getServerProfile(id) : undefined;
}

export function resolveDir(config: Tm1Config): { serverDir: string; serverName: string } | null {
  const profile = profileForConfig(config);
  const git = profile?.git;
  if (!profile || !git || !git.enabled) { return null; }
  const ws = vscode.workspace.workspaceFolders?.[0];
  const serverDir = resolveServerGitDir(git, profile.name, ws?.uri.fsPath ?? '');
  return serverDir ? { serverDir, serverName: profile.name } : null;
}

/**
 * The server a file on disk belongs to: the connected server whose git folder
 * contains it (deepest folder wins). A file outside every git folder has no
 * binding, so the active connection stays the fallback — as before.
 */
export function serverConfigForFile(fsPath: string | undefined): Tm1Config {
  return (fsPath ? serverConfigForFileStrict(fsPath) : undefined) ?? getConfig();
}

/** Scheme of the server side of a git diff: `tm1-server:/<serverId>/<kind>/<file>`. */
export const SERVER_DIFF_SCHEME = 'tm1-server';

/**
 * The server a document belongs to. The server side of a git diff names its
 * server in the URI; it lies in no git folder, so the path lookup would fall
 * back to the active connection — possibly another server, whose missing
 * cubes then show up as lint errors.
 */
export function serverConfigForUri(uri: vscode.Uri): Tm1Config {
  if (uri.scheme === SERVER_DIFF_SCHEME) {
    const cfg = getServerConfig(uri.path.split('/')[1] ?? '');
    if (cfg) { return cfg; }
  }
  return serverConfigForFile(uri.fsPath);
}

/**
 * Like `serverConfigForFile`, but `undefined` instead of the active connection
 * for a file outside every git folder. A push must never guess the server.
 */
export function serverConfigForFileStrict(fsPath: string): Tm1Config | undefined {
  // Only Windows folds case: on Linux `/repo/Finance` and `/repo/finance`
  // are two different folders.
  const fold = (s: string) => process.platform === 'win32' ? s.toLowerCase() : s;
  const file = fold(fsPath.replace(/\\/g, '/'));
  let best: Tm1Config | undefined;
  let bestLen = -1;
  for (const id of getConnectedIds()) {
    const cfg = getServerConfig(id);
    const dir = cfg && fold(resolveDir(cfg)?.serverDir.replace(/\/+$/, '') ?? '');
    if (dir && dir.length > bestLen && file.startsWith(`${dir}/`)) {
      best = cfg;
      bestLen = dir.length;
    }
  }
  return best;
}

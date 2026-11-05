import {
  addFolder,
  renameFolder as renameFolderPure,
  deleteFolder as deleteFolderPure,
  assignFolder,
} from './serverFoldersPure';
import {
  _ctx,
  getAllServers,
  saveServers,
  onServerChanged,
  type ServerProfile,
  type GitProfile,
} from './state';

export function getServerProfile(serverId: string): ServerProfile | undefined {
  if (!_ctx) { return undefined; }
  return getAllServers(_ctx).find(s => s.id === serverId);
}

export function getGitProfile(serverId: string): GitProfile | undefined {
  return getServerProfile(serverId)?.git;
}

export async function updateServerGit(serverId: string, git: GitProfile): Promise<void> {
  if (!_ctx) { return; }
  const servers = getAllServers(_ctx);
  const idx = servers.findIndex(s => s.id === serverId);
  if (idx < 0) { return; }
  servers[idx] = { ...servers[idx], git };
  await saveServers(_ctx, servers);
  onServerChanged.fire('profiles');
}

// ── Server folders (optional grouping in the tree) ────────────────────────────
const KEY_SERVER_FOLDERS = 'tm1.serverFolders';

/** All known folder names (incl. empty ones the user created). */
export function listServerFolders(): string[] {
  if (!_ctx) { return []; }
  return _ctx.globalState.get<string[]>(KEY_SERVER_FOLDERS) ?? [];
}

/** Create an (initially empty) folder. No-op for empty/duplicate names. */
export async function createServerFolder(name: string): Promise<void> {
  if (!_ctx) { return; }
  await _ctx.globalState.update(KEY_SERVER_FOLDERS, addFolder(listServerFolders(), name));
  onServerChanged.fire('profiles');
}

/** Assign a server to a folder, or clear it (undefined/empty → back to root). */
export async function setServerFolder(serverId: string, folder: string | undefined): Promise<void> {
  if (!_ctx) { return; }
  await saveServers(_ctx, assignFolder(getAllServers(_ctx), serverId, folder));
  onServerChanged.fire('profiles');
}

/** Rename a folder, reassigning every server in it. */
export async function renameServerFolder(oldName: string, newName: string): Promise<void> {
  if (!_ctx) { return; }
  const { folders, servers } = renameFolderPure(listServerFolders(), getAllServers(_ctx), oldName, newName);
  await _ctx.globalState.update(KEY_SERVER_FOLDERS, folders);
  await saveServers(_ctx, servers);
  onServerChanged.fire('profiles');
}

/** Delete a folder; its servers fall back to the root. */
export async function deleteServerFolder(name: string): Promise<void> {
  if (!_ctx) { return; }
  const { folders, servers } = deleteFolderPure(listServerFolders(), getAllServers(_ctx), name);
  await _ctx.globalState.update(KEY_SERVER_FOLDERS, folders);
  await saveServers(_ctx, servers);
  onServerChanged.fire('profiles');
}

// ── Process-group per-server overrides ────────────────────────────────────────
// Per-server grouping config used to live in workspace settings
// (tm1.processGroup{Suffix,Mode}ByServer). It is per-server data, not a general
// setting, so it now lives in globalState and the settings were removed from the
// manifest. Keyed by profile *id*, not name: a rename keeps the id but changes
// the name, and a name key would silently orphan the override (and could be
// inherited by a later server reusing that name).
// migrateProcessGroupSettings() carries the legacy workspace maps over once and
// re-keys any pre-existing name-keyed entries onto the ids.
import { PG_SUFFIX_KEY, PG_MODE_KEY } from './stateKeys';

// The key literals live in stateKeys.ts — only there, so that `deleteServer`
// cleans them up along via SERVER_STATE_KEYS (guard: serverStateKeyGuard.test.ts).


/** Current per-server grouping overrides (token + mode maps, keyed by server id). */
export function getProcessGroupOverrides(): { suffix: Record<string, string>; mode: Record<string, string> } {
  if (!_ctx) { return { suffix: {}, mode: {} }; }
  return {
    suffix: _ctx.globalState.get<Record<string, string>>(PG_SUFFIX_KEY) ?? {},
    mode:   _ctx.globalState.get<Record<string, string>>(PG_MODE_KEY) ?? {},
  };
}

/** Set the grouping override for one server (token + mode), keyed by profile id. */
export async function setProcessGroupOverride(serverId: string, token: string, mode: string): Promise<void> {
  if (!_ctx) { return; }
  const { suffix, mode: modeMap } = getProcessGroupOverrides();
  await _ctx.globalState.update(PG_SUFFIX_KEY, { ...suffix, [serverId]: token });
  await _ctx.globalState.update(PG_MODE_KEY, { ...modeMap, [serverId]: mode });
  onServerChanged.fire('profiles');
}

/** Remove the grouping override for one server (falls back to the global default). */
export async function clearProcessGroupOverride(serverId: string): Promise<void> {
  if (!_ctx) { return; }
  const { suffix, mode: modeMap } = getProcessGroupOverrides();
  const s = { ...suffix }; delete s[serverId];
  const m = { ...modeMap }; delete m[serverId];
  await _ctx.globalState.update(PG_SUFFIX_KEY, s);
  await _ctx.globalState.update(PG_MODE_KEY, m);
  onServerChanged.fire('profiles');
}

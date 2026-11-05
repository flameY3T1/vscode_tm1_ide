import * as vscode from 'vscode';
import {
  _ctx,
  getAllServers,
  saveServers,
  pwKey,
  KEY_SERVERS,
} from '../../serverState/state';
import {
  getProcessGroupOverrides,
} from '../../serverState/profiles';
import { PG_SUFFIX_KEY, PG_MODE_KEY } from '../../serverState/stateKeys';
import {
  DEFAULT_PROCESS_GROUP_MODE,
} from '../../providers/processGroupingPure';

const KEY_PG_MIGRATED = 'tm1.processGroup.migrated';
const KEY_PG_MIGRATED_TO_ID = 'tm1.processGroup.migratedToId';
const KEY_PG_GLOBAL_MIGRATED = 'tm1.processGroup.globalMigrated';

/** A legacy setting value plus every scope it was actually written to. */
interface LegacySetting {
  value: string;
  targets: vscode.ConfigurationTarget[];
}

/**
 * Read a removed `tm1.*` setting that a user may still have in their settings.json.
 *
 * `inspect`, not `get`: once the key is gone from the manifest there is no
 * declared default any more, so `get` cannot tell "user set it" from "unset".
 * The most specific scope supplies the value; every scope that carries one is
 * reported so the caller can clear them all.
 */
function readLegacySetting(cfg: vscode.WorkspaceConfiguration, key: string): LegacySetting | undefined {
  const inspected = cfg.inspect<string>(key);
  if (!inspected) { return undefined; }
  const scopes: [unknown, vscode.ConfigurationTarget][] = [
    [inspected.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder],
    [inspected.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [inspected.globalValue, vscode.ConfigurationTarget.Global],
  ];
  const set = scopes.filter(([v]) => typeof v === 'string');
  if (set.length === 0) { return undefined; }
  return { value: set[0][0] as string, targets: set.map(([, target]) => target) };
}

/**
 * Three one-time steps for the per-server process-grouping overrides:
 *  1. carry the legacy workspace `*ByServer` maps over into globalState,
 *  2. re-key those maps from server *name* to server *id*,
 *  3. fold the removed global `tm1.processGroup{Suffix,Mode}` settings into a
 *     per-server override for every server that has none yet.
 *
 * Each step carries its own flag, so an install that already ran step 1 still
 * gets steps 2 and 3. Step 2 runs after step 1 — otherwise the entries just
 * imported from the legacy settings would stay name-keyed. Step 3 runs last so
 * it sees the final, id-keyed override map and only fills the real gaps.
 */
export async function migrateProcessGroupSettings(): Promise<void> {
  if (!_ctx) { return; }
  if (!_ctx.globalState.get<boolean>(KEY_PG_MIGRATED)) {
    const cfg = vscode.workspace.getConfiguration('tm1');
    const oldSuffix = cfg.get<Record<string, string>>('processGroupSuffixByServer') ?? {};
    const oldMode = cfg.get<Record<string, string>>('processGroupModeByServer') ?? {};
    if (Object.keys(oldSuffix).length > 0 || Object.keys(oldMode).length > 0) {
      const cur = getProcessGroupOverrides();
      // Existing globalState wins over the legacy settings on key collision.
      await _ctx.globalState.update(PG_SUFFIX_KEY, { ...oldSuffix, ...cur.suffix });
      await _ctx.globalState.update(PG_MODE_KEY, { ...oldMode, ...cur.mode });
      // Clear the now-undeclared workspace maps so they don't linger in settings.json.
      await cfg.update('processGroupSuffixByServer', undefined, vscode.ConfigurationTarget.Global);
      await cfg.update('processGroupModeByServer', undefined, vscode.ConfigurationTarget.Global);
    }
    await _ctx.globalState.update(KEY_PG_MIGRATED, true);
  }

  if (!_ctx.globalState.get<boolean>(KEY_PG_MIGRATED_TO_ID)) {
    const servers = getAllServers(_ctx);
    const knownIds = new Set(servers.map(s => s.id));
    // First match wins on duplicate server names — nothing better is available.
    const idByName = new Map<string, string>();
    for (const s of servers) {
      if (!idByName.has(s.name)) { idByName.set(s.name, s.id); }
    }
    // Already-id-keyed entries stay as they are; name keys are translated; keys
    // matching neither belong to a deleted server and are dropped (a later
    // server reusing that name must not inherit a foreign grouping).
    const remap = (src: Record<string, string>): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(src)) {
        if (knownIds.has(key)) { out[key] = value; continue; }
        const id = idByName.get(key);
        if (id !== undefined) { out[id] = value; }
      }
      return out;
    };
    const cur = getProcessGroupOverrides();
    await _ctx.globalState.update(PG_SUFFIX_KEY, remap(cur.suffix));
    await _ctx.globalState.update(PG_MODE_KEY, remap(cur.mode));
    await _ctx.globalState.update(KEY_PG_MIGRATED_TO_ID, true);
  }

  if (!_ctx.globalState.get<boolean>(KEY_PG_GLOBAL_MIGRATED)) {
    // tm1.processGroupSuffix / tm1.processGroupMode were global settings on top of
    // the per-server overrides — redundant, and removed from the manifest. Without
    // this step a user who had them set would silently lose their grouping and keep
    // an orphan entry in settings.json.
    const cfg = vscode.workspace.getConfiguration('tm1');
    const legacyToken = readLegacySetting(cfg, 'processGroupSuffix');
    const legacyMode = readLegacySetting(cfg, 'processGroupMode');
    if (legacyToken || legacyMode) {
      // A half-set pair keeps the other half at its former default. `#####` is
      // spelled out because it was the manifest default of the removed setting —
      // it is what these users saw, and there is no default token any more.
      const token = legacyToken?.value ?? '#####';
      const mode = legacyMode?.value ?? DEFAULT_PROCESS_GROUP_MODE;
      const cur = getProcessGroupOverrides();
      const suffix = { ...cur.suffix };
      const modeMap = { ...cur.mode };
      for (const s of getAllServers(_ctx)) {
        // An existing override was the more specific choice — never overwrite it.
        if (Object.prototype.hasOwnProperty.call(suffix, s.id)) { continue; }
        suffix[s.id] = token;
        modeMap[s.id] = mode;
      }
      await _ctx.globalState.update(PG_SUFFIX_KEY, suffix);
      await _ctx.globalState.update(PG_MODE_KEY, modeMap);
      // Clear the now-undeclared settings in exactly the scopes they were set in.
      for (const target of legacyToken?.targets ?? []) {
        await cfg.update('processGroupSuffix', undefined, target);
      }
      for (const target of legacyMode?.targets ?? []) {
        await cfg.update('processGroupMode', undefined, target);
      }
    }
    await _ctx.globalState.update(KEY_PG_GLOBAL_MIGRATED, true);
  }
}

const KEY_GIT_MIGRATED = 'tm1.git.migrated';

/**
 * One-time migration: copy the legacy global tm1.git.* values into every server
 * profile that has no git field yet. Idempotent via the tm1.git.migrated flag.
 */
export async function migrateGlobalGitSettings(
  globalGit: { enabled: boolean; repoPath: string; parallelFetch: number },
): Promise<void> {
  if (!_ctx) { return; }
  if (_ctx.globalState.get<boolean>(KEY_GIT_MIGRATED)) { return; }
  const servers = getAllServers(_ctx);
  const next = servers.map(s => (s.git ? s : { ...s, git: { ...globalGit } }));
  await saveServers(_ctx, next);
  await _ctx.globalState.update(KEY_GIT_MIGRATED, true);
}

/** Migrate legacy server profiles that stored passwords in globalState */
export async function migrateLegacyPasswords(ctx: vscode.ExtensionContext): Promise<void> {
  const servers = ctx.globalState.get<any[]>(KEY_SERVERS) ?? [];
  let migrated = false;
  for (const s of servers) {
    if (s.password) {
      await ctx.secrets.store(pwKey(s.id), s.password);
      delete s.password;
      migrated = true;
    }
  }
  if (migrated) {
    await ctx.globalState.update(KEY_SERVERS, servers);
  }
}

// ─── Migration chain ─────────────────────────────────────────────────────────

/**
 * Schema version of the extension's `globalState`. Steps above the stored
 * version run in order; after each one the version advances, so a step that
 * throws is retried on the next activation and blocks the steps after it.
 */
export const STATE_VERSION_KEY = 'tm1.state.version';

export interface StateMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/**
 * Runs `steps[storedVersion..]` and stores the new version after each.
 * Installs from before the version key start at 0 and walk every step once;
 * the pre-chain steps still check their own boolean flag
 * (`tm1.git.migrated`, `tm1.processGroup.*`), so users who already migrated
 * do not re-run them. New steps need no flag — append them, never reorder.
 */
export async function runMigrationChain(
  state: StateMemento,
  steps: readonly (() => Promise<void>)[],
): Promise<void> {
  const stored = state.get<number>(STATE_VERSION_KEY);
  for (let v = typeof stored === 'number' ? stored : 0; v < steps.length; v++) {
    await steps[v]();
    await state.update(STATE_VERSION_KEY, v + 1);
  }
}

/** The ordered steps. Index + 1 = the state version after the step. */
export async function runStateMigrations(
  globalGit: { enabled: boolean; repoPath: string; parallelFetch: number },
): Promise<void> {
  if (!_ctx) { return; }
  await runMigrationChain(_ctx.globalState, [
    () => migrateGlobalGitSettings(globalGit),   // v1
    () => migrateProcessGroupSettings(),         // v2
  ]);
}

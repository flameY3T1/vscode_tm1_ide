import * as vscode from 'vscode';
import type { AuthType, Tm1Config, V12Config } from '../tm1Rest/transport/types';
import { namedStore } from './namedStore';
import { _sessionCacheKey } from '../tm1Rest/transport/session';

export type { AuthType };

/**
 * What changed: `profiles` = a stored profile (add, edit, rename, remove,
 * credentials); `connection` = connect or disconnect; `impersonation` = start
 * or end of "work as user". Listeners that only care about the live session
 * skip `profiles`.
 */
export type ServerChangeKind = 'profiles' | 'connection' | 'impersonation';
export const onServerChanged = new vscode.EventEmitter<ServerChangeKind>();
/** Removal is independent of REST connection state and identifies the owner. */
export const onProfileRemoved = new vscode.EventEmitter<{ kind: 'server' | 'admin'; id: string }>();
export const onConnected    = new vscode.EventEmitter<string>(); // fires serverId
export const onDisconnected = new vscode.EventEmitter<{ serverId: string; serverUrl: string }>();

export interface ServerProfile {
  id: string;
  name: string;
  serverUrl: string;
  username: string;
  rejectUnauthorized: boolean;
  authType: AuthType;
  camNamespace?: string;
  /** Integrated login only: Kerberos SPN, e.g. `HTTP/tm1.example.com`. Empty =
   *  built from the host's reverse DNS. */
  spn?: string;
  git?: GitProfile;
  /** Optional folder name this server is grouped under in the tree. Undefined = root. */
  folder?: string;
  /** Set when profile came from admin server's instance list. */
  parentAdminId?: string;
  /** name admin server reports instance under — match key. */
  discoveredName?: string;
  /** URL admin server last reported. Compared against `serverUrl` to
   *  tell an untouched profile from one the user corrected. */
  discoveredUrl?: string;
  /** Reference to a credential set (`tm1.credentials`). Set ⇒ this profile's
   *  username, authType, camNamespace and `tm1.pw.<id>` are NOT read on
   *  connect; everything comes from the set. */
  credentialId?: string;
  /** undefined ≡ 'v11' (existing REST prefix). */
  version?: 'v11' | 'v12';
  v12?: V12Config;
  /** Came in through a server list import: no credentials yet, so connecting
   *  opens the form first — same as a fresh admin-server child. */
  imported?: boolean;
  // password is NOT stored here — lives in SecretStorage under key tm1.pw.<id>
}

export interface GitProfile {
  enabled: boolean;
  repoPath: string;
  parallelFetch: number;
  /** Append a per-server subfolder (the sanitized server name) under repoPath.
   *  Default true. Set false to mirror straight into repoPath without the
   *  server-name folder. Undefined on legacy profiles → treated as true. */
  includeServerFolder?: boolean;
}

export const GIT_DEFAULTS: GitProfile = {
  enabled: false,
  repoPath: '${workspaceFolder}/tm1',
  parallelFetch: 8,
  includeServerFolder: true,
};

export const KEY_SERVERS   = 'tm1.servers';
export const KEY_ACTIVE    = 'tm1.activeServerId';
export const KEY_CONNECTED = 'tm1.connectedServerIds';

export function pwKey(id: string): string { return `tm1.pw.${id}`; }

export const KEY_CREDENTIALS = 'tm1.credentials';

/** Secret of a credential set. Same construction as `pwKey`, so the project
 *  has only one notion of a secret. */
export function credKey(id: string): string { return `tm1.cred.${id}`; }

export interface CredentialSet {
  id: string;
  /** Display name and key of the selection — the username doesn't work for
   *  that: the same user has two passwords on two instances. */
  name: string;
  username: string;
  authType: AuthType;
  /** Mandatory in the CAM branch: a CAM login is only complete with a namespace. */
  camNamespace?: string;
}

// ── In-memory connection state ─────────────────────────────────────────────

/** serverId → resolved Tm1Config (includes password fetched from SecretStorage) */
export const _connectedConfigs = new Map<string, Tm1Config>();

export function isConnected(serverId: string): boolean {
  return _connectedConfigs.has(serverId);
}

export function getServerConfig(serverId: string): Tm1Config | undefined {
  return _connectedConfigs.get(serverId);
}

export function getConnectedIds(): string[] {
  return [..._connectedConfigs.keys()];
}

// Review V8 defers the reconnect at activation while only an offline TM1 file
// is open. Server pickers that find nothing connected start it here and wait,
// so a later command from the palette, a notebook run or a debug launch still
// finds the restored servers (review 2026-10-07, R1).
let _deferredRestore: (() => Promise<void>) | undefined;
export function setDeferredRestore(fn: (() => Promise<void>) | undefined): void {
  _deferredRestore = fn;
}

/** Connected server ids, after starting the deferred reconnect if none are connected yet. */
export async function getConnectedIdsRestored(): Promise<string[]> {
  if (_connectedConfigs.size === 0 && _deferredRestore) { await _deferredRestore(); }
  return getConnectedIds();
}

/**
 * Reverse-lookup by identity: the connected profile this config logs in as.
 * Two profiles may share a serverUrl, so the URL alone is not enough. An
 * impersonated config still belongs to its profile; if nothing matches, fall
 * back to the URL only when exactly one connected profile carries it.
 */
export function getServerIdByConfig(cfg: Tm1Config): string | undefined {
  const own = (c: Tm1Config) => _sessionCacheKey({ ...c, impersonate: undefined } as Tm1Config);
  const want = own(cfg);
  const byUrl: string[] = [];
  for (const [id, c] of _connectedConfigs.entries()) {
    if (own(c) === want) { return id; }
    if (c.serverUrl === cfg.serverUrl) { byUrl.push(id); }
  }
  return byUrl.length === 1 ? byUrl[0] : undefined;
}

/** Reverse-lookup: find the connected serverId for a given Tm1Config (by serverUrl). */
export function getServerIdByUrl(serverUrl: string): string | undefined {
  for (const [id, cfg] of _connectedConfigs.entries()) {
    if (cfg.serverUrl === serverUrl) { return id; }
  }
  return undefined;
}

// Module-level resolver so panel titles in any editor can format the
// server label without each manager carrying its own context reference.
let _serverNameResolver: (serverUrl: string) => string | undefined = () => undefined;
export function setServerNameResolver(fn: (serverUrl: string) => string | undefined): void {
  _serverNameResolver = fn;
}
export function getServerNameByUrl(serverUrl: string): string | undefined {
  return _serverNameResolver(serverUrl);
}

/**
 * Short display label for a server: profile name if known, otherwise
 * hostname[:port] from the URL. Returns undefined for missing/default.
 * Pure (no vscode) — the name resolver is injected, defaulting to
 * `getServerNameByUrl`. Lives here alongside the resolver it pairs with
 * (S4: relocated out of processEditorUtils so non-process commands no longer
 * reach into the process editor for it).
 */
export function formatServerLabel(
  serverUrl: string | undefined,
  getServerName: (serverUrl: string) => string | undefined = getServerNameByUrl,
): string | undefined {
  if (!serverUrl || serverUrl === '__default__') { return undefined; }
  const name = getServerName(serverUrl);
  if (name) { return name; }
  try {
    const u = new URL(serverUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return serverUrl;
  }
}

// ── Server profile CRUD ────────────────────────────────────────────────────

/**
 * The same blueprint as `tm1.adminServers` and `tm1.credentials`
 * (`namedStore`), just with two deliberate deviations:
 *
 *  * The context comes in as a parameter, not from `initServerManager` — over
 *    25 callers pass their `ExtensionContext` through anyway, and the tests
 *    set their stub exactly on top of that.
 *  * No `onServerChanged.fire()`: the callers rewrite whole lists (assigning
 *    folders, unlinking admin-server children) and report once themselves
 *    afterwards.
 */
const serverStore = namedStore<ServerProfile>(KEY_SERVERS, { idPrefix: 'srv', ctx: () => _ctx });

export function getAllServers(ctx: vscode.ExtensionContext): ServerProfile[] {
  return serverStore.withCtx(ctx).list();
}

export const newServerId = serverStore.newId;

export function getServer(ctx: vscode.ExtensionContext, id: string): ServerProfile | undefined {
  return serverStore.withCtx(ctx).get(id);
}

export function saveServers(ctx: vscode.ExtensionContext, servers: ServerProfile[]): Promise<void> {
  return serverStore.withCtx(ctx).replaceAll(servers);
}

export function getActiveId(ctx: vscode.ExtensionContext): string | undefined {
  return ctx.globalState.get<string>(KEY_ACTIVE);
}

// Module-level context so vscode-free call paths (git mirror after-save) can
// read profiles without threading ctx. Set once in extension.activate().
export let _ctx: vscode.ExtensionContext | undefined;
export function initServerManager(ctx: vscode.ExtensionContext): void { _ctx = ctx; }

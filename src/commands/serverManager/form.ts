import * as vscode from 'vscode';
import type { AuthType, Tm1Config, V12Config } from '../../tm1Rest/transport/types';
import { validateServerUrl, normalizeServerUrl, isPlainHttpUrl } from '../../utils/serverUrl';
import { probeWithFallback } from './probeConnection';
import { errMsg } from '../../utils/errMsg';
import { buildTm1Config } from '../../tm1Rest/transport/authConfig';
import {
  pwKey,
  getAllServers,
  saveServers,
  isConnected,
  getConnectedIds,
  onServerChanged,
  onProfileRemoved,
  type ServerProfile,
} from '../../serverState/state';
import { connect, disconnect, needsInitialCredentials, loadCredentials } from './connection';
import { getCredential } from './credentials';
import { purgeServerState } from './purgeServerState';
import { removeBrowserProfile } from './browserConnect';

// ── Form-based adding (webview, `tm1.addServer`) ────────────────────────────

/** Input data from the add-server webview (password in plain text, transient only). */
export interface ServerFormData {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  authType: AuthType;
  camNamespace?: string;
  /** Integrated only — see `ServerProfile.spn`. */
  spn?: string;
  rejectUnauthorized: boolean;
  /** undefined ≡ 'v11' (existing REST prefix). */
  version?: 'v11' | 'v12';
  v12?: V12Config;
  /** Set ⇒ the profile uses this credential set. The form's username/authType/
   *  camNamespace are still written into the profile, only the password is
   *  suppressed (see `saveServerFromForm`) — but on connect,
   *  `resolveCredentials`/`needsInitialCredentials` never read these fields
   *  when `credentialId` is set, they all come from the set instead. */
  credentialId?: string;
  /** Edit webview only: a password is stored. The value itself stays on the
   *  host (`getServerFormData` sends `''`, `withStoredPassword` fills it in). */
  hasPassword?: boolean;
}

export function cfgFromForm(data: ServerFormData): Tm1Config {
  return buildTm1Config(
    {
      serverUrl:          data.serverUrl,
      username:           data.username,
      password:           data.password,
      rejectUnauthorized: data.rejectUnauthorized,
    },
    {
      authType:     data.authType,
      camNamespace: data.camNamespace,
      version:      data.version,
      v12:          data.v12,
      spn:          data.spn,
    },
  );
}

export interface ConnectionTestResult {
  ok: boolean;
  /** ProductVersion on success. */
  version?: string;
  /** Plain-text error message on failure. */
  message?: string;
  /** Set when pass 2 applied an automatic scheme/TLS fallback. */
  appliedFallback?: { serverUrl?: string; rejectUnauthorized?: boolean; note: 'http' | 'https' | 'tls' };
}

/**
 * Probes a connection based on form data WITHOUT persisting anything or
 * marking the session as "connected". Mirrors the connect probe (GET
 * Configuration?$select=ProductVersion), including 401/403 and network
 * mapping.
 */
export async function testServerConnection(data: ServerFormData): Promise<ConnectionTestResult> {
  const url = normalizeServerUrl(data.serverUrl);
  const urlErr = validateServerUrl(url);
  if (urlErr) { return { ok: false, message: urlErr }; }
  const cfg = cfgFromForm({ ...data, serverUrl: url });
  const r = await probeWithFallback(cfg);
  return r.ok ? { ok: true, version: r.productVersion, appliedFallback: r.appliedFallback } : { ok: false, message: r.message };
}

/**
 * Loads the form data of an existing profile for the edit webview.
 * `undefined` if the profile is missing.
 *
 * The password does NOT go into the webview, only `hasPassword`: the DOM of a
 * webview keeps it readable through DevTools for as long as the panel lives
 * (review 2026-10-26). Same rule as for credential sets (`addServerPanel.ts`).
 */
/**
 * Puts the stored password back into form data from the edit webview: an
 * empty field there means "unchanged", because the webview never had the
 * value. A typed password and a credential set both win over the stored one.
 */
export async function withStoredPassword(
  ctx: vscode.ExtensionContext,
  serverId: string,
  data: ServerFormData,
): Promise<ServerFormData> {
  if (data.password || data.credentialId) { return data; }
  return { ...data, password: await ctx.secrets.get(pwKey(serverId)) ?? '' };
}

export async function getServerFormData(
  ctx: vscode.ExtensionContext,
  serverId: string,
): Promise<ServerFormData | undefined> {
  const profile = getAllServers(ctx).find(s => s.id === serverId);
  if (!profile) { return undefined; }
  const password = await ctx.secrets.get(pwKey(serverId)) ?? '';
  return {
    name: profile.name,
    serverUrl: profile.serverUrl,
    username: profile.username,
    password: '',
    hasPassword: !!password,
    authType: profile.authType,
    camNamespace: profile.camNamespace ?? '',
    spn: profile.spn ?? '',
    rejectUnauthorized: profile.rejectUnauthorized,
    credentialId: profile.credentialId,
    version: profile.version,
    v12: profile.v12,
  };
}

// ── Insecure-transport gate (plain HTTP and/or disabled cert verification) ──

/** Which transport-security downgrades a form carries. */
export type InsecureSaveKind = 'none' | 'http' | 'tls' | 'both';

/**
 * Pure classification of the transport downgrades a profile would persist:
 * plain HTTP (credentials on the wire in clear text) and/or `rejectUnauthorized:
 * false` (any certificate accepted → interceptable TLS). Both are equally
 * security-relevant, so both need the same explicit confirmation.
 *
 * `both` is deliberately its own kind: two consecutive, near-identical modals
 * only train users to click warnings away, so the caller raises ONE modal that
 * names both problems.
 */
export function classifyInsecureSave(
  d: Pick<ServerFormData, 'serverUrl' | 'rejectUnauthorized'>,
): InsecureSaveKind {
  // Classify the URL that would actually be persisted (saveServerFromForm
  // normalizes too) — a bare "host:8010" becomes https:// and is NOT plain HTTP.
  const http = isPlainHttpUrl(normalizeServerUrl(d.serverUrl));
  const tls = d.rejectUnauthorized === false;
  if (http && tls) { return 'both'; }
  if (http) { return 'http'; }
  if (tls) { return 'tls'; }
  return 'none';
}

/** Localized modal body for a kind — `undefined` when nothing needs confirming. */
export function insecureSaveMessage(kind: InsecureSaveKind): string | undefined {
  switch (kind) {
    case 'http':
      return vscode.l10n.t('Warning: Plain HTTP — credentials are transmitted in clear text. Save anyway?');
    case 'tls':
      return vscode.l10n.t('Warning: Certificate verification is disabled — the connection can be intercepted and credentials read. Save anyway?');
    case 'both':
      return vscode.l10n.t('Warning: Plain HTTP and certificate verification disabled — credentials are transmitted in clear text and the connection can be intercepted. Save anyway?');
    default:
      return undefined;
  }
}

/**
 * Modal gate in front of persisting a downgraded transport. Resolves `true`
 * when the save may proceed (nothing to confirm, or the user confirmed).
 */
export async function confirmInsecureSave(
  d: Pick<ServerFormData, 'serverUrl' | 'rejectUnauthorized'>,
): Promise<boolean> {
  const message = insecureSaveMessage(classifyInsecureSave(d));
  if (!message) { return true; }
  const SAVE_ANYWAY = vscode.l10n.t('Save anyway');
  const choice = await vscode.window.showWarningMessage(message, { modal: true }, SAVE_ANYWAY);
  return choice === SAVE_ANYWAY;
}

export type SaveServerResult =
  | {
      profile: ServerProfile;
      /** Set when the profile was saved but the connect attempt failed. */
      connectError?: string;
      urlError?: undefined;
      credentialError?: undefined;
    }
  | {
      profile?: undefined;
      connectError?: undefined;
      /** Set when the URL was invalid — NOTHING was persisted (no secret, no profile). */
      urlError: string;
      credentialError?: undefined;
    }
  | {
      profile?: undefined;
      connectError?: undefined;
      urlError?: undefined;
      /** Set when the referenced credential set no longer exists —
       *  NOTHING was persisted. */
      credentialError: string;
    };

/**
 * Persists a server profile from form data (password → SecretStorage) and
 * then connects. With `existingId`, the existing profile is replaced
 * (editing); otherwise a new one is created.
 *
 * Validates the (normalized) URL BEFORE any write access — on an invalid
 * URL, nothing is persisted (neither secret nor profile).
 */
export async function saveServerFromForm(
  ctx: vscode.ExtensionContext,
  data: ServerFormData,
  existingId?: string,
): Promise<SaveServerResult> {
  const normUrl = normalizeServerUrl(data.serverUrl);
  const urlErr = validateServerUrl(normUrl);
  if (urlErr) { return { urlError: urlErr }; }
  data = { ...data, serverUrl: normUrl };
  // Until now, freshness checking of the reference only happened in the
  // webview. The host accepted any id — a profile with a dead reference
  // would only report "credentials missing" on connect, without naming the
  // cause, and falling back to the form fields would be wrong (with a set
  // chosen, they only carry its display values). So don't even save it in
  // the first place (final review 2026-08-28, finding 7).
  if (data.credentialId && !getCredential(data.credentialId)) {
    return { credentialError: vscode.l10n.t('The selected login profile was deleted. Please pick another one.') };
  }

  const id = existingId ?? Date.now().toString();
  // Don't create an own secret when a set is chosen — otherwise it would sit
  // duplicated in storage, and later unlinking the reference would bring back
  // a stale password.
  await ctx.secrets.store(pwKey(id), data.credentialId ? '' : data.password);

  const servers = getAllServers(ctx);
  const idx = servers.findIndex(s => s.id === id);
  const existing = idx >= 0 ? servers[idx] : undefined;

  const profile: ServerProfile = {
    id,
    name: data.name,
    serverUrl: data.serverUrl,
    username: data.username,
    rejectUnauthorized: data.rejectUnauthorized,
    authType: data.authType,
    camNamespace: data.camNamespace || undefined,
    spn: data.authType === 'integrated' ? data.spn?.trim() || undefined : undefined,
    credentialId: data.credentialId || undefined,
    version: data.version,
    v12: data.v12,
    // Preserve tree grouping + git config across edits — the form does not
    // carry these fields, so rebuilding the profile fresh would drop them.
    folder: existing?.folder,
    git: existing?.git,
    // Same reason: the admin-server link — losing it would make the next
    // discovery create a SECOND profile for the same instance.
    parentAdminId: existing?.parentAdminId,
    discoveredName: existing?.discoveredName,
    discoveredUrl: existing?.discoveredUrl,
  };

  if (idx >= 0) { servers[idx] = profile; } else { servers.push(profile); }
  await saveServers(ctx, servers);

  try {
    await connect(ctx, profile);
    return { profile };
  } catch (err) {
    return { profile, connectError: errMsg(err) };
  }
}

export async function showServerManagerCommand(ctx: vscode.ExtensionContext): Promise<void> {
  while (true) {
    const servers = getAllServers(ctx);

    type Item = vscode.QuickPickItem & { action: string; profile?: ServerProfile };
    const items: Item[] = [
      ...servers.map(s => ({
        label: (isConnected(s.id) ? '$(vm-running) ' : '$(vm-outline) ') + s.name,
        description: `${s.username}@${s.serverUrl}` + (s.authType === 'CAM' ? ` [CAM:${s.camNamespace}]` : ''),
        detail: isConnected(s.id) ? vscode.l10n.t('Connected — click to disconnect') : vscode.l10n.t('Disconnected — click to connect'),
        action: 'toggle',
        profile: s,
      })),
      { label: '', kind: vscode.QuickPickItemKind.Separator, action: '' },
      { label: '$(add) ' + vscode.l10n.t('Add server'), action: 'add' },
      ...(servers.length > 0 ? [
        { label: '$(edit) ' + vscode.l10n.t('Edit server'), action: 'edit' },
        { label: '$(trash) ' + vscode.l10n.t('Remove server'), action: 'delete' },
      ] : []),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: 'TM1 Server',
      placeHolder: getConnectedIds().length > 0
        ? vscode.l10n.t('Connected: {0}', getConnectedIds().map(id => servers.find(s => s.id === id)?.name ?? id).join(', '))
        : vscode.l10n.t('No server connected'),
    });
    if (!picked) { return; }

    if (picked.action === 'toggle' && picked.profile) {
      if (isConnected(picked.profile.id)) {
        await disconnect(ctx, picked.profile.id);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Disconnected from "{0}"', picked.profile.name));
      } else {
        // loadCredentials is the only path by which a connection gets
        // credentials — profile or credential set, never both read.
        // A broken reference is NOT specially caught here: it falls through
        // below to the same connect() error handling as any other connection
        // error.
        const cred = await loadCredentials(ctx, picked.profile);
        if (cred.ok && needsInitialCredentials(picked.profile, cred.password)) {
          // Freshly discovered profile without credentials — show the form
          // instead of a doomed request. Command instead of a direct import:
          // form.ts must not import addServerPanel.ts (cycle, see tm1.addServer above).
          await vscode.commands.executeCommand('tm1.server.editById', picked.profile.id);
          return;
        }
        try {
          await connect(ctx, picked.profile);
          vscode.window.showInformationMessage(vscode.l10n.t('TM1: Connected to "{0}"', picked.profile.name));
        } catch (err) {
          vscode.window.showErrorMessage(vscode.l10n.t('TM1: Connection to "{0}" failed — {1}', picked.profile.name, errMsg(err)));
        }
      }
      return;

    } else if (picked.action === 'add') {
      // Adding runs through the add webview (same form as editing).
      // executeCommand instead of a direct import → no serverManager↔addServerPanel cycle.
      await vscode.commands.executeCommand('tm1.addServer');
      return;

    } else if (picked.action === 'edit') {
      const toEdit = await vscode.window.showQuickPick(
        servers.map(s => ({ label: s.name, description: s.serverUrl, id: s.id })),
        { title: vscode.l10n.t('Which server to edit?') }
      );
      if (!toEdit) { continue; }
      // Editing runs through the edit webview (same form as adding).
      // executeCommand instead of a direct import → no serverManager↔addServerPanel cycle.
      await vscode.commands.executeCommand('tm1.editServer', { meta: { serverId: toEdit.id } });
      return;

    } else if (picked.action === 'delete') {
      const toDel = await vscode.window.showQuickPick(
        servers.map(s => ({ label: s.name, description: s.serverUrl, id: s.id })),
        { title: vscode.l10n.t('Which server to remove?') }
      );
      if (!toDel) { continue; }
      await deleteServer(ctx, toDel.id);
      vscode.window.showInformationMessage(vscode.l10n.t('TM1: Server "{0}" removed.', toDel.label));
    }
  }
}

/**
 * Removes a server profile: disconnects (if connected), deletes the profile
 * from globalState and the password from SecretStorage. Returns the display
 * name (or `undefined` if no profile with that ID exists).
 */
export async function deleteServer(ctx: vscode.ExtensionContext, serverId: string): Promise<string | undefined> {
  const servers = getAllServers(ctx);
  const profile = servers.find(s => s.id === serverId);
  if (!profile) { return undefined; }
  // Disconnect FIRST while the profile is still persisted, so onDisconnected
  // listeners can resolve serverUrl from getAllServers if the cfg is missing.
  if (isConnected(serverId)) {
    await disconnect(ctx, serverId);
  }
  const remaining = servers.filter(s => s.id !== serverId);
  await saveServers(ctx, remaining);
  onProfileRemoved.fire({ kind: 'server', id: serverId });
  await ctx.secrets.delete(pwKey(serverId));
  // Everything that hung off the profile goes with it — quietly, like the
  // password one line above. This used to be two separate calls (workbenches,
  // review 2026-08-24 H4; attribute columns, task 8), and seven other stores
  // were left unreachable in `globalState`; the table in `stateKeys.ts` now
  // knows all of them.
  //
  // `urlStillInUse`: two profiles are allowed to point to the same instance
  // with different users. The url-keyed stores (linter and formatting rules,
  // MDX history) then still belong to the remaining profile and must not be
  // deleted along with this one.
  await purgeServerState(ctx, {
    serverId,
    serverUrl: profile.serverUrl,
    urlStillInUse: remaining.some(s => s.serverUrl === profile.serverUrl),
  });
  // The browser profile belongs to the host, not to one database: it goes
  // only with the last browser-login profile on that origin.
  if (profile.authType === 'browser') {
    try {
      const origin = new URL(profile.serverUrl).origin;
      if (!remaining.some(s => s.authType === 'browser' && new URL(s.serverUrl).origin === origin)) {
        await removeBrowserProfile(profile.serverUrl);
      }
    } catch (e) {
      console.error('[deleteServer] browser profile not removed:', e);
    }
  }
  // Notify the tree — saveServers doesn't emit on its own, and any
  // disconnect-fired refresh above ran while the profile was still persisted.
  onServerChanged.fire('profiles');
  return profile.name;
}

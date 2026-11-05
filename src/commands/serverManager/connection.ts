import * as vscode from 'vscode';
import { learnSessionTimeout } from '../../tm1Rest/sessionTimeoutApi';
import { setConfigOverride, closeSession, apiRequest } from '../../tm1Client';
import { forgetImpersonation } from './impersonation';
import { _sessionCacheKey, onBrowserSessionExpired } from '../../tm1Rest/transport/session';
import { buildTm1Config } from '../../tm1Rest/transport/authConfig';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import {
  _connectedConfigs,
  getConnectedIds,
  getAllServers,
  saveServers,
  getActiveId,
  pwKey,
  credKey,
  KEY_ACTIVE,
  KEY_CONNECTED,
  onConnected,
  onDisconnected,
  onServerChanged,
  type ServerProfile,
} from '../../serverState/state';
import { resolveCredentials, type ResolvedCredentials } from './credentialResolvePure';
import { getCredential } from './credentials';
import { errMsg } from '../../utils/errMsg';
import { isTlsCertError as isTlsCertErrorPure } from '../../utils/networkErrorPure';
import { probeConnection } from './probeConnection';

/**
 * Is this a TLS certificate error?
 *
 * `connect()` does not rethrow the raw error, but a humanized and translated
 * version — so detection must not rely on English words in the text. The
 * `tlsCert` marker is carried along when the error is repackaged, just like
 * the network `code`, and takes precedence here.
 */
export function isTlsCertError(err: unknown): boolean {
  return isTlsCertErrorPure(err);
}

/**
 * Builds the localized top-level error notification for a failed `connect()`.
 * Classifies offline (host unreachable / refused / timeout / reset) vs a
 * generic connection failure using the preserved network `code` — the
 * humanized `.message` no longer carries the code. Fully l10n'd so the wrapper
 * follows the VS Code display language instead of being hardcoded German.
 */
export function _connectFailureMessage(err: unknown, profileName: string): string {
  const detail = errMsg(err);
  const code = (err as { code?: string })?.code ?? '';
  const offline = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ECONNRESET/i.test(code) || /timeout/i.test(detail);
  return offline
    ? vscode.l10n.t('TM1: Server "{0}" offline — {1}', profileName, detail)
    : vscode.l10n.t('TM1: Connection to "{0}" failed — {1}', profileName, detail);
}

/**
 * Fetches the credential set and both secrets and lets the pure function
 * decide. THE ONLY path by which a connection's credentials come into being
 * — otherwise the one spot overlooked during a refactor wouldn't know about
 * the reference.
 */
export async function loadCredentials(
  ctx: vscode.ExtensionContext,
  profile: ServerProfile,
): Promise<ResolvedCredentials> {
  const set = profile.credentialId ? getCredential(profile.credentialId) : undefined;
  const ownPassword = await ctx.secrets.get(pwKey(profile.id)) ?? '';
  const setPassword = profile.credentialId ? await ctx.secrets.get(credKey(profile.credentialId)) ?? '' : '';
  return resolveCredentials(profile, set, ownPassword, setPassword);
}

/**
 * Folds a persisted profile + its resolved credentials into a valid
 * `Tm1Config`. Throws (via `buildTm1Config`) on an invalid persisted auth combo
 * — callers wrap this in the connect/restore error paths so a bad profile
 * surfaces as a clear message instead of an opaque 401 / mint failure.
 */
function cfgFromProfile(profile: ServerProfile, cred: Extract<ResolvedCredentials, { ok: true }>): Tm1Config {
  return buildTm1Config(
    {
      serverUrl:          profile.serverUrl,
      username:           cred.username,
      password:           cred.password,
      rejectUnauthorized: profile.rejectUnauthorized,
    },
    {
      authType:     cred.authType,
      camNamespace: cred.camNamespace,
      version:      profile.version,
      v12:          profile.v12,
      spn:          profile.spn,
    },
  );
}

/**
 * A freshly discovered profile has no credentials yet. A connection attempt
 * would run into a 401 and report "username or password is incorrect" —
 * which is wrong here, since none were ever entered. Only for profiles from
 * an admin server or a server list import: for a profile created by hand, an
 * empty username is a deliberate choice.
 */
export function needsInitialCredentials(profile: ServerProfile, password: string | undefined): boolean {
  // A reference to a credential set supplies the profile fully — then the
  // empty `username` is not a gap, just unused.
  if (profile.credentialId) { return false; }
  // Integrated login needs none at all: it uses the running Windows session.
  // Empty fields there are the normal case, not a gap.
  if (profile.authType === 'integrated') { return false; }
  // Browser login: the browser holds the credentials.
  if (profile.authType === 'browser') { return false; }
  return (!!profile.parentAdminId || !!profile.imported) && !profile.username && !password;
}

/**
 * Permanently turns off certificate verification for ONE profile.
 *
 * Called from the button on the certificate error message. Deliberately only
 * for that one profile, not for the admin server through which it was
 * discovered: the admin server passes its value on only to NEWLY discovered
 * children, so reaching through it would be a silent change to all the
 * others. Returns the updated profile, or `undefined` if it no longer
 * exists.
 */
export async function acceptCertificate(
  ctx: vscode.ExtensionContext,
  serverId: string,
): Promise<ServerProfile | undefined> {
  const servers = getAllServers(ctx);
  const idx = servers.findIndex(s => s.id === serverId);
  if (idx < 0) { return undefined; }
  const next = [...servers];
  next[idx] = { ...next[idx], rejectUnauthorized: false };
  await saveServers(ctx, next);
  return next[idx];
}

export async function connect(ctx: vscode.ExtensionContext, profile: ServerProfile): Promise<void> {
  const cred = await loadCredentials(ctx, profile);
  if (!cred.ok) {
    throw new Error(vscode.l10n.t(
      'Credentials for "{0}" are missing — the stored login profile no longer exists. Open the server settings and pick or re-enter credentials.',
      profile.name,
    ));
  }
  const cfg: Tm1Config = cfgFromProfile(profile, cred);

  // Same probe as "Test connection": reachability, auth, and every message.
  // It clears the negative-auth cache first, so an explicit (re)connect
  // re-tries corrected credentials; browser login opens the browser here and
  // only here (never in the background).
  const probe = await probeConnection(cfg);
  if (!probe.ok) {
    // The text is translated — callers classify offline-vs-failed by the
    // network `code` and offer "accept certificate" by `tlsCert`.
    throw Object.assign(new Error(probe.message), { code: probe.code, tlsCert: probe.kind === 'tls' });
  }

  _connectedConfigs.set(profile.id, cfg);
  // Don't await: the connect is done, the timeout is a bonus.
  void learnSessionTimeout(cfg, apiRequest);
  await _persistConnectedIds(ctx);

  // Keep global override pointing to last connected server (backwards compat for deploy/linter/debug)
  await ctx.globalState.update(KEY_ACTIVE, profile.id);
  setConfigOverride(cfg);

  onConnected.fire(profile.id);
  onServerChanged.fire('connection');
}

export async function disconnect(ctx: vscode.ExtensionContext, serverId: string): Promise<void> {
  // Grab the cfg BEFORE deleting so closeSession has access to the cookie/agent
  // and listeners can resolve the serverUrl after the cache entry is gone.
  const cfg = _connectedConfigs.get(serverId);
  // Fall back to the persisted profile in case cfg is missing (defensive — a
  // disconnect call shortly after profile deletion still has a valid URL).
  const fallbackUrl = getAllServers(ctx).find(s => s.id === serverId)?.serverUrl ?? '';
  const serverUrl = cfg?.serverUrl ?? fallbackUrl;

  _connectedConfigs.delete(serverId);
  // Otherwise the assumed identity would survive the disconnect and be back
  // on the next connect, without anyone having set it.
  forgetImpersonation(serverId);
  await _persistConnectedIds(ctx);

  // Update global override to a remaining connected server, or clear it
  const remaining = getConnectedIds();
  if (remaining.length > 0) {
    const firstCfg = _connectedConfigs.get(remaining[remaining.length - 1])!;
    setConfigOverride(firstCfg);
    await ctx.globalState.update(KEY_ACTIVE, remaining[remaining.length - 1]);
  } else {
    setConfigOverride(null);
    await ctx.globalState.update(KEY_ACTIVE, undefined);
  }

  onDisconnected.fire({ serverId, serverUrl });
  onServerChanged.fire('connection');
  // Close AFTER the panels are torn down: their dispose cleanup still runs on
  // this session (closeSession waits for it) instead of logging in again.
  if (cfg) {
    try { await closeSession(cfg); } catch { /* best-effort */ }
  }
}

/**
 * A browser session expired on some request: offer to log in again. Never
 * reconnects by itself (feedback_no_auto_reconnect) — the button is the
 * explicit connect.
 */
export function watchBrowserSessionExpiry(ctx: vscode.ExtensionContext): vscode.Disposable {
  const shown = new Set<string>();
  return onBrowserSessionExpired(cfg => {
    const key = _sessionCacheKey(cfg);
    const id = [..._connectedConfigs].find(([, c]) => _sessionCacheKey(c) === key)?.[0];
    const profile = id ? getAllServers(ctx).find(s => s.id === id) : undefined;
    // Many parallel requests fail at once; one message per expiry.
    if (!profile || shown.has(profile.id)) { return; }
    shown.add(profile.id);
    const again = vscode.l10n.t('Log in again');
    void vscode.window.showWarningMessage(
      vscode.l10n.t('TM1: The browser session for "{0}" has expired.', profile.name), again,
    ).then(async choice => {
      shown.delete(profile.id);
      if (choice !== again) { return; }
      try {
        await connect(ctx, profile);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Connected to "{0}"', profile.name));
      } catch (err) {
        vscode.window.showErrorMessage(errMsg(err));
      }
    });
  });
}

async function _persistConnectedIds(ctx: vscode.ExtensionContext): Promise<void> {
  await ctx.globalState.update(KEY_CONNECTED, getConnectedIds());
}

// ── Startup restore ────────────────────────────────────────────────────────

/** Restore all previously connected servers on extension startup. Probes each — drops offline ones. */
export async function restoreConnectedServers(ctx: vscode.ExtensionContext): Promise<void> {
  const servers = getAllServers(ctx);
  const connectedIds = ctx.globalState.get<string[]>(KEY_CONNECTED) ?? [];

  // Legacy: if no persisted connected IDs but there is an active server ID, restore that one
  const idsToRestore = connectedIds.length > 0
    ? connectedIds
    : (getActiveId(ctx) ? [getActiveId(ctx)!] : []);

  const offline: { name: string; reason: string }[] = [];
  await Promise.all(idsToRestore.map(async id => {
    const profile = servers.find(s => s.id === id);
    if (!profile) { return; }
    const cred = await loadCredentials(ctx, profile);
    if (!cred.ok) {
      // A broken reference to a deleted credential set must not abort the
      // reconnect at startup — this one profile is skipped (not reported as
      // "offline"), the others keep going.
      return;
    }
    let cfg: Tm1Config;
    try {
      cfg = cfgFromProfile(profile, cred);
    } catch (err) {
      offline.push({ name: profile.name, reason: errMsg(err) });
      return;
    }
    // Browser login never opens a browser at startup; the session died with
    // the last VS Code anyway. Dropped like a broken credential reference.
    if (cfg.authType === 'browser') { return; }
    const probe = await probeConnection(cfg);
    if (!probe.ok) {
      offline.push({ name: profile.name, reason: probe.message });
      return;
    }
    _connectedConfigs.set(id, cfg);
    void learnSessionTimeout(cfg, apiRequest);
  }));

  await _persistConnectedIds(ctx);

  // Set global override to last successfully connected server
  const restoredIds = getConnectedIds();
  const lastId = restoredIds[restoredIds.length - 1];
  if (lastId) {
    const cfg = _connectedConfigs.get(lastId);
    if (cfg) { setConfigOverride(cfg); }
  } else {
    setConfigOverride(null);
  }

  if (offline.length > 0) {
    const list = offline.map(o => `"${o.name}" (${o.reason})`).join(', ');
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server offline — {0}', list));
  }

  // Restore may run fire-and-forget (activation must not block on network):
  // signal completion so the tree rebuilds with the restored connection state.
  onServerChanged.fire('connection');
}

// ── Active server (backwards compat) ──────────────────────────────────────

/** Returns the display name of the last-connected server, or undefined if none connected. */
export function getActiveServerName(ctx: vscode.ExtensionContext): string | undefined {
  const servers = getAllServers(ctx);
  const activeId = getActiveId(ctx);
  return servers.find(s => s.id === activeId)?.name;
}

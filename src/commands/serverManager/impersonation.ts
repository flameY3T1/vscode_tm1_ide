// src/commands/serverManager/impersonation.ts
// View the model through the eyes of another TM1 user (v11).
//
// Impersonation hooks into the ONE spot where every window gets its
// connection from: `_connectedConfigs`. When the entry there is swapped for a
// configuration with `impersonate`, everything — tree, cube view, security
// matrices, process runs — operates under that user's rights starting with
// the next request. No second path, no special cases per window.
//
// Writing remains allowed. That's not an oversight: TM1 applies the rights
// of the impersonated user, and that is exactly the point of the exercise —
// seeing what this user is allowed to do.
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { apiRequest, closeSession, setConfigOverride } from '../../tm1Client';
import { disposeAllForServer } from '../../serverState/serverDisposeRegistry';
import { invalidateReferenceIndex } from '../../references/referenceIndexService';
import { _connectedConfigs, getServerConfig, onServerChanged, KEY_ACTIVE } from '../../serverState/state';

/**
 * The own connection per server, for as long as an impersonation is active.
 * Without it, ending the impersonation would have to rebuild the
 * configuration (read the profile, fetch the secret from storage) — and on
 * failure the user would be left without a connection.
 */
const _originalConfigs = new Map<string, Tm1Config>();

/** The impersonated user of this server, otherwise undefined. */
export function getImpersonation(serverId: string): string | undefined {
  return getServerConfig(serverId)?.impersonate;
}

/** All active impersonations as `serverId → user`. */
export function listImpersonations(): Array<{ serverId: string; user: string }> {
  const out: Array<{ serverId: string; user: string }> = [];
  for (const [serverId, cfg] of _connectedConfigs) {
    if (cfg.impersonate) { out.push({ serverId, user: cfg.impersonate }); }
  }
  return out;
}

/**
 * Sets an impersonation (`user`) or ends it (`undefined`).
 *
 * Open windows are closed, not reloaded: they hold their `Tm1Config` in a
 * closure and would otherwise keep working under the old view — a cube view
 * showing the administrator's numbers under another user's heading would be
 * worse than a closed window. The same path that disconnecting also takes.
 */
export async function setImpersonation(
  ctx: vscode.ExtensionContext,
  serverId: string,
  user: string | undefined,
): Promise<void> {
  const current = getServerConfig(serverId);
  if (!current) { throw new Error(vscode.l10n.t('TM1: Server not connected.')); }
  if (user && current.version === 'v12') {
    throw new Error(vscode.l10n.t('Impersonation needs TM1 11.x — v12 has no impersonation header.'));
  }
  if ((current.impersonate ?? undefined) === user) { return; }

  const original = _originalConfigs.get(serverId) ?? current;
  const next: Tm1Config = user ? { ...original, impersonate: user } : original;

  // Clean up the ABANDONED session, not the new one. When ending, that's the
  // impersonated one — otherwise it hangs around at the server until it times
  // out and shows up in every thread overview. When starting, the own
  // session deliberately stays open: it gets reused after the impersonation
  // ends.
  if (current.impersonate) {
    try { await closeSession(current); } catch { /* best-effort */ }
    // A disconnect or reconnect could have happened while waiting. Without
    // this check, the switch would write back its configuration built BEFORE
    // the await — and would thereby mark a disconnected server as connected
    // again, or replace fresh credentials with stale ones.
    if (getServerConfig(serverId) !== current) { return; }
  }

  // TM1 refuses to impersonate a member of ADMIN (also the own user under
  // another spelling) with 403 "insufficient rights to impersonate the user
  // specified" — on EVERY request, so the tree would only show 403s. Probe
  // once before switching and keep the current view if TM1 says no
  // (measured 2026-10-05, 11.8: non-admin user and SecurityAdmin 200, ADMIN
  // members 403).
  if (user) {
    const probe = await apiRequest('GET', 'ActiveUser?$select=Name', undefined, undefined, next);
    if (probe.statusCode === 403) {
      throw new Error(vscode.l10n.t('TM1 refuses to impersonate "{0}". Members of ADMIN cannot be impersonated.', user));
    }
    if (getServerConfig(serverId) !== current) { return; }
  }

  if (user) { _originalConfigs.set(serverId, original); }
  else { _originalConfigs.delete(serverId); }

  _connectedConfigs.set(serverId, next);
  // The global fallback (deploy, linter, debugger) points at the
  // last-connected server — if it points at this one, it has to move along.
  if (ctx.globalState.get<string>(KEY_ACTIVE) === serverId) { setConfigOverride(next); }

  disposeAllForServer(current.serverUrl);
  // The reference index is keyed only by `serverUrl`, which doesn't change
  // during an impersonation. Without this line, "Called from" and the data
  // source references would show the OTHER view's data for up to 30 seconds
  // (the cache lifetime) — both when starting and when ending.
  invalidateReferenceIndex(current);
  onServerChanged.fire('impersonation');
}

/**
 * Cleans up on disconnect — otherwise the view outlives the connection.
 *
 * The preserved own session deliberately stays open during the
 * impersonation (it gets reused after ending it). On disconnect, no one else
 * picks it up: the disconnect handler only closes the configuration from
 * `_connectedConfigs`, and that is the impersonated one. Without this call,
 * the — usually administrative — session hangs around at the server until
 * it times out.
 */
export function forgetImpersonation(serverId: string): void {
  const original = _originalConfigs.get(serverId);
  _originalConfigs.delete(serverId);
  if (original) { void closeSession(original).catch(() => { /* best-effort */ }); }
}

export function _clearImpersonationsForTest(): void {
  _originalConfigs.clear();
}

/**
 * Store for credential sets — named credentials that several server
 * profiles can point to.
 *
 * Kept separate from `tm1.servers` for the same reason as `tm1.adminServers`:
 * `getAllServers()` is read everywhere, and an entry in it that isn't a
 * server would have to be filtered out at every one of those spots.
 *
 * The password NEVER lives here, only in SecretStorage under `credKey(id)`.
 */
import * as vscode from 'vscode';
import { _ctx, onServerChanged, getAllServers, credKey, KEY_CREDENTIALS, type CredentialSet } from '../../serverState/state';
import { namedStore } from '../../serverState/namedStore';
import { listAdminServers } from '../../serverState/adminServers';

export type { CredentialSet };

const store = namedStore<CredentialSet>(KEY_CREDENTIALS, {
  idPrefix: 'cred', ctx: () => _ctx,
});

export const newCredentialId = store.newId;
export const listCredentials = store.list;
export const getCredential = store.get;

// Revisions bracket BOTH metadata and secret writes. A reader must never use
// old secrets with newly written metadata, including while an await is pending.
const revisions = new WeakMap<vscode.ExtensionContext, Map<string, { revision: number; pending: number }>>();
function revisionState(ctx: vscode.ExtensionContext, id: string) {
  let entries = revisions.get(ctx);
  if (!entries) { entries = new Map(); revisions.set(ctx, entries); }
  let entry = entries.get(id);
  if (!entry) { entry = { revision: 0, pending: 0 }; entries.set(id, entry); }
  return entry;
}

/**
 * Who points to the set — for delete protection and the message.
 *
 * Not just server profiles: an admin server carries the same reference via
 * `defaultCredentialId`. Without this, a set that ONLY an admin server points
 * to could be deleted; `adminDiscovery` would then stamp the dead id onto
 * every newly discovered instance, `needsInitialCredentials` would consider
 * it supplied, and the user would get "credentials missing" on connect with
 * no hint at the cause (final review 2026-08-28, finding 3).
 *
 * Admin-server entries are labeled by name — otherwise the message would
 * show a name the user searches for in vain in their server list.
 */
export function credentialUsers(ctx: vscode.ExtensionContext, id: string): string[] {
  const profiles = getAllServers(ctx).filter(s => s.credentialId === id).map(s => s.name);
  const admins = listAdminServers()
    .filter(a => a.defaultCredentialId === id)
    .map(a => vscode.l10n.t('Admin server "{0}"', a.name));
  return [...profiles, ...admins];
}

/**
 * Create or update. `password === undefined` leaves an existing secret in
 * place — the edit form never sends a set's password back, an empty field
 * there means "unchanged".
 */
export async function saveCredential(
  set: CredentialSet,
  password: string | undefined,
): Promise<{ error?: string }> {
  if (!_ctx) { return {}; }
  const ctx = _ctx;
  const name = set.name.trim();
  if (!name) {
    return { error: vscode.l10n.t('Please enter a name for this login profile.') };
  }
  if (store.list().some(c => c.id !== set.id && c.name.toLowerCase() === name.toLowerCase())) {
    return { error: vscode.l10n.t('A login profile named "{0}" already exists.', name) };
  }
  // A CAM login is only complete with a namespace (`buildTm1Config` throws
  // otherwise). Without this rejection, a set could be created that fails on
  // connect — and in the server form, the namespace field is locked when a
  // set is chosen, so the user couldn't fix it there
  // (final review 2026-08-28, finding 4).
  if (set.authType === 'CAM' && !set.camNamespace?.trim()) {
    return { error: vscode.l10n.t('CAM credentials need a namespace — enter the CAM namespace.') };
  }
  // Explicit field list instead of `{ ...set }`: the caller passes through an
  // object from the webview, and whatever lands here sits in `globalState` —
  // i.e. in plain text on disk. A fixed list makes the promise "never a
  // secret in globalState" structural instead of merely conventional
  // (final review 2026-08-28, finding 6).
  const next: CredentialSet = {
    id: set.id,
    name,
    username: set.username,
    authType: set.authType,
    ...(set.camNamespace ? { camNamespace: set.camNamespace.trim() } : {}),
  };
  const revision = revisionState(ctx, set.id);
  revision.revision++;
  revision.pending++;
  try {
    await store.withCtx(ctx).upsert(next);
    if (password !== undefined) { await ctx.secrets.store(credKey(set.id), password); }
  } finally {
    revision.pending--;
    revision.revision++;
    if (!revision.pending) { onServerChanged.fire('profiles'); }
  }
  return {};
}

/**
 * Delete only when no profile points to it. A silent orphaning would leave
 * behind a server profile with no connectable credentials, which would only
 * surface on the next connect attempt.
 */
export async function deleteCredential(
  ctx: vscode.ExtensionContext,
  id: string,
): Promise<{ inUseBy?: string[] }> {
  const users = credentialUsers(ctx, id);
  if (users.length) { return { inUseBy: users }; }
  if (!_ctx) { return {}; }
  const revision = revisionState(ctx, id);
  revision.revision++;
  revision.pending++;
  try {
    await store.withCtx(ctx).remove(id);
    await ctx.secrets.delete(credKey(id));
  } finally {
    revision.pending--;
    revision.revision++;
    if (!revision.pending) { onServerChanged.fire('profiles'); }
  }
  return {};
}

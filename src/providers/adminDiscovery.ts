/**
 * Instance discovery for one TM1 Admin Server entry: fetches its reported
 * instance list, reconciles it against the profiles we already keep for it,
 * and persists the outcome into `tm1.servers`.
 *
 * This lives here — not in the tree provider — because the provider is a
 * display layer with no `ExtensionContext` (it takes callbacks, see
 * `tm1TreeDataProvider.ts`). Persistence needs `_ctx`, which only the
 * `serverManager` modules carry (see task-5-addendum.md).
 */
import { _ctx, getAllServers, saveServers, type ServerProfile } from '../serverState/state';
import { getAdminServer } from '../serverState/adminServers';
import { reconcileDiscovery } from './adminDiscoveryPure';
import { listInstancesFor } from './adminInstances';
import { PawGatewayError } from '../tm1Rest/pawGatewayUrl';
import { isSaasHost } from '../utils/serverUrl';

export interface DiscoveryResult {
  /** The profiles to display under the admin-server node, in order. */
  visible: ServerProfile[];
  /** Profiles whose URL diverges from what the admin server last reported (the user corrected it). */
  diverged: Set<string>;
  /** Profiles the admin server no longer reports. */
  stale: Set<string>;
}

const EMPTY_RESULT: DiscoveryResult = { visible: [], diverged: new Set(), stale: new Set() };

/**
 * Instance count from the most recent successful `discoverAndSync(adminId)`,
 * for the tree node's description. Deliberately NOT refreshed by firing
 * `_onDidChangeTreeData` right after an expand — that would rebuild the node
 * that is expanding and risks a loop. It shows at the next ordinary refresh
 * (e.g. `tm1.adminServer.refresh`).
 */
const _lastInstanceCount = new Map<string, number>();

export function lastInstanceCount(adminId: string): number | undefined {
  return _lastInstanceCount.get(adminId);
}

/** Test-only: drop all cached instance counts (module-level state outlives `initServerManager`). */
export function _clearInstanceCountsForTest(): void {
  _lastInstanceCount.clear();
}

/**
 * Fetch the admin server's instance list, reconcile it against the profiles
 * already tagged with this `adminId`, persist the outcome (create/refresh),
 * and return the display list.
 *
 * Throws when the admin server is unreachable — the caller (the tree
 * provider) shows an error child and must not touch any profile on failure.
 */
export async function discoverAndSync(adminId: string): Promise<DiscoveryResult> {
  const requestedAdmin = getAdminServer(adminId);
  if (!requestedAdmin || !_ctx) { return EMPTY_RESULT; }
  const ctx = _ctx;

  const isCurrent = (): boolean => {
    const current = getAdminServer(adminId);
    return _ctx === ctx && !!current && current.serverUrl === requestedAdmin.serverUrl
      && current.rejectUnauthorized === requestedAdmin.rejectUnauthorized
      && (current.kind ?? 'tm1') === (requestedAdmin.kind ?? 'tm1')
      && current.tenant === requestedAdmin.tenant;
  };
  let addressed: Awaited<ReturnType<typeof listInstancesFor>>;
  try {
    addressed = await listInstancesFor(requestedAdmin);
  } catch (error) {
    if (!isCurrent()) { return EMPTY_RESULT; }
    // PA SaaS lists only for a logged-in browser (adminInstances.ts#listPawDatabases).
    // Without one, the profiles found last time stand; connecting one logs in.
    if (error instanceof PawGatewayError && error.statusCode === 401 && isSaasHost(requestedAdmin.serverUrl)) {
      const hidden = new Set(requestedAdmin.hidden ?? []);
      const kept = getAllServers(ctx).filter(s => s.parentAdminId === adminId && !hidden.has(s.discoveredName ?? ''));
      if (kept.length) { return { visible: kept, diverged: new Set(), stale: new Set() }; }
    }
    throw error;
  }
  // The network await permits edits/removal. Reconcile with current preferences,
  // and discard results fetched for an endpoint or context that is no longer ours.
  const admin = getAdminServer(adminId);
  if (!admin || !isCurrent()) { return EMPTY_RESULT; }

  const servers = getAllServers(ctx);
  const mine = servers.filter(s => s.parentAdminId === adminId);
  const plan = reconcileDiscovery(adminId, addressed, mine, admin.hidden ?? []);
  // A PA SaaS child keeps the tenant in `v12.instance`, not in its URL (the
  // region host): a changed tenant on the gateway entry reaches it here.
  const saasNames = new Set(addressed.filter(a => a.saas).map(a => a.name));
  const retenant = mine.filter(s => s.v12?.authMode === 'saas' && s.v12.instance !== admin.tenant
    && saasNames.has(s.discoveredName ?? ''));

  if (plan.toCreate.length || plan.toUpdateUrl.length || plan.toTouchDiscoveredUrl.length || retenant.length) {
    const next = [...servers];
    for (const c of plan.toCreate) {
      const saas = saasNames.has(c.discoveredName);
      next.push({
        id: c.id,
        name: c.name,
        serverUrl: c.serverUrl,
        username: '',
        rejectUnauthorized: admin.rejectUnauthorized,
        authType: saas ? 'browser' : admin.defaultAuthType ?? 'Basic',
        ...(saas ? { version: 'v12' as const, v12: { authMode: 'saas' as const, instance: admin.tenant ?? '', database: c.discoveredName, tm1User: '' } } : {}),
        parentAdminId: adminId,
        discoveredName: c.discoveredName,
        discoveredUrl: c.discoveredUrl,
        // Only NEWLY created children inherit the default set — like
        // `rejectUnauthorized` above, there is no reach-through to existing profiles.
        ...(admin.defaultCredentialId && !saas ? { credentialId: admin.defaultCredentialId } : {}),
      });
    }
    for (const u of plan.toUpdateUrl) {
      const i = next.findIndex(s => s.id === u.id);
      if (i >= 0) { next[i] = { ...next[i], serverUrl: u.serverUrl, discoveredUrl: u.discoveredUrl }; }
    }
    for (const t of plan.toTouchDiscoveredUrl) {
      const i = next.findIndex(s => s.id === t.id);
      if (i >= 0) { next[i] = { ...next[i], discoveredUrl: t.discoveredUrl }; }
    }
    for (const r of retenant) {
      const i = next.findIndex(s => s.id === r.id);
      if (i >= 0 && r.v12) { next[i] = { ...next[i], v12: { ...r.v12, instance: admin.tenant ?? '' } }; }
    }
    await saveServers(ctx, next);
  }

  const after = getAllServers(ctx);
  const diverged = new Set(plan.divergedIds);
  const stale = new Set(plan.staleIds);
  const visible = plan.visibleIds
    .map(id => after.find(s => s.id === id))
    .filter((s): s is ServerProfile => !!s);

  if (!isCurrent()) { return EMPTY_RESULT; }
  _lastInstanceCount.set(adminId, visible.length);

  return { visible, diverged, stale };
}

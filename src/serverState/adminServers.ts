/**
 * Store for TM1 Admin Server entries.
 *
 * Deliberately SEPARATE from `tm1.servers`: `getAllServers()` is read all over
 * the place (connect quick picks, git setup, migrations, sandbox tracker,
 * tree). An entry in there that cannot be connected would have to be filtered
 * out at every one of those call sites, and the one place that forgets is the
 * bug.
 */
import { _ctx, onServerChanged, onProfileRemoved } from './state';
import { namedStore } from './namedStore';

export interface AdminServerProfile {
  id: string;
  name: string;
  /** Missing means the legacy, anonymous TM1 admin server. */
  kind?: 'tm1' | 'paw';
  /** Root URL of the admin server or PAW gateway; never contains credentials. */
  serverUrl: string;
  rejectUnauthorized: boolean;
  /** Instance names (as reported) the user took out of this group. */
  hidden: string[];
  /** Credential set that NEWLY discovered instances get assigned. Like
   *  `rejectUnauthorized`, this has no retroactive effect on existing children.
   *  PAW also uses this Basic profile for discovery itself. */
  defaultCredentialId?: string;
  /** PAW only: newly discovered instances log in through the browser
   *  (`authType: 'browser'`) instead of a credential set. */
  defaultAuthType?: 'browser';
  /** PAW only: tenant id; instance URLs then take the PA SaaS shape
   *  `/api/<tenant>/v0/tm1/<Name>` (`pawInstanceUrl`). */
  tenant?: string;
}

export const KEY_ADMIN_SERVERS = 'tm1.adminServers';

const store = namedStore<AdminServerProfile>(KEY_ADMIN_SERVERS, {
  idPrefix: 'adm', ctx: () => _ctx, notify: () => onServerChanged.fire('profiles'),
});

export const newAdminServerId = store.newId;
export const listAdminServers = store.list;
export const getAdminServer = store.get;
export const saveAdminServer = store.upsert;
export async function removeAdminServer(id: string): Promise<void> {
  await store.remove(id);
  onProfileRemoved.fire({ kind: 'admin', id });
}

/** Takes a discovered name out of the group. Idempotent. */
export async function hideDiscovered(adminId: string, discoveredName: string): Promise<void> {
  const admin = store.get(adminId);
  if (!admin) { return; }
  const hidden = admin.hidden ?? [];
  if (hidden.includes(discoveredName)) { return; }
  await store.upsert({ ...admin, hidden: [...hidden, discoveredName] });
}

/** Reverse of `hideDiscovered` — the user takes the name back into the
 *  group. Idempotent: a name not on the list does nothing. */
export async function unhideDiscovered(adminId: string, discoveredName: string): Promise<void> {
  const admin = store.get(adminId);
  if (!admin) { return; }
  const hidden = admin.hidden ?? [];
  if (!hidden.includes(discoveredName)) { return; }
  await store.upsert({ ...admin, hidden: hidden.filter(n => n !== discoveredName) });
}

/**
 * Server list exchange: export the profiles to a JSON file a team can share,
 * and merge such a file back in. vscode-free so the rules are unit-testable.
 *
 * What stays out of the file, on purpose:
 *  - passwords and the username (personal; `v12.tm1User` likewise),
 *  - credential-set references and the Git profile (local to this machine),
 *  - admin-server bookkeeping (`parentAdminId`, `discovered*`): the recipient
 *    may not have that admin server — an exported child becomes a plain server.
 *
 * Admin-server children are exported only once they were actually used —
 * a username entered or connected right now. The rest the recipient's own
 * admin server finds by itself.
 */
import type { ServerProfile } from '../../serverState/state';
import type { V12Config } from '../../tm1Rest/transport/types';

export const EXCHANGE_FORMAT = 'tm1-servers/1';

export type ExportedServer = Pick<ServerProfile,
  'name' | 'serverUrl' | 'authType' | 'rejectUnauthorized' | 'camNamespace' | 'spn' | 'folder' | 'version' | 'v12'>;

export interface ServerExchangeFile {
  format: typeof EXCHANGE_FORMAT;
  servers: ExportedServer[];
}

export function toExportFile(servers: ServerProfile[], isConnected: (id: string) => boolean): ServerExchangeFile {
  const exported = servers
    .filter(s => !s.parentAdminId || !!s.username || isConnected(s.id))
    .map((s): ExportedServer => ({
      name: s.name,
      serverUrl: s.serverUrl,
      authType: s.authType,
      rejectUnauthorized: s.rejectUnauthorized,
      ...(s.camNamespace ? { camNamespace: s.camNamespace } : {}),
      // A service name is no secret, and finding it out is the hard part.
      ...(s.spn ? { spn: s.spn } : {}),
      ...(s.folder ? { folder: s.folder } : {}),
      ...(s.version ? { version: s.version } : {}),
      ...(s.v12 ? { v12: { ...s.v12, tm1User: '' } } : {}),
    }));
  return { format: EXCHANGE_FORMAT, servers: exported };
}

/** Same server = same URL and, on v12, same instance + database (one gateway URL serves many). */
function serverKey(s: Pick<ServerProfile, 'serverUrl' | 'v12'>): string {
  const url = s.serverUrl.trim().replace(/\/+$/, '').toLowerCase();
  return s.v12 ? `${url}|${s.v12.instance}|${s.v12.database}`.toLowerCase() : url;
}

export interface ImportResult {
  servers: ServerProfile[];
  added: number;
  skipped: number;
  /** Entries dropped because a field has the wrong type or an unsupported value. */
  invalid: number;
}

/** Auth types a profile can actually connect with. */
export const IMPORTABLE_AUTH_TYPES: readonly ServerProfile['authType'][] = ['Basic', 'CAM', 'integrated', 'v12-basic'];
export const IMPORTABLE_VERSIONS: readonly NonNullable<ServerProfile['version']>[] = ['v11', 'v12'];
export const IMPORTABLE_V12_AUTH_MODES: readonly V12Config['authMode'][] = ['basic-s2s', 'basic-native', 'saas'];

const optString = (v: unknown): boolean => v === undefined || typeof v === 'string';

/** The v12 block with only the fields the file may carry, or null when malformed. */
function importV12(v: unknown): V12Config | undefined | null {
  if (v === undefined) { return undefined; }
  if (!v || typeof v !== 'object') { return null; }
  const o = v as Record<string, unknown>;
  if (typeof o.instance !== 'string' || typeof o.database !== 'string'
    || !IMPORTABLE_V12_AUTH_MODES.includes(o.authMode as V12Config['authMode'])) { return null; }
  return { instance: o.instance, database: o.database, authMode: o.authMode as V12Config['authMode'], tm1User: '' };
}

/** Throws on a file that is not a server export — better than importing garbage. */
export function mergeImport(existing: ServerProfile[], raw: unknown, newId: () => string): ImportResult {
  const file = raw as Partial<ServerExchangeFile> | undefined;
  if (!file || file.format !== EXCHANGE_FORMAT || !Array.isArray(file.servers)) {
    throw new Error('not a TM1 server export');
  }
  const known = new Set(existing.map(serverKey));
  const fromFile = new Set<string>();
  const servers = [...existing];
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  for (const s of file.servers) {
    // A hand-edited file reaches `tm1.servers` unchecked otherwise; a numeric
    // `folder` alone broke the whole explorer root (localeCompare on a number).
    const v12 = s && typeof s === 'object' ? importV12(s.v12) : null;
    if (!s || typeof s.name !== 'string' || typeof s.serverUrl !== 'string' || !s.serverUrl
      || v12 === null
      || (s.authType !== undefined && !IMPORTABLE_AUTH_TYPES.includes(s.authType))
      || (s.version !== undefined && !IMPORTABLE_VERSIONS.includes(s.version))
      || !optString(s.folder) || !optString(s.camNamespace) || !optString(s.spn)) { invalid++; continue; }
    // Against the existing list the URL decides (a renamed profile is still
    // the same server); inside the file two profiles may share a URL, e.g.
    // with different users, so there the name belongs to the key.
    const key = serverKey(s);
    const fileKey = `${key}|${s.name}`;
    if (known.has(key) || fromFile.has(fileKey)) { skipped++; continue; }
    fromFile.add(fileKey);
    servers.push({
      id: newId(),
      name: s.name,
      serverUrl: s.serverUrl,
      username: '',
      authType: s.authType ?? 'Basic',
      rejectUnauthorized: s.rejectUnauthorized !== false,
      ...(s.camNamespace ? { camNamespace: s.camNamespace } : {}),
      ...(s.spn ? { spn: s.spn } : {}),
      ...(s.folder ? { folder: s.folder } : {}),
      ...(s.version ? { version: s.version } : {}),
      ...(v12 ? { v12 } : {}),
      imported: true,
    });
    added++;
  }
  return { servers, added, skipped, invalid };
}

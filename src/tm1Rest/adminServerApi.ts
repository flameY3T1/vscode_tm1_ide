/**
 * REST access to the TM1 admin server — reads the list of instances
 * registered with it (`GET /api/v1/Servers`). The admin server answers
 * anonymously, hence `anonymousGet` instead of the `transport/` stack.
 *
 * No `vscode` import: `tm1Rest/**` stays vscode-free (depcruise rule
 * `tm1rest-no-vscode`), so error messages stay English — the caller
 * localizes at the display site.
 */
import { anonymousGet } from './anonymousGet';

export interface AdminInstance {
  name: string;
  /**
   * Complete base URL as the instance self-registered it. The host part is the
   * TM1 machine's own name as its OS reports it — frequently not resolvable
   * from a client machine, see `resolveInstanceUrl` in `adminDiscoveryPure`.
   */
  host: string;
  acceptingClients: boolean;
  usingSSL: boolean;
  /** Reported IPv4 bind address. `0.0.0.0` when the instance binds to all NICs. */
  ipAddress: string;
  ipv6Address: string;
  /** REST port of the instance. `0` when the admin server did not report one. */
  httpPortNumber: number;
  lastUpdated?: string;
}

interface RawServer {
  Name?: string;
  Host?: string;
  AcceptingClients?: boolean;
  UsingSSL?: boolean;
  IPAddress?: string;
  IPv6Address?: string;
  HTTPPortNumber?: number;
  LastUpdated?: string;
}

export async function listAdminInstances(
  adminUrl: string,
  rejectUnauthorized: boolean,
  timeoutMs = 10000,
): Promise<AdminInstance[]> {
  const path = '/api/v1/Servers';
  const res = await anonymousGet(`${adminUrl.trim().replace(/\/+$/, '')}${path}`, rejectUnauthorized, timeoutMs);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`TM1 Admin Server answered HTTP ${res.status} for ${path}`);
  }
  let parsedBody: { value?: RawServer[] };
  try {
    parsedBody = JSON.parse(res.body);
  } catch (e) {
    throw new Error(`Failed to parse Admin Server response as JSON: ${(e as Error).message}`);
  }
  const rows = Array.isArray(parsedBody.value) ? parsedBody.value : [];
  return rows.map((r) => ({
    name: r.Name ?? '',
    host: r.Host ?? '',
    acceptingClients: r.AcceptingClients ?? false,
    usingSSL: r.UsingSSL ?? false,
    ipAddress: r.IPAddress ?? '',
    ipv6Address: r.IPv6Address ?? '',
    httpPortNumber: typeof r.HTTPPortNumber === 'number' ? r.HTTPPortNumber : 0,
    ...(r.LastUpdated !== undefined ? { lastUpdated: r.LastUpdated } : {}),
  }));
}

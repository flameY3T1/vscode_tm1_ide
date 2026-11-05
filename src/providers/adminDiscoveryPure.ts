/**
 * Pure reconciliation between what an admin server reports and the profiles we
 * already keep for it. No vscode, no I/O — the tree provider wires it.
 *
 * Two rules carry the whole design:
 *  - `discoveredName` is the match key, so renaming a profile is safe.
 *  - the reported URL is only written while the profile still carries exactly
 *    the URL we last wrote (`serverUrl === discoveredUrl`). Once the user has
 *    corrected it, theirs wins — otherwise every expand would undo the fix.
 */
import type { AdminInstance } from '../tm1Rest/adminServerApi';
import { encodePawInstanceName, normalizePawGatewayUrl } from '../tm1Rest/pawGatewayUrl';
import { pawInstanceRoute } from '../utils/pawTarget';

/** `0.0.0.0` / `::` mean "bound to every NIC" — nothing a client can dial. */
function usableIp(ip: string): boolean {
  const t = (ip ?? '').trim();
  return t !== '' && t !== '0.0.0.0' && t !== '::' && t !== '::0';
}

function hostOf(url: string): string {
  try {
    // WHATWG `hostname` already brackets an IPv6 literal — do not double it.
    return new URL(url.trim()).hostname;
  } catch {
    return '';
  }
}

/**
 * The URL under which a reported instance is actually reachable.
 *
 * The instance's own `Host` is useless as often as not: TM1 builds it from the
 * machine's OS host name, which on a corporate network is an internal short
 * name the client cannot resolve (measured 2026-08-28). Two fields do carry a
 * dialable address, in this order:
 *
 *  1. the **admin server's own host** plus the instance's `HTTPPortNumber` —
 *     the user typed that address themselves and it just answered the instance
 *     list, so it demonstrably resolves; and `tm1admsrv.exe` ships with the
 *     same installation as the instances, so it is nearly always the same
 *     machine.
 *  2. the reported `IPAddress`/`IPv6Address`, when the admin URL yields no host.
 *     Beware: against `https` an IP will not match a certificate issued for the
 *     host name.
 *
 * "Nearly always" fails when one instance registers with admin servers on
 * several machines (`AdminHost=A;B`). The reported fields
 * cannot decide it: on the test server (2026-10-21) the instances reported
 * `IPAddress` 192.0.2.158 (its LAN address), 127.0.0.1 and 0.0.0.0 while only the admin host
 * answered, and their own `Host` resolved to a loopback on the client. So
 * {@link instanceUrlCandidates} lists the alternatives and the caller keeps the
 * first one whose port answers.
 *
 * The scheme comes from `UsingSSL` (the instance's REST port), never from the
 * admin URL — 5895 is plain http even where every instance runs TLS. Without a
 * reported port nothing can be composed and the reported `Host` stands.
 */
export function resolveInstanceUrl(adminUrl: string, inst: AdminInstance): string {
  const port = inst.httpPortNumber;
  if (!port || port <= 0) { return inst.host; }
  const scheme = inst.usingSSL ? 'https' : 'http';

  const adminHost = hostOf(adminUrl);
  if (adminHost) { return `${scheme}://${adminHost}:${port}`; }

  if (usableIp(inst.ipAddress)) { return `${scheme}://${inst.ipAddress.trim()}:${port}`; }
  if (usableIp(inst.ipv6Address)) { return `${scheme}://[${inst.ipv6Address.trim()}]:${port}`; }

  return inst.host;
}

/**
 * Every URL an instance might answer on, best first: the {@link resolveInstanceUrl}
 * pick, then its own reported host, then its reported IPs. Deduplicated; a single
 * entry when no port is reported.
 */
export function instanceUrlCandidates(adminUrl: string, inst: AdminInstance): string[] {
  const first = resolveInstanceUrl(adminUrl, inst);
  const port = inst.httpPortNumber;
  if (!port || port <= 0) { return [first]; }
  const scheme = inst.usingSSL ? 'https' : 'http';
  const own = hostOf(inst.host);
  const all = [
    first,
    ...(own ? [`${scheme}://${own}:${port}`] : []),
    ...(usableIp(inst.ipAddress) ? [`${scheme}://${inst.ipAddress.trim()}:${port}`] : []),
    ...(usableIp(inst.ipv6Address) ? [`${scheme}://[${inst.ipv6Address.trim()}]:${port}`] : []),
  ];
  return [...new Set(all)];
}

/**
 * Child URL of a PAW gateway entry: `<base>/api/v1/tm1/<Name>`, or with a
 * tenant the PA SaaS shape `<base>/api/<tenant>/v0/tm1/<Name>` (measured on
 * SaaS 2026-10-25: both shapes answer with the same browser cookies).
 */
export function pawInstanceUrl(baseUrl: string, name: string, tenant?: string): string {
  return pawInstanceRoute(normalizePawGatewayUrl(baseUrl), encodePawInstanceName(name), tenant);
}

export interface DiscoveredProfileLike {
  id: string;
  name: string;
  serverUrl: string;
  discoveredName?: string;
  discoveredUrl?: string;
}

export interface Reconciliation {
  toCreate: { id: string; name: string; serverUrl: string; discoveredName: string; discoveredUrl: string }[];
  toUpdateUrl: { id: string; serverUrl: string; discoveredUrl: string }[];
  toTouchDiscoveredUrl: { id: string; discoveredUrl: string }[];
  visibleIds: string[];
  staleIds: string[];
  divergedIds: string[];
}

/**
 * Deterministic id. NOT `Date.now().toString()` like `form.ts` uses: one
 * discovery creates several profiles inside the same millisecond, which would
 * collide. Being deterministic also keeps the same instance under two admin
 * servers apart, and survives a restart.
 */
export function discoveredProfileId(adminId: string, discoveredName: string): string {
  return `disc:${adminId}:${discoveredName}`;
}

export function reconcileDiscovery(
  adminId: string,
  reported: Pick<AdminInstance, 'name' | 'host' | 'acceptingClients'>[],
  existing: DiscoveredProfileLike[],
  hidden: string[],
): Reconciliation {
  const hiddenSet = new Set(hidden);
  const usable = reported
    .filter(r => r.acceptingClients && r.name && r.host && !hiddenSet.has(r.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const byName = new Map<string, DiscoveredProfileLike>();
  for (const p of existing) {
    if (p.discoveredName) { byName.set(p.discoveredName, p); }
  }

  const out: Reconciliation = {
    toCreate: [], toUpdateUrl: [], toTouchDiscoveredUrl: [],
    visibleIds: [], staleIds: [], divergedIds: [],
  };

  const seen = new Set<string>();
  for (const r of usable) {
    const found = byName.get(r.name);
    if (!found) {
      const id = discoveredProfileId(adminId, r.name);
      out.toCreate.push({ id, name: r.name, serverUrl: r.host, discoveredName: r.name, discoveredUrl: r.host });
      out.visibleIds.push(id);
      continue;
    }
    seen.add(r.name);
    out.visibleIds.push(found.id);
    const untouched = found.serverUrl === found.discoveredUrl;
    if (found.discoveredUrl !== r.host) {
      if (untouched) {
        out.toUpdateUrl.push({ id: found.id, serverUrl: r.host, discoveredUrl: r.host });
      } else {
        out.toTouchDiscoveredUrl.push({ id: found.id, discoveredUrl: r.host });
      }
    }
    if (!untouched) { out.divergedIds.push(found.id); }
  }

  for (const p of existing) {
    if (!p.discoveredName || seen.has(p.discoveredName) || hiddenSet.has(p.discoveredName)) { continue; }
    out.staleIds.push(p.id);
    if (!out.visibleIds.includes(p.id)) { out.visibleIds.push(p.id); }
  }

  return out;
}

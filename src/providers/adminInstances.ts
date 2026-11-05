// Instance list of an admin server or PAW gateway. The tree, the "hidden
// instances" dialog and the connection probe in the add-server panel each
// branched on the kind themselves, and each read a failure differently — the
// dialog swallowed it (review 2026-10-03, B7).
import { connect } from 'node:net';
import { listAdminInstances } from '../tm1Rest/adminServerApi';
import { listPawInstances, type PawInstance } from '../tm1Rest/pawGatewayApi';
import { PawGatewayError } from '../tm1Rest/pawGatewayUrl';
import { _allSessions, _getSession } from '../tm1Rest/transport/session';
import { isSaasHost } from '../utils/serverUrl';
import { instanceUrlCandidates, pawInstanceUrl } from './adminDiscoveryPure';
import { describePawError } from '../utils/pawErrorText';
import { describeNetworkError } from '../utils/networkErrorText';

export interface AdminEndpoint {
  kind?: 'tm1' | 'paw';
  serverUrl: string;
  rejectUnauthorized: boolean;
  /** PAW only: tenant for the instance URLs (`pawInstanceUrl`). */
  tenant?: string;
}

export interface AddressedInstance {
  name: string;
  acceptingClients: boolean;
  /** The URL a profile for this instance connects to. */
  host: string;
  /** PA SaaS database: `host` is the region host, the profile is v12 with
   *  tenant and database (`v12.authMode` saas), like a SaaS browser profile. */
  saas?: boolean;
}

/** Every instance the endpoint reports, with its connect URL. Throws when unreachable. */
export async function listInstancesFor(admin: AdminEndpoint): Promise<AddressedInstance[]> {
  if (admin.kind === 'paw') {
    const instances = await listPawDatabases(admin);
    return instances.map(({ isV12, ...r }) => {
      // Only measured on PA SaaS; a v12 database behind an on-prem PAW keeps the v11 shape.
      if (!isV12 || !isSaasHost(admin.serverUrl)) {
        return { ...r, host: pawInstanceUrl(admin.serverUrl, r.name, admin.tenant) };
      }
      if (!admin.tenant) { throw new PawGatewayError('PA SaaS databases need a tenant', 'tenant'); }
      return { ...r, host: new URL(admin.serverUrl).origin, saas: true };
    });
  }
  const reported = await listAdminInstances(admin.serverUrl, admin.rejectUnauthorized);
  return Promise.all(reported.map(async r => ({ ...r, host: await firstAnswering(instanceUrlCandidates(admin.serverUrl, r)) })));
}

/**
 * Anonymous first (PAW). PA SaaS answers 401 there: then the cookies of a
 * browser session on the same host, if one is live. Without one the 401
 * stands — the list never opens a browser by itself.
 */
async function listPawDatabases(admin: AdminEndpoint): Promise<PawInstance[]> {
  try {
    return await listPawAnonymousOnceMore(admin);
  } catch (err) {
    const cookie = err instanceof PawGatewayError && err.statusCode === 401 ? browserCookieFor(admin.serverUrl) : undefined;
    if (!cookie) { throw err; }
    return listPawInstances(admin.serverUrl, admin.rejectUnauthorized, undefined, cookie);
  }
}

/**
 * One retry on a timeout only. Reported 2026-11-01 on a company PAW: the
 * first list request after VS Code starts sometimes hangs into the timeout,
 * a second click right after answers at once (curl.exe: 200 in < 0.3 s every
 * time). The request is anonymous and sends no credentials, so a retry can
 * lock nobody out.
 */
async function listPawAnonymousOnceMore(admin: AdminEndpoint): Promise<PawInstance[]> {
  try {
    return await listPawInstances(admin.serverUrl, admin.rejectUnauthorized);
  } catch (err) {
    if (!(err instanceof PawGatewayError) || err.code !== 'timeout') { throw err; }
    return listPawInstances(admin.serverUrl, admin.rejectUnauthorized);
  }
}

function browserCookieFor(url: string): string | undefined {
  const origin = new URL(url).origin;
  return _allSessions().find(e => e.cfg.authType === 'browser'
    && new URL(e.cfg.serverUrl).origin === origin && _getSession(e.cfg))?.cookie;
}

/** Port answer wait per candidate; the admin host answers in milliseconds when it is the right machine. */
const PROBE_MS = 1500;

/**
 * The first candidate whose TCP port accepts a connection, tried in order, so a
 * working admin host costs one handshake and wins as before. None answering
 * (instance down, firewall): the first candidate stands, the old behaviour.
 */
async function firstAnswering(candidates: string[]): Promise<string> {
  for (const url of candidates) {
    if (await portAnswers(url)) { return url; }
  }
  return candidates[0];
}

function portAnswers(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return Promise.resolve(false); }
  return new Promise(resolve => {
    let s: ReturnType<typeof connect>;
    // A refused socket can also throw synchronously (bad host, sandbox); same answer.
    try { s = connect({ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port), timeout: PROBE_MS }); } catch { resolve(false); return; }
    const done = (ok: boolean): void => { s.destroy(); resolve(ok); };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

/**
 * A failed `listInstancesFor`, readable. Interpreted instead of raw: `https://`
 * against a plaintext port comes out of node as a BoringSSL line
 * ("WRONG_VERSION_NUMBER") that reads like a TLS version problem.
 */
export function describeInstanceListError(kind: AdminEndpoint['kind'], err: unknown, url: string): string {
  return kind === 'paw' ? describePawError(err, url) : describeNetworkError(err, url);
}

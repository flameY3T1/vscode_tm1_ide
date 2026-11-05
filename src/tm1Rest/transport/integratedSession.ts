// src/tm1Rest/transport/integratedSession.ts
//
// Mints a `TM1SessionId` cookie via integrated Windows authentication.
// v11 ONLY: in v12 the session comes from `/{instance}/auth/v1/session`
// (see `v12Session.ts`), where there is neither SPNEGO nor NTLM.
//
// Self-contained like `v12Session.ts` — this module must NOT import from
// `./http`, or a cycle results.
//
// ── Why the messages are computed here rather than through a library ───────
// On a 401, TM1 offers `Negotiate`, but underneath it sends **raw NTLMSSP**
// (`NTLMSSP\0`, msgType 2), not SPNEGO. Measured on 2026-09-17 against TM1
// 11.8 with `IntegratedSecurityMode=2`: a 178-byte challenge, TargetName
// `TM1HOST`, flags `0xA28A8205`, AV pairs 2,1,4,3,7 (with a timestamp, MIC
// rules apply). The two obvious shortcuts both fail here, both measured:
//   * `curl.exe --negotiate -u :` — Windows curl has no NTLM at all
//     (`Features: … Kerberos SPNEGO SSL SSPI …`; `--ntlm` reports
//     "the installed libcurl version does not support this"), and the
//     SSPI package *Negotiate* cannot do anything with a bare Type 2:
//     it sent an EMPTY Type 3 (Lm, Nt, Domain, User, Workstation all
//     `len=0`), which TM1 rightly rejects with 401.
//   * .NET's `HttpClientHandler.UseDefaultCredentials` — lands on the
//     same Negotiate/SPNEGO package and gives up after the challenge.
// So: `ntlm.ts` computes the messages, `sspiNtlm.ts` fetches them from
// Windows without a password. The scheme NAME stays `Negotiate`, the
// CONTENT is NTLM — exactly what TM1 expects.
//
// ── Connection binding ───────────────────────────────────────────────────
// NTLM is bound to the socket. Both legs must run over the SAME connection,
// and a second handshake needs a FRESH one: a second Type 1 on a socket that
// has already seen an exchange is rejected without a challenge (measured
// alongside this on 2026-09-17 — the first probe ran straight into this
// trap). Hence a dedicated agent per mint with `maxSockets: 1`, which travels
// along with the result: the session carries its requests forward on the
// same connection.
//
// WARNING, this last claim is UNVERIFIED: `transport/http.ts` sends the first
// data request after a mint to the caller's agent, if it has pinned one — so
// precisely NOT on this connection. Nobody knows whether the cookie is
// socket-independent; no data request after a mint has ever gone through so
// far. The contradiction is written out at the call site (finding A3).
//
// ── Through Planning Analytics Workspace ─────────────────────────────────
// A `serverUrl` of the form `https://<paw>/api/v1/tm1/<instance>` goes
// through the PAW gateway. Measured 2026-09-29 against a company PAW in
// front of TM1 11.8 (probe pawNtlmProbe.mjs), it takes TWO
// logins, each its own handshake on its own connection:
//   1. `POST <paw>/login`, form `mode=negotiate` → `paSession`, `ba-sso-csrf`.
//   2. `GET <paw>/login/tm1/<instance>` with those cookies → `TM1SessionId_<instance>`.
//      Its first answer is `403` WITHOUT a `WWW-Authenticate` header; the
//      schemes stand only in the body (`{"error":{"authenticate":{"Negotiate":"",…}}}`).
// All three cookies together then carry `<paw>/api/v1/tm1/<instance>/api/v1/…`
// (200, on a fresh socket). A data call BEFORE step 2 is no usable probe: it
// answered 401, 500 or hung for 30 s across runs.
//
// Native (Basic) login through PAW, from the browser against the same
// company PAW (2026-09-30): `POST <paw>/login/tm1/<instance>/form`,
// `mode=basic&username=…&password=…` → 200, no `/login` before it, no
// `ba-sso-csrf`. Posted cold from the extension it answers 200 as well and
// sets `paSession` + `TM1SessionId_<instance>` (2026-09-30, first post took
// 21 s, later ones 0.3–6 s). OPEN: the first API call after it answered 401
// (2026-09-30) — the browser's data route is not known yet, so the extension
// does not use this post (removed 2026-10-01). Basic straight on the API route
// hangs on the company PAW (2026-09-29) but answers 200 on PAW Local
// (2026-09-16/20).
//
// The instance step is where PAW opens its own session to TM1. On
// 2026-09-30 its first, unauthenticated leg hung until our 30 s deadline;
// the manual retry 16 s later answered in 5.6 s on a fresh connection. So a
// timeout on THAT leg is retried once — it carries no credentials, the AD
// lockout argument does not apply. A timeout after credentials went out is
// not retried.
import * as https from 'https';
import * as http from 'http';
import * as dns from 'dns';
import type { Tm1Config } from './types';
import { buildBaseUrl } from './urlBuilder';
import { parseTm1SessionCookie, EXT_CLIENT_ID } from './auth';
import { errMsg } from '../../utils/errMsg';
import { pawTarget } from '../../utils/pawTarget';
import {
  buildType1, buildType3, parseType2, pickNtlmScheme, extractChallengeToken,
  authorizationHeader, extractSchemeToken, splitDomainUser, type NtlmScheme,
} from './ntlm';
import { startSspiHandshake, sspiAvailable, type SspiHandshake, type SspiPackage } from './sspiNtlm';

export type IntegratedMintOutcome =
  | { ok: true; cookie: string; agent: http.Agent | https.Agent }
  | { ok: false; status: number; message: string };

interface Leg {
  status: number;
  challenges: string[];
  setCookie: string[] | undefined;
  localPort: number | undefined;
  /** First few KB of the body — PAW names its schemes there, not in a header. */
  body?: string;
}

/** What a PAW leg needs beyond a plain GET. */
interface LegExtra {
  method?: 'GET' | 'POST';
  /** `application/x-www-form-urlencoded` body. */
  form?: string;
  cookie?: string;
}

type RequestLeg = (url: string, authorization: string | undefined,
  agent: http.Agent | https.Agent, rejectUnauthorized: boolean, extra?: LegExtra) => Promise<Leg>;

/** Injectable outside world — tests hand in doubles here. */
export interface IntegratedDeps {
  request?: RequestLeg;
  startSspi?: typeof startSspiHandshake;
  sspiAvailable?: () => boolean;
  /** Reverse resolution for the service name — injected in tests. */
  reverseNames?: (host: string) => Promise<string[]>;
}

/**
 * Which hostname belongs in the service name.
 *
 * Kerberos builds it from the host (`HTTP/<host>`), and SPNs are registered
 * against the FQDN — a short name runs into `SEC_E_TARGET_UNKNOWN`. An
 * FQDN or an IP is left as is; otherwise the reverse-resolved name applies,
 * but only with a matching first component — a foreign PTR record must not
 * be allowed to bend the service name.
 */
export function pickSpnHost(host: string, reverseNames: string[]): string {
  if (host.includes('.') || host.includes(':')) { return host; }
  const wanted = `${host.toLowerCase()}.`;
  for (const name of reverseNames) {
    const candidate = name.replace(/\.$/, '');
    if (candidate.toLowerCase().startsWith(wanted)) { return candidate; }
  }
  return host;
}

async function reverseNames(host: string): Promise<string[]> {
  try {
    const { address } = await dns.promises.lookup(host);
    return await dns.promises.reverse(address);
  } catch {
    // No resolution: continue with the typed host. Kerberos may then fail
    // on the SPN, but NTLM still works.
    return [];
  }
}

/**
 * Deadline for ONE leg of the handshake.
 *
 * Named, not a bare number: the handshake tries up to three packages one
 * after another, two legs each, and the helper process before that has its
 * own 30-second deadline (`sspiNtlm.ts#SSPI_TIMEOUT_MS`). In the worst case
 * these add up — anyone wanting to cap the total duration needs to see this
 * HERE. An overall cap supplied by the caller is still missing (finding A9,
 * second half): `mintIntegratedCookie` takes no `timeoutMs`, even though
 * `requestWithSession` gets one.
 */
const LEG_TIMEOUT_MS = 30_000;
const LEG_TIMEOUT_MESSAGE = 'Integrated login timed out';

/**
 * Per-leg trace sink. This layer must not import `vscode`, so the extension
 * wires an output channel in here. Lines carry path, status, schemes and
 * duration — never a token, cookie value or password.
 */
let legLog: ((line: string) => void) | undefined;
export function setIntegratedLoginLog(sink: ((line: string) => void) | undefined): void { legLog = sink; }
/** Lets `http.ts` add what happens to the session after the login. */
export function logIntegratedLogin(line: string): void { legLog?.(line); }

function loggedRequest(doRequest: RequestLeg): RequestLeg {
  return async (url, authorization, agent, rejectUnauthorized, extra) => {
    if (!legLog) { return doRequest(url, authorization, agent, rejectUnauthorized, extra); }
    const log = legLog;
    const u = new URL(url);
    const what = `${extra?.method ?? 'GET'} ${u.host}${u.pathname}`
      + (authorization ? ` [${authorization.split(' ', 1)[0]}]` : ' [no auth]');
    const t0 = Date.now();
    try {
      const leg = await doRequest(url, authorization, agent, rejectUnauthorized, extra);
      const schemes = [...leg.challenges.map(c => c.split(/[\s,]/, 1)[0]), ...bodySchemes(leg.body).map(s => `${s} (body)`)];
      const cookies = (leg.setCookie ?? []).map(c => c.split('=', 1)[0]);
      log(`${what} -> ${leg.status} in ${Date.now() - t0} ms`
        + (schemes.length ? `; offers ${schemes.join(', ')}` : '')
        + (cookies.length ? `; sets ${cookies.join(', ')}` : ''));
      return leg;
    } catch (error) {
      log(`${what} -> FAILED after ${Date.now() - t0} ms: ${errMsg(error)}`);
      throw error;
    }
  };
}

function requestLeg(
  url: string,
  authorization: string | undefined,
  agent: http.Agent | https.Agent,
  rejectUnauthorized: boolean,
  extra: LegExtra = {},
): Promise<Leg> {
  const legTimeoutMs = LEG_TIMEOUT_MS;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  return new Promise<Leg>((resolve, reject) => {
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: extra.method ?? 'GET',
      agent,
      headers: {
        Accept: 'application/json',
        // The handshake must not lose the connection, see header.
        Connection: 'keep-alive',
        'TM1-SessionContext': EXT_CLIENT_ID,
        ...(authorization ? { Authorization: authorization } : {}),
        ...(extra.cookie ? { Cookie: extra.cookie } : {}),
        ...(extra.form !== undefined
          ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(extra.form) }
          : {}),
      },
      ...(isHttps ? { rejectUnauthorized } : {}),
    }, (res) => {
      // `rawHeaders` instead of `headers`: multiple `WWW-Authenticate` lines
      // would be merged into one there, and keeping them separate is the point.
      const challenges: string[] = [];
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        if (res.rawHeaders[i].toLowerCase() === 'www-authenticate') {
          challenges.push(res.rawHeaders[i + 1]);
        }
      }
      const localPort = res.socket?.localPort;
      // Keep only the start of the body, but read it to the end to free the connection.
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { if (body.length < 4096) { body += chunk; } });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        challenges,
        setCookie: res.headers['set-cookie'],
        localPort,
        body,
      }));
      res.on('error', reject);
    });
    req.setTimeout(legTimeoutMs, () => req.destroy(new Error(LEG_TIMEOUT_MESSAGE)));
    req.on('error', reject);
    if (extra.form !== undefined) { req.write(extra.form); }
    req.end();
  });
}

function agentFor(isHttps: boolean): http.Agent | https.Agent {
  const options = { keepAlive: true, maxSockets: 1, maxFreeSockets: 1 };
  return isHttps ? new https.Agent(options) : new http.Agent(options);
}

/**
 * Opens the session and returns the cookie and agent.
 *
 * The probe request goes to `<base>/Configuration` — the cheapest path every
 * v11 instance knows. Only a `2xx` with a cookie counts as a login; a `401`
 * stays a `401` (the caller must NOT fall back to Basic, or the server
 * counts a second failed login — AD locks accounts).
 */
export async function mintIntegratedCookie(cfg: Tm1Config, deps: IntegratedDeps = {}): Promise<IntegratedMintOutcome> {
  const t0 = Date.now();
  const outcome = await mintIntegratedCookieInner(cfg, deps);
  legLog?.(outcome.ok
    ? `Integrated login OK after ${Date.now() - t0} ms`
    : `Integrated login FAILED after ${Date.now() - t0} ms (status ${outcome.status}): ${outcome.message}`);
  return outcome;
}

async function mintIntegratedCookieInner(cfg: Tm1Config, deps: IntegratedDeps): Promise<IntegratedMintOutcome> {
  if (cfg.version === 'v12') {
    return { ok: false, status: 0, message: 'Integrated login is v11 only — v12 mints its session through the auth endpoint.' };
  }
  const paw = pawTarget(cfg.serverUrl);
  const url = paw ? `${paw.gateway}/login` : `${buildBaseUrl(cfg)}/Configuration`;
  const isHttps = new URL(url).protocol === 'https:';
  const doRequest = loggedRequest(deps.request ?? requestLeg);
  legLog?.(`Integrated login ${paw ? `through PAW ${paw.gateway}, instance ${paw.instance}` : `to ${url}`}`);

  // Every attempt needs its own connection; at the end exactly the one on
  // which the login succeeded is kept open.
  const agents: (http.Agent | https.Agent)[] = [];
  const newAgent = (): http.Agent | https.Agent => { agents.push(agentFor(isHttps)); return agents[agents.length - 1]; };
  let keptAgent: http.Agent | https.Agent | undefined;

  try {
    if (paw) {
      const outcome = await mintThroughPaw(cfg, paw, doRequest, deps, newAgent);
      if (outcome.ok) { keptAgent = outcome.agent; }
      return outcome;
    }
    const legs = await loginAt(url, cfg, doRequest, deps, newAgent);
    if ('failed' in legs) { return legs.failed; }
    if ('open' in legs) {
      // No login protection — so there is nothing to mint either.
      const cookie = parseTm1SessionCookie(legs.open.setCookie);
      if (cookie) { keptAgent = legs.agent; return { ok: true, cookie, agent: legs.agent }; }
      return { ok: false, status: legs.open.status, message: 'The server answered without asking for credentials but returned no TM1SessionId cookie.' };
    }
    const outcome = finish(legs.second, legs.first, legs.who, legs.usedAgent);
    if (outcome.ok) { keptAgent = legs.usedAgent; }
    return outcome;
  } catch (error) {
    // Network and TLS errors travel upward unchanged: the caller interprets
    // them with `describeNetworkError`/`isTlsCertError` like for every other
    // login type, including the "accept certificate permanently" button.
    throw error instanceof Error ? error : new Error(errMsg(error));
  } finally {
    // Keep only the one on which the login stands — the rest are closed.
    for (const a of agents) {
      if (a !== keptAgent) { a.destroy(); }
    }
  }
}

/**
 * `WWW-Authenticate` schemes of one UNAUTHENTICATED request (plus the ones PAW
 * lists in its JSON body). No credentials are sent — safe against lockout.
 */
export async function fetchAuthChallenges(cfg: Tm1Config, deps: Pick<IntegratedDeps, 'request'> = {}): Promise<string[]> {
  const paw = pawTarget(cfg.serverUrl);
  const url = paw ? `${paw.gateway}/login` : `${buildBaseUrl(cfg)}/Configuration`;
  const agent = agentFor(new URL(url).protocol === 'https:');
  try {
    const leg = await (deps.request ?? requestLeg)(url, undefined, agent, cfg.rejectUnauthorized);
    return [...leg.challenges, ...bodySchemes(leg.body)];
  } finally {
    agent.destroy();
  }
}

/** Schemes PAW lists in a JSON body instead of `WWW-Authenticate`. */
function bodySchemes(body: string | undefined): string[] {
  try {
    const offered: unknown = JSON.parse(body ?? '')?.error?.authenticate;
    return offered && typeof offered === 'object' ? Object.keys(offered) : [];
  } catch {
    return [];
  }
}

type LoginLegs = HandshakeLegs | { open: Leg; agent: http.Agent | https.Agent };

/** One login at `url`: unauthenticated leg, then the handshake if one is asked for. */
async function loginAt(
  url: string,
  cfg: Tm1Config,
  doRequest: RequestLeg,
  deps: IntegratedDeps,
  newAgent: () => http.Agent | https.Agent,
): Promise<LoginLegs> {
  const agent = newAgent();
  const unauth = await doRequest(url, undefined, agent, cfg.rejectUnauthorized);
  if (unauth.status >= 200 && unauth.status < 300) { return { open: unauth, agent }; }
  const scheme = pickNtlmScheme(unauth.challenges) ?? pickNtlmScheme(bodySchemes(unauth.body));
  if (!scheme) {
    const offered = unauth.challenges.map(c => c.split(/[\s,]/, 1)[0]).filter(Boolean).join(', ');
    return {
      failed: {
        ok: false,
        status: unauth.status,
        message: `The server does not offer integrated login${offered ? ` (it offers: ${offered})` : ''}.`
          + ' IntegratedSecurityMode 2, 3 or 5 is required on the TM1 server.',
      },
    };
  }

  const login = (cfg.username ?? '').trim();
  // Typed credentials: ONLY NTLM, and only ONE attempt. A second one with
  // the same wrong credentials counts again on the server — AD locks accounts.
  const host = new URL(url).hostname;
  // A typed SPN wins: reverse DNS often names a cluster node or a load
  // balancer instead of the name the service account is registered under.
  const spn = cfg.authType === 'integrated' && cfg.spn
    ? cfg.spn
    : `HTTP/${pickSpnHost(host, await (deps.reverseNames ?? reverseNames)(host))}`;
  legLog?.(`Kerberos service name ${spn} (${cfg.authType === 'integrated' && cfg.spn ? 'from the profile' : 'from the host name'})`);
  return login
    ? handshakeWithPassword(url, scheme, login, cfg.password ?? '', agent, cfg.rejectUnauthorized, doRequest, spn)
    : handshakeWithWindows(url, scheme, agent, cfg.rejectUnauthorized, doRequest, deps, newAgent, spn);
}

/** Both PAW logins (see header); the session is the sum of their cookies. */
async function mintThroughPaw(
  cfg: Tm1Config,
  paw: { gateway: string; instance: string },
  doRequest: RequestLeg,
  deps: IntegratedDeps,
  newAgent: () => http.Agent | https.Agent,
): Promise<IntegratedMintOutcome> {
  const jar = new Map<string, string>();
  const cookieHeader = (): string => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const withJar = (extra: LegExtra): RequestLeg => async (url, authorization, agent, rejectUnauthorized) => {
    const leg = await doRequest(url, authorization, agent, rejectUnauthorized, { ...extra, cookie: cookieHeader() || undefined });
    for (const raw of leg.setCookie ?? []) {
      const pair = raw.split(';', 1)[0].trim();
      const eq = pair.indexOf('=');
      if (eq > 0) { jar.set(pair.slice(0, eq), pair.slice(eq + 1)); }
    }
    return leg;
  };

  const steps = [
    { what: 'PAW login', url: `${paw.gateway}/login`, extra: { method: 'POST', form: 'mode=negotiate' } as LegExtra, retryUnauthTimeout: false },
    { what: `PAW login to instance ${paw.instance}`, url: `${paw.gateway}/login/tm1/${paw.instance}`, extra: {} as LegExtra, retryUnauthTimeout: true },
  ];
  let agent: http.Agent | https.Agent | undefined;
  for (const step of steps) {
    let sentAuth = false;
    const leg: RequestLeg = (url, authorization, a, ru) => {
      sentAuth ||= authorization !== undefined;
      return withJar(step.extra)(url, authorization, a, ru);
    };
    let legs: LoginLegs;
    try {
      legs = await loginAt(step.url, cfg, leg, deps, newAgent);
    } catch (error) {
      if (!step.retryUnauthTimeout || sentAuth || errMsg(error) !== LEG_TIMEOUT_MESSAGE) { throw error; }
      legLog?.(`${step.what}: no answer, retrying once on a fresh connection`);
      legs = await loginAt(step.url, cfg, withJar(step.extra), deps, newAgent);
    }
    if ('failed' in legs) {
      const failed = legs.failed;
      return failed.ok ? failed : { ...failed, message: `${step.what}: ${failed.message}` };
    }
    if ('open' in legs) { agent = legs.agent; continue; }
    const refused = legsFailure(legs.second, legs.first, legs.who);
    if (refused) { return { ...refused, message: `${step.what}: ${refused.message}` }; }
    agent = legs.usedAgent;
  }
  if (![...jar.keys()].some(k => /^TM1SessionId/i.test(k))) {
    return { ok: false, status: 0, message: `PAW accepted the login but returned no TM1SessionId cookie for instance ${paw.instance}.` };
  }
  return { ok: true, cookie: cookieHeader(), agent: agent! };
}

interface HandshakeOk {
  first: Leg;
  second: Leg;
  who: string;
  /** The connection the exchange ran on — it carries the session forward. */
  usedAgent: http.Agent | https.Agent;
}
type HandshakeLegs = HandshakeOk | { failed: IntegratedMintOutcome };

/** If the challenge is missing, this path is not a login endpoint. */
function noChallenge(first: Leg): HandshakeLegs {
  return {
    failed: {
      ok: false,
      status: first.status,
      message: `The server did not answer the handshake with a challenge (HTTP ${first.status}).`
        + ' This path is not an integrated-login endpoint.',
    },
  };
}

/**
 * Both legs with the logged-in Windows identity (passwordless, SSPI).
 *
 * First `Negotiate` (SPNEGO, and hence Kerberos, as soon as an `HTTP/<fqdn>`
 * SPN is registered for the host), then `NTLM`. The fallback costs nothing in security and nothing in lockout
 * risk: there is no password involved, and a failed attempt with one's own
 * session does not count as a wrong login in AD.
 *
 * Every attempt needs a FRESH connection (see header) and a fresh helper
 * process (an SSPI context is used up after one exchange).
 */
async function handshakeWithWindows(
  url: string,
  scheme: NtlmScheme,
  agent: http.Agent | https.Agent,
  rejectUnauthorized: boolean,
  doRequest: RequestLeg,
  deps: IntegratedDeps,
  newAgent: () => http.Agent | https.Agent,
  spn: string,
): Promise<HandshakeLegs> {
  if (!(deps.sspiAvailable ?? sspiAvailable)()) {
    return {
      failed: {
        ok: false,
        status: 0,
        message: `Single sign-on with the current Windows session needs Windows (running on ${process.platform}).`
          + ' Enter DOMAIN\\user and a password to use NTLM with explicit credentials instead.',
      },
    };
  }
  // The `Kerberos` package goes FIRST: it produces a real Kerberos token and
  // does not silently degrade to NTLM the way `Negotiate` can. `Negotiate` remains as the middle path for
  // servers that expect SPNEGO, `NTLM` as the fallback. All three are
  // passwordless — no failed attempt counts in the directory.
  const packages: SspiPackage[] = ['Kerberos', 'Negotiate', 'NTLM'];
  let last: HandshakeLegs = noChallenge({
    status: 0, challenges: [], setCookie: undefined, localPort: undefined,
  });
  let current = agent;
  /** Why the respective package was dropped — for the final message and the
   *  connection log a consultant can send in. */
  const rejected: string[] = [];
  const reject = (why: string): void => { rejected.push(why); legLog?.(`Windows package dropped: ${why}`); };

  for (const [index, packageName] of packages.entries()) {
    if (index > 0) { current = newAgent(); }
    // A package that cannot even be set up (no ticket, package not present
    // on this machine) must NOT end the whole flow — otherwise the promised
    // fallback would not happen.
    let handshake: SspiHandshake;
    try {
      handshake = await (deps.startSspi ?? startSspiHandshake)(spn, undefined, packageName);
    } catch (error) {
      reject(`${packageName}: ${errMsg(error)}`);
      continue;
    }
    legLog?.(`Windows package ${packageName} as ${handshake.identity}`);
    try {
      const first = await doRequest(url, authorizationHeader(scheme, handshake.negotiate), current, rejectUnauthorized);
      // Check for SUCCESS FIRST: a Kerberos exchange completes in ONE
      // round — `200` with a cookie, no further challenge. Dismissing this
      // as "no challenge" threw away the completed session.
      if (first.status >= 200 && first.status < 300) {
        last = { first, second: first, who: `${handshake.identity} (${packageName}, ${spn})`, usedAgent: current };
        return last;
      }
      // For SSPI, any token counts, not only an NTLM Type 2: Kerberos
      // answers SPNEGO-wrapped (ASN.1), and the package itself understands it.
      const challenge = extractSchemeToken(first.challenges, scheme);
      if (!challenge) {
        last = noChallenge(first);
        reject(`${packageName}: no challenge`);
        continue;
      }
      let type3: Buffer;
      try {
        type3 = await handshake.authenticate(challenge);
      } catch (error) {
        // The package cannot do anything with THIS challenge (wrong token
        // format, expired ticket) — next package, not abort.
        reject(`${packageName}: ${errMsg(error)}`);
        continue;
      }
      const second = await doRequest(url, authorizationHeader(scheme, type3), current, rejectUnauthorized);
      // The service name belongs in the message: a wrong SPN is the most
      // common Kerberos failure, and otherwise invisible from the outside.
      last = { first, second, who: `${handshake.identity} (${packageName}, ${spn})`, usedAgent: current };
      if (second.status >= 200 && second.status < 300) { return last; }
      reject(`${packageName}: HTTP ${second.status}`);
    } finally {
      handshake.dispose();
    }
  }

  // No package worked, and none got as far as a response: then the combined
  // reason says more than the last individual case.
  if ('failed' in last && !last.failed.ok && rejected.length > 0) {
    return {
      failed: {
        ok: false,
        status: last.failed.status,
        message: `${last.failed.message} Attempts: ${rejected.join('; ')}.`
          + ` If the server needs Kerberos: \`klist\` shows whether this Windows session holds a ticket,`
          + ` \`setspn -Q ${spn}\` whether that service name is registered — if not, enter the registered one`
          + ` (SPN, e.g. HTTP/tm1.example.com) in the profile; every step is in Output › TM1 Connection.`,
      },
    };
  }
  return last;
}

/** Both legs with typed credentials — NTLMv2 computed by hand. */
async function handshakeWithPassword(
  url: string,
  scheme: NtlmScheme,
  login: string,
  password: string,
  agent: http.Agent | https.Agent,
  rejectUnauthorized: boolean,
  doRequest: RequestLeg,
  spn: string,
): Promise<HandshakeLegs> {
  const negotiate = buildType1();
  const first = await doRequest(url, authorizationHeader(scheme, negotiate), agent, rejectUnauthorized);
  const token = extractChallengeToken(first.challenges, scheme);
  if (!token) { return noChallenge(first); }
  const challenge = parseType2(token);
  const { domain, user } = splitDomainUser(login);
  const type3 = buildType3({
    challenge,
    user,
    password,
    // EXACTLY what was typed. Previously the `TargetName` from the
    // challenge was used here instead — that sent `user1` out as
    // `DOMAIN\user1`, and a TM1 whose client is simply named `user1`
    // rejected it (reported 2026-09-17). Whoever needs the domain types
    // it; whoever leaves it out means unqualified.
    domain,
    negotiateMessage: negotiate,
    targetSpn: spn,
    // Over TLS, a Windows client sends 16 zero bytes when there is no real
    // binding in place (see `Type3Input.channelBindings`).
    channelBindings: Buffer.alloc(16),
  });
  const second = await doRequest(url, authorizationHeader(scheme, type3), agent, rejectUnauthorized);
  return { first, second, who: domain ? `${domain}\\${user}` : user, usedAgent: agent };
}

/** Why a completed exchange did not log in, or `undefined` if it did. */
function legsFailure(second: Leg, first: Leg, who: string): Extract<IntegratedMintOutcome, { ok: false }> | undefined {
  if (second.localPort !== undefined && first.localPort !== undefined
    && second.localPort !== first.localPort) {
    // Without this note, one would look for the bug in the computation, even
    // though the connection changed — NTLM is bound to the socket.
    return {
      ok: false,
      status: second.status,
      message: 'The integrated login lost its connection between the two steps'
        + ' (NTLM is bound to one socket), so the server could not complete it.',
    };
  }
  if (second.status >= 200 && second.status < 300) { return undefined; }
  return {
    ok: false,
    status: second.status,
    message: `Integrated login as ${who} was refused by the server (HTTP ${second.status}).`
      + ' The Windows handshake completed, so check that this account is registered as a'
      + ' TM1 client and look at event 4625 in the Security log on the TM1 host.'
      + ' Every step is in Output › TM1 Connection.',
  };
}

/** Shared conclusion: take the cookie, otherwise interpret what failed. */
function finish(second: Leg, first: Leg, who: string, agent: http.Agent | https.Agent): IntegratedMintOutcome {
  const refused = legsFailure(second, first, who);
  if (refused) { return refused; }
  const cookie = parseTm1SessionCookie(second.setCookie);
  if (cookie) { return { ok: true, cookie, agent }; }
  return { ok: false, status: second.status, message: 'Integrated login was accepted but the server returned no TM1SessionId cookie.' };
}

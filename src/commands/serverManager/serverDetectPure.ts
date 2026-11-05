// Reads the server type off anonymous answers — pure (depcruise
// `pure-no-vscode`). The add-server form asks before any password is sent, so
// detection can never lock an account.
//
// Measured 2026-10-30, all without credentials:
// - v11 (11.8, :8016 / :12357): `/api/v1/Servers` 401, `WWW-Authenticate:
//   Basic realm="TM1"`; `/tm1/Servers` 404.
// - v12 gateway (:4444): every path 401 with JSON `{"error":{"code":"278"}}`
//   and NO `WWW-Authenticate`.
// - Admin server (:5895 / :5898): `/api/v1/Servers` 200, `$metadata#Servers`.
// - PAW: `/tm1/Servers` anonymous 200 with `Name` + `AcceptingClients`
//   (PAW Local 2.1.23, measured 2026-09-17 and 2026-10-30). Careful: that body
//   carries `$metadata#Servers` like an admin server's, and PAW answers
//   `/api/v1/Servers` with 401 + `Bearer` + `Basic realm="TM1"` like a v11
//   server (2026-10-30) — so PAW must be asked first.
// NOT measured: the CAM (mode 4/5) and Negotiate challenges — taken from
// `offeredLogins`, which reads them by scheme name.
import { offeredLogins } from '../../tm1Rest/transport/authChallengePure';
import { isPawAuthRequired } from '../../utils/pawTarget';

type DetectedAuth = 'Basic' | 'CAM' | 'integrated';

export interface ListedDatabase { name: string; acceptingClients: boolean }

export interface Answer { status: number; challenges: string[]; body: string }

/** What a pasted address says by itself, before any request. */
export interface ParsedAddress {
  /** Scheme + host + port — what the probes and the stored profile use. */
  origin: string;
  /** v12 REST URL `…/<instance>/api/v1/Databases('<db>')`. */
  v12?: { instance: string; database?: string };
  /** PA SaaS URL `…/api/<tenant>/v0/tm1/<db>`. */
  saas?: { tenant: string; database?: string };
  /** PAW instance URL `…/api/v1/tm1/<db>` (or `/tm1/<db>`): the one database meant. */
  pawDatabase?: string;
}

export function parseServerAddress(url: string): ParsedAddress {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname);
  const saas = /^\/api\/([^/]+)\/v0\/tm1(?:\/([^/]+))?/.exec(path);
  if (saas) { return { origin: u.origin, saas: { tenant: saas[1], ...(saas[2] ? { database: saas[2] } : {}) } }; }
  const v12 = /^\/([^/]+)\/api\/v1(?:\/Databases\('((?:[^']|'')+)'\))?/.exec(path);
  const paw = /^(?:\/api\/v1)?\/tm1\/([^/]+)/.exec(path);
  if (paw && paw[1] !== 'api' && paw[1] !== 'Servers') { return { origin: u.origin, pawDatabase: paw[1] }; }
  if (v12 && v12[1] !== 'api') {
    return { origin: u.origin, v12: { instance: v12[1], ...(v12[2] ? { database: v12[2].replace(/''/g, "'") } : {}) } };
  }
  return { origin: u.origin };
}

/** `value` rows of an admin-server or PAW list; `undefined` if the body is no such list. */
export function parseDatabaseList(body: string): ListedDatabase[] | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  const rows = (parsed as { value?: unknown })?.value;
  if (!Array.isArray(rows)) { return undefined; }
  return rows
    .filter((r): r is { Name: string; AcceptingClients?: boolean } => typeof r?.Name === 'string' && r.Name !== '')
    .map(r => ({ name: r.Name, acceptingClients: r.AcceptingClients !== false }));
}

/** PAW probe (`/tm1/Servers`): a list there means a PAW gateway. */
export function pawFrom(a: Answer): ListedDatabase[] | undefined {
  return a.status === 200 ? parseDatabaseList(a.body) : undefined;
}

/**
 * PAW path (`/tm1/Servers`) that wants a login first. Measured on a company
 * PAW 2026-10-31: 200 with `AUTH_REQUIRED` in the body (`isPawAuthRequired`).
 * A redirect or a 401 WITH a challenge are covered too, unmeasured. Neither v11
 * (404) nor v12 (401 without a challenge, code 278) answers that way —
 * measured 2026-10-30. Without this, such a PAW fell through, and the form
 * landed on the instance tile with the PAW path cut off.
 */
export function pawBehindLogin(a: Answer | undefined): boolean {
  if (!a) { return false; }
  return (a.status >= 300 && a.status < 400) || (a.status === 401 && a.challenges.length > 0)
    || (a.status === 200 && isPawAuthRequired(a.body));
}

/**
 * `/api/v1/Servers` with a `Bearer` challenge: PAW, not TM1. v11 offers only
 * `Basic realm="TM1"` there (11.8, measured 2026-10-30); PAW Local adds `Bearer`
 * (2026-10-30), and a company PAW sends `Bearer realm="Service"`, `Negotiate`,
 * `Basic realm="TM1"` while its `/tm1/Servers` times out for Node — measured
 * 2026-10-31 with the detection's own request. The Basic challenge alone read
 * that PAW as v11.
 */
export function pawChallenge(a: Answer): boolean {
  return a.status === 401 && a.challenges.some(c => /^\s*Bearer\b/i.test(c));
}

export type Classified =
  | { kind: 'admin'; databases: ListedDatabase[] }
  | { kind: 'v11'; auth: DetectedAuth }
  | { kind: 'v12' }
  | undefined;

/** Answer of `/api/v1/Servers`. */
export function classifyServersAnswer(a: Answer): Classified {
  if (a.status === 200 && /\$metadata#Servers/.test(a.body)) {
    const databases = parseDatabaseList(a.body);
    if (databases) { return { kind: 'admin', databases }; }
  }
  const offered = offeredLogins(a.challenges);
  if (offered.length > 0) {
    // Basic wins when offered: it is the one the form can test right away.
    const auth: DetectedAuth = offered.includes('Basic') ? 'Basic' : offered.includes('CAM') ? 'CAM' : 'integrated';
    return { kind: 'v11', auth };
  }
  if (a.status === 401 && a.challenges.length === 0 && /"code"\s*:\s*"278"/.test(a.body)) { return { kind: 'v12' }; }
  return undefined;
}

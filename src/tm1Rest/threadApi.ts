import * as http from 'http';
import * as https from 'https';
import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { parseBodySafe, parseODataValueBody, parseODataValueBodyBigIntIds } from './parseRest';
import { encodeODataKey } from '../utils/odataKey';
import { resolveAgent } from './transport/agent';
import { isOk } from './httpError';
import { INTERACTIVE_CAP_MS } from './timeouts';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';

/**
 * Dedicated single-socket keep-alive agent per server for the threads poller.
 * TM1 (11.x) binds a request's worker thread to its TCP socket, so pinning the
 * poll to its OWN keep-alive socket (isolated from the shared session pool)
 * makes TM1 keep handing it the SAME worker thread — the thread ID shown for
 * the monitor's own poll row then stays constant across polls instead of
 * churning (which happens when the poll grabs a fresh/rotating socket from the
 * shared pool). This is what a dedicated monitoring connection (e.g. Arc) does.
 * Reuses the session cookie — only the transport socket is dedicated (see
 * apiRequest's `agent` param). Verified live against TM1 11.8: constant real id.
 */
const _pollAgents = new Map<string, http.Agent | https.Agent>();

function threadPollAgent(cfg: Tm1Config): http.Agent | https.Agent {
  const key = cfg?.serverUrl ?? '';
  let agent = _pollAgents.get(key);
  if (!agent) {
    agent = resolveAgent(cfg, (cfg?.serverUrl ?? '').startsWith('https:'), { maxSockets: 1 });
    _pollAgents.set(key, agent);
  }
  return agent;
}

function dropPollAgent(serverUrl: string): void {
  const agent = _pollAgents.get(serverUrl);
  if (agent) { agent.destroy(); _pollAgents.delete(serverUrl); }
}

/** Destroy + drop the dedicated poll agent for a server (call on panel close). */
export function disposeThreadPollAgent(cfg: Tm1Config): void {
  dropPollAgent(cfg?.serverUrl ?? '');
}

// The tree, the debugger and run-cancel create the agent too; without this a
// disconnect left its socket in the map and a reconnect reused a dead one.
registerServerDisposer('threadPollAgent', dropPollAgent);

/** Single TM1 thread entry (subset of fields commonly read). */
export interface Tm1Thread {
  ID: number;
  Name: string;
  Type?: string;
  State?: string;
  Function?: string;
  ObjectType?: string;
  ObjectName?: string;
  RLocks?: number;
  IXLocks?: number;
  WLocks?: number;
  ElapsedTime?: string;
  WaitTime?: string;
  Info?: string;
  Context?: string;
  /**
   * Owning login-session ID (like Arc's "Session" column). Unlike the thread
   * ID — which is the per-request worker thread TM1's pool hands out and so
   * rotates every poll — the session ID is bound to the client login and stays
   * constant, making it the stable identifier for "watch my connection". For
   * v11 it comes straight from the Thread's `Session` navigation property
   * (`GET /Threads?$expand=Session`); for v12 it is the source `Sessions(ID)`.
   * Undefined for system threads that have no owning session. Usually a number
   * (v11), but a string for v12 whose session ids are Int64 and exceed JS's
   * safe-integer range — kept lossless as a string so the displayed id is exact.
   */
  Session?: number | string;
  /**
   * v12 only: the owning Job's id (a GUID string). v12 has no numeric worker
   * thread — running work is a `Job` — so job rows carry no numeric `ID`; this
   * is what cancel targets (`POST /Jobs('<id>')/tm1.Cancel`). Undefined for v11.
   */
  JobId?: string;
}

/** Thread entry extended with optional wait-chain fields from $expand=WaitingOn. */
export interface Tm1ThreadWithWait extends Tm1Thread {
  WaitingOn?: { ID: number };
  BlockedBy?: number;
  /** v12 only: GUIDs of the Jobs this Job is waiting on (Job.WaitingOn). */
  WaitingOnJobs?: string[];
}

/** Best-supported `/Threads` $expand variant per server (widening → narrowing). */
type ThreadExpand =
  | 'session-user-wait' | 'session-user'
  | 'session-wait' | 'session' | 'none';
const _expandSupportedCache = new Map<string, ThreadExpand>();

/** Reset expand-variant caches (for tests). */
export function _clearExpandSupportCache(): void {
  _expandSupportedCache.clear();
  _sessionsExpandCache.clear();
}

/**
 * CAM logins surface as `CAMID("ns:u:uid")` in Thread.Name / Session.Context.
 * Where the server gives us no `User.FriendlyName` to substitute, show the
 * trailing component of the CAMID (the actual login id) instead of the raw
 * wrapper. Non-CAM strings pass through untouched.
 */
export function camIdToDisplay(v: string | undefined): string | undefined {
  if (!v) { return v; }
  return v.replace(/CAMID\("([^"]*)"\)/g, (_m, inner: string) => {
    const parts = inner.split(':');
    return parts[parts.length - 1] || inner;
  });
}

/**
 * Session.Context as shown in the monitor. Older builds of this extension sent
 * a `{"CAMNamespace":…,"Client":"vscode-tm1-ti/x.y.z"}` JSON blob as the
 * session context on CAM logins; sessions opened by those builds (and by other
 * clients doing the same) still carry it. Unwrap to the client id so the column
 * reads uniformly, then strip any CAMID wrapper.
 */
export function contextToDisplay(v: string | undefined): string | undefined {
  if (!v) { return v; }
  const trimmed = v.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"Client"')) {
    try {
      const client = (JSON.parse(trimmed) as { Client?: unknown }).Client;
      if (typeof client === 'string' && client) { return camIdToDisplay(client); }
    } catch { /* not our blob — fall through and show it as-is */ }
  }
  return camIdToDisplay(v);
}

const _EXPAND_VARIANTS: ReadonlyArray<readonly [ThreadExpand, string]> = [
  // Widest first: join the owning session's User so CAM servers can show the
  // FriendlyName instead of the raw CAMID(...) that Thread.Name carries.
  ['session-user-wait', 'Threads?$expand=Session($expand=User($select=Name,FriendlyName)),WaitingOn'],
  ['session-user', 'Threads?$expand=Session($expand=User($select=Name,FriendlyName))'],
  ['session-wait', 'Threads?$expand=Session,WaitingOn'],
  ['session', 'Threads?$expand=Session'],
  ['none', 'Threads'],
];

/**
 * List v11 threads with each thread's owning login-session joined in.
 *
 * TM1's `Thread` entity has a `Session` navigation property (confirmed in
 * $metadata and live on 11.8), so `GET /Threads?$expand=Session` returns every
 * thread's REAL owning session id directly — for all threads, incl. other
 * users' and transient poll threads; system threads report `Session: null`.
 * This is the authoritative Thread→Session mapping: no `/Sessions` containment
 * join, no self-poll heuristics.
 *
 * We also try to expand `WaitingOn` (deadlock wait-chain) in the same request,
 * but TM1 11.8 dropped that property (`error 278: "WaitingOn" is not a property
 * of "Thread"`) → the tiered fallback narrows to `Session` only, then to a
 * plain fetch, caching the widest variant that works per server.
 */
export async function listThreadsWithWaitChain(cfg: Tm1Config, timeoutMs?: number): Promise<Tm1ThreadWithWait[]> {
  if (cfg?.version === 'v12') { return listThreadsV12(cfg, timeoutMs); }
  const key = cfg?.serverUrl ?? '';
  const cached = _expandSupportedCache.get(key);
  const startIdx = cached ? _EXPAND_VARIANTS.findIndex(v => v[0] === cached) : 0;
  let threads: Tm1ThreadWithWait[] | undefined;
  for (let i = Math.max(0, startIdx); i < _EXPAND_VARIANTS.length; i++) {
    const [name, url] = _EXPAND_VARIANTS[i];
    try {
      const res = await apiRequest('GET', url, undefined, timeoutMs, cfg, undefined, threadPollAgent(cfg));
      if (isOk(res)) {
        _expandSupportedCache.set(key, name);
        threads = parseODataValueBody<Tm1ThreadWithWait>(res).map(flattenSession);
        break;
      }
    } catch { /* try the next, narrower variant */ }
  }
  if (!threads) {
    // Every variant returned non-2xx — repeat the plain fetch so assertOk throws.
    const res = await apiRequest('GET', 'Threads', undefined, timeoutMs, cfg, undefined, threadPollAgent(cfg));
    assertOk(res);
    threads = parseODataValueBody<Tm1ThreadWithWait>(res).map(flattenSession);
  }
  return mergeIdleSessions(cfg, threads, timeoutMs);
}

/**
 * `$expand=Session` returns Session as a nested entity `{ID,…}`; flatten it to
 * the numeric session id our `Tm1Thread.Session` field expects. `null` (system
 * threads with no owning session) and the plain no-expand fetch → `undefined`.
 */
export function flattenSession(t: Tm1ThreadWithWait): Tm1ThreadWithWait {
  const s = (t as unknown as { Session?: unknown }).Session;
  let friendly: string | undefined;
  if (s && typeof s === 'object') {
    const u = (s as { User?: { Name?: string; FriendlyName?: string } }).User;
    friendly = u?.FriendlyName || undefined;
  }
  t.Session = (s && typeof s === 'object' && typeof (s as { ID?: unknown }).ID === 'number')
    ? (s as { ID: number }).ID
    : undefined;
  // CAM servers stamp Thread.Name/Context with the raw CAMID("ns:u:uid") —
  // prefer the joined session user's FriendlyName, else strip the wrapper.
  if (friendly) { t.Name = friendly; }
  else if (t.Name) { t.Name = camIdToDisplay(t.Name) as string; }
  if (t.Context) { t.Context = contextToDisplay(t.Context); }
  return t;
}

interface SessionEntry { ID: number; Context?: string; Active?: boolean; User?: { Name?: string; FriendlyName?: string; Type?: string } }

/** `/Sessions` $expand variants, widest first (FriendlyName for CAM display). */
const _SESSIONS_VARIANTS: ReadonlyArray<string> = [
  'Sessions?$expand=User($select=Name,FriendlyName)',
  'Sessions?$expand=User',
];
const _sessionsExpandCache = new Map<string, number>();

/**
 * `/Threads` only lists ACTIVE worker threads, so a logged-in but idle client
 * (e.g. a second VS Code window just sitting there) has no thread and would be
 * invisible in the monitor — the user can't see their own other sessions. To
 * match Arc's session-aware view we append every connected `/Sessions` login
 * that has no active thread as an Idle row (blank thread ID, its Session id,
 * user + context). Sessions that ARE running something are already represented
 * by their active thread row (matched by the thread's own `Session` id), so
 * they're skipped here to avoid duplicates. Best-effort: on any failure the
 * active threads are returned as-is.
 */
async function mergeIdleSessions(
  cfg: Tm1Config, threads: Tm1ThreadWithWait[], timeoutMs?: number,
): Promise<Tm1ThreadWithWait[]> {
  try {
    const key = `${cfg?.serverUrl ?? ''}|sessions`;
    const startIdx = _sessionsExpandCache.get(key) ?? 0;
    let sessions: SessionEntry[] | undefined;
    for (let i = startIdx; i < _SESSIONS_VARIANTS.length; i++) {
      const res = await apiRequest('GET', _SESSIONS_VARIANTS[i], undefined, timeoutMs, cfg, undefined, threadPollAgent(cfg));
      if (isOk(res)) {
        _sessionsExpandCache.set(key, i);
        sessions = parseODataValueBody<SessionEntry>(res);
        break;
      }
    }
    if (!sessions) { return threads; }
    const activeSessionIds = new Set<number>();
    for (const t of threads) { if (typeof t.Session === 'number') { activeSessionIds.add(t.Session); } }
    for (const s of sessions) {
      // Skip ended/stale logins: TM1 keeps recently-disconnected sessions in
      // `/Sessions` with Active=false. Only alive sessions (idle or running,
      // Active=true) should surface. Tolerate servers that omit the field
      // (undefined → keep, so nothing is lost on older/edge TM1 versions).
      if (s.Active === false) { continue; }
      // Timed-out logins: TM1 (seen on CAM) keeps the Session entry but drops
      // its User, so the row degenerated to a nameless "(session)". A session
      // nobody owns is not a connection anyone can act on — skip it. Live
      // sessions always carry a User here (both /Sessions variants expand it).
      if (!s.User?.Name) { continue; }
      if (activeSessionIds.has(s.ID)) { continue; }
      threads.push({
        ID: undefined as unknown as number,   // idle session: no worker thread
        Name: s.User.FriendlyName || camIdToDisplay(s.User.Name) as string,
        // Thread CATEGORY (User/System) like v11's Thread.Type — NOT the login's
        // security level (Session.User.Type is Admin/User security, verified live
        // on 11.8, so it must not feed this column — that was the wrong 'Admin').
        // Every row that survives the filter above is a named login.
        Type: 'User',
        // Always 'Idle' so the monitor's existing "active only" toggle
        // (hides State === 'Idle') cleanly filters these session rows out.
        State: 'Idle',
        Context: contextToDisplay(s.Context),
        Session: s.ID,
      });
    }
    return threads;
  } catch {
    return threads;
  }
}

/**
 * v12 monitoring model (verified live against 12.2): the top-level `/Threads`
 * collection stays EMPTY even while a process runs — running work is a `Job`
 * (`/Jobs`, one per in-flight operation) with a `Session` nav and a `WaitingOn`
 * wait-chain; idle connections are `/Sessions`. So v12 sources active rows from
 * `/Jobs?$expand=Session` and appends the idle logins via `mergeIdleSessions`,
 * mirroring the v11 view.
 */
interface V12Job {
  ID: string;
  Description?: string;
  State?: 'Waiting' | 'Running' | 'Canceling' | string;
  ElapsedTime?: string;
  WaitTime?: string;
  Session?: { ID?: number | string; Context?: string; Active?: boolean; User?: { Name?: string; FriendlyName?: string; Type?: string } };
  WaitingOn?: Array<{ ID: string }>;
}

/** Map a v12 Job (a running/queued operation) to a monitor row. Pure. */
export function _mapJobToRow(j: V12Job): Tm1ThreadWithWait {
  // Normalise JobState (Waiting|Running|Canceling) to the v11 State vocabulary
  // so styling ('Run'→s-run) and the "active only" / "kill waiting" filters work
  // uniformly across versions.
  const state = j.State === 'Running' ? 'Run' : j.State === 'Waiting' ? 'Wait' : (j.State ?? '');
  const s = j.Session;
  return {
    ID: undefined as unknown as number,   // v12 has no numeric worker-thread id → JobId is shown instead
    JobId: j.ID,
    Name: s?.User?.FriendlyName || camIdToDisplay(s?.User?.Name) || contextToDisplay(s?.Context) || '(job)',   // the actual TM1 user
    // Type is the thread CATEGORY (User/System), matching v11's Thread.Type —
    // NOT the user's security level. A job is always user activity.
    Type: 'User',
    State: state,
    Function: j.Description,
    Context: contextToDisplay(s?.Context),
    ElapsedTime: j.ElapsedTime,
    WaitTime: j.WaitTime,
    // Pass the session id through as-is: a number (v11-style) or the lossless
    // string produced for v12 Int64 ids (see parseODataValueBodyBigIntIds).
    Session: s?.ID != null ? s.ID : undefined,
    WaitingOnJobs: Array.isArray(j.WaitingOn) ? j.WaitingOn.map(w => w.ID).filter(Boolean) : undefined,
  };
}

const _V12_JOB_VARIANTS: ReadonlyArray<readonly [ThreadExpand, string]> = [
  ['session-user-wait', 'Jobs?$expand=Session($expand=User($select=Name,FriendlyName)),WaitingOn'],
  ['session-user', 'Jobs?$expand=Session($expand=User($select=Name,FriendlyName))'],
  ['session-wait', 'Jobs?$expand=Session($expand=User),WaitingOn'],
  ['session', 'Jobs?$expand=Session($expand=User)'],
  ['none', 'Jobs'],
];

async function listThreadsV12(cfg: Tm1Config, timeoutMs?: number): Promise<Tm1ThreadWithWait[]> {
  const key = `${cfg?.serverUrl ?? ''}|v12jobs`;
  const cached = _expandSupportedCache.get(key);
  const startIdx = cached ? _V12_JOB_VARIANTS.findIndex(v => v[0] === cached) : 0;
  let jobs: V12Job[] | undefined;
  for (let i = Math.max(0, startIdx); i < _V12_JOB_VARIANTS.length; i++) {
    const [name, url] = _V12_JOB_VARIANTS[i];
    try {
      const res = await apiRequest('GET', url, undefined, timeoutMs, cfg, undefined, threadPollAgent(cfg));
      if (isOk(res)) {
        _expandSupportedCache.set(key, name);
        jobs = parseODataValueBodyBigIntIds<V12Job>(res);
        break;
      }
    } catch { /* try the next, narrower variant */ }
  }
  if (!jobs) {
    const res = await apiRequest('GET', 'Jobs', undefined, timeoutMs, cfg, undefined, threadPollAgent(cfg));
    assertOk(res);
    jobs = parseODataValueBody<V12Job>(res);
  }
  // v12 shows ONLY the active jobs (the PAW "Activity" model) — no idle-session
  // merge (sessions aren't exposed in PAW v12 and the user asked to drop them).
  return jobs.map(_mapJobToRow);
}

/**
 * GET /Threads — returns the current thread list.
 * Throws on non-2xx. For v12, sources from `/Jobs` + `/Sessions` (see listThreadsV12).
 */
export async function listThreads(cfg: Tm1Config, timeoutMs?: number): Promise<Tm1Thread[]> {
  if (cfg?.version === 'v12') { return listThreadsV12(cfg, timeoutMs); }
  const res = await apiRequest('GET', 'Threads', undefined, timeoutMs, cfg);
  assertOk(res);
  return parseODataValueBody<Tm1Thread>(res);
}

/**
 * POST /Threads(<id>)/tm1.CancelOperation — best-effort thread cancel.
 * Throws on non-2xx.
 */
export async function cancelThread(cfg: Tm1Config, id: number, timeoutMs = 5000): Promise<void> {
  const res = await apiRequest('POST', `Threads(${id})/tm1.CancelOperation`, '{}', timeoutMs, cfg);
  assertOk(res);
}

/**
 * POST /Jobs('<id>')/tm1.Cancel — best-effort v12 job cancel (the v12 analogue
 * of cancelThread; running work in v12 is a Job, not a Thread). Throws on non-2xx.
 */
export async function cancelJob(cfg: Tm1Config, jobId: string, timeoutMs = 5000): Promise<void> {
  const res = await apiRequest('POST', `Jobs('${encodeODataKey(jobId)}')/tm1.Cancel`, '{}', timeoutMs, cfg);
  assertOk(res);
}

/**
 * Looks up the thread ID of a running process/chore execution.
 *
 * An object executed via REST has an EMPTY ObjectName — the name lives in the
 * Function field as the request URL, e.g.
 *   "POST /api/v1/Processes('MyProc')/tm1.ExecuteWithReturn"
 *   "POST /api/v1/Chores('MyChore')/tm1.Execute"
 * So match Function on `<kind>('<name>')/tm1.Execute` (covers tm1.Execute and
 * tm1.ExecuteWithReturn). For processes, fall back to ObjectName for non-REST
 * contexts. Any non-Idle state counts (a process parked in Sleep() is not 'Run').
 * Returns undefined if not running or on any error.
 *
 * `includeTransient` adds a last-resort match on the unbound
 * `ExecuteProcessWithReturn` action, whose Function carries NO object name
 * (`POST /api/v1/ExecuteProcessWithReturn`). Only set it for callers that ran
 * their TI inline — the match cannot tell two concurrent inline runs apart.
 *
 * BOTH needles are scoped to our own login session where the server allows it
 * (see `pickOwnRow`): this lookup exists to cancel a run WE started, and the
 * named needle matches another user's run of the same object just as well.
 */
export async function findExecutionThreadId(
  objectKind: 'Processes' | 'Chores', name: string, config: Tm1Config,
  opts?: { includeTransient?: boolean },
): Promise<number | undefined> {
  try {
    // Always join the owning session — it is the only thing that tells our run
    // apart from a foreign one. A plain `GET /Threads` has NO Session (it is a
    // navigation property), so servers that reject the $expand degrade to the
    // unscoped match (named needle) resp. lose the transient fallback entirely.
    const wantTransient = opts?.includeTransient === true;
    let res = await apiRequest('GET', 'Threads?$expand=Session', undefined, INTERACTIVE_CAP_MS, config);
    if (res.statusCode !== 200) {
      res = await apiRequest('GET', 'Threads', undefined, INTERACTIVE_CAP_MS, config);
    }
    if (res.statusCode !== 200) { return undefined; }
    const threads = parseODataValueBody<ThreadRow>(res);
    const active = threads.filter(th => th.State !== 'Idle');
    const needle = `${objectKind}('${name}')/tm1.Execute`;
    let named = active.filter(th => (th.Function ?? '').includes(needle));
    // For processes, fall back to ObjectName for non-REST contexts.
    if (named.length === 0 && objectKind === 'Processes') {
      named = active.filter(th => th.ObjectName === name);
    }
    const t = await pickOwnRow(config, named);
    if (t) { return t.ID; }
    if (!wantTransient) { return undefined; }
    // Last resort: an inline `POST /ExecuteProcessWithReturn`. That Function
    // matches EVERY client's inline helper (Arc, a second VS Code window, …),
    // so only our OWN session's thread may be claimed — cancelling a foreign
    // one would kill somebody else's run. No session signal → no cancel.
    const mine = await fetchOwnSessionId(config);
    if (mine === undefined) { return undefined; }
    const own = active.find(th =>
      (th.Function ?? '').includes('ExecuteProcessWithReturn') && sameSession(sessionIdOf(th), mine));
    return own?.ID;
  } catch {
    return undefined;
  }
}

/**
 * v12 analogue of {@link findExecutionThreadId}: looks up the Job of a running
 * process/chore execution. v12 has no `/Threads` (it answers with an empty
 * collection) — running work lives in `/Jobs`, keyed by a GUID string, and is
 * killed with `tm1.Cancel` instead of `tm1.CancelOperation`.
 *
 * The Job's `Description` is the request line WITHOUT the `/api/v1` prefix,
 * e.g. `POST /Processes('MyProc')/tm1.ExecuteWithReturn` — live-verified — so
 * the same `<kind>('<name>')/tm1.Execute` needle matches.
 *
 * `includeTransient` additionally matches a RUNNING inline execution
 * (`POST /ExecuteProcessWithReturn`, no object name). Restricted to Running so
 * a stale queued job can never be mistaken for it.
 *
 * Both needles are session-scoped exactly like in {@link findExecutionThreadId}.
 */
export async function findExecutionJobId(
  objectKind: 'Processes' | 'Chores', name: string, config: Tm1Config,
  opts?: { includeTransient?: boolean },
): Promise<string | undefined> {
  try {
    // Same reasoning as in findExecutionThreadId: a match is only provably OURS
    // when it can be scoped to our own session, which needs the Session nav.
    const wantTransient = opts?.includeTransient === true;
    let res = await apiRequest('GET', 'Jobs?$expand=Session', undefined, INTERACTIVE_CAP_MS, config);
    if (res.statusCode !== 200) {
      res = await apiRequest('GET', 'Jobs', undefined, INTERACTIVE_CAP_MS, config);
    }
    if (res.statusCode !== 200) { return undefined; }
    const jobs = parseODataValueBody<V12Job>(res);
    const needle = `${objectKind}('${name}')/tm1.Execute`;
    const j = await pickOwnRow(config, jobs.filter(job => (job.Description ?? '').includes(needle)));
    if (j) { return j.ID; }
    if (!wantTransient) { return undefined; }
    // Restricted to Running (a stale queued job must never be mistaken for it)
    // AND to our own session — the inline description names no object, so it
    // matches every client's helper run.
    const mine = await fetchOwnSessionId(config);
    if (mine === undefined) { return undefined; }
    const own = jobs.find(job =>
      job.State === 'Running'
      && (job.Description ?? '').includes('ExecuteProcessWithReturn')
      && sameSession(sessionIdOf(job), mine));
    return own?.ID;
  } catch {
    return undefined;
  }
}

/**
 * Own login-session id (`GET /ActiveSession`; on v12 `buildBaseUrl` puts the
 * Databases prefix in front). Every call of a `Tm1Config` rides the SAME cached
 * TM1 session (see transport/session.ts), so this is exactly the session that
 * owns an inline execution we may have to cancel.
 *
 * Returns undefined on any failure — the caller MUST then refuse to guess.
 */
async function fetchOwnSessionId(cfg: Tm1Config): Promise<number | string | undefined> {
  try {
    const res = await apiRequest('GET', 'ActiveSession', undefined, INTERACTIVE_CAP_MS, cfg);
    if (res.statusCode !== 200) { return undefined; }
    const json = parseBodySafe<{ ID?: number | string }>(res, {});
    return json.ID != null ? json.ID : undefined;
  } catch {
    return undefined;
  }
}

/** `$expand=Session` nests the session entity; a plain fetch carries no Session at all. */
type WithSessionNav = { Session?: number | string | { ID?: number | string } | null };

/**
 * A `/Threads` row as it comes off the wire HERE. `Tm1Thread.Session` is the
 * already-flattened display id (`number | string`); intersecting that with the
 * nav shape would narrow the nested `{ ID }` case — the LIVE runtime path of
 * `$expand=Session` — down to `never`. So drop it before intersecting, otherwise
 * the type lies about the wire and `sessionIdOf`'s object branch looks dead.
 */
type ThreadRow = Omit<Tm1Thread, 'Session'> & WithSessionNav;

function sessionIdOf(row: WithSessionNav): number | string | undefined {
  const s = row.Session;
  if (s == null) { return undefined; }
  if (typeof s === 'object') { return s.ID != null ? s.ID : undefined; }
  return s;
}

/**
 * Narrow the rows a needle matched to the one owned by OUR login session. A
 * needle identifies the OBJECT only (or nothing at all, for the inline action),
 * so a concurrent run of the same process/chore by another user matches just as
 * well — while this lookup exists solely to cancel a run WE started, which
 * always sits on our own session.
 *
 * Deliberate fallback: when NO row carries a session id (server rejected
 * `$expand=Session`) or the `/ActiveSession` probe fails, the first match is
 * returned UNSCOPED — today's behaviour. Refusing would be safer still, but it
 * would disable cancel outright on servers without the Session nav, and a named
 * needle is at least object-specific. The nameless transient needle does NOT
 * use this compromise: it stays refuse-without-session (see its call sites).
 */
async function pickOwnRow<T extends WithSessionNav>(cfg: Tm1Config, rows: T[]): Promise<T | undefined> {
  if (rows.length === 0) { return undefined; }
  if (!rows.some(r => sessionIdOf(r) !== undefined)) { return rows[0]; }
  const mine = await fetchOwnSessionId(cfg);
  if (mine === undefined) { return rows[0]; }
  return rows.find(r => sameSession(sessionIdOf(r), mine));
}

/**
 * Compare two session ids across BOTH wire representations. `/Jobs` is read
 * elsewhere through `parseODataValueBodyBigIntIds`, which keeps a 16+ digit
 * Int64 id as an EXACT string, while `/ActiveSession` goes through plain
 * `JSON.parse`, which rounds it to a double — the text forms then differ although
 * it is the same session. So compare the text first (exact on v11 and on any pair
 * read the same way), then the numeric value, which is identical for both
 * representations (`Number('<digits>')` rounds exactly like `JSON.parse` does).
 * Robust by construction instead of by comment: aligning either side on the other
 * parser must never silently kill the transient cancel.
 */
function sameSession(a: number | string | undefined, b: number | string | undefined): boolean {
  if (a == null || b == null) { return false; }
  if (String(a) === String(b)) { return true; }
  const na = digitsToNumber(a);
  return na !== undefined && na === digitsToNumber(b);
}

/** Numeric value of a pure-digit id — the same double `JSON.parse` would produce. */
function digitsToNumber(v: number | string): number | undefined {
  if (typeof v === 'number') { return Number.isFinite(v) ? v : undefined; }
  return /^\d+$/.test(v) ? Number(v) : undefined;
}

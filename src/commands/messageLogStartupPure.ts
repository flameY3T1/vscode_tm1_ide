/**
 * Pure parser + aggregator for the server-startup view of the message log —
 * no vscode deps.
 *
 * Every pattern here is verbatim from a real server: the English forms from a
 * 29560-line production `tm1server.log`, the German ones read off the live 11.8
 * test server.
 *
 * A server configured to German does NOT log German throughout — IBM translated
 * the messages only in part, so `TM1 Server is ready`, the feeder lines and
 * `Using Persistent Feeders` stay English while the cube and dimension lines are
 * German. An English server is uniform. The two spellings are therefore
 * alternatives of ONE marker, checked per line; there is no server-wide language
 * mode to detect and switch on, and picking one language would silently blind
 * the view to half of a German server's startup.
 */

/** One `MessageLogEntries` row, as far as this module needs it. */
export interface StartupRawEntry {
  TimeStamp?: string;
  Timestamp?: string;
  Message?: string;
  Text?: string;
  /** Worker thread. The whole lane view rests on it — see `analyzeStartup`. */
  ThreadID?: number;
}

export type StartupEvent =
  | { type: 'begin' }
  | { type: 'ready'; elapsedSec: number }
  | { type: 'loadTime'; sec: number }
  | { type: 'mtq'; threads: number }
  | { type: 'cubeLoadThreads'; threads: number }
  | { type: 'bodyStart'; name: string }
  | { type: 'bodyEnd'; name: string }
  | { type: 'headEnd'; name: string }
  | { type: 'dimension'; name: string }
  | { type: 'rules'; name: string }
  | { type: 'feederDone'; name: string; ms: number }
  | { type: 'feederFromFile'; name: string }
  | { type: 'persistentFeeders' };

// ── Boundaries ───────────────────────────────────────────────────────────────
/** First line TM1 writes on a cold start; the German build keeps it English. */
const RE_BEGIN = /^Data Directory:\s/;
const RE_READY = /^TM1 Server is ready, elapsed time ([\d.,]+) seconds/i;
const RE_LOAD_TIME = /^TM1 Server load time \(secs\)\s*=\s*(\d+)/i;
/**
 * Last line of an orderly stop. English on the German-configured 11.8 test
 * server too (measured 2026-11-03). A taskkill leaves no such line (two kills
 * on the test server, 2026-10-25 and 2026-11-01). Whether a Windows shutdown
 * writes it is not measured.
 */
const RE_SHUTDOWN = /^Server shutdown, elapsed time/i;

// ── Configuration worth showing next to the timings ──────────────────────────
const RE_MTQ = [
  /^MTQ is enabled with (\d+) threads?/i,
  /^MTQ mit (\d+) Threads? aktiviert/i,
];
const RE_CUBE_THREADS = [
  /^MaximumCubeLoadThreads (?:is set to|ist auf) (\d+)/i,
  /^(\d+) Threads? zum Laden von Cubes werden gestartet/i,
  /^Starting (\d+) threads? to load cubes/i,
];

// ── Cube body: the ONLY phase with a real start/end pair ─────────────────────
// German is the trap: the END says "Laden des Hauptteils … abgeschlossen" and the
// START says "Hauptteil … wird geladen" — both contain "Hauptteil", so the end
// forms must be tested BEFORE the start forms.
const RE_BODY_END = [
  /^Done loading body for cube (.+)$/i,
  /^Laden des Hauptteils für Cube (.+) abgeschlossen\.?$/i,
];
const RE_BODY_START = [
  /^Loading body for cube (.+)$/i,
  /^Hauptteil für Cube (.+) wird geladen\.?$/i,
];
/** Header has no start line — count only, never a duration. */
const RE_HEAD_END = [
  /^Done loading header for cube (.+)$/i,
  /^Laden der Kopfzeile für Cube (.+) abgeschlossen\.?$/i,
];
/** Dimension has no end line — count only. */
const RE_DIM = [
  /^Loading dimension (.+)$/i,
  /^Dimension '(.+)' wird geladen\.?$/i,
];
/** Rules have no end line — count only. */
const RE_RULES = [
  /^Loading rules for cube (.+)$/i,
  /^Regeln für Cube (.+) werden geladen\.?$/i,
];

// ── Feeders ──────────────────────────────────────────────────────────────────
/**
 * The one phase TM1 times itself. Only the `(in Nms)` half is a measurement —
 * the opening `ProcessFeeders: Computing feeders …` line deliberately does NOT
 * parse, or the same work would be counted twice.
 */
const RE_FEEDER_DONE = /^TM1CubeImpl::ProcessFeeders\(in (\d+)ms\): Done computing feeders for base cube '(.+)'\.?$/i;
const RE_FEEDER_FILE = [
  /^Feeders already loaded for cube ["'](.+)["']$/i,
  /^Feeders already loaded for cube (.+)$/i,
  /^TM1CubeImpl::LoadFeeders: Loading feeders for cube '(.+)' from saved feeders file\.?$/i,
];
/** Whole-server switch, not a per-cube line. Distinct from the config echo
 *  `PersistentFeeders is disabled` / `… ist aktiviert`, which says nothing about
 *  what this particular start actually did. */
const RE_PERSISTENT = /^Using Persistent Feeders\b/i;

function firstMatch(res: readonly RegExp[], msg: string): string | null {
  for (const re of res) {
    const m = re.exec(msg);
    if (m) { return m[1]; }
  }
  return null;
}

/** Parse one log message into a startup event, or `null` if it is not one. */
export function parseStartupLine(msg: string): StartupEvent | null {
  if (!msg) { return null; }
  const s = msg.trim();

  if (RE_BEGIN.test(s)) { return { type: 'begin' }; }
  let m = RE_READY.exec(s);
  if (m) { return { type: 'ready', elapsedSec: parseFloat(m[1].replace(',', '.')) }; }
  m = RE_LOAD_TIME.exec(s);
  if (m) { return { type: 'loadTime', sec: Number(m[1]) }; }

  m = RE_FEEDER_DONE.exec(s);
  if (m) { return { type: 'feederDone', name: m[2], ms: Number(m[1]) }; }

  let n = firstMatch(RE_BODY_END, s);
  if (n !== null) { return { type: 'bodyEnd', name: n }; }
  n = firstMatch(RE_HEAD_END, s);
  if (n !== null) { return { type: 'headEnd', name: n }; }
  n = firstMatch(RE_BODY_START, s);
  if (n !== null) { return { type: 'bodyStart', name: n }; }
  n = firstMatch(RE_DIM, s);
  if (n !== null) { return { type: 'dimension', name: n }; }
  n = firstMatch(RE_RULES, s);
  if (n !== null) { return { type: 'rules', name: n }; }
  n = firstMatch(RE_FEEDER_FILE, s);
  if (n !== null) { return { type: 'feederFromFile', name: n }; }

  if (RE_PERSISTENT.test(s)) { return { type: 'persistentFeeders' }; }

  n = firstMatch(RE_MTQ, s);
  if (n !== null) { return { type: 'mtq', threads: Number(n) }; }
  n = firstMatch(RE_CUBE_THREADS, s);
  if (n !== null) { return { type: 'cubeLoadThreads', threads: Number(n) }; }

  return null;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** One entry of the startup picker: a `ready` line and the total it reports. */
export interface StartupRef {
  readyTs: string;
  elapsedSec: number;
}

/**
 * How the run before a startup ended, as far as the log can say.
 *
 * - `clean`: TM1 wrote `Server shutdown, elapsed time …`.
 * - `unlogged`: lines before the start, but no shutdown line. A taskkill looks
 *   like this (two kills, 2026-10-25 and 2026-11-01), so never call it a crash.
 * - `unknown`: nothing before the start in the readable log.
 */
export type PrevEnd = 'clean' | 'unlogged' | 'unknown';

/** One startup in the history: the picker entry plus how the run before it ended. */
export interface StartupHistoryEntry extends StartupRef {
  beginTs: string | null;
  prevEnd: PrevEnd;
  /** Shutdown line, or the last line of any kind before the start; `null` when unknown. */
  prevEndTs: string | null;
  /** From `prevEndTs` to `beginTs`. */
  downSec: number | null;
  /** Starts that got a `Data Directory:` line but never reached `ready`. */
  abortedBefore: number;
}

/** OData filter for the boundary lines `buildStartupHistory` reads - one call for the whole log. */
export const STARTUP_BOUNDARY_FILTER =
  "contains(Message,'TM1 Server is ready') or startswith(Message,'Data Directory:') or startswith(Message,'Server shutdown, elapsed')";

/**
 * Turn the boundary lines of a log into the startup history, newest first.
 *
 * `lastLineBefore` maps a `beginTs` to the timestamp of the last log line
 * before it; the host fetches it only for starts without a shutdown line. A
 * start missing from the map stays `unlogged` with no downtime; a start whose
 * entry is not a real timestamp (TM1 writes `0000-00-00T00:00Z` for the
 * shared-memory line) or is absent because the log begins there is `unknown`.
 *
 * An aborted start (begin, maybe a shutdown, no ready) keeps the end of the
 * real run before it: downtime counts from that run to the start that worked.
 */
export function buildStartupHistory(
  entries: StartupRawEntry[],
  lastLineBefore?: ReadonlyMap<string, string | null>,
): StartupHistoryEntry[] {
  const ordered = [...entries].sort((a, b) => (msOf(ts(a)) ?? 0) - (msOf(ts(b)) ?? 0));
  const out: StartupHistoryEntry[] = [];
  let shutdownTs: string | null = null;
  let pending: { beginTs: string; prevEnd: PrevEnd; prevEndTs: string | null } | null = null;
  let aborted = 0;

  for (const en of ordered) {
    const t = ts(en);
    const msg = msgOf(en).trim();
    if (RE_SHUTDOWN.test(msg)) { shutdownTs = t; continue; }
    const ev = parseStartupLine(msg);
    if (ev?.type === 'begin') {
      if (pending) { aborted++; pending.beginTs = t; }
      else if (shutdownTs) { pending = { beginTs: t, prevEnd: 'clean', prevEndTs: shutdownTs }; }
      else {
        const last = lastLineBefore?.get(t);
        const known = last !== undefined && last !== null && msOf(last) !== null;
        pending = {
          beginTs: t,
          prevEnd: last === undefined || known ? 'unlogged' : 'unknown',
          prevEndTs: known ? last : null,
        };
      }
      shutdownTs = null;
    } else if (ev?.type === 'ready' && t) {
      const beginTs = pending?.beginTs ?? null;
      const prevEndTs = pending?.prevEndTs ?? null;
      const b = msOf(beginTs ?? ''), e = msOf(prevEndTs ?? '');
      out.push({
        readyTs: t,
        elapsedSec: ev.elapsedSec,
        beginTs,
        prevEnd: pending?.prevEnd ?? 'unknown',
        prevEndTs,
        downSec: b !== null && e !== null ? round2((b - e) / 1000) : null,
        abortedBefore: aborted,
      });
      pending = null;
      aborted = 0;
    }
  }
  return out.reverse();
}

/** One cube body load, timed from its own start/end pair. */
export interface CubeLoad {
  name: string;
  /** Worker thread, `undefined` when the server omits `ThreadID`. */
  thread: number | undefined;
  startTs: string;
  endTs: string;
  sec: number;
}

/**
 * One worker thread's share of the cube loading.
 *
 * This is the honest unit for a parallel start. Measured on a real 1987 s
 * startup: 9 workers, 179 cubes, and NOT ONE of them idle - the total was set by
 * a single worker that spent 1856 s on 7 cubes, 1206 s of it on one. Reading the
 * same start as "10 000 s of work in 1987 s" says throughput was fine; reading it
 * as lanes says extra workers would have changed nothing.
 */
export interface WorkerLane {
  thread: number | undefined;
  cubes: CubeLoad[];
  /** Sum of this lane's cube durations. */
  busySec: number;
  /** First start to last end of this lane. */
  spanSec: number;
  /** `spanSec - busySec` - time the worker held no cube. */
  idleSec: number;
  startTs: string;
  endTs: string;
}

export interface StartupAnalysis {
  beginTs: string | null;
  readyTs: string | null;
  /** From `TM1 Server is ready, elapsed time N seconds`. */
  reportedSec: number | null;
  /** From `TM1 Server load time (secs) = N` - TM1's second, slightly smaller total. */
  loadTimeSec: number | null;
  /** Wall clock between the two boundary lines actually present in the window. */
  wallSec: number | null;
  mtqThreads: number | null;
  cubeLoadThreads: number | null;
  persistentFeeders: boolean;
  /** Longest first. */
  cubes: CubeLoad[];
  /** Busiest first. */
  lanes: WorkerLane[];
  /** Most cube bodies open at one instant. */
  maxParallel: number;
  /** Sum of all cube durations - WORK, which may exceed the wall clock. */
  busySec: number;
  /** Wall time covered by at least one cube load - the union, never the sum. */
  coveredSec: number;
  /** Span of the longest lane: the floor no extra worker can push below. */
  criticalLaneSec: number;
  criticalThread: number | undefined;
  headers: number;
  dimensions: number;
  rules: number;
  /** Cubes whose feeders were computed, longest first. */
  feeders: { name: string; sec: number }[];
  /** Cubes whose feeders came from the saved feeders file instead. */
  feedersFromFile: number;
  /** `begin` to the first load line of any kind. */
  preludeSec: number | null;
  /** Last cube body end to `ready`. */
  tailSec: number | null;
  /** Bodies whose partner fell outside the window - reported, never dropped quietly. */
  unpairedStarts: number;
  unpairedEnds: number;
  lineCount: number;
}

function ts(en: StartupRawEntry): string { return en.TimeStamp ?? en.Timestamp ?? ''; }
function msgOf(en: StartupRawEntry): string { return en.Message ?? en.Text ?? ''; }
function msOf(t: string): number | null {
  if (!t) { return null; }
  const v = Date.parse(t);
  return Number.isNaN(v) ? null : v;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Break one startup window down.
 *
 * Entries may arrive in either order - REST hands them over newest-first - and
 * are sorted chronologically here.
 *
 * Bodies pair by `(thread, name)` when the thread is there, by name alone when it
 * is not. Measured against a real log: 1791 of 1791 body pairs sat on ONE thread,
 * none crossed. The thread also stops a window that clipped two startups together
 * from welding one cube's start to the other's end.
 */
export function analyzeStartup(entries: StartupRawEntry[]): StartupAnalysis {
  const ordered = [...entries].sort((a, b) => (msOf(ts(a)) ?? 0) - (msOf(ts(b)) ?? 0));

  let beginTs: string | null = null;
  let readyTs: string | null = null;
  let reportedSec: number | null = null;
  let loadTimeSec: number | null = null;
  let mtqThreads: number | null = null;
  let cubeLoadThreads: number | null = null;
  let persistentFeeders = false;
  let headers = 0, dimensions = 0, rules = 0, feedersFromFile = 0;
  let unpairedStarts = 0, unpairedEnds = 0;
  let firstLoadMs: number | null = null;
  const feeders: { name: string; sec: number }[] = [];
  const cubes: CubeLoad[] = [];
  const open = new Map<string, { ts: string; ms: number }>();
  const key = (thread: number | undefined, name: string) => `${thread ?? '-'} ${name}`;

  const markLoad = (t: number | null) => {
    if (t !== null && (firstLoadMs === null || t < firstLoadMs)) { firstLoadMs = t; }
  };

  for (const en of ordered) {
    const ev = parseStartupLine(msgOf(en));
    if (!ev) { continue; }
    const t = ts(en);
    const tm = msOf(t);
    const th = typeof en.ThreadID === 'number' && en.ThreadID > 0 ? en.ThreadID : undefined;

    switch (ev.type) {
      case 'begin': if (beginTs === null) { beginTs = t; } break;
      case 'ready': readyTs = t; reportedSec = ev.elapsedSec; break;
      case 'loadTime': loadTimeSec = ev.sec; break;
      case 'mtq': mtqThreads = ev.threads; break;
      case 'cubeLoadThreads': cubeLoadThreads = ev.threads; break;
      case 'persistentFeeders': persistentFeeders = true; break;
      case 'headEnd': headers++; markLoad(tm); break;
      case 'dimension': dimensions++; markLoad(tm); break;
      case 'rules': rules++; markLoad(tm); break;
      case 'feederFromFile': feedersFromFile++; break;
      case 'feederDone': feeders.push({ name: ev.name, sec: round2(ev.ms / 1000) }); break;
      case 'bodyStart':
        markLoad(tm);
        // An unparsable timestamp cannot yield a duration; count it as unpaired
        // rather than open a run that would later produce NaN seconds.
        if (tm === null) { unpairedStarts++; break; }
        open.set(key(th, ev.name), { ts: t, ms: tm });
        break;
      case 'bodyEnd': {
        markLoad(tm);
        const k = key(th, ev.name);
        const s = open.get(k);
        if (s === undefined || tm === null) { unpairedEnds++; break; }
        open.delete(k);
        cubes.push({ name: ev.name, thread: th, startTs: s.ts, endTs: t, sec: round2((tm - s.ms) / 1000) });
        break;
      }
    }
  }
  unpairedStarts += open.size;

  cubes.sort((a, b) => b.sec - a.sec);
  feeders.sort((a, b) => b.sec - a.sec);

  const byThread = new Map<string, CubeLoad[]>();
  for (const c of cubes) {
    const k = String(c.thread ?? '-');
    if (!byThread.has(k)) { byThread.set(k, []); }
    byThread.get(k)!.push(c);
  }
  const lanes: WorkerLane[] = [...byThread.values()].map(cs => {
    const startsMs = cs.map(c => msOf(c.startTs) ?? 0);
    const endsMs = cs.map(c => msOf(c.endTs) ?? 0);
    const from = Math.min(...startsMs), to = Math.max(...endsMs);
    const busy = round2(cs.reduce((a, c) => a + c.sec, 0));
    const span = round2((to - from) / 1000);
    return {
      thread: cs[0].thread,
      cubes: [...cs].sort((a, b) => b.sec - a.sec),
      busySec: busy,
      spanSec: span,
      idleSec: round2(Math.max(0, span - busy)),
      startTs: cs[startsMs.indexOf(from)].startTs,
      endTs: cs[endsMs.indexOf(to)].endTs,
    };
  }).sort((a, b) => b.busySec - a.busySec);

  // Concurrency and covered wall time - the union of the intervals, NOT the sum.
  const spans = cubes
    .map(c => [msOf(c.startTs), msOf(c.endTs)] as [number | null, number | null])
    .filter((s): s is [number, number] => s[0] !== null && s[1] !== null)
    .sort((a, b) => a[0] - b[0]);
  let maxParallel = 0;
  let ends: number[] = [];
  let covered = 0, curFrom: number | null = null, curTo = 0;
  for (const [from, to] of spans) {
    ends = ends.filter(x => x > from);
    ends.push(to);
    if (ends.length > maxParallel) { maxParallel = ends.length; }
    if (curFrom === null) { curFrom = from; curTo = to; }
    else if (from <= curTo) { curTo = Math.max(curTo, to); }
    else { covered += curTo - curFrom; curFrom = from; curTo = to; }
  }
  if (curFrom !== null) { covered += curTo - curFrom; }

  const critical = lanes.length > 0
    ? lanes.reduce((a, b) => (b.spanSec > a.spanSec ? b : a))
    : undefined;

  const beginMs = msOf(beginTs ?? ''), readyMs = msOf(readyTs ?? '');
  const lastBodyMs = spans.length > 0 ? Math.max(...spans.map(s => s[1])) : null;

  return {
    beginTs, readyTs, reportedSec, loadTimeSec,
    wallSec: beginMs !== null && readyMs !== null ? round2((readyMs - beginMs) / 1000) : null,
    mtqThreads, cubeLoadThreads, persistentFeeders,
    cubes, lanes, maxParallel,
    busySec: round2(cubes.reduce((a, c) => a + c.sec, 0)),
    coveredSec: round2(covered / 1000),
    criticalLaneSec: critical ? critical.spanSec : 0,
    criticalThread: critical ? critical.thread : undefined,
    headers, dimensions, rules, feeders, feedersFromFile,
    preludeSec: beginMs !== null && firstLoadMs !== null ? round2((firstLoadMs - beginMs) / 1000) : null,
    tailSec: readyMs !== null && lastBodyMs !== null ? round2((readyMs - lastBodyMs) / 1000) : null,
    unpairedStarts, unpairedEnds,
    lineCount: ordered.length,
  };
}

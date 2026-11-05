// src/tm1Rest/runStatsApi.ts
// Fetches last-run facts. WHY processes read a control cube and chores read the
// message log — plus what neither of them can tell — is documented in
// `runStats.ts`; this file only does the calls.

import { apiRequest } from './client';
import { parseBodySafe } from './parseRest';
import type { Tm1Config } from './transport/types';
import { executeMdx, type ApiFetcher } from '../mdx/executeMdx';
import { parseChoreRunLogCounted, parseChoreRuns, type ChoreLogEntry, type ChoreRun, type RunStats } from './runStats';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';

const MEASURES = '{[}StatsByProcess].[Last Start Time],[}StatsByProcess].[Last End Time]}';

const PROCESS_MDX =
  `SELECT ${MEASURES} ON 0, NON EMPTY {[}Processes].Members} ON 1 `
  + 'FROM [}StatsByProcess] WHERE ([}TimeIntervals].[LATEST])';

/**
 * Map process name → last-run facts. Returns an empty map when the control cube
 * is missing or the query fails (older servers, performance monitor off) — every
 * caller shows the no-value placeholder for those.
 */
export async function fetchProcessRunStats(cfg: Tm1Config): Promise<Map<string, RunStats>> {
  const api: ApiFetcher = (method, path, body) => apiRequest(method, path, body, undefined, cfg);
  const out = new Map<string, RunStats>();
  try {
    const res = await executeMdx(PROCESS_MDX, api);
    if (!res.ok || !('table' in res)) { return out; }
    const t = res.table;
    for (let r = 0; r < t.rowHeaders.length; r++) {
      const name = t.rowHeaders[r]?.[0];
      if (!name) { continue; }
      const start = epochSeconds(t.cells[r]?.[0]?.value);
      const end = epochSeconds(t.cells[r]?.[1]?.value);
      if (end === undefined) { continue; }
      out.set(name, {
        lastEnd: end,
        duration: start !== undefined && end >= start ? end - start : undefined,
        state: 'finished',
      });
    }
  } catch (e) { logRestBestEffort('runStats', 'read process run stats', e); /* control cube unavailable → empty */ }
  return out;
}

/** Default read cap for `fetchProcessRunLog` — the 11.8 test log (130 404 lines, 26.6 MB) read whole in 720 ms. */
export const PROCESS_RUN_LOG_TOP = 300_000;

/**
 * Which processes ran in the message log window, newest first, capped at `top` lines.
 * `Process "<name>"` opens both the "executed by" and the "run from process" line.
 * Throws on HTTP failure — the caller turns that into a coverage gap, never into "no runs".
 */
export async function fetchProcessRunLog(cfg: Tm1Config, top = PROCESS_RUN_LOG_TOP): Promise<{
  lines: number; capped: boolean; from?: string; to?: string; processesLc: string[];
}> {
  const path = "MessageLogEntries?$filter=Logger eq 'TM1.Process'&$orderby=TimeStamp desc"
    + `&$top=${top}&$select=TimeStamp,Message`;
  const res = await apiRequest('GET', path, undefined, undefined, cfg);
  if (!isOk(res)) { throw new Error(`message log HTTP ${res.statusCode}`); }
  const rows = parseBodySafe<{ value?: Array<{ TimeStamp?: string; Message?: string }> }>(res, {}).value ?? [];
  const seen = new Set<string>();
  for (const r of rows) {
    const m = /Process "([^"]+)"/.exec(r.Message ?? '');
    if (m) { seen.add(m[1].toLowerCase()); }
  }
  return {
    lines: rows.length,
    capped: rows.length >= top,
    to: rows[0]?.TimeStamp,
    from: rows[rows.length - 1]?.TimeStamp,
    processesLc: [...seen],
  };
}

/**
 * Upper bound on the chore log lines read in one go — the ONLY limit on how far
 * back the overview sees, next to the log file's own rollover.
 *
 * Measured on the 11.8 test server: `$filter` runs BEFORE `$top`, so only
 * `TM1.Chore` lines count against it — 1206 of the log's 118 468 entries, four
 * months' worth, 180 KB, 213 ms. Asking for far more than exists costs nothing
 * ($top=200000 returned the same 1206 rows in the same time), so the budget is
 * generous on purpose. Three lines per run means 5000 lines ≈ 1600 runs; a chore
 * whose last run is older than that shows the no-value placeholder.
 */
const CHORE_LOG_TOP = 5000;

export interface ChoreRunStats {
  /** Chore name → last-run facts. */
  stats: Map<string, RunStats>;
  /**
   * Timestamp of the OLDEST log entry that was read, i.e. how far back the
   * columns can see. Undefined when nothing came back.
   */
  oldestEntry?: string;
  /** How many log lines were read — 0 if nothing came back. */
  linesRead?: number;
  /** How many of those were recognized as a chore line. */
  linesMatched?: number;
  /** Every run in the log window, oldest first — for the calendar. */
  runs?: ChoreRun[];
  /**
   * Why the map is empty — `undefined` when it is not.
   *
   * `unsupported`: the server cannot do it (v12 without a message log).
   * `failed`: the call went wrong. Both used to look the same, namely
   * like "no runs" — and the column showed "—" without a line of reason.
   *
   * NO `monitorOff`: `Configuration` carries no field for that at all on
   * 11.8 (measured 2026-09-20, no `PerformanceMonitor*` key). Reporting a
   * reason that cannot be determined would be a guess.
   */
  reason?: 'unsupported' | 'failed';
}

/**
 * Last-run facts per chore, folded out of the `TM1.Chore` message log. Returns
 * an empty result on any failure — a server that rejects the filter must not
 * take the whole overview down with it.
 */
export async function fetchChoreRunStats(cfg: Tm1Config, top = CHORE_LOG_TOP): Promise<ChoreRunStats> {
  // v12 has no message log: `MessageLogEntries` is not reachable there
  // (measured 2026-09-16, see `docs/architecture/` and the probe
  // v12LogSurfaceProbe.js). Sending the call anyway costs one
  // request per overview and always ends up in the `catch` — the difference
  // from "nothing found" was lost in the process.
  if (cfg.version === 'v12') { return { stats: new Map(), reason: 'unsupported' }; }
  try {
    const res = await apiRequest(
      'GET',
      "MessageLogEntries?$filter=Logger eq 'TM1.Chore'"
        + `&$orderby=TimeStamp desc&$top=${top}&$select=TimeStamp,Message`,
      undefined,
      30000,
      cfg,
    );
    if (!isOk(res)) {
      return { stats: new Map(), reason: 'failed' };
    }
    const parsed = parseBodySafe<{ value?: Array<{ TimeStamp?: string; Message?: string }> }>(res, {});
    const raw = parsed.value ?? [];
    const entries: ChoreLogEntry[] = raw.map(e => ({
      timestamp: e.TimeStamp ?? '',
      message: e.Message ?? '',
    }));
    // The query asks for newest first, so the last row is the far end of the window.
    const { stats, linesRead, linesMatched } = parseChoreRunLogCounted(entries);
    return { stats, oldestEntry: raw[raw.length - 1]?.TimeStamp, linesRead, linesMatched, runs: parseChoreRuns(entries) };
  } catch {
    return { stats: new Map(), reason: 'failed' };
  }
}

/** A stats cell holding a Unix epoch. An untouched cell is `null`, never 0. */
function epochSeconds(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') { return undefined; }
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Which cubes are loaded in memory, from the performance monitor.
 *
 * TM1 REST has no such field on the Cube entity (11.8 `$metadata`: Name,
 * Rules, DrillthroughRules, LastSchemaUpdate, LastDataUpdate, Attributes).
 * `}StatsByCube` shows it — measured 2026-09-26 on a test cube: after
 * `tm1.Unload` the `Total Memory Used` stayed (19456) while the populated
 * cell counts went empty; after `tm1.Load` they came back. The cube refreshes
 * about every 20 s.
 *
 * `true` = cells counted (loaded). Memory counted but no cells is NOT taken as
 * unloaded: an empty cube and a rules-only cube (no stored values) look the
 * same, and the unloaded state only offers "Load". So only the unambiguous case
 * lands in the map; everything else — memory without cells, no memory figure,
 * v12, a monitor that is off or a failed query — stays out, and the caller
 * offers both actions.
 */
const CUBE_LOAD_MDX =
  'SELECT {[}StatsStatsByCube].[Total Memory Used],[}StatsStatsByCube].[Number of Populated Numeric Cells],'
  + '[}StatsStatsByCube].[Number of Populated String Cells]} ON 0, {[}PerfCubes].Members} ON 1 '
  + 'FROM [}StatsByCube] WHERE ([}TimeIntervals].[LATEST])';

export async function fetchCubeLoadStates(cfg: Tm1Config): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (cfg.version === 'v12') { return out; }
  const api: ApiFetcher = (method, path, body) => apiRequest(method, path, body, undefined, cfg);
  try {
    const res = await executeMdx(CUBE_LOAD_MDX, api);
    if (!res.ok || !('table' in res)) { return out; }
    const t = res.table;
    const num = (v: unknown) => (typeof v === 'number' ? v : Number(v)) || 0;
    for (let r = 0; r < t.rowHeaders.length; r++) {
      const name = t.rowHeaders[r]?.[0];
      if (!name) { continue; }
      const [mem, n, s] = [0, 1, 2].map(c => num(t.cells[r]?.[c]?.value));
      if (mem > 0 && n + s > 0) { out.set(name.toLowerCase(), true); }
    }
  } catch (e) { logRestBestEffort('runStats', 'read cube load state', e); /* monitor off or cube missing → unknown */ }
  return out;
}

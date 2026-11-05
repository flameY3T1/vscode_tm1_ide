// src/tm1Rest/runStats.ts
// What "last run" means for a process and for a chore, and how each is read.
// Pure: parsing + formatting only, the REST calls live in `runStatsApi.ts`.
//
// PROCESSES — control cube `}StatsByProcess` ([}TimeIntervals] x [}Processes] x
// [}StatsByProcess]). Measured live on 11.8, right after a run:
//   Last Start Time / Last End Time  filled, Unix epoch SECONDS
//   Last Duration                    ALWAYS null — even for a process whose own
//                                    start/end were 3 s apart. Unused on this
//                                    version, so the duration is END MINUS START
//                                    (cross-checked against the message log,
//                                    which logged "elapsed time 3.00 seconds").
//   Completion Status / Current State / Client Name   always empty as well.
// The cube stays empty entirely while the performance monitor is off
// (`/ActiveConfiguration/Administration/PerformanceMonitorOn`).
//
// CHORES — the sibling cube `}StatsByChore` looks like it should carry the same
// facts and does NOT: measured after a chore ran, only `Current Process` was
// filled, every time and status measure stayed null. The message log is the one
// source that works, and it needs no performance monitor:
//   Chore "X" executed by scheduler        (or: executed by user "U")   → start
//   Chore "X" time = 22.39 seconds         (omitted for very short runs) → duration
//   Chore "X" finished executing                                        → end
// `Logger eq 'TM1.Chore'` is cheap because chores are rare: 1203 entries / 182 KB
// / 191 ms on the test server, reaching four months back.
//
// NOT derivable: whether the last run SUCCEEDED. The chore log has no success or
// failure wording and every entry is level Info; `Completion Status` in the cube
// is null even after a clean run. `state` below therefore says only whether the
// run has finished, never whether it went well.

export interface RunStats {
  /** End of the last run, Unix epoch seconds. For a running chore: its start. */
  lastEnd?: number;
  /** Duration of the last run in seconds. */
  duration?: number;
  /** Whether the last run has ended. Says NOTHING about success. */
  state?: 'finished' | 'running';
}

/** One `/MessageLogEntries` row, reduced to what the chore parser needs. */
export interface ChoreLogEntry {
  timestamp: string;
  message: string;
}

const STARTED = /^Chore "(.+)" executed by /;
// `[0-9.,]` instead of `[0-9.]`: whether TM1 writes a comma depending on
// locale is NOT measured (the test instance had not a single chore line in
// 10,000 log lines, 2026-09-20). Widening the character class costs nothing
// and catches the case if it exists — `Number()` needs the dot afterward.
const TIMED = /^Chore "(.+)" time = ([0-9.,]+) seconds/;
const FINISHED = /^Chore "(.+)" finished executing/;

/** How far apart a "time =" line and its "finished executing" line may sit. */
const PAIR_WINDOW_MS = 2000;

interface ChoreMarks {
  startMs?: number;
  finishMs?: number;
  timeMs?: number;
  timeSec?: number;
}

/**
 * Fold `TM1.Chore` log entries into last-run facts per chore.
 *
 * Only the NEWEST timestamp of each of the three line kinds is kept, and the run
 * is composed from those — never from pairing adjacent lines. Measured reason:
 * `time =` and `finished executing` routinely carry the SAME millisecond, and
 * `$orderby=TimeStamp desc` then returns them in either order, so a walk that
 * pairs neighbours reports a finished chore as still running (five of thirteen
 * chores on the test server did exactly that).
 *
 * Order of `entries` does not matter.
 */
export interface ChoreRunLogResult {
  stats: Map<string, RunStats>;
  /** How many log lines were read. */
  linesRead: number;
  /** How many of those were recognized as a chore line. */
  linesMatched: number;
}

/**
 * Like `parseChoreRunLog`, but with the count alongside it.
 *
 * Why the numbers are needed: if no line matches, the overview shows "—" for
 * every chore and the tooltip still says "read up to <date>". The user sees
 * "read up to April, but nothing in it" and has no clue why. With
 * `0 of 10,000 recognized`, there is at least a statement that reading
 * happened and the lines did not match — whether because of a localized log,
 * a changed format, or simply because no chore ever ran, the number does not
 * say, but it ends the guessing.
 */
export function parseChoreRunLogCounted(entries: readonly ChoreLogEntry[]): ChoreRunLogResult {
  let linesMatched = 0;
  const stats = parseChoreRunLog(entries, () => { linesMatched++; });
  return { stats, linesRead: entries.length, linesMatched };
}

export function parseChoreRunLog(
  entries: readonly ChoreLogEntry[],
  onMatch?: () => void,
): Map<string, RunStats> {
  const marks = new Map<string, ChoreMarks>();
  const mark = (name: string): ChoreMarks => {
    let m = marks.get(name);
    if (!m) { m = {}; marks.set(name, m); }
    return m;
  };
  for (const { timestamp, message } of entries) {
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) { continue; }

    const started = STARTED.exec(message);
    if (started) {
      onMatch?.();
      const m = mark(started[1]);
      if (m.startMs === undefined || ms > m.startMs) { m.startMs = ms; }
      continue;
    }
    const timed = TIMED.exec(message);
    if (timed) {
      onMatch?.();
      const m = mark(timed[1]);
      if (m.timeMs === undefined || ms > m.timeMs) { m.timeMs = ms; m.timeSec = Number(timed[2].replace(',', '.')); }
      continue;
    }
    const finished = FINISHED.exec(message);
    if (finished) {
      onMatch?.();
      const m = mark(finished[1]);
      if (m.finishMs === undefined || ms > m.finishMs) { m.finishMs = ms; }
    }
  }

  const out = new Map<string, RunStats>();
  for (const [name, m] of marks) {
    if (m.finishMs === undefined) {
      // Started but never finished within the log window — the start is the only
      // timestamp this chore has.
      if (m.startMs !== undefined) { out.set(name, { lastEnd: Math.floor(m.startMs / 1000), state: 'running' }); }
      continue;
    }
    const running = m.startMs !== undefined && m.startMs > m.finishMs;
    if (running) {
      out.set(name, { lastEnd: Math.floor(m.startMs! / 1000), state: 'running' });
      continue;
    }
    // TM1 omits the "time =" line for some runs, so fall back to the span
    // between the start and the finish entry.
    const timedThisRun = m.timeMs !== undefined && Math.abs(m.timeMs - m.finishMs) <= PAIR_WINDOW_MS;
    const duration = timedThisRun
      ? m.timeSec
      : (m.startMs !== undefined && m.startMs <= m.finishMs ? (m.finishMs - m.startMs) / 1000 : undefined);
    out.set(name, { lastEnd: Math.floor(m.finishMs / 1000), duration, state: 'finished' });
  }
  return out;
}

/** One chore run from the log, for the calendar. `endMs` missing = still running (or cut off by the log window). */
export interface ChoreRun {
  name: string;
  startMs: number;
  endMs?: number;
}

/**
 * Every chore run in the log window, not just the last one.
 *
 * Pairs a start line with the next finish line of the SAME chore. Unlike
 * `parseChoreRunLog`, this pairing is safe: the same-millisecond tie that
 * breaks neighbour pairing is between `time =` and `finished executing`, and
 * `time =` is not used here. A finish without a preceding start (the start
 * fell out of the window) is dropped — its bar would have no left edge.
 *
 * Order of `entries` does not matter.
 */
export function parseChoreRuns(entries: readonly ChoreLogEntry[]): ChoreRun[] {
  const marks: Array<{ ms: number; name: string; start: boolean }> = [];
  for (const { timestamp, message } of entries) {
    const ms = Date.parse(timestamp);
    if (!Number.isFinite(ms)) { continue; }
    const started = STARTED.exec(message);
    if (started) { marks.push({ ms, name: started[1], start: true }); continue; }
    const finished = FINISHED.exec(message);
    if (finished) { marks.push({ ms, name: finished[1], start: false }); }
  }
  // On a tie the finish goes first: run N ending in the same millisecond as
  // run N+1 starts must close N, not N+1. A finish that finds nothing open is
  // kept for a start of the same chore in that very millisecond — a run that
  // took under a millisecond.
  marks.sort((a, b) => a.ms - b.ms || (a.start === b.start ? 0 : a.start ? 1 : -1));
  const open = new Map<string, ChoreRun>();
  const orphanFinish = new Map<string, number>();
  const runs: ChoreRun[] = [];
  const dropped = new Set<ChoreRun>();
  for (const m of marks) {
    if (m.start) {
      // A start while the same chore is still open: the old run's finish is
      // missing from the log. Drop it — drawn up to "now" it would be a bar
      // without an end that paints every overlap.
      const stale = open.get(m.name);
      if (stale) { dropped.add(stale); }
      const run: ChoreRun = { name: m.name, startMs: m.ms };
      if (orphanFinish.get(m.name) === m.ms) {
        run.endMs = m.ms;
        open.delete(m.name);
      } else {
        open.set(m.name, run);
      }
      orphanFinish.delete(m.name);
      runs.push(run);
    } else {
      const run = open.get(m.name);
      if (run) { run.endMs = m.ms; open.delete(m.name); } else { orphanFinish.set(m.name, m.ms); }
    }
  }
  return dropped.size ? runs.filter(r => !dropped.has(r)) : runs;
}

/** Unix epoch seconds → local `YYYY-MM-DD HH:mm`. */
export function formatEpochMinute(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Seconds → compact `1h 02m 03s` / `2m 03s` / `7s`. Sub-second runs read `<1s`. */
export function formatDurationSec(sec: number): string {
  if (sec < 1) { return '<1s'; }
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number): string => String(n).padStart(2, '0');
  if (h) { return `${h}h ${p(m)}m ${p(s)}s`; }
  if (m) { return `${m}m ${p(s)}s`; }
  return `${s}s`;
}

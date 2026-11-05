/**
 * Pure parsing for the TM1 **v12** substitute message log — no vscode deps.
 *
 * v12 (PA Engine) removed message-log RETRIEVAL from the REST API: measured live
 * against 12.5.9 on 2026-08-26, `MessageLogEntries` answers HTTP 200 with an
 * EMPTY collection (`/$count` = 0 even one second after a process ran), the
 * `MessageLog()` function answers the same empty collection, `TailMessageLog()`
 * hands back a delta link over that same empty set, and the
 * `Processes('X')/ErrorLogs` navigation — which the $metadata still declares —
 * is empty on every process. The management plane
 * (`/manage/v1/**`, probed with the root client) knows only
 * Instances/Databases/Applications/ProductVersions. There is no successor.
 *
 * What v12 DOES keep is one structured log file per top-level run, listed by
 * `ErrorLogFiles` and readable via `ErrorLogFiles('<name>')/Content`:
 *
 *   ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl
 *   {"id":1,"level":"info","timestamp":"…","name":"ZZ_VSC_ELTERN","message":"Process \"ZZ_VSC_ELTERN\" executed by user \"Admin\"."}
 *   {"id":1,"level":"info","timestamp":"…","name":"ZZ_VSC_KIND","message":"Process \"ZZ_VSC_KIND\" executed by Process \"ZZ_VSC_ELTERN\" via ExecuteProcess."}
 *   {"id":1,"level":"info","timestamp":"…","name":"ZZ_VSC_KIND","message":"Process execution finished normally."}
 *   {"id":1,"level":"error","timestamp":"…","name":"ZZ_VSC_ELTERN","message":"Error: Prolog procedure line (3): eltern fehler"}
 *   {"id":1,"level":"info","timestamp":"…","name":"ZZ_VSC_ELTERN","message":"Process execution finished with messages."}
 *
 * That is the whole run: start line, nested children with their parent named,
 * error lines with the procedure line number, and the end verdict. It is enough
 * to rebuild the process analysis — but NOT the server log: startup lines
 * (`TM1.Server`), TI `LogOutput` (logger `TM1.TILogOutput`) and every other
 * server-level message go to the host-side JSONL (`…/logs/tm1-i-…-0.jsonl`,
 * verified on disk) and have no REST path at all.
 */

import type { RawEntry } from './messageLogAnalysisPure';

/** One `ErrorLogFiles` entry of v12, decomposed. */
export interface RunLogFile {
  filename: string;
  /** `ProcessLog_` → a directly executed process, `ChoreLog_` → a chore run. */
  kind: 'process' | 'chore';
  /** Process or chore the file was written for — the tail of the filename. */
  object: string;
  /** Start instant encoded in the filename (UTC), ISO — `''` when unparsable. */
  startedAt: string;
}

/** A v12 run-log line mapped onto the shape the message-log panel and `analyze()` read. */
export interface V12LogEntry extends RawEntry {
  Logger?: string;
  Name?: string;
}

/**
 * Filename form, live 12.5.9:
 * `<Process|Chore>Log_<yyyyMMddHHmmss>_<epochms+seq>_<object>.jsonl`.
 *
 * The object name may hold anything TM1 allows in a process name — `_`, `}`,
 * `#`, spaces, digits — so it is taken as the greedy remainder up to the
 * extension. The digit groups cannot swallow it: neither can cross the `_` that
 * separates them.
 *
 * The 14-digit stamp is UTC (`…_20260826051823_…` for a line timestamped
 * `2026-08-26T05:18:23.816Z`). It is used for ORDERING only — every entry
 * carries its own millisecond timestamp.
 */
const RE_RUN_LOG = /^(Process|Chore)Log_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_\d+_(.+)\.jsonl$/i;

export function parseRunLogFilename(filename: string): RunLogFile | null {
  const m = RE_RUN_LOG.exec(filename);
  if (!m) { return null; }
  const [, kind, y, mo, d, h, mi, s, object] = m;
  return {
    filename,
    kind: kind.toLowerCase() === 'chore' ? 'chore' : 'process',
    object,
    startedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`,
  };
}

/**
 * Newest run first.
 *
 * Sorted here rather than trusted from `$orderby=Filename desc`: the middle
 * group is an epoch-ms value with a sequence number glued on, so two files of
 * the SAME second sort by string length before value (`…_178772150300010_`
 * before `…_17877215030002_`). The second-precision stamp is the only part with
 * a defined meaning, and ties inside one second are resolved by the entry
 * timestamps later anyway.
 */
export function sortRunLogsNewestFirst(files: RunLogFile[]): RunLogFile[] {
  return [...files].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/** Wire level of a v12 log line → the spelling TM1 11.8 uses in `MessageLogEntries.Level`. */
export function v12Level(level: string | undefined): string {
  switch ((level ?? '').toLowerCase()) {
    case 'info': return 'Info';
    case 'warn':
    case 'warning': return 'Warning';
    case 'error': return 'Error';
    case 'fatal': return 'Fatal';
    case 'debug': return 'Debug';
    default: return 'Unknown';
  }
}

/**
 * Parse one `ErrorLogFiles('…')/Content` body (JSONL) into panel entries.
 *
 * `Logger` carries the process the LINE belongs to, not a logger name: in a v12
 * run log that is the useful column — a parent run and the children it launched
 * are in one file and are told apart only by this field. `Name` repeats it for
 * `analyze()`, whose v12 end lines carry no name in their text.
 *
 * For a `ChoreLog_*` file the chore is stamped on as well. It has to come from
 * here, because the FILE NAME is the only place it appears: the lines inside a
 * chore log name the processes and never the chore (checked across all 73 chore
 * logs on the test server). `ChoreRun` is the file itself, so two runs of one
 * chore stay two runs instead of collapsing into a single group.
 *
 * The line's `id` is deliberately NOT mapped onto `RawEntry.ID`: `ID` means
 * "server-side write sequence" to the ordering code, while v12's `id` restarts
 * per run (1, 2, 3 … measured across five consecutive runs) and would order the
 * entries by a number that means nothing across files.
 *
 * A malformed line is skipped rather than thrown on — one broken line must not
 * cost the whole run.
 */
export function parseRunLogContent(text: string, file?: RunLogFile): V12LogEntry[] {
  const out: V12LogEntry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { continue; }
    let obj: { level?: string; timestamp?: string; name?: string; message?: string };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj !== 'object' || obj === null) { continue; }
    const name = typeof obj.name === 'string' ? obj.name : (file?.object ?? '');
    out.push({
      TimeStamp: typeof obj.timestamp === 'string' ? obj.timestamp : (file?.startedAt ?? ''),
      Level: v12Level(obj.level),
      Message: typeof obj.message === 'string' ? obj.message : '',
      Logger: name,
      Name: name,
      ...(file?.kind === 'chore' ? { Chore: file.object, ChoreRun: file.filename } : {}),
      ...(file?.kind === 'process' ? { RunFile: file.filename } : {}),
    });
  }
  return out;
}

/**
 * Has this run log stopped growing?
 *
 * A finished run's file is immutable — TM1 writes it once and never touches it
 * again — which is what makes caching it safe across the panel's 5-second poll.
 * A RUNNING process has a file too, and that one is still being appended to, so
 * caching it would freeze the run at whatever it had logged when it was first
 * read: no end line, no runtime, `running` forever.
 *
 * The verdict line is the marker for exactly that boundary: TM1 writes it last,
 * one per file, as the run's final act.
 */
export function isRunLogComplete(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) { return false; }
  try {
    const msg = (JSON.parse(last) as { message?: string }).message ?? '';
    return /^Process execution /i.test(msg.trim());
  } catch {
    return false;
  }
}

/**
 * Newest entry first (`descending`) or oldest first.
 *
 * Ties are ordered so that READING THE RESULT IN THE REQUESTED DIRECTION yields
 * the order the file was written in — which for descending means the tie is
 * REVERSED against the file, not kept.
 *
 * That is not pedantry, it is the whole pairing: `analyze()` reverses whatever it
 * is handed (v11 fetches newest-first), so a tie left in file order arrives with
 * the END line ahead of its own START. v12 writes fast runs entirely inside ONE
 * millisecond — measured: of 231 live run logs, 35 runs had start and end on the
 * same stamp — and v11's tie repair cannot help here: it needs either a
 * server-side write sequence (v12 has none that means anything across files) or a
 * reported runtime (v12 reports none at all). So the tie order handed over must
 * already be right.
 *
 * Within one millisecond the file order IS the write order: a run's start and end
 * always live in the same file.
 */
export function sortEntriesByTime(entries: V12LogEntry[], ascending: boolean): V12LogEntry[] {
  const withIdx = entries.map((e, i) => ({ e, i, ms: Date.parse(e.TimeStamp ?? '') }));
  withIdx.sort((a, b) => {
    const am = Number.isNaN(a.ms) ? 0 : a.ms;
    const bm = Number.isNaN(b.ms) ? 0 : b.ms;
    if (am !== bm) { return ascending ? am - bm : bm - am; }
    return ascending ? a.i - b.i : b.i - a.i;
  });
  return withIdx.map(x => x.e);
}

/**
 * The v12 substitute for `MessageLogEntries`: read the per-run log files.
 *
 * Why this exists at all — and what it can NOT deliver — is written up in
 * `messageLogV12Pure.ts`. In short: v12 answers every message-log query with an
 * empty collection, but still writes one JSONL file per top-level run, and those
 * files are the only log material the REST API hands out.
 *
 * No vscode import on purpose: this is the seam the tests drive directly, and
 * the user-facing wording lives in `messageLog.ts`.
 */

import { apiRequest } from '../tm1Rest/client';
import { assertOk } from '../tm1Rest/transport/http';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { parseBody } from '../tm1Rest/parseRest';
import { encodeODataKey } from '../utils/odataKey';
import { levelToggleFor } from './messageLogPure';
import {
  parseRunLogFilename,
  parseRunLogContent,
  sortRunLogsNewestFirst,
  sortEntriesByTime,
  isRunLogComplete,
  type RunLogFile,
  type V12LogEntry,
} from './messageLogV12Pure';

/**
 * How many run-log files one fetch may open, whatever depth is asked for.
 *
 * A file is one HTTP round trip and holds a handful of lines, so the depth alone
 * would set the request count: 2000 rows over ~3 lines per file is ~660 files.
 * The cap is the honest deckel — `truncated` says when it bit, and the caller
 * shows it rather than pretending the window was deeper than it was.
 */
export const MAX_RUN_LOG_FILES = 250;

/** Files opened in parallel. Small on purpose: `transport/requestGate.ts` caps requests globally. */
const FETCH_CONCURRENCY = 6;

/**
 * How long an EMPTY run log must have existed before it counts as settled.
 *
 * v12 writes a run log for a chore run even when the run logs nothing — 55 of the
 * 73 chore logs on the test server are zero bytes. Those files carry no verdict
 * line, so `isRunLogComplete` says "still growing" and they would be re-read on
 * every poll forever, which on that server is 55 wasted round trips per tick.
 * A file that has been empty for a minute belongs to a run that is long over; a
 * file created seconds ago may genuinely still be filling.
 */
const EMPTY_SETTLE_MS = 60_000;

/**
 * Parsed content of run logs that have finished, keyed `serverUrl::filename`.
 *
 * Without it the panel's poll (default every 5 s) would re-read every file in
 * the window on every tick — dozens of round trips per tick, against ONE on v11.
 * A finished run log never changes, so the second read can only ever return what
 * the first one did; `isRunLogComplete` is what keeps a still-running file out.
 *
 * Insertion-ordered and capped: the oldest key is evicted first, which is also
 * the least likely to be inside a window again.
 */
const _contentCache = new Map<string, V12LogEntry[]>();
const CONTENT_CACHE_MAX = 1000;

/** Drop a server's cached run logs — called on disconnect, so a re-login re-reads. */
export function clearV12RunLogCache(serverUrl?: string): void {
  if (!serverUrl) { _contentCache.clear(); return; }
  for (const key of [..._contentCache.keys()]) {
    if (key.startsWith(`${serverUrl}::`)) { _contentCache.delete(key); }
  }
}

function cachePut(key: string, entries: V12LogEntry[]): void {
  _contentCache.set(key, entries);
  while (_contentCache.size > CONTENT_CACHE_MAX) {
    const oldest = _contentCache.keys().next().value;
    if (oldest === undefined) { break; }
    _contentCache.delete(oldest);
  }
}

export interface V12FetchResult {
  entries: V12LogEntry[];
  /** Run-log files the server listed. */
  filesAvailable: number;
  /** Files actually opened. */
  filesRead: number;
  /** The depth or the file cap cut the window — older runs exist and were not read. */
  truncated: boolean;
}

/** List `ErrorLogFiles` and keep the ones whose name is a run log, newest run first. */
export async function listRunLogFiles(config: Tm1Config, timeoutMs?: number): Promise<RunLogFile[]> {
  const res = await apiRequest('GET', 'ErrorLogFiles?$select=Filename', undefined, timeoutMs, config);
  assertOk(res);
  const value = parseBody<{ value?: { Filename?: string }[] }>(res).value ?? [];
  const files: RunLogFile[] = [];
  for (const row of value) {
    const parsed = row.Filename ? parseRunLogFilename(row.Filename) : null;
    if (parsed) { files.push(parsed); }
  }
  return sortRunLogsNewestFirst(files);
}

/** Read one run-log file. A file that vanished between listing and reading yields no entries. */
async function readRunLog(file: RunLogFile, config: Tm1Config, timeoutMs?: number): Promise<V12LogEntry[]> {
  const key = `${config.serverUrl}::${file.filename}`;
  const cached = _contentCache.get(key);
  if (cached) { return cached; }
  const res = await apiRequest(
    'GET',
    `ErrorLogFiles('${encodeODataKey(file.filename)}')/Content`,
    undefined,
    timeoutMs,
    config,
  );
  // 404: TM1 prunes run logs, and a list is a snapshot. Losing one file must not
  // fail the whole panel — every other run is still readable.
  if (res.statusCode === 404) { return []; }
  assertOk(res);
  const entries = parseRunLogContent(res.body, file);
  const settledEmpty = entries.length === 0
    && Date.now() - Date.parse(file.startedAt) > EMPTY_SETTLE_MS;
  if (isRunLogComplete(res.body) || settledEmpty) { cachePut(key, entries); }
  return entries;
}

/**
 * Read a single run-log file.
 *
 * Public for the call graph that needs exactly ONE run instead of the last
 * N — `fetchV12RunLogEntries` below always reads a whole window.
 */
export async function readRunLogContentForFile(
  file: RunLogFile, config: Tm1Config, timeoutMs?: number,
): Promise<V12LogEntry[]> {
  return await readRunLog(file, config, timeoutMs);
}

/**
 * Fetch up to `top` v12 run-log entries.
 *
 * Files are opened newest-first in small batches and the loop stops as soon as
 * the depth is covered, so asking for 100 rows costs ~30 round trips instead of
 * all 223 the test server holds.
 *
 * `levels` is the panel's toggle state. On v11 the same narrowing is an OData
 * `$filter` (so the depth counts MATCHING rows); here it is applied after
 * reading, because there is nothing to push it to — which also means the depth
 * counts matching rows on both paths.
 */
export async function fetchV12RunLogEntries(
  config: Tm1Config,
  opts: {
    top: number;
    ascending?: boolean;
    levels?: Record<string, boolean>;
    timeoutMs?: number;
    maxFiles?: number;
    /** Skip runs of `}` processes/chores BEFORE reading: the file name carries
     *  the object, and the file cap would otherwise fill with tooling runs (one
     *  test server held 32,000 of 33,873 such files, 2026-10-14). */
    hideControl?: boolean;
    /** Read only this chore's `ChoreLog_*` files — the file name carries the chore. */
    chore?: string;
  },
): Promise<V12FetchResult> {
  const listed = await listRunLogFiles(config, opts.timeoutMs);
  const chore = opts.chore?.toLowerCase();
  const files = chore !== undefined
    ? listed.filter(f => f.kind === 'chore' && f.object.toLowerCase() === chore)
    : opts.hideControl ? listed.filter(f => !f.object.startsWith('}')) : listed;
  const cap = Math.min(files.length, Math.max(1, opts.maxFiles ?? MAX_RUN_LOG_FILES));
  const wanted = (e: V12LogEntry): boolean =>
    !opts.levels || opts.levels[levelToggleFor(e.Level)] !== false;

  // Per FILE, not one flat list: the depth has to cut between runs, never inside
  // one. A file IS a run — cutting it in half leaves a start with no end (`running`
  // forever) or an end with no start (a truncated stray root), which is the exact
  // damage the window is supposed to avoid.
  const perFile: V12LogEntry[][] = [];
  let collected = 0;
  let filesRead = 0;
  for (let i = 0; i < cap && collected < opts.top; i += FETCH_CONCURRENCY) {
    const batch = files.slice(i, Math.min(i + FETCH_CONCURRENCY, cap));
    const results = await Promise.all(batch.map(f => readRunLog(f, config, opts.timeoutMs)));
    filesRead += batch.length;
    for (const entries of results) {
      const kept = opts.levels ? entries.filter(wanted) : entries;
      if (kept.length === 0) { continue; }
      perFile.push(kept);
      collected += kept.length;
    }
  }

  // Whole files, newest run first, until the depth is reached — the first file is
  // always kept, so a depth smaller than one run shows that run rather than
  // nothing. `perFile` is already newest-first (the file list is).
  const chosen: V12LogEntry[] = [];
  let droppedRuns = 0;
  for (const entries of perFile) {
    if (chosen.length > 0 && chosen.length + entries.length > opts.top) { droppedRuns++; continue; }
    chosen.push(...entries);
  }

  // Sort AFTER collecting, not per file: a run that started earlier can end after
  // one that started later, so the files interleave in time.
  const entries = sortEntriesByTime(chosen, opts.ascending === true);
  return {
    entries,
    filesAvailable: files.length,
    filesRead,
    truncated: filesRead < files.length || droppedRuns > 0,
  };
}

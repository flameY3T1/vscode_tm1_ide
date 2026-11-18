/** Pure helpers for message-log webview — no vscode dependencies. */
import { escapeODataKey } from '../utils/odataKey';

export const LEVEL_CLASS: Readonly<Record<string, string>> = Object.freeze({
  INFO:    'l-info',
  WARN:    'l-warn',
  WARNING: 'l-warn',
  ERROR:   'l-err',
  FATAL:   'l-err',
  DEBUG:   'l-dbg',
});

/** Return CSS class for a log level (case-insensitive). Defaults to `l-info`. */
export function levelClassFor(level: string | undefined): string {
  return LEVEL_CLASS[(level ?? '').toUpperCase()] ?? 'l-info';
}

/** Enrich raw log entry with display class. Pure. */
export function mapLogEntry<T extends { Level?: string }>(e: T): T & { LevelClass: string } {
  return { ...e, LevelClass: levelClassFor(e.Level) };
}

/**
 * Wrap TM1 process error-log filenames (TM1ProcessError_*.log/.txt) found in an
 * ALREADY-HTML-ESCAPED message string in a clickable `<span class="errlink">`.
 *
 * The filename embeds the process name, which may contain spaces and `#`
 * (e.g. `TM1ProcessError_<ts>_<id>_## test1.log`), so the body accepts any char
 * up to `.log`/`.txt` EXCEPT `&`, `<`, `>` and newline. Those three are exactly
 * what HTML-escaping turns surrounding markup into (`&lt;`/`&gt;`/`&amp;`), so
 * excluding them keeps the match inside the `<…>`-delimited filename and can't
 * swallow the escaped delimiters or produce broken/injected markup. The match is
 * lazy so two filenames on one line stay separate.
 *
 * The message-log webview bundle imports it too — single source of truth for
 * extension + webview.
 */
export function linkifyErrorLogFilenames(escapedMsg: string): string {
  return escapedMsg.replace(
    /TM1ProcessError_[^&<>\n]*?\.(?:log|txt)/g,
    (fn) => '<span class="errlink" data-file="' + fn + '">' + fn + '</span>',
  );
}

/**
 * Which TM1 log levels back each toolbar toggle.
 *
 * The four buttons are display buckets, not wire values: `levelClassFor` above
 * folds `Fatal` in with `Error` and lets anything unrecognised — TM1 writes a
 * literal `Unknown` on its first line — fall through to info. The server-side
 * filter has to fold identically, or a row would pass the toggle it is drawn
 * under and still be missing from the answer.
 */
const LEVELS_PER_TOGGLE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  info: Object.freeze(['Info', 'Unknown']),
  warn: Object.freeze(['Warning']),
  error: Object.freeze(['Error', 'Fatal']),
  debug: Object.freeze(['Debug']),
});

/**
 * Which toolbar toggle a wire level is drawn under — the same folding
 * `buildLevelFilter` pushes to the server, for the one path that cannot push it:
 * TM1 v12 has no message-log query to filter, so its run-log entries are sieved
 * client-side and MUST use this table, or a level would pass the toggle it is
 * drawn under on v11 and be dropped on v12.
 *
 * An unrecognised level folds into `info`, matching `levelClassFor`.
 */
export function levelToggleFor(level: string | undefined): string {
  const lv = (level ?? '').toLowerCase();
  for (const key of Object.keys(LEVELS_PER_TOGGLE)) {
    if (LEVELS_PER_TOGGLE[key].some((l) => l.toLowerCase() === lv)) { return key; }
  }
  return 'info';
}

/**
 * OData namespace of TM1's `LogLevel` enum, read off `$metadata` on 11.8:
 * `Fatal=0, Error=1, Warning=2, Info=3, Debug=4, Unknown=5, Off=6`.
 */
const LOG_LEVEL_ENUM = 'ibm.tm1.api.v1.LogLevel';

/**
 * Build the `$filter` that narrows `MessageLogEntries` to the wanted levels, so
 * the `$top` window counts MATCHING rows instead of recent ones — asking for 200
 * errors reaches back as far as it must, rather than sieving the last 200 lines
 * and finding four.
 *
 * Returns `undefined` when every level is wanted (send no `$filter` at all — the
 * cheapest query and the one behaviour we know from before), and `null` when no
 * level is wanted, which the caller must read as "skip the request entirely";
 * an empty `$filter` string would silently mean "everything".
 *
 * ⚠️ The enum literal MUST be namespace-qualified. Measured live on 11.8:
 * `Level eq 'Error'` answers HTTP 200 with an EMPTY result set, and
 * `Level ne 'Info'` answers HTTP 200 with ALL 54017 rows — TM1 drops a
 * predicate it cannot type instead of rejecting it. Only
 * `Level eq ibm.tm1.api.v1.LogLevel'Error'` actually selects. A wrong *type*
 * name is loud (HTTP 501 `functionExpr not currently supported`), so the caller
 * can fall back on the error; a wrong *literal form* is silent, so it must not
 * be reachable from here.
 */
export function buildLevelFilter(enabled: Record<string, boolean>): string | undefined | null {
  const keys = Object.keys(LEVELS_PER_TOGGLE);
  const wanted = keys.filter((k) => enabled[k]);
  if (wanted.length === keys.length) { return undefined; }
  if (wanted.length === 0) { return null; }
  const terms = wanted.flatMap((k) => LEVELS_PER_TOGGLE[k].map((lv) => `Level eq ${LOG_LEVEL_ENUM}'${lv}'`));
  return `(${terms.join(' or ')})`;
}

/**
 * Build the `$filter` that leaves the given loggers OUT, so the `$top` window
 * counts rows of the wanted sources — the same reason `buildLevelFilter` exists.
 *
 * An exclusion chain rather than an `eq` list on purpose: a logger nobody has
 * seen yet stays visible. Measured live on 11.8 (two servers, 2026-11-15):
 * `Logger ne 'X'` and `Logger eq 'X'` both select, an unknown name answers zero
 * rows (TM1 does NOT drop this predicate the way it drops an unqualified level
 * literal), the chain combines with the level filter via `and`, and the empty
 * name — TM1 writes one such line with level `Unknown` — works as `''`.
 *
 * Returns `undefined` for an empty list: send no `$filter` at all.
 */
export function buildLoggerFilter(excluded: readonly string[]): string | undefined {
  if (excluded.length === 0) { return undefined; }
  return '(' + excluded.map((n) => `Logger ne '${escapeODataKey(n)}'`).join(' and ') + ')';
}

/** A logger that has rows in the message log, with the timestamp of its newest one. */
export interface KnownLogger { name: string; last: string }

/** Upper bound of `walkLoggers`; the two live servers hold 10 and 14 loggers with rows. */
export const LOGGER_WALK_CAP = 60;

/**
 * Find every logger that has at least one row, newest first.
 *
 * `GET /Loggers` is no help: it lists 1196 configurable names on 11.8, of which
 * 10 to 14 ever wrote a line. So ask for the newest row, then for the newest row
 * outside the loggers found so far, until nothing is left — one request per
 * logger plus one. Measured 2026-11-15: 1.3 s in total on a log of 41,060 rows,
 * 19.5 s on one of 689,169 rows (every step scans, 1.3 to 3.4 s each).
 *
 * Answers `true` when the walk reached the end, `false` when it stopped early:
 * at the cap, or because the server handed back a logger that was excluded
 * (a server that ignores the predicate would otherwise loop forever).
 */
export async function walkLoggers(
  newestOutside: (excluded: readonly string[]) => Promise<{ Logger?: string; TimeStamp?: string } | undefined>,
  onFound: (logger: KnownLogger) => void,
  cap: number = LOGGER_WALK_CAP,
): Promise<boolean> {
  const found: string[] = [];
  while (found.length < cap) {
    const row = await newestOutside(found);
    if (!row) { return true; }
    const name = row.Logger ?? '';
    if (found.includes(name)) { return false; }
    found.push(name);
    onFound({ name, last: row.TimeStamp ?? '' });
  }
  return false;
}

/**
 * Can the server startup analysis run against this server?
 *
 * Only on v11/PA. A startup writes its lines (`TM1.Server`, `TM1 Server is
 * ready`) to the SERVER log, and v12 exposes no server log over REST — measured
 * live on 12.5.9, 2026-08-26: every message-log endpoint answers empty, and the
 * only log material it hands out is one file per process/chore RUN, in which a
 * startup leaves no trace. The startup view therefore has nothing to read there,
 * and the answer is version-based, not a failed request away.
 */
export function isStartupAnalysisAvailable(version: string | undefined): boolean {
  return version !== 'v12';
}

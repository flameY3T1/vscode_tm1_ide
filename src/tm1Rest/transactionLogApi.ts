/**
 * `TransactionLogEntries` — TM1's log of cell changes.
 *
 * Measured live on 2026-09-22 against 11.8.02900.8; the evidence is in
 * `docs/architecture/tm1-rest-quirks.md`. The three points that shape the
 * structure of this module:
 *
 * 1. **`ID` is NOT a key.** The field counts the rows delivered within the
 *    session: the same time window with `$top=3` and `$top=6` gave, for the
 *    same timestamps, first 29000-29002, then 29003-29008.
 *    `$orderby=ID desc` is rejected (`400 Code 278`). That is why `ID` does
 *    not appear in the type below — anyone reading it is building on sand.
 *    Paging and refreshing go through `TimeStamp`.
 * 2. **No substring search in the values.** `contains(NewValue,…)` answers
 *    `400 Code 278` (the first parameter is not a string). Equality works,
 *    and for element names `Tuple/any(t: t eq '<Element>')`.
 * 3. **Payload linear, server time flat.** 1000 rows 271 KB in 8 ms,
 *    10000 rows 2.79 MB in 64 ms. The expensive part is rendering, not
 *    fetching — but a time window is mandatory, otherwise the UI would pull
 *    a log that runs into the millions on a server that has been running
 *    for a while.
 */
import { escapeODataKey } from '../utils/odataKey';
import { apiRequest } from './client';
import { parseBody } from './parseRest';
import type { Tm1Config } from './transport/types';
import { isOk, Tm1HttpError } from './httpError';

/**
 * A log row in wire notation. `ID` and `ChangeSetID` are missing on
 * purpose: the former is a session counter (see the header comment), the
 * latter came back consistently empty on 11.8.
 */
export interface TransactionLogEntry {
  TimeStamp?: string;
  ReplicationTime?: string;
  User?: string;
  Cube?: string;
  /** One element name per cube dimension, in dimension order. */
  Tuple?: string[];
  OldValue?: string | number | null;
  NewValue?: string | number | null;
  StatusMessage?: string | null;
}

/** What the UI queries for. `fromIso` is mandatory — there is no window without a start. */
export interface TransactionLogQuery {
  /** Lower window bound, ISO-8601 with `Z`. */
  fromIso: string;
  /** Upper window bound; absent = up to now. */
  toIso?: string;
  /** Exact cube name (equality, not a substring). */
  cube?: string;
  /** Exact user name. */
  user?: string;
  /** Exact element name, checked against every position of the tuple. */
  element?: string;
  /** Include control cubes (`}…`). Off = `not startswith(Cube,'}')`. */
  includeControl?: boolean;
  top: number;
}

export interface TransactionLogResult {
  entries: TransactionLogEntry[];
  /** Total matches in the window, from `$count=true` — more than `entries.length` when `top` truncates. */
  total: number;
}

/** OData string literal. `escapeODataKey` does the doubling, not this file. */
function lit(s: string): string {
  return `'${escapeODataKey(s)}'`;
}

/**
 * Builds the `$filter`. Pure and therefore tested in isolation
 * (`src/test/commands/transactionLog.test.ts`) — every sub-expression here
 * has been checked live against a nonsense value that returns 0, so that
 * "takes effect" does not mean "gets silently ignored".
 */
export function buildTransactionLogFilter(q: TransactionLogQuery): string {
  const parts = [`TimeStamp ge ${q.fromIso}`];
  if (q.toIso) { parts.push(`TimeStamp le ${q.toIso}`); }
  if (q.cube) { parts.push(`Cube eq ${lit(q.cube)}`); }
  if (q.user) { parts.push(`User eq ${lit(q.user)}`); }
  if (q.element) { parts.push(`Tuple/any(t: t eq ${lit(q.element)})`); }
  // Control cubes: client and dimension properties always log along with it
  // and make up the majority of the rows on a quiet server.
  if (!q.includeControl) { parts.push(`not startswith(Cube,'}')`); }
  return parts.join(' and ');
}

/** The path for the query — separated from fetching so the guard test can read it. */
export function buildTransactionLogPath(q: TransactionLogQuery): string {
  return 'TransactionLogEntries'
    + '?$orderby=TimeStamp desc'
    + `&$top=${Math.max(1, Math.trunc(q.top))}`
    + '&$count=true'
    + '&$filter=' + encodeURIComponent(buildTransactionLogFilter(q));
}

/**
 * Fetches the newest window. Throws on non-2xx (the caller shows the
 * message) — deliberately strict here, unlike `parseBodySafe`: an empty
 * result and a rejected filter would otherwise look the same in the table.
 */
export async function fetchTransactionLogEntries(
  config: Tm1Config,
  q: TransactionLogQuery,
  timeoutMs?: number,
): Promise<TransactionLogResult> {
  const res = await apiRequest('GET', buildTransactionLogPath(q), undefined, timeoutMs, config);
  if (!isOk(res)) {
    throw new Tm1HttpError(`HTTP ${res.statusCode}: ${res.body.slice(0, 400)}`, res.statusCode);
  }
  // parseBody, not JSON.parse: at 10000 rows that is 2.79 MB that would
  // otherwise live on as a raw string alongside the parsed structure.
  const parsed = parseBody<{ value?: TransactionLogEntry[]; '@odata.count'?: number }>(res);
  const entries = parsed.value ?? [];
  return { entries, total: parsed['@odata.count'] ?? entries.length };
}

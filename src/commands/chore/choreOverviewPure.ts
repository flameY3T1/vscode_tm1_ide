/**
 * Pure helpers for the Chore Overview panel — no vscode dependencies.
 *
 * TM1 chore schedule fields:
 *  - Frequency is an ISO-8601-ish duration `P<d>DT<h>H<m>M<s>S`
 *    (e.g. `P0DT00H15M00S` = every 15 minutes, `P1DT00H00M00S` = daily).
 *  - StartTime is a datetime string; only the time-of-day matters for a schedule.
 */

import type { ChoreOverviewRow } from '../../chore/choreTablePure';
import { formatEpochMinute, formatDurationSec, type RunStats } from '../../tm1Rest/runStats';

const EMPTY = '—';

/** Parse a TM1 Frequency duration into a compact human string. */
export function formatFrequency(freq: string | null | undefined): string {
  if (!freq) { return EMPTY; }
  const m = /^P(\d+)DT(\d+)H(\d+)M(\d+)S$/.exec(freq.trim());
  if (!m) { return freq; }
  const [d, h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  const parts: string[] = [];
  if (d) { parts.push(d + 'd'); }
  if (h) { parts.push(h + 'h'); }
  if (min) { parts.push(min + 'm'); }
  if (s) { parts.push(s + 's'); }
  return parts.length ? parts.join(' ') : EMPTY;
}

/**
 * Time-of-day (HH:MM) of a TM1 StartTime, in LOCAL time.
 *
 * The chore EDITOR shows this field in UTC, because that is how TM1 stores and
 * takes it back. The overview does not: it puts this column next to a "Last run"
 * read out of the message log, which is an absolute instant shown locally, and
 * two adjacent time columns in different zones read as a bug.
 */
export function formatStartTime(startTime: string | null | undefined): string {
  if (!startTime) { return EMPTY; }
  const a = parseAnchor(startTime);
  if (a) {
    const d = new Date(a.epoch);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  const trimmed = startTime.trim();
  return trimmed || EMPTY;
}

/** Parse a TM1 StartTime datetime into an absolute epoch (ms) + its TZ offset (min). */
function parseAnchor(startTime: string): { epoch: number; offMin: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/.exec(startTime);
  if (!m) { return null; }
  const [, y, mo, d, hh, mi, ss, tz] = m;
  let offMin = 0;
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    offMin = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(4, 6), 10));
  }
  const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mi, ss ? +ss : 0);
  return { epoch: utcMs - offMin * 60000, offMin };
}

/** Convert a TM1 Frequency duration `P<d>DT<h>H<m>M<s>S` to milliseconds (null if unparseable). */
function frequencyMs(freq: string): number | null {
  const m = /^P(\d+)DT(\d+)H(\d+)M(\d+)S$/.exec(freq);
  if (!m) { return null; }
  const [, d, h, min, s] = m;
  return (((+d * 24 + +h) * 60 + +min) * 60 + +s) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Absolute epoch (ms) of the next run, or null for missing/zero frequency. */
function nextRunEpoch(
  startTime: string | null | undefined,
  freq: string | null | undefined,
  now: Date,
): number | null {
  if (!startTime || !freq) { return null; }
  const a = parseAnchor(startTime);
  const fm = frequencyMs(freq);
  if (!a || fm === null || fm <= 0) { return null; }
  const nowMs = now.getTime();
  const k = a.epoch >= nowMs ? 0 : Math.ceil((nowMs - a.epoch) / fm);
  return a.epoch + k * fm;
}

/**
 * Compute the next scheduled run of a chore. TM1 REST returns StartTime as the
 * fixed anchor (it never advances server-side — verified live on 11.8), so the
 * next run is `anchor + k·Frequency` for the smallest k ≥ 0 that lands ≥ now.
 * Returns "—" for missing/zero-frequency chores (run-once or never).
 *
 * Shares `formatEpochMinute` with the "Last run" column ON PURPOSE: the two
 * columns sit side by side, so one formatter means they can never drift apart in
 * layout or in time zone.
 */
export function computeNextRun(
  startTime: string | null | undefined,
  freq: string | null | undefined,
  now: Date = new Date(),
): string {
  const epoch = nextRunEpoch(startTime, freq, now);
  if (epoch === null) { return EMPTY; }
  return formatEpochMinute(epoch / 1000);
}

/** Map raw chore records to display rows for the overview table. */
export function buildOverviewRows(
  chores: Array<{
    Name: string;
    Active?: boolean;
    StartTime?: string | null;
    Frequency?: string | null;
    ExecutionMode?: string | null;
  }>,
  opts: {
    now?: Date;
    stats?: ReadonlyMap<string, RunStats>;
    /** UI wording for `RunStats.state`; the caller owns localisation. */
    stateLabels?: Record<'finished' | 'running', string>;
  } = {},
): ChoreOverviewRow[] {
  const now = opts.now ?? new Date();
  return chores.map(c => {
    const fm = c.Frequency ? frequencyMs(c.Frequency) : null;
    const st = opts.stats?.get(c.Name);
    return {
      name: c.Name,
      active: !!c.Active,
      startTime: formatStartTime(c.StartTime),
      frequency: formatFrequency(c.Frequency),
      executionMode: c.ExecutionMode ? String(c.ExecutionMode) : EMPTY,
      nextRun: computeNextRun(c.StartTime, c.Frequency, now),
      frequencyMs: fm !== null && fm > 0 ? fm : null,
      nextRunMs: nextRunEpoch(c.StartTime, c.Frequency, now),
      lastRun: st?.lastEnd ? formatEpochMinute(st.lastEnd) : EMPTY,
      lastRunMs: st?.lastEnd ? st.lastEnd * 1000 : null,
      duration: st?.duration !== undefined ? formatDurationSec(st.duration) : EMPTY,
      durationSec: st?.duration ?? null,
      lastState: st?.state ? (opts.stateLabels?.[st.state] ?? st.state) : EMPTY,
      anchorMs: c.StartTime ? parseAnchor(c.StartTime)?.epoch ?? null : null,
    };
  });
}

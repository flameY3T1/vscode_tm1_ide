/**
 * Chore overview rows and the helpers the overview window runs on them —
 * sorting and the calendar. Shared by the host (commands/chore/) and the
 * webview bundle (webviewClient/choreOverview/), which may not import
 * commands/. No vscode, no REST.
 */

// Shared "placeholders sort last" rule — same definition the object overviews use.
import { isPlaceholderText } from '../webviews/objectOverview/overviewSortPure';

export interface ChoreOverviewRow {
  name: string;
  active: boolean;
  /** Compact start time, e.g. "21:00" or "—". */
  startTime: string;
  /** Compact frequency, e.g. "15m", "1d", "1d 2h" or "—". */
  frequency: string;
  /** Raw ExecutionMode ("SingleCommit"/"MultipleCommit") or "—". */
  executionMode: string;
  /** Next scheduled run, e.g. "Fri 17.07.26 21:00" or "—". */
  nextRun: string;
  /** Raw frequency in ms behind `frequency`; null when unscheduled. Sort key. */
  frequencyMs: number | null;
  /** Raw epoch (ms) behind `nextRun`; null when unscheduled. Sort key. */
  nextRunMs: number | null;
  /** End of the last run, e.g. "2026-09-18 21:00" or "—". */
  lastRun: string;
  /** Raw epoch (ms) behind `lastRun`; null when never run / stats off. Sort key. */
  lastRunMs: number | null;
  /** Duration of the last run, e.g. "2m 03s" or "—". */
  duration: string;
  /** Raw seconds behind `duration`; null when unknown. Sort key. */
  durationSec: number | null;
  /**
   * Whether the last run has ENDED ("finished"/"running"), or "—" when the log
   * says nothing. Deliberately not "success" — no TM1 source reports that, see
   * `tm1Rest/runStats.ts`.
   */
  lastState: string;
  /** Absolute epoch (ms) of the schedule anchor (StartTime); null when unparseable. Calendar input. */
  anchorMs: number | null;
}

/**
 * Comparator for the overview table. `frequency` and `nextRun` display
 * formatted strings ("15m", "Mon 27.07.26 23:00") whose text order is
 * meaningless — they sort on their raw ms values instead. Same for the two
 * last-run columns ("2m 03s" would sort before "9s"). `nextRun` and `lastRun`
 * are zero-padded `YYYY-MM-DD HH:mm`, whose text order IS chronological, but
 * they still sort on their raw keys so that "—" and a real date cannot mix. `startTime` is
 * zero-padded "HH:MM", so its text order already matches clock order.
 * Unscheduled rows stay last in both directions — whether they show up as a
 * null raw value (`frequencyMs`/`nextRunMs`) or as the "—" placeholder string
 * (`startTime`, `executionMode`, which have no raw counterpart).
 */
export function compareChoreRows(
  a: ChoreOverviewRow,
  b: ChoreOverviewRow,
  sortKey: string,
  dir: 'asc' | 'desc',
): number {
  const RAW: Record<string, string> = {
    frequency: 'frequencyMs', nextRun: 'nextRunMs',
    lastRun: 'lastRunMs', duration: 'durationSec',
  };
  const field = RAW[sortKey] || sortKey;
  const pick = (r: ChoreOverviewRow) => {
    const v = (r as unknown as Record<string, unknown>)[field];
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  };
  const va = pick(a);
  const vb = pick(b);
  const ea = va === null || va === undefined;
  const eb = vb === null || vb === undefined;
  if (ea || eb) { return ea && eb ? 0 : (ea ? 1 : -1); }
  const sign = dir === 'asc' ? 1 : -1;
  if (typeof va === 'string' && typeof vb === 'string') {
    // "—" (no schedule / no mode) is not a value: ICU ranks the em dash before
    // digits and letters, so without this it would head an ascending sort.
    const pa = isPlaceholderText(va);
    const pb = isPlaceholderText(vb);
    if (pa !== pb) { return pa ? 1 : -1; }
    return va.localeCompare(vb) * sign;
  }
  return ((va as number) - (vb as number)) * sign;
}

/**
 * Scheduled starts of one chore inside `[fromMs, toMs)`: `anchor + k·freq`.
 * At most `cap` of them — a one-minute chore over a week would be 10 080 marks,
 * which nobody reads; the calendar shows a band instead once the cap is hit.
 *
 * Ignores DST sensitivity (`DSTSensitive`): a chore that shifts with daylight
 * saving shows one hour off for the other half of the year. The overview's
 * "Next run" column has the same simplification.
 */
export function plannedStarts(anchorMs: number, freqMs: number, fromMs: number, toMs: number, cap: number): number[] {
  if (!(freqMs > 0)) { return anchorMs >= fromMs && anchorMs < toMs ? [anchorMs] : []; }
  const k0 = Math.max(0, Math.ceil((fromMs - anchorMs) / freqMs));
  const out: number[] = [];
  for (let t = anchorMs + k0 * freqMs; t < toMs && out.length < cap; t += freqMs) { out.push(t); }
  return out;
}

/**
 * Indexes of intervals that overlap at least one interval of ANOTHER chore.
 * Same-chore overlaps do not count: TM1 does not start a chore that is still
 * running, so they only arise from a planned bar drawn with the last duration.
 */
export function overlappingIntervals(items: Array<{ name: string; s: number; e: number }>): Set<number> {
  const order = items.map((_, i) => i).sort((a, b) => items[a].s - items[b].s);
  const hit = new Set<number>();
  const active: number[] = [];
  for (const i of order) {
    for (let j = active.length - 1; j >= 0; j--) {
      if (items[active[j]].e <= items[i].s) { active.splice(j, 1); }
    }
    for (const j of active) {
      if (items[j].name !== items[i].name) { hit.add(i); hit.add(j); }
    }
    active.push(i);
  }
  return hit;
}

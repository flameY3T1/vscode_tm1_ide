import { describe, it, expect } from 'vitest';
import { formatFrequency, formatStartTime, buildOverviewRows, computeNextRun } from '../commands/chore/choreOverviewPure';
import { compareChoreRows } from '../chore/choreTablePure';
import type { ChoreOverviewRow } from '../chore/choreTablePure';

const NOW = new Date('2026-07-17T15:13:00Z'); // a Friday (verified live vs test server)

describe('formatFrequency', () => {
  it('minutes-only', () => { expect(formatFrequency('P0DT00H15M00S')).toBe('15m'); });
  it('hours-only', () => { expect(formatFrequency('P0DT01H00M00S')).toBe('1h'); });
  it('daily', () => { expect(formatFrequency('P1DT00H00M00S')).toBe('1d'); });
  it('weekly', () => { expect(formatFrequency('P7DT00H00M00S')).toBe('7d'); });
  it('combined d/h/m', () => { expect(formatFrequency('P1DT02H30M00S')).toBe('1d 2h 30m'); });
  it('seconds included', () => { expect(formatFrequency('P0DT00H00M45S')).toBe('45s'); });
  it('all-zero → dash', () => { expect(formatFrequency('P0DT00H00M00S')).toBe('—'); });
  it('null → dash', () => { expect(formatFrequency(null)).toBe('—'); });
  it('undefined → dash', () => { expect(formatFrequency(undefined)).toBe('—'); });
  it('unparseable → raw', () => { expect(formatFrequency('weird')).toBe('weird'); });
});

describe('formatStartTime', () => {
  // setup.ts pins TZ=Europe/Berlin, so these assert the LOCAL clock: +01:00 in
  // November, +02:00 in July. A regression to UTC formatting fails them.
  it('zoneless datetime is read as UTC, shown local', () => { expect(formatStartTime('2020-11-05T21:00:00')).toBe('22:00'); });
  it('with timezone offset → normalised to the local zone', () => { expect(formatStartTime('2020-11-05T09:30:00+01:00')).toBe('09:30'); });
  it('null → dash', () => { expect(formatStartTime(null)).toBe('—'); });
  it('empty → dash', () => { expect(formatStartTime('')).toBe('—'); });
  it('no T-time → raw', () => { expect(formatStartTime('sometime')).toBe('sometime'); });
});

describe('buildOverviewRows', () => {
  it('maps and formats fields (incl. next run)', () => {
    const rows = buildOverviewRows([
      { Name: 'Load', Active: true, StartTime: '2020-11-05T21:00:00', Frequency: 'P0DT00H15M00S', ExecutionMode: 'SingleCommit' },
      { Name: 'Idle', Active: false },
    ], { now: NOW });
    expect(rows).toEqual([
      {
        name: 'Load', active: true, startTime: '22:00', frequency: '15m',
        executionMode: 'SingleCommit', nextRun: '2026-07-17 17:15',
        frequencyMs: 15 * 60_000, nextRunMs: Date.UTC(2026, 6, 17, 15, 15),
        lastRun: '—', lastRunMs: null, duration: '—', durationSec: null,
        lastState: '—', anchorMs: 1604610000000,
      },
      {
        name: 'Idle', active: false, startTime: '—', frequency: '—',
        executionMode: '—', nextRun: '—', frequencyMs: null, nextRunMs: null,
        lastRun: '—', lastRunMs: null, duration: '—', durationSec: null,
        lastState: '—', anchorMs: null,
      },
    ]);
  });

  it('folds run stats into the last-run columns, dash where the cube knows nothing', () => {
    const rows = buildOverviewRows(
      [{ Name: 'Load', Active: true }, { Name: 'Never', Active: true }],
      {
        now: NOW,
        // 2026-07-17 13:00 UTC; formatted in LOCAL time, so assert on the raw key.
        stats: new Map([['Load', { lastEnd: 1_784_638_800, duration: 123, state: 'finished' as const }]]),
        stateLabels: { finished: 'beendet', running: 'laeuft' },
      },
    );
    expect(rows[0].lastRunMs).toBe(1_784_638_800_000);
    expect(rows[0].duration).toBe('2m 03s');
    expect(rows[0].durationSec).toBe(123);
    expect(rows[0].lastState).toBe('beendet');
    expect(rows[1]).toMatchObject({ lastRun: '—', lastRunMs: null, duration: '—', lastState: '—' });
  });

  it('emits null raw sort values for a zero-frequency (run-once) chore', () => {
    const [row] = buildOverviewRows(
      [{ Name: 'Once', Active: true, StartTime: '2020-11-05T21:00:00', Frequency: 'P0DT00H00M00S' }],
      { now: NOW },
    );
    expect(row.frequency).toBe('—');
    expect(row.frequencyMs).toBeNull();
    expect(row.nextRunMs).toBeNull();
  });
});

describe('compareChoreRows', () => {
  const row = (over: Partial<ChoreOverviewRow>): ChoreOverviewRow => ({
    name: 'x', active: true, startTime: '—', frequency: '—',
    executionMode: '—', nextRun: '—', frequencyMs: null, nextRunMs: null,
    lastRun: '—', lastRunMs: null, duration: '—', durationSec: null,
    lastState: '—', anchorMs: null,
    ...over,
  });
  const order = (rows: ChoreOverviewRow[], key: string, dir: 'asc' | 'desc') =>
    rows.slice().sort((a, b) => compareChoreRows(a, b, key, dir)).map(r => r.name);

  it('sorts frequency by duration, not by its label', () => {
    // Text order would be "1d 2h" < "15m" < "45s" — all three are wrong.
    const rows = [
      row({ name: 'day', frequency: '1d 2h', frequencyMs: 26 * 3_600_000 }),
      row({ name: 'sec', frequency: '45s', frequencyMs: 45_000 }),
      row({ name: 'min', frequency: '15m', frequencyMs: 900_000 }),
    ];
    expect(order(rows, 'frequency', 'asc')).toEqual(['sec', 'min', 'day']);
    expect(order(rows, 'frequency', 'desc')).toEqual(['day', 'min', 'sec']);
  });

  it('sorts nextRun chronologically, not by weekday name', () => {
    // Text order would start at "Fri …" because the label leads with the weekday.
    const rows = [
      row({ name: 'tue', nextRun: 'Tue 28.07.26 14:30', nextRunMs: Date.UTC(2026, 6, 28, 14, 30) }),
      row({ name: 'fri', nextRun: 'Fri 31.07.26 06:00', nextRunMs: Date.UTC(2026, 6, 31, 6, 0) }),
      row({ name: 'mon', nextRun: 'Mon 27.07.26 23:00', nextRunMs: Date.UTC(2026, 6, 27, 23, 0) }),
    ];
    expect(order(rows, 'nextRun', 'asc')).toEqual(['mon', 'tue', 'fri']);
    expect(order(rows, 'nextRun', 'desc')).toEqual(['fri', 'tue', 'mon']);
  });

  it('keeps unscheduled chores last in both directions', () => {
    const rows = [
      row({ name: 'none' }),
      row({ name: 'min', frequency: '15m', frequencyMs: 900_000 }),
      row({ name: 'day', frequency: '1d', frequencyMs: 86_400_000 }),
    ];
    expect(order(rows, 'frequency', 'asc')).toEqual(['min', 'day', 'none']);
    expect(order(rows, 'frequency', 'desc')).toEqual(['day', 'min', 'none']);
  });

  it('keeps the "—" placeholder last for startTime in both directions', () => {
    // '—'.localeCompare('21:00') === -1 — plain ICU order stacks unscheduled
    // chores at the TOP ascending, the opposite of the Frequency column.
    expect('—'.localeCompare('21:00')).toBe(-1);
    const rows = [
      row({ name: 'none' }),                        // startTime '—'
      row({ name: 'late', startTime: '21:00' }),
      row({ name: 'early', startTime: '09:05' }),
    ];
    expect(order(rows, 'startTime', 'asc')).toEqual(['early', 'late', 'none']);
    expect(order(rows, 'startTime', 'desc')).toEqual(['late', 'early', 'none']);
  });

  it('keeps the "—" placeholder last for executionMode in both directions', () => {
    const rows = [
      row({ name: 'none' }),                        // executionMode '—'
      row({ name: 'single', executionMode: 'SingleCommit' }),
      row({ name: 'multi', executionMode: 'MultipleCommit' }),
    ];
    expect(order(rows, 'executionMode', 'asc')).toEqual(['multi', 'single', 'none']);
    expect(order(rows, 'executionMode', 'desc')).toEqual(['single', 'multi', 'none']);
  });

  it('still compares text columns as text and flags as booleans', () => {
    const rows = [
      row({ name: 'beta', active: false, startTime: '09:05' }),
      row({ name: 'alpha', active: true, startTime: '21:00' }),
    ];
    expect(order(rows, 'name', 'asc')).toEqual(['alpha', 'beta']);
    expect(order(rows, 'name', 'desc')).toEqual(['beta', 'alpha']);
    expect(order(rows, 'startTime', 'asc')).toEqual(['beta', 'alpha']);
    expect(order(rows, 'active', 'desc')).toEqual(['alpha', 'beta']);
  });
});

describe('computeNextRun', () => {
  it('future anchor → returns anchor itself (k=0)', () => {
    expect(computeNextRun('2030-06-14T06:00:00', 'P1DT00H00M00S', NOW)).toBe('2030-06-14 08:00');
  });
  it('past daily anchor → advances to today', () => {
    // 21:00+01:00 = 20:00Z; now 15:13Z is earlier → next run today 20:00Z = 22:00 local
    expect(computeNextRun('2020-11-05T21:00:00+01:00', 'P1DT00H00M00S', NOW)).toBe('2026-07-17 22:00');
  });
  it('sub-day hourly anchor → next hour boundary', () => {
    expect(computeNextRun('2026-07-17T10:00:00Z', 'P0DT01H00M00S', NOW)).toBe('2026-07-17 18:00');
  });
  it('multi-day (30d) anchor advances by whole periods', () => {
    expect(computeNextRun('2026-07-01T05:00:00Z', 'P30DT00H00M00S', NOW)).toBe('2026-07-31 07:00');
  });
  it('uses the same format as the "Last run" column', () => {
    // Both columns render through formatEpochMinute — asserted here so the two
    // cannot drift apart again (they showed different formats AND zones once).
    const [row] = buildOverviewRows(
      [{ Name: 'C', Active: true, StartTime: '2030-06-14T06:00:00', Frequency: 'P1DT00H00M00S' }],
      { now: NOW, stats: new Map([['C', { lastEnd: 1_784_638_800, state: 'finished' as const }]]) },
    );
    const shape = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    expect(row.nextRun).toMatch(shape);
    expect(row.lastRun).toMatch(shape);
  });
  it('zero frequency → dash (run-once/never)', () => {
    expect(computeNextRun('2020-11-05T21:00:00', 'P0DT00H00M00S', NOW)).toBe('—');
  });
  it('null start → dash', () => { expect(computeNextRun(null, 'P1DT00H00M00S', NOW)).toBe('—'); });
  it('null frequency → dash', () => { expect(computeNextRun('2020-11-05T21:00:00', null, NOW)).toBe('—'); });
});

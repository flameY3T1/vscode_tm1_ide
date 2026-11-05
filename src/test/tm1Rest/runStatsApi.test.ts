import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatDurationSec, formatEpochMinute, parseChoreRunLog, parseChoreRunLogCounted,
} from '../../tm1Rest/runStats';

const apiRequest = vi.fn();
vi.mock('../../tm1Rest/client', () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));

import { fetchProcessRunStats, fetchChoreRunStats, fetchCubeLoadStates } from '../../tm1Rest/runStatsApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG = { serverUrl: 'https://h:1/api/v1', username: 'u', password: 'p', authType: 'basic' } as unknown as Tm1Config;

/**
 * Answer the three calls `executeMdx` makes (POST /ExecuteMDX → GET …/Cells/$count
 * → GET the cellset) with a cellset holding the two time measures on axis 0 and one
 * tuple per process on axis 1. The third axis is the WHERE slicer — `parseCellset`
 * only treats axis 1 as ROWS when three axes are present.
 */
function mockCellset(rows: Array<[string, Array<number | null>]>, measures = ['Last Start Time', 'Last End Time']): void {
  const cellset = {
    Cells: rows.flatMap(([, vals], r) =>
      vals.map((v, c) => ({ Ordinal: r * measures.length + c, Value: v, FormattedValue: '0,00' }))),
    Axes: [
      { Ordinal: 0, Hierarchies: [{ Name: '}StatsByProcess' }], Tuples: measures.map(m => ({ Members: [{ Name: m }] })) },
      { Ordinal: 1, Hierarchies: [{ Name: '}Processes' }], Tuples: rows.map(([name]) => ({ Members: [{ Name: name }] })) },
      { Ordinal: 2, Hierarchies: [{ Name: '}TimeIntervals' }], Tuples: [{ Members: [{ Name: 'LATEST' }] }] },
    ],
  };
  apiRequest.mockImplementation((_m: string, path: string) => {
    if (path === 'ExecuteMDX') { return Promise.resolve({ statusCode: 201, body: JSON.stringify({ ID: 'cs1' }) }); }
    if (path.includes('$count')) { return Promise.resolve({ statusCode: 200, body: String(rows.length * measures.length) }); }
    return Promise.resolve({ statusCode: 200, body: JSON.stringify(cellset) });
  });
}

describe('fetchProcessRunStats', () => {
  beforeEach(() => { apiRequest.mockReset(); });

  it('derives the duration from end minus start (11.8 leaves Last Duration null)', async () => {
    mockCellset([['__sleep', [1_789_753_079, 1_789_753_082]]]);
    const out = await fetchProcessRunStats(CFG);
    expect(out.get('__sleep')).toEqual({ lastEnd: 1_789_753_082, duration: 3, state: 'finished' });
    const body = String(apiRequest.mock.calls[0][2]);
    expect(body).toContain('[}StatsByProcess]');
    expect(body).toContain('[}TimeIntervals].[LATEST]');
  });

  it('keeps a run without a start time, and skips a row with no end time', async () => {
    mockCellset([['noStart', [null, 1_789_753_082]], ['never', [null, null]]]);
    const out = await fetchProcessRunStats(CFG);
    // An untouched cell arrives as null; Number(null) would be a finite 0.
    expect(out.get('noStart')).toEqual({ lastEnd: 1_789_753_082, duration: undefined, state: 'finished' });
    expect(out.has('never')).toBe(false);
  });

  it('returns an empty map when the control cube is missing', async () => {
    apiRequest.mockResolvedValue({ statusCode: 400, body: '{"error":{"code":"501","message":"object not found"}}' });
    expect((await fetchProcessRunStats(CFG)).size).toBe(0);
  });
});

describe('fetchChoreRunStats', () => {
  beforeEach(() => { apiRequest.mockReset(); });

  it('asks the message log for the chore logger only', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[]}' });
    await fetchChoreRunStats(CFG);
    const path = String(apiRequest.mock.calls[0][1]);
    expect(path).toContain("Logger eq 'TM1.Chore'");
    expect(path).toContain('$orderby=TimeStamp desc');
  });

  it('reports the oldest entry it read, so the UI can say how far back it looked', async () => {
    apiRequest.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [
        { TimeStamp: '2026-09-18T17:00:26.799Z', Message: 'Chore "C" finished executing' },
        { TimeStamp: '2026-05-15T18:20:04.124Z', Message: 'Registering chore: "C"' },
      ] }),
    });
    const out = await fetchChoreRunStats(CFG);
    expect(out.oldestEntry).toBe('2026-05-15T18:20:04.124Z');
    expect(out.stats.get('C')?.state).toBe('finished');
  });

  it('returns an empty map on a rejected query instead of throwing', async () => {
    apiRequest.mockResolvedValue({ statusCode: 400, body: '{"error":{"message":"bad filter"}}' });
    expect((await fetchChoreRunStats(CFG)).stats.size).toBe(0);
    apiRequest.mockRejectedValue(new Error('ECONNRESET'));
    expect((await fetchChoreRunStats(CFG)).stats.size).toBe(0);
  });
});

describe('parseChoreRunLog', () => {
  // Newest first — the order the REST call asks for. Wording copied verbatim
  // from the live log of the 11.8 test server.
  const entry = (timestamp: string, message: string) => ({ timestamp, message });

  it('pairs start, time and finish into one run', () => {
    const out = parseChoreRunLog([
      entry('2026-09-18T17:00:26.799Z', 'Chore "010_Import_All_Data" finished executing'),
      entry('2026-09-18T17:00:26.795Z', 'Chore "010_Import_All_Data" time = 22.39 seconds'),
      entry('2026-09-18T17:00:04.402Z', 'Chore "010_Import_All_Data" executed by scheduler'),
    ]);
    expect(out.get('010_Import_All_Data')).toEqual({
      lastEnd: Math.floor(Date.parse('2026-09-18T17:00:26.799Z') / 1000),
      duration: 22.39,
      state: 'finished',
    });
  });

  it('falls back to the start/finish span when TM1 omits the "time =" line', () => {
    // Measured: a run of 11 ms logs no "time =" entry at all.
    const out = parseChoreRunLog([
      entry('2026-09-18T17:42:54.788Z', 'Chore "020_SaveDataAll_stündlich" finished executing'),
      entry('2026-09-18T17:42:54.777Z', 'Chore "020_SaveDataAll_stündlich" executed by user "flameY3T1"'),
    ]);
    expect(out.get('020_SaveDataAll_stündlich')?.duration).toBeCloseTo(0.011, 3);
  });

  it('treats a same-millisecond "time =" after the finish line as that run, not a new one', () => {
    // Measured: both lines carry the same timestamp and `$orderby desc` may put
    // "time =" first, which a neighbour-pairing walk read as a second, open run.
    const out = parseChoreRunLog([
      entry('2026-09-18T14:11:12.758Z', 'Chore "990_Monthly_Backup" time = 0.00 seconds'),
      entry('2026-09-18T14:11:12.758Z', 'Chore "990_Monthly_Backup" finished executing'),
      entry('2026-09-18T14:11:12.757Z', 'Chore "990_Monthly_Backup" executed by scheduler'),
    ]);
    expect(out.get('990_Monthly_Backup')).toEqual({
      lastEnd: Math.floor(Date.parse('2026-09-18T14:11:12.758Z') / 1000),
      duration: 0,
      state: 'finished',
    });
  });

  it('keeps the newest of several runs', () => {
    const out = parseChoreRunLog([
      entry('2026-09-18T17:00:26.799Z', 'Chore "C" finished executing'),
      entry('2026-09-18T17:00:04.402Z', 'Chore "C" executed by scheduler'),
      entry('2026-09-18T16:00:22.500Z', 'Chore "C" finished executing'),
      entry('2026-09-18T16:00:00.236Z', 'Chore "C" executed by scheduler'),
    ]);
    expect(out.get('C')?.lastEnd).toBe(Math.floor(Date.parse('2026-09-18T17:00:26.799Z') / 1000));
  });

  it('reports a start without a finish as running', () => {
    const out = parseChoreRunLog([
      entry('2026-09-18T17:00:04.402Z', 'Chore "C" executed by scheduler'),
    ]);
    expect(out.get('C')).toEqual({ lastEnd: Math.floor(Date.parse('2026-09-18T17:00:04.402Z') / 1000), state: 'running' });
  });

  it('reports a start NEWER than the last finish as running', () => {
    const out = parseChoreRunLog([
      entry('2026-09-18T17:10:00.000Z', 'Chore "C" executed by scheduler'),
      entry('2026-09-18T17:00:26.799Z', 'Chore "C" finished executing'),
      entry('2026-09-18T17:00:04.402Z', 'Chore "C" executed by scheduler'),
    ]);
    expect(out.get('C')).toEqual({ lastEnd: Math.floor(Date.parse('2026-09-18T17:10:00.000Z') / 1000), state: 'running' });
  });

  it('ignores a stale "time =" from an older run', () => {
    const out = parseChoreRunLog([
      entry('2026-09-18T17:00:26.799Z', 'Chore "C" finished executing'),
      entry('2026-09-18T17:00:04.402Z', 'Chore "C" executed by scheduler'),
      entry('2026-09-18T16:00:22.496Z', 'Chore "C" time = 22.26 seconds'),
    ]);
    // 22.397 s from the start/finish span, NOT the hour-old 22.26 s line.
    expect(out.get('C')?.duration).toBeCloseTo(22.397, 3);
  });

  it('skips lines about registering or deactivating a chore', () => {
    const out = parseChoreRunLog([
      entry('2026-09-18T17:00:00.000Z', 'Registering chore: "C"  Start time: 2024/02/01 07:00:00  Frequency: 01:00:00:00'),
      entry('2026-09-18T17:00:01.000Z', 'Deactivating chore: "C"'),
    ]);
    expect(out.size).toBe(0);
  });

  it('ignores entries it cannot date and unrelated chore lines', () => {
    const out = parseChoreRunLog([
      entry('not-a-date', 'Chore "C" finished executing'),
      entry('2026-09-18T17:00:00.000Z', 'Chore "C" is inactive and will not be scheduled'),
    ]);
    expect(out.size).toBe(0);
  });
});

describe('formatDurationSec', () => {
  it('scales from sub-second to hours', () => {
    expect(formatDurationSec(0.011)).toBe('<1s');
    expect(formatDurationSec(7)).toBe('7s');
    expect(formatDurationSec(22.39)).toBe('22s');
    expect(formatDurationSec(123)).toBe('2m 03s');
    expect(formatDurationSec(3723)).toBe('1h 02m 03s');
  });
});

describe('formatEpochMinute', () => {
  it('renders local wall-clock minutes', () => {
    const sec = Math.floor(new Date(2026, 6, 17, 15, 5, 30).getTime() / 1000);
    expect(formatEpochMinute(sec)).toBe('2026-07-17 15:05');
  });
});

describe('parseChoreRunLogCounted — read versus recognised (C5)', () => {
  it('counts every recognised chore line', () => {
    const r = parseChoreRunLogCounted([
      { timestamp: '2026-09-20T10:00:00Z', message: 'Chore "N" executed by admin' },
      { timestamp: '2026-09-20T10:00:05Z', message: 'Chore "N" time = 5.0 seconds' },
      { timestamp: '2026-09-20T10:00:05Z', message: 'Chore "N" finished executing' },
    ]);
    expect(r.linesRead).toBe(3);
    expect(r.linesMatched).toBe(3);
  });

  it('reports 0 recognised when the log sounds different', () => {
    // Exactly the case the tooltip is meant to name: lines were read, but nothing
    // was recognised — a localised log, a different format, or simply
    // no chore run in the window.
    const r = parseChoreRunLogCounted([
      { timestamp: '2026-09-20T10:00:00Z', message: 'Chore "N" wurde von admin ausgefuehrt' },
      { timestamp: '2026-09-20T10:00:05Z', message: 'Etwas ganz anderes' },
    ]);
    expect(r.linesRead).toBe(2);
    expect(r.linesMatched).toBe(0);
    expect(r.stats.size).toBe(0);
  });

  it('accepts a duration with a decimal comma', () => {
    const out = parseChoreRunLog([
      { timestamp: '2026-09-20T10:00:00Z', message: 'Chore "N" executed by admin' },
      { timestamp: '2026-09-20T10:00:07Z', message: 'Chore "N" time = 7,5 seconds' },
      { timestamp: '2026-09-20T10:00:07Z', message: 'Chore "N" finished executing' },
    ]);
    expect(out.get('N')?.duration).toBe(7.5);
  });
});

describe('fetchCubeLoadStates', () => {
  beforeEach(() => { apiRequest.mockReset(); });

  it('marks only cubes with counted cells; memory without cells stays unknown (rules-only cube)', async () => {
    mockCellset([
      ['Stored', [19456, 12, 0]],
      ['RulesOnly', [19456, 0, 0]],
      ['NoMemory', [0, 0, 0]],
    ], ['Total Memory Used', 'Number of Populated Numeric Cells', 'Number of Populated String Cells']);
    const states = await fetchCubeLoadStates({ ...CFG, version: 'v11' } as unknown as Tm1Config);
    expect([...states]).toEqual([['stored', true]]);
  });
});

import { describe, it, expect } from 'vitest';
import { analyzeStartup, type StartupRawEntry } from '../../commands/messageLogStartupPure';

const e = (Message: string, TimeStamp: string, ThreadID?: number): StartupRawEntry =>
  ({ Message, TimeStamp, ...(ThreadID === undefined ? {} : { ThreadID }) });

// One tiny startup: two workers, three cubes, deliberately overlapping.
const START: StartupRawEntry[] = [
  e('Data Directory: c:\\tm1\\data', '2026-08-24T02:00:00.000Z', 1),
  e('MTQ is enabled with 16 threads', '2026-08-24T02:00:00.100Z', 1),
  e('MaximumCubeLoadThreads is set to 2', '2026-08-24T02:00:00.100Z', 1),
  e('Loading dimension D1', '2026-08-24T02:00:01.000Z', 1),
  e('Done loading header for cube A', '2026-08-24T02:00:02.000Z', 1),
  e('Loading rules for cube A', '2026-08-24T02:00:02.500Z', 1),
  // Worker 100 takes the long cube, worker 200 takes two short ones.
  e('Loading body for cube LANG', '2026-08-24T02:00:03.000Z', 100),
  e('Loading body for cube KURZ1', '2026-08-24T02:00:03.000Z', 200),
  e('Done loading body for cube KURZ1', '2026-08-24T02:00:05.000Z', 200),
  e('Loading body for cube KURZ2', '2026-08-24T02:00:05.000Z', 200),
  e('Done loading body for cube KURZ2', '2026-08-24T02:00:09.000Z', 200),
  e('Done loading body for cube LANG', '2026-08-24T02:00:23.000Z', 100),
  e("TM1CubeImpl::ProcessFeeders(in 1500ms): Done computing feeders for base cube 'LANG'.", '2026-08-24T02:00:24.500Z', 100),
  e('Feeders already loaded for cube "KURZ1"', '2026-08-24T02:00:24.600Z', 100),
  e('Using Persistent Feeders', '2026-08-24T02:00:24.700Z', 100),
  e('TM1 Server load time (secs) = 25', '2026-08-24T02:00:25.000Z', 1),
  e('TM1 Server is ready, elapsed time 26.00 seconds', '2026-08-24T02:00:26.000Z', 1),
];

describe('analyzeStartup', () => {
  const r = analyzeStartup(START);

  it('reads both totals TM1 states and the wall clock between the boundaries', () => {
    expect(r.reportedSec).toBe(26);
    expect(r.loadTimeSec).toBe(25);
    expect(r.wallSec).toBe(26);
  });

  it('works on entries handed over newest-first, the way REST returns them', () => {
    const rev = analyzeStartup([...START].reverse());
    expect(rev.reportedSec).toBe(26);
    expect(rev.cubes.map(c => c.name)).toEqual(r.cubes.map(c => c.name));
  });

  it('times each cube body from its own pair', () => {
    expect(r.cubes.map(c => [c.name, c.sec])).toEqual([['LANG', 20], ['KURZ2', 4], ['KURZ1', 2]]);
  });

  it('groups the cubes into worker lanes, busiest first', () => {
    expect(r.lanes.map(l => [l.thread, l.cubes.length, l.busySec]))
      .toEqual([[100, 1, 20], [200, 2, 6]]);
  });

  it('reports the sum AND the covered wall time separately', () => {
    // 20 + 4 + 2 = 26 s of work inside a 20 s window — a stacked bar of the parts
    // against the total would claim 100 % where the truth is 77 %.
    expect(r.busySec).toBe(26);
    expect(r.coveredSec).toBe(20);
    expect(r.maxParallel).toBe(2);
  });

  it('names the longest lane as the floor the startup cannot go below', () => {
    // No number of extra workers makes this start finish before worker 100 does.
    expect(r.criticalLaneSec).toBe(20);
    expect(r.criticalThread).toBe(100);
  });

  it('measures the prelude before the first load line and the tail after the last', () => {
    expect(r.preludeSec).toBe(1);   // begin 02:00:00 → first dimension 02:00:01
    expect(r.tailSec).toBe(3);      // last body end 02:00:23 → ready 02:00:26
  });

  it('counts the phases that have no pair instead of inventing durations for them', () => {
    expect(r.headers).toBe(1);
    expect(r.dimensions).toBe(1);
    expect(r.rules).toBe(1);
  });

  it('keeps computed feeders and feeders read from file apart', () => {
    expect(r.feeders).toEqual([{ name: 'LANG', sec: 1.5 }]);
    expect(r.feedersFromFile).toBe(1);
    expect(r.persistentFeeders).toBe(true);
  });

  it('carries the configuration that explains the shape', () => {
    expect(r.mtqThreads).toBe(16);
    expect(r.cubeLoadThreads).toBe(2);
  });

  it('reports nothing unpaired for a complete window', () => {
    expect(r.unpairedStarts).toBe(0);
    expect(r.unpairedEnds).toBe(0);
  });
});

describe('analyzeStartup — edges', () => {
  it('pairs by thread, so two workers loading a same-named cube do not cross', () => {
    // Should not happen in one startup, but the window may clip two startups
    // together. Crossing the pair would invent a runtime spanning both.
    const r = analyzeStartup([
      e('Loading body for cube C', '2026-08-24T02:00:00.000Z', 100),
      e('Loading body for cube C', '2026-08-24T02:00:01.000Z', 200),
      e('Done loading body for cube C', '2026-08-24T02:00:02.000Z', 200),
      e('Done loading body for cube C', '2026-08-24T02:00:10.000Z', 100),
    ]);
    expect(r.cubes.map(c => [c.thread, c.sec])).toEqual([[100, 10], [200, 1]]);
  });

  it('still pairs by name when the server sends no thread id', () => {
    const r = analyzeStartup([
      e('Loading body for cube C', '2026-08-24T02:00:00.000Z'),
      e('Done loading body for cube C', '2026-08-24T02:00:04.000Z'),
    ]);
    expect(r.cubes).toEqual([{ name: 'C', thread: undefined, startTs: '2026-08-24T02:00:00.000Z', endTs: '2026-08-24T02:00:04.000Z', sec: 4 }]);
    expect(r.lanes).toHaveLength(1);
  });

  it('counts a body cut off by the window instead of dropping it silently', () => {
    const r = analyzeStartup([
      e('Done loading body for cube ANGEFANGEN_DAVOR', '2026-08-24T02:00:01.000Z', 100),
      e('Loading body for cube NIE_FERTIG', '2026-08-24T02:00:02.000Z', 100),
    ]);
    expect(r.cubes).toEqual([]);
    expect(r.unpairedEnds).toBe(1);
    expect(r.unpairedStarts).toBe(1);
  });

  it('answers an empty window with zeroes rather than throwing', () => {
    const r = analyzeStartup([]);
    expect(r.cubes).toEqual([]);
    expect(r.lanes).toEqual([]);
    expect(r.reportedSec).toBeNull();
    expect(r.wallSec).toBeNull();
    expect(r.criticalLaneSec).toBe(0);
  });

  it('ignores an unparsable timestamp instead of producing NaN seconds', () => {
    const r = analyzeStartup([
      e('Loading body for cube C', 'nicht-lesbar', 100),
      e('Done loading body for cube C', '2026-08-24T02:00:04.000Z', 100),
    ]);
    expect(r.cubes).toEqual([]);
    expect(r.unpairedEnds).toBe(1);
  });
});

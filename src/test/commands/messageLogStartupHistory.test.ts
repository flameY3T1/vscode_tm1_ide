import { describe, it, expect } from 'vitest';
import { buildStartupHistory } from '../../commands/messageLogStartupPure';

/**
 * Timestamps and messages verbatim from the live 11.8 test servers
 * (2026-11-03): the boundary lines `STARTUP_BOUNDARY_FILTER` returns.
 */
const row = (TimeStamp: string, Message: string) => ({ TimeStamp, Message });
const begin = (ts: string) => row(ts, 'Data Directory: c:\\tm1\\data');
const ready = (ts: string, sec: number) => row(ts, `TM1 Server is ready, elapsed time ${sec}.00 seconds`);
const shutdown = (ts: string) => row(ts, 'Server shutdown, elapsed time 3.00 seconds');

describe('buildStartupHistory', () => {
  it('classifies the end before each start, newest first', () => {
    const rows = [
      begin('2026-10-28T06:01:52.544Z'), ready('2026-10-28T06:02:06.858Z', 14),
      shutdown('2026-10-30T07:14:49.903Z'),
      begin('2026-10-30T07:14:52.987Z'), ready('2026-10-30T07:15:08.348Z', 16),
      begin('2026-11-01T07:32:39.730Z'), ready('2026-11-01T07:32:55.687Z', 16),
    ];
    // Delivered newest first, like REST does.
    const h = buildStartupHistory([...rows].reverse(), new Map([
      ['2026-10-28T06:01:52.544Z', '2026-10-27T22:00:23.590Z'],
      ['2026-11-01T07:32:39.730Z', '2026-10-31T23:00:25.980Z'],
    ]));
    expect(h.map(s => [s.readyTs, s.prevEnd, s.downSec])).toEqual([
      ['2026-11-01T07:32:55.687Z', 'unlogged', 30733.75],
      ['2026-10-30T07:15:08.348Z', 'clean', 3.08],
      ['2026-10-28T06:02:06.858Z', 'unlogged', 28888.95],
    ]);
  });

  it('first pass without lookups: no shutdown line means unlogged, no downtime', () => {
    const h = buildStartupHistory([begin('2026-10-24T08:40:48.091Z'), ready('2026-10-24T08:41:05.388Z', 17)]);
    expect(h[0]).toMatchObject({ prevEnd: 'unlogged', prevEndTs: null, downSec: null, beginTs: '2026-10-24T08:40:48.091Z' });
  });

  it('nothing before the start, or only the 0000-00-00 shared-memory line, is unknown', () => {
    const rows = [begin('2026-09-24T17:45:45.486Z'), ready('2026-09-24T17:45:46.707Z', 1)];
    expect(buildStartupHistory(rows, new Map([['2026-09-24T17:45:45.486Z', null]]))[0].prevEnd).toBe('unknown');
    expect(buildStartupHistory(rows, new Map([['2026-09-24T17:45:45.486Z', '0000-00-00T00:00Z']]))[0].prevEnd).toBe('unknown');
  });

  it('an aborted start keeps the real previous end and is counted', () => {
    // Shape from the rotated tm1server.log1: begin, shutdown 0.2 s later, begin, ready.
    const h = buildStartupHistory([
      shutdown('2026-05-15T18:00:00.000Z'),
      begin('2026-05-15T18:12:59.524Z'), shutdown('2026-05-15T18:12:59.738Z'),
      begin('2026-05-15T18:19:57.447Z'), ready('2026-05-15T18:20:04.644Z', 7),
    ]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ prevEnd: 'clean', prevEndTs: '2026-05-15T18:00:00.000Z', abortedBefore: 1, beginTs: '2026-05-15T18:19:57.447Z' });
  });

  it('a ready line whose begin fell outside the rows has an unknown end', () => {
    expect(buildStartupHistory([ready('2026-10-24T08:41:05.388Z', 17)])[0]).toMatchObject({ prevEnd: 'unknown', beginTs: null });
  });
});

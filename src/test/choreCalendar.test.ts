import { describe, it, expect } from 'vitest';
import { buildOverviewRows } from '../commands/chore/choreOverviewPure';
import { plannedStarts, overlappingIntervals } from '../chore/choreTablePure';
import { parseChoreRuns } from '../tm1Rest/runStats';

const H = 3600000;

describe('plannedStarts', () => {
  it('lists anchor + k·freq inside the window', () => {
    expect(plannedStarts(0, 6 * H, 5 * H, 20 * H, 99)).toEqual([6 * H, 12 * H, 18 * H]);
  });
  it('stops at the cap', () => {
    expect(plannedStarts(0, 60000, 0, 24 * H, 10)).toHaveLength(10);
  });
  it('a chore without frequency runs once at its anchor', () => {
    expect(plannedStarts(3 * H, 0, 0, 24 * H, 99)).toEqual([3 * H]);
    expect(plannedStarts(30 * H, 0, 0, 24 * H, 99)).toEqual([]);
  });
});

describe('overlappingIntervals', () => {
  it('flags overlap between different chores only', () => {
    const hit = overlappingIntervals([
      { name: 'A', s: 0, e: 10 },
      { name: 'B', s: 5, e: 15 },
      { name: 'C', s: 15, e: 20 },   // touches B's end: no overlap
      { name: 'C', s: 16, e: 18 },   // same chore as its neighbour: no overlap
    ]);
    expect([...hit].sort()).toEqual([0, 1]);
  });
});

describe('parseChoreRuns', () => {
  it('pairs start and finish per chore, in any input order', () => {
    const runs = parseChoreRuns([
      { timestamp: '2026-09-26T10:00:05.000Z', message: 'Chore "A" finished executing' },
      { timestamp: '2026-09-26T10:00:05.000Z', message: 'Chore "A" time = 5.00 seconds' },
      { timestamp: '2026-09-26T10:00:00.000Z', message: 'Chore "A" executed by scheduler' },
      { timestamp: '2026-09-26T11:00:00.000Z', message: 'Chore "A" executed by user "admin"' },
      { timestamp: '2026-09-26T09:00:00.000Z', message: 'Chore "B" finished executing' },
    ]);
    expect(runs).toEqual([
      { name: 'A', startMs: Date.parse('2026-09-26T10:00:00Z'), endMs: Date.parse('2026-09-26T10:00:05Z') },
      { name: 'A', startMs: Date.parse('2026-09-26T11:00:00Z') },
    ]);
  });

  it('drops a run whose finish is missing when the next one starts', () => {
    const runs = parseChoreRuns([
      { timestamp: '2026-09-26T10:00:00.000Z', message: 'Chore "A" executed by scheduler' },
      { timestamp: '2026-09-26T11:00:00.000Z', message: 'Chore "A" executed by scheduler' },
      { timestamp: '2026-09-26T11:00:05.000Z', message: 'Chore "A" finished executing' },
    ]);
    expect(runs).toEqual([
      { name: 'A', startMs: Date.parse('2026-09-26T11:00:00Z'), endMs: Date.parse('2026-09-26T11:00:05Z') },
    ]);
  });

  it('on a tie the finish closes the earlier run, not the one starting', () => {
    const runs = parseChoreRuns([
      { timestamp: '2026-09-26T11:00:00.000Z', message: 'Chore "A" executed by scheduler' },
      { timestamp: '2026-09-26T10:00:00.000Z', message: 'Chore "A" executed by scheduler' },
      { timestamp: '2026-09-26T11:00:00.000Z', message: 'Chore "A" finished executing' },
      { timestamp: '2026-09-26T12:00:00.000Z', message: 'Chore "B" executed by scheduler' },
      { timestamp: '2026-09-26T12:00:00.000Z', message: 'Chore "B" finished executing' },
    ]);
    expect(runs).toEqual([
      { name: 'A', startMs: Date.parse('2026-09-26T10:00:00Z'), endMs: Date.parse('2026-09-26T11:00:00Z') },
      { name: 'A', startMs: Date.parse('2026-09-26T11:00:00Z') },
      { name: 'B', startMs: Date.parse('2026-09-26T12:00:00Z'), endMs: Date.parse('2026-09-26T12:00:00Z') },
    ]);
  });
});

describe('chore calendar wiring', () => {
  it('carries the schedule anchor on each row', () => {
    const [row] = buildOverviewRows([{ Name: 'X', Active: true, StartTime: '2026-09-26T02:00:00Z', Frequency: 'P1DT00H00M00S' }]);
    expect(row.anchorMs).toBe(Date.parse('2026-09-26T02:00:00Z'));
    expect(row.frequencyMs).toBe(24 * H);
  });
});

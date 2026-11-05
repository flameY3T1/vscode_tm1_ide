// Hang asynchronously started runs (`RunProcess`) under their presumed
// caller instead of leaving them standing around as childless roots.
//
// Background: `RunProcess` writes NO `run from process` line — the
// call appears as its own top-level run on its own thread. In a
// real log (29 581 lines) 3767 of 3829 roots were therefore childless;
// the 62 real trees drowned in them.
import { describe, it, expect } from 'vitest';
import { analyze, type RawEntry } from '../../messageLog/messageLogAnalysisPure';

/** One log line. `analyze()` expects the list NEWEST-FIRST. */
function z(ts: string, thread: number, msg: string): RawEntry {
  return { TimeStamp: ts, ThreadID: thread, Level: 'Info', Message: msg };
}
const start = (n: string, u = 'n'): string => `Process "${n}" executed by user "${u}"`;
const kind = (n: string, p: string, u = 'n'): string => `Process "${n}" run from process "${p}" by user "${u}"`;
const ende = (n: string, s: number): string => `Process "${n}":  finished executing normally, elapsed time ${s.toFixed(2)} seconds`;

/** Write lines in ascending order, but pass them in descending order. */
function lauf(zeilen: RawEntry[]): ReturnType<typeof analyze> {
  return analyze(zeilen.slice().reverse());
}

describe('hanging in asynchronously started runs', () => {
  it('hangs a top-level start under the open run of the same originator', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 200, start('Fan')),          // different thread, same originator
      z('2026-08-26T07:00:03Z', 200, ende('Fan', 2)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.trees).toHaveLength(1);
    expect(res.trees[0].name).toBe('Master');
    const kindNode = res.trees[0].children[0];
    expect(kindNode.name).toBe('Fan');
    // Hung in DIRECTLY, without a bracket node: a synthetic node would carry
    // the same name and would be counted by every name search. Bundling
    // into one line is the display's job.
    expect(kindNode.status).toBe('ok');
    expect(kindNode.startedTopLevel).toBe(true);
  });

  it('lets a start on the SAME thread remain a root', () => {
    // Same thread means one after the other, not side by side — nothing is
    // asynchronous there, and the previous run had long finished.
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Erst')),
      z('2026-08-26T07:00:02Z', 100, ende('Erst', 2)),
      z('2026-08-26T07:00:03Z', 100, start('Zweit')),
      z('2026-08-26T07:00:04Z', 100, ende('Zweit', 1)),
    ]);
    // `analyze()` outputs the roots newest-first.
    expect(res.trees.map(t => t.name)).toEqual(['Zweit', 'Erst']);
  });

  it('lets a FOREIGN originator remain a root', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master', 'anna')),
      z('2026-08-26T07:00:01Z', 200, start('Fremd', 'bert')),
      z('2026-08-26T07:00:02Z', 200, ende('Fremd', 1)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.trees.map(t => t.name).sort()).toEqual(['Fremd', 'Master']);
  });

  it('lets a start without an open neighbour remain a root', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Allein')),
      z('2026-08-26T07:00:01Z', 100, ende('Allein', 1)),
    ]);
    expect(res.trees.map(t => t.name)).toEqual(['Allein']);
  });

  it('hangs many runs of the same name all under the same caller', () => {
    const zeilen = [z('2026-08-26T07:00:00Z', 100, start('Master'))];
    for (let i = 0; i < 5; i++) {
      zeilen.push(z(`2026-08-26T07:00:0${i + 1}Z`, 200 + i, start('Fan')));
      zeilen.push(z(`2026-08-26T07:00:0${i + 2}Z`, 200 + i, ende('Fan', 1)));
    }
    zeilen.push(z('2026-08-26T07:00:30Z', 100, ende('Master', 30)));
    const res = lauf(zeilen);
    expect(res.trees).toHaveLength(1);
    expect(res.trees[0].children).toHaveLength(5);
    // All recognizable as asynchronous — the display builds the one line from that.
    expect(res.trees[0].children.every(c => c.startedTopLevel)).toBe(true);
  });

  it('keeps the individual times of the hung-in runs', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 200, start('Fan')),
      z('2026-08-26T07:00:03Z', 200, ende('Fan', 2)),
      z('2026-08-26T07:00:04Z', 300, start('Fan')),
      z('2026-08-26T07:00:07Z', 300, ende('Fan', 3)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    // Children, like the roots, are newest-first.
    expect(res.trees[0].children.map(c => c.elapsedSec)).toEqual([3, 2]);
  });
});

describe('the own time of the caller stays intact', () => {
  it('does NOT subtract the asynchronous work from the own time', () => {
    // Without the exception, 10 - 400 = negative would come out, clamped to 0 and
    // marked as `inconsistent` — a clean tree would become one
    // that is faulty throughout.
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 200, start('Fan')),
      z('2026-08-26T07:06:41Z', 200, ende('Fan', 400)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.trees[0].selfSec).toBe(10);
    expect(res.trees[0].inconsistent).toBe(false);
  });

  it('still subtracts a REAL child', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 100, kind('Echt', 'Master')),
      z('2026-08-26T07:00:05Z', 100, ende('Echt', 4)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.trees[0].selfSec).toBe(6);
  });
});

describe('the statistics stay unchanged', () => {
  it('still counts hung-in runs fully', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 200, start('Fan')),
      z('2026-08-26T07:00:03Z', 200, ende('Fan', 2)),
      z('2026-08-26T07:00:04Z', 300, start('Fan')),
      z('2026-08-26T07:00:07Z', 300, ende('Fan', 3)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    const s = res.stats.find(x => x.name === 'Fan');
    expect(s?.calls).toBe(2);
    expect(s?.totalSec).toBeCloseTo(5, 5);
  });

  it('counts a hung-in run exactly once', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 200, start('Fan')),
      z('2026-08-26T07:00:03Z', 200, ende('Fan', 2)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.stats.find(x => x.name === 'Fan')?.calls).toBe(1);
  });
});

describe('the marker for the call graph', () => {
  it('records that a run started as top-level', () => {
    // `runSource#alsWurzeln` collects afterwards; without the marker the
    // run times of the RunProcess edges in the call graph would be empty again.
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 200, start('Fan')),
      z('2026-08-26T07:00:03Z', 200, ende('Fan', 2)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.trees[0].children[0].startedTopLevel).toBe(true);
    expect(res.trees[0].startedTopLevel).toBe(true);
  });

  it('does not mark a REAL child', () => {
    const res = lauf([
      z('2026-08-26T07:00:00Z', 100, start('Master')),
      z('2026-08-26T07:00:01Z', 100, kind('Echt', 'Master')),
      z('2026-08-26T07:00:05Z', 100, ende('Echt', 4)),
      z('2026-08-26T07:00:10Z', 100, ende('Master', 10)),
    ]);
    expect(res.trees[0].children[0].startedTopLevel).toBeFalsy();
  });
});

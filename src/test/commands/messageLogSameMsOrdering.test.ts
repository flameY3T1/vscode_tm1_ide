import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyze, type RawEntry, type CallNode } from '../../messageLog/messageLogAnalysisPure';

/**
 * Within-millisecond ordering.
 *
 * `MessageLogEntries?$orderby=TimeStamp desc` leaves ties in whatever order the
 * server feels like, and TM1 really does write both halves of a 0.00 s run into one
 * millisecond. Reversing an arbitrary tie order can put an end line ahead of its own
 * start, which renders as a truncated stray root PLUS a node stuck at `running` and
 * counts the single run twice in the per-process statistics.
 *
 * The dangerous shape that any fix must not break sits in the same log: one run of a
 * name ENDS while another run of the SAME name STARTS in that same millisecond. There
 * the end belongs to the OLDER run, so a blanket "starts before ends" rule would be
 * exactly wrong. Every case below is asserted in both directions.
 */

const FIXTURE: RawEntry[] = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/messageLog', 'real-tm1-11.8-same-ms.json'), 'utf-8'),
);

/** Fixture with the write sequence removed — the fallback path for servers without `ID`. */
const FIXTURE_NO_ID: RawEntry[] = FIXTURE.map(({ ID: _ID, ...rest }) => rest);

function flatten(nodes: CallNode[]): CallNode[] {
  return nodes.flatMap(n => [n, ...flatten(n.children)]);
}

/** Synthetic entry in wire shape. `id` omitted ⇒ server without a write sequence. */
function e(msg: string, ts: string, id?: number): RawEntry {
  return id === undefined
    ? { TimeStamp: ts, Message: msg }
    : { ID: id, TimeStamp: ts, Message: msg };
}
/** The same entries as the server would return them: newest first. */
function fetched(...asc: RawEntry[]): RawEntry[] { return [...asc].reverse(); }
/** Swap two neighbours to simulate the other tie order the server may return. */
function swap(list: RawEntry[], i: number): RawEntry[] {
  const out = [...list];
  [out[i], out[i + 1]] = [out[i + 1], out[i]];
  return out;
}

// ── Direction 1: a start and its own end share one millisecond ────────────────
describe('same-millisecond start/end pair resolves to ONE run', () => {
  const START = 'Process "P" executed by user "U"';
  const END = 'Prozess "P":  Ausführung normal beendet, verstrichene Zeit 0.00 Sekunden';

  for (const withId of [true, false]) {
    const label = withId ? 'with the server write sequence' : 'without a write sequence (fallback)';

    it(`${label}, whichever tie order the server returns`, () => {
      const base = fetched(
        e(START, '2026-07-25T13:54:29.609Z', withId ? 1 : undefined),
        e(END, '2026-07-25T13:54:29.609Z', withId ? 2 : undefined),
      );
      for (const input of [base, swap(base, 0)]) {
        const r = analyze(input);
        expect(r.trees).toHaveLength(1);
        const [run] = r.trees;
        expect(run.status).toBe('ok');
        expect(run.elapsedSec).toBe(0);
        expect(run.truncated).toBe(false);
        // The defect this pins: a stray truncated root plus a node at `running`.
        expect(flatten(r.trees).filter(n => n.status === 'running')).toEqual([]);
        expect(r.parsedRuns).toBe(1);
        // …and the run counted twice in the statistics.
        expect(r.stats.find(s => s.name === 'P')!.calls).toBe(1);
      }
    });
  }
});

// ── Direction 2: an end and an UNRELATED same-named start share one millisecond ─
describe('an end in the same millisecond as a same-named start keeps the earlier run', () => {
  const START = 'Process "P" executed by user "U"';
  const END_3 = 'Prozess "P":  Ausführung normal beendet, verstrichene Zeit 3.00 Sekunden';
  const END_1 = 'Prozess "P":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden';

  for (const withId of [true, false]) {
    const label = withId ? 'with the server write sequence' : 'without a write sequence (fallback)';

    it(`${label}: the 3.00 s end belongs to the run that started 3 s ago, not to the one starting now`, () => {
      const base = fetched(
        e(START, '2026-07-23T19:55:07.092Z', withId ? 1 : undefined),
        e(END_3, '2026-07-23T19:55:10.094Z', withId ? 2 : undefined),
        e(START, '2026-07-23T19:55:10.094Z', withId ? 3 : undefined),
        e(END_1, '2026-07-23T19:55:11.100Z', withId ? 4 : undefined),
      );
      // Index 1/2 of the FETCHED (newest-first) list are the two tied entries.
      for (const input of [base, swap(base, 1)]) {
        const r = analyze(input);
        const runs = r.trees.filter(n => n.name === 'P');
        expect(runs).toHaveLength(2);
        const early = runs.find(n => n.startTs.endsWith('07.092Z'))!;
        const late = runs.find(n => n.startTs.endsWith('10.094Z'))!;
        // The whole point: 3.00 s cannot have elapsed inside one millisecond.
        expect(early.elapsedSec).toBe(3.0);
        expect(late.elapsedSec).toBe(1.0);
        expect(r.stats.find(s => s.name === 'P')!.calls).toBe(2);
        expect(flatten(r.trees).filter(n => n.truncated)).toEqual([]);
      }
    });
  }

  const ERR = 'Prozess "P":  Ausführung wurde mit Fehlern beendet. Fehlerdatei: <x.log>';

  it('an end that carries NO runtime is never reordered — there is no evidence to reorder it on', () => {
    // A rollback / abort / "mit Fehlern beendet" end reports no elapsed time, so
    // nothing distinguishes "belongs to the start in this millisecond" from
    // "belongs to the older run". Without a write sequence the parser must leave the
    // arrival order alone: moving the start ahead would silently hand the failure to
    // the wrong run.
    const r = analyze(fetched(
      e(START, '2026-07-23T19:52:26.114Z'),
      e(ERR, '2026-07-23T19:52:28.129Z'),
      e(START, '2026-07-23T19:52:28.129Z'),
    ));
    const runs = flatten(r.trees).filter(n => n.name === 'P');
    expect(runs).toHaveLength(2);
    const failed = runs.find(n => n.status === 'error')!;
    expect(failed.startTs).toBe('2026-07-23T19:52:26.114Z');
    expect(runs.find(n => n.status === 'running')!.startTs).toBe('2026-07-23T19:52:28.129Z');
    expect(runs.some(n => n.ambiguous)).toBe(false);
  });

  it('and when the server returns that tie the other way round, the guess is FLAGGED, not hidden', () => {
    // Same three lines, opposite tie order. Now both runs are open when the runtime-less
    // end arrives and nothing can separate them, so the pick is marked uncertain (H4)
    // instead of being presented as fact. A write sequence removes the doubt entirely,
    // which is exactly why `ID` is preferred over this fallback.
    const r = analyze(fetched(
      e(START, '2026-07-23T19:52:26.114Z'),
      e(START, '2026-07-23T19:52:28.129Z'),
      e(ERR, '2026-07-23T19:52:28.129Z'),
    ));
    const runs = flatten(r.trees).filter(n => n.name === 'P');
    expect(runs).toHaveLength(2);
    expect(runs.every(n => n.ambiguous)).toBe(true);
    expect(r.stats.find(s => s.name === 'P')!.uncertain).toBe(2);
  });

  it('the write sequence removes that doubt in both tie orders', () => {
    const asc = [
      e(START, '2026-07-23T19:52:26.114Z', 1),
      e(ERR, '2026-07-23T19:52:28.129Z', 2),
      e(START, '2026-07-23T19:52:28.129Z', 3),
    ];
    for (const input of [fetched(...asc), swap(fetched(...asc), 0)]) {
      const runs = flatten(analyze(input).trees).filter(n => n.name === 'P');
      expect(runs.find(n => n.status === 'error')!.startTs).toBe('2026-07-23T19:52:26.114Z');
      expect(runs.some(n => n.ambiguous)).toBe(false);
    }
  });

  it('a second same-millisecond start is not dragged in front of an end the first one already claimed', () => {
    // Fallback path, one 0.00 s end and TWO starts in one millisecond: exactly one
    // start moves ahead of the end. The other stays open and honestly says `running`
    // — it must not be turned into a second owner of the same end line.
    const END_0 = 'Prozess "P":  Ausführung normal beendet, verstrichene Zeit 0.00 Sekunden';
    const r = analyze(fetched(
      e(END_0, '2026-07-25T13:54:29.609Z'),
      e(START, '2026-07-25T13:54:29.609Z'),
      e(START, '2026-07-25T13:54:29.609Z'),
    ));
    const runs = flatten(r.trees).filter(n => n.name === 'P');
    expect(runs).toHaveLength(2);
    expect(runs.filter(n => n.elapsedSec === 0)).toHaveLength(1);
    expect(runs.filter(n => n.status === 'running')).toHaveLength(1);
    expect(runs.filter(n => n.truncated)).toEqual([]);
    expect(r.stats.find(s => s.name === 'P')!.calls).toBe(2);
  });
});

// ── The reordering may never reach across the clock ───────────────────────────
describe('reordering is confined to entries sharing one millisecond', () => {
  it('never re-sorts across timestamps, even when the write sequence disagrees', () => {
    // Whatever `ID` is worth on a given server, the timestamps here already separate
    // the two lines. A global sort by `ID` would put the end first and manufacture the
    // very truncated stray root this change removes.
    const r = analyze(fetched(
      e('Process "P" executed by user "U"', '2026-07-23T10:00:00.000Z', 9),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05.000Z', 1),
    ));
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0].truncated).toBe(false);
    expect(r.trees[0].elapsedSec).toBe(5.0);
    expect(r.trees[0].startTs).toBe('2026-07-23T10:00:00.000Z');
  });

  it('leaves entries with unparsable timestamps in arrival order', () => {
    const r = analyze(fetched(
      { ID: 1, TimeStamp: 'not-a-date', Message: 'Process "P" executed by user "U"' },
      { ID: 2, TimeStamp: 'not-a-date', Message: 'Prozess "P":  Ausführung normal beendet, verstrichene Zeit 0.00 Sekunden' },
    ));
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0].status).toBe('ok');
  });
});

// ── The live 11.8 slices the defect was found on ──────────────────────────────
describe('live TM1 11.8 slices with same-millisecond ties', () => {
  const r = analyze(FIXTURE);
  const all = flatten(r.trees);
  const byName = (n: string): CallNode[] => all.filter(x => x.name === n);

  it('produces no truncated stray root at all', () => {
    expect(all.filter(n => n.truncated)).toEqual([]);
  });

  it('counts each 0.00 s run once, not twice', () => {
    for (const name of ['}VSCode_CubeSaveData', 'ZZ_MCP_LIVE_PROC_A']) {
      expect(byName(name)).toHaveLength(1);
      expect(byName(name)[0].status).toBe('ok');
      expect(byName(name)[0].elapsedSec).toBe(0);
      expect(r.stats.find(s => s.name === name)!.calls).toBe(1);
    }
  });

  it('closes the compile failure that shares its millisecond with its own start line', () => {
    // `__s3_gxbd38` starts and fails to initialise inside one millisecond, and the
    // server returned the verdict first. The run must end as `error`, not sit at
    // `running` while its verdict is discarded as an unmatched line.
    const fail = byName('__s3_gxbd38');
    expect(fail).toHaveLength(1);
    expect(fail[0].status).toBe('error');
    expect(r.stats.find(s => s.name === '__s3_gxbd38')!.failures).toBe(1);
  });

  it('nests the chore-launched processes under their chore', () => {
    // The chore start and the process it launches share a millisecond; on the raw
    // tie order the process was walked first, found no open chore and became its own
    // root, leaving the chore as a permanently empty row.
    const chores = r.trees.filter(n => n.kind === 'chore');
    expect(chores.map(c => c.name).sort()).toEqual(['ZZ_MCP_LIVE_CHORE_A', 'ttt']);
    expect(chores.every(c => c.children.length > 0)).toBe(true);
    expect(r.trees.filter(n => n.name === '_test')).toEqual([]);
    expect(byName('ttt')[0].status).toBe('ok');
    expect(byName('ttt')[0].elapsedSec).toBe(0.11);
  });

  it('keeps the dangerous ##sleep pairing: the 3.00 s end stays with the older run', () => {
    const sleeps = byName('##sleep');
    const early = sleeps.find(n => n.startTs.endsWith('19:55:07.092Z'))!;
    const late = sleeps.find(n => n.startTs.endsWith('19:55:10.094Z'))!;
    expect(early.elapsedSec).toBe(3.0);
    expect(late.elapsedSec).toBe(1.01);
  });

  it('resolves ties the raw order invented — the write sequence leaves one candidate', () => {
    // The error end at 19:52:28.129 and a new `##sleep` start share that millisecond.
    // In write order the end arrives while only the 19:52:26.114 run is open, so there
    // is nothing to choose between and no ≈ marker.
    const err = byName('##sleep').find(n => n.status === 'error')!;
    expect(err.startTs).toBe('2026-07-23T19:52:26.114Z');
    expect(err.ambiguous).toBe(false);
  });

  it('the thread id settles the tie H4 could only flag', () => {
    // Two `## test1` runs are open when the 19:55 children attach — the 19:52:21
    // run never gets an end line inside the slice — so on name and time alone the
    // pairing was undecidable and both runs were marked `≈`.
    //
    // It was never undecidable in the data: the fixture carries the real
    // `ThreadID`, both children and the 19:55:04 start sit on thread 21676 while
    // the older run is thread 10784. The children attach to the run that actually
    // spawned them, and nothing is left to flag.
    expect(byName('## test1').filter(n => n.ambiguous)).toEqual([]);
    expect(r.stats.find(s => s.name === '## test1')!.uncertain).toBe(0);
    const parent = byName('## test1').find(n => n.startTs.endsWith('19:55:04.077Z'))!;
    expect(parent.children.map(c => c.name)).toEqual(['##sleep', '##sleep']);
    // …and the older run keeps its OWN two children, the pair logged on 10784.
    const older = byName('## test1').find(n => n.startTs.endsWith('19:52:21.102Z'))!;
    expect(older.children.map(c => c.startTs).sort()).toEqual([
      '2026-07-23T19:52:26.114Z',
      '2026-07-23T19:52:28.129Z',
    ]);
  });

  it('every parsed line is accounted for', () => {
    expect(r.ignoredLines).toBe(0);
    expect(r.entryCount).toBe(FIXTURE.length);
  });
});

// ── The same live slices from a server that does not send `ID` ────────────────
describe('live slices without a write sequence — the fallback must still not flip the hard case', () => {
  const r = analyze(FIXTURE_NO_ID);
  const all = flatten(r.trees);

  it('collapses the 0.00 s runs on runtime evidence alone', () => {
    for (const name of ['}VSCode_CubeSaveData', 'ZZ_MCP_LIVE_PROC_A']) {
      expect(all.filter(n => n.name === name)).toHaveLength(1);
      expect(r.stats.find(s => s.name === name)!.calls).toBe(1);
    }
    expect(all.filter(n => n.truncated)).toEqual([]);
  });

  it('pairs ##sleep exactly as the write sequence does', () => {
    const sleeps = all.filter(n => n.name === '##sleep');
    expect(sleeps.find(n => n.startTs.endsWith('19:55:07.092Z'))!.elapsedSec).toBe(3.0);
    expect(sleeps.find(n => n.startTs.endsWith('19:55:10.094Z'))!.elapsedSec).toBe(1.01);
  });

  it('leaves the evidence-free ties flagged rather than guessing them right by luck', () => {
    // Without `ID` the runtime-less error end and the chore/compile-failure ties have
    // no handle at all. They stay visibly uncertain — the deliberate difference to the
    // sequenced path, and the reason `ID` is preferred when the server sends it.
    expect(all.filter(n => n.name === '__s3_gxbd38')[0].status).toBe('running');
    expect(all.filter(n => n.name === '##sleep' && n.status === 'error')[0].ambiguous).toBe(true);
  });
});

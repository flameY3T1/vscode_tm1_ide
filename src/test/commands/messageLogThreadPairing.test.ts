import { describe, it, expect } from 'vitest';
import { analyze, type RawEntry } from '../../messageLog/messageLogAnalysisPure';

/**
 * Entries in FETCHED order = newest-first, the way `$orderby=TimeStamp desc`
 * hands them over. `t` is the TM1 worker thread the line was written on
 * (`MessageLogEntries.ThreadID`), which is populated on every TM1.Process line —
 * verified live on 11.8 over 4000 rows, none missing or zero.
 */
const e = (Message: string, TimeStamp: string, ThreadID?: number): RawEntry =>
  ({ Message, TimeStamp, Level: 'INFO', ...(ThreadID === undefined ? {} : { ThreadID }) });

function flat(nodes: { children: unknown[] }[]): { name: string; startTs: string; elapsedSec: number | null; ambiguous?: boolean; status: string; children: unknown[] }[] {
  const out: never[] = [];
  const walk = (ns: unknown[]) => {
    for (const n of ns as { children: unknown[] }[]) { (out as unknown[]).push(n); walk(n.children); }
  };
  walk(nodes);
  return out;
}

describe('analyze — pairing by ThreadID', () => {
  it('gives each parallel run the runtime logged on its OWN thread', () => {
    // Verbatim shape from the real tm1server.log: a chore fans one process out
    // over several threads within milliseconds, and TM1 rounds the reported
    // runtime to 1/100 s. Thread 100 really ran 4.050 s but logs "4.04" — which
    // lands EXACTLY on thread 200's start, so pure arithmetic scores the foreign
    // start 0.00 against the true one's 0.01 and pairs it wrong.
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 4.05 Sekunden', '2026-08-21T07:00:09.060', 200),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 4.04 Sekunden', '2026-08-21T07:00:09.050', 100),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.010', 200),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.000', 100),
    ]);
    const runs = flat(r.trees);
    expect(runs).toHaveLength(2);
    expect(runs.every(n => n.status === 'ok')).toBe(true);
    const first = runs.find(n => n.startTs.endsWith('05.000'))!;
    const second = runs.find(n => n.startTs.endsWith('05.010'))!;
    expect(first.elapsedSec).toBe(4.04);
    expect(second.elapsedSec).toBe(4.05);
  });

  it('does not flag a tie the thread id resolves', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.02 Sekunden', '2026-08-21T07:00:10.040', 200),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-08-21T07:00:10.020', 100),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.020', 200),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.020', 100),
    ]);
    expect(flat(r.trees).some(n => n.ambiguous)).toBe(false);
  });

  it('pairs an error end — which reports no runtime at all — by thread', () => {
    // Without a reported elapsed time the old matcher had no arithmetic handle
    // and closed the most recently started run. On the real log 341 of the
    // mis-pairings were exactly this shape.
    const r = analyze([
      e('Prozess "P":  Ausführung wurde mit Fehlern beendet. Fehlerdatei: <TM1ProcessError_1_P.log>', '2026-08-21T07:00:09.000', 100),
      e('Process "P" executed by user "SPAETER"', '2026-08-21T07:00:08.000', 200),
      e('Process "P" executed by user "FRUEHER"', '2026-08-21T07:00:05.000', 100),
    ]);
    const failed = flat(r.trees).find(n => n.status === 'error')!;
    expect(failed.startTs).toContain('07:00:05');
    const stillRunning = flat(r.trees).find(n => n.status === 'running')!;
    expect(stillRunning.startTs).toContain('07:00:08');
  });

  it('attaches a child to the parent instance on its own thread', () => {
    const r = analyze([
      e('Process "KIND" run from process "ELTERN" by user "U"', '2026-08-21T07:00:06.000', 200),
      e('Process "ELTERN" executed by user "U"', '2026-08-21T07:00:05.100', 200),
      e('Process "ELTERN" executed by user "U"', '2026-08-21T07:00:05.000', 100),
    ]);
    const parents = r.trees.filter(n => n.name === 'ELTERN');
    expect(parents).toHaveLength(2);
    const withChild = parents.filter(p => p.children.length === 1);
    expect(withChild).toHaveLength(1);
    expect(withChild[0].startTs).toContain('05.100');
    expect(withChild[0].children[0].name).toBe('KIND');
  });

  it('still separates two runs that share ONE thread by their reported runtime', () => {
    // Nested / sequential runs on one thread stay the arithmetic matcher's job.
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-08-21T07:00:11.000', 100),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-08-21T07:00:10.000', 100),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:10.000', 100),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.000', 100),
    ]);
    const runs = flat(r.trees);
    expect(runs.map(n => n.elapsedSec).sort()).toEqual([1.0, 5.0]);
  });

  it('behaves exactly as before when no entry carries a thread id', () => {
    // Older servers / hand-built fixtures must not change verdict.
    const withOut = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-08-21T07:00:10.000'),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.000'),
    ]);
    expect(withOut.trees[0].status).toBe('ok');
    expect(withOut.trees[0].elapsedSec).toBe(5.0);
  });

  it('falls back to every candidate when the end line names an unseen thread', () => {
    // A start cut off by $top leaves no run on that thread. Narrowing must not
    // starve the lookup into inventing a truncated stray root.
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-08-21T07:00:10.000', 999),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.000', 100),
    ]);
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0].status).toBe('ok');
    expect(r.trees[0].truncated).toBe(false);
  });

  it('ignores a stale open run on a reused thread and closes the newest', () => {
    // TM1 hands worker threads back to a pool, so the same id reappears. LIFO
    // inside the thread is what keeps the reuse harmless.
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-08-21T07:00:20.000', 100),
      e('Process "P" executed by user "NEU"', '2026-08-21T07:00:19.000', 100),
      e('Process "P" executed by user "ALT"', '2026-08-21T07:00:05.000', 100),
    ]);
    const runs = flat(r.trees);
    const done = runs.find(n => n.status === 'ok')!;
    expect(done.startTs).toContain('07:00:19');
    expect(runs.find(n => n.status === 'running')!.startTs).toContain('07:00:05');
  });
});

describe('analyze — what the thread id cannot settle', () => {
  it('still flags two runs opened on ONE thread that no runtime separates', () => {
    // Thread narrowing removes a candidate only when the thread points at one of
    // them. Two runs of a name on the same thread, closed by an error end that
    // reports no runtime, remain genuinely undecidable — and must stay marked
    // rather than be guessed (H4). 14 of 3540 contested ends on the real log are
    // of this shape.
    const r = analyze([
      e('Prozess "P":  Ausführung wurde mit Fehlern beendet. Fehlerdatei: <TM1ProcessError_1_P.log>', '2026-08-21T07:00:09.000', 100),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.000', 100),
      e('Process "P" executed by user "U"', '2026-08-21T07:00:05.000', 100),
    ]);
    expect(r.trees.filter(n => n.ambiguous)).toHaveLength(2);
  });

  it('does not let a thread id override the user handle it agrees with', () => {
    // Two users run the same process concurrently on two threads; the child names
    // its user. Thread and user point at the same parent — the answer must be that
    // parent, and unflagged.
    const r = analyze([
      e('Process "KIND" run from process "ELTERN" by user "ANNA"', '2026-08-21T07:00:06.000', 100),
      e('Process "ELTERN" executed by user "BEN"', '2026-08-21T07:00:05.100', 200),
      e('Process "ELTERN" executed by user "ANNA"', '2026-08-21T07:00:05.000', 100),
    ]);
    const anna = r.trees.find(n => n.name === 'ELTERN' && n.startTs.endsWith('05.000'))!;
    expect(anna.children.map(c => c.name)).toEqual(['KIND']);
    expect(anna.ambiguous).toBeFalsy();
  });
});

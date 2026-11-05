import { describe, it, expect } from 'vitest';
import { parseLine, analyze } from '../../messageLog/messageLogAnalysisPure';

describe('parseLine', () => {
  it('parses EN top-level start', () => {
    expect(parseLine('Process "## test1" executed by user "flameY3T1"'))
      .toEqual({ type: 'top', name: '## test1', kind: 'process', user: 'flameY3T1' });
  });
  it('parses EN child start with explicit parent', () => {
    expect(parseLine('Process "##sleep" run from process "## test1" by user "flameY3T1"'))
      .toEqual({ type: 'child', name: '##sleep', parent: '## test1', user: 'flameY3T1' });
  });
  it('parses a chore-launched process start and keeps the chore name', () => {
    expect(parseLine('Process "P" executed by chore "Nightly Batch"'))
      .toEqual({ type: 'top', name: 'P', kind: 'process', chore: 'Nightly Batch' });
  });
  it('parses DE normal end with elapsed seconds', () => {
    expect(parseLine('Prozess "## test1":  Ausführung normal beendet, verstrichene Zeit 8.03 Sekunden'))
      .toEqual({ type: 'end', name: '## test1', elapsedSec: 8.03, error: false });
  });
  it('parses EN elapsed-time end', () => {
    expect(parseLine('Process "P": execution completed, elapsed time 2.5 seconds'))
      .toEqual({ type: 'end', name: 'P', elapsedSec: 2.5, error: false });
  });
  it('parses German error end WITHOUT elapsed (mit Fehlern beendet)', () => {
    expect(parseLine('Prozess "##sleep":  Ausführung wurde mit Fehlern beendet. Fehlerdatei: <TM1ProcessError_20260723195228_12510784_##sleep.log> : Ungültiger Schlüssel'))
      .toEqual({ type: 'end', name: '##sleep', elapsedSec: null, error: true });
  });
  it('parses rollback / lock exception as an error end', () => {
    expect(parseLine('Process "## test1": Execution rolling back due to lock exception'))
      .toEqual({ type: 'end', name: '## test1', elapsedSec: null, error: true });
  });
  it('accepts comma decimal separator', () => {
    expect(parseLine('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 3,50 Sekunden'))
      .toMatchObject({ type: 'end', elapsedSec: 3.5 });
  });
  it('returns null for non-process lines', () => {
    expect(parseLine('Server startup complete.')).toBeNull();
  });
  it('parses German "abnormal beendet" error end without elapsed', () => {
    expect(parseLine('Prozess "P": Ausführung abnormal beendet.'))
      .toEqual({ type: 'end', name: 'P', elapsedSec: null, error: true });
  });
  it('parses English "ended in error" without elapsed', () => {
    expect(parseLine('Process "P": execution ended in error'))
      .toEqual({ type: 'end', name: 'P', elapsedSec: null, error: true });
  });

  // LOW: a TI LogOutput line that merely QUOTES the wording must not close the run.
  // The genuine end phrase follows the process name directly ("Ausführung wurde mit
  // Fehlern beendet"); anything behind a further ':' segment is process output.
  it('does NOT treat a LogOutput line quoting the error wording as an end', () => {
    expect(parseLine('Prozess "A": Zeile 5: Text mit Fehlern beendet? no')).toBeNull();
  });

  // LOW-1: the gap between name and "elapsed time" must be able to cross a further
  // quoted token (data source, file name) — a quote-free gap silently drops the end
  // line and the run then shows 'running' forever.
  it('parses an end line whose message contains a further quoted token', () => {
    expect(parseLine('Process "P" ended, data source "C:\\tmp\\x.csv", elapsed time 3.00 seconds'))
      .toEqual({ type: 'end', name: 'P', elapsedSec: 3.0, error: false });
  });
  it('parses a DE end line with a quoted token before the elapsed value', () => {
    expect(parseLine('Prozess "P": Datenquelle "D:\\in\\a.csv" verstrichene Zeit 1,50 Sekunden'))
      .toMatchObject({ type: 'end', name: 'P', elapsedSec: 1.5 });
  });

  // LOW: `"(.+?)"…".*?"` backtracks quadratically on quote-dense lines. With
  // `"([^"]+)"` + a gap that consumes quoted tokens atomically the input is linear.
  it('stays linear on quote-dense lines (no catastrophic backtracking)', () => {
    const line = 'Prozess "A": ' + '"x" '.repeat(12000); // ~48 KB, ~12k quote pairs
    const t0 = Date.now();
    expect(parseLine(line)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(200);
  });

  // ── Compile failure: the only end form TM1 writes BEFORE the run ever starts ──
  it('parses the German compile-failure verdict as an error end', () => {
    expect(parseLine('Prozess "}zzP": Fehler in Zeile 2\nVariable "recordnumber" ist nicht definiert.\nIF(RecordNumber<=8);: Der Prozess konnte nicht initialisiert werden'))
      .toEqual({ type: 'end', name: '}zzP', elapsedSec: null, error: true, initFail: true });
  });

  it('parses the English compile-failure verdict as an error end', () => {
    expect(parseLine('Process "P": Error on line 2: The process could not be initialized'))
      .toEqual({ type: 'end', name: 'P', elapsedSec: null, error: true, initFail: true });
  });

  // The `Fehler in Zeile N` HEAD also introduces ordinary RUNTIME errors, whose real
  // end line still arrives. Only the trailing verdict says the run never started, so
  // only the verdict may close it — otherwise the run ends before its own end line.
  it('leaves a runtime-error DETAIL line without the verdict unmatched', () => {
    expect(parseLine('Prozess "P": Fehler in Zeile 42\nUngültiger Schlüssel: Dimensionsname: "D", Elementname: "x"')).toBeNull();
  });

  // Same M3 reasoning as the other end forms: a TI LogOutput line QUOTING the verdict
  // must not close the run, so the verdict has to close the message.
  it('does NOT treat a LogOutput line quoting the compile verdict as an end', () => {
    expect(parseLine('Prozess "P": Der Prozess konnte nicht initialisiert werden - meldet das Log, sagt der Text weiter')).toBeNull();
  });
});

// Entries in FETCHED order = newest-first (REST $orderby TimeStamp desc).
const e = (Message: string, TimeStamp: string) => ({ Message, TimeStamp, Level: 'INFO' });

const CLEAN = [
  e('Prozess "## test1":  Ausführung normal beendet, verstrichene Zeit 8.03 Sekunden', '2026-07-23T21:55:12.109'),
  e('Prozess "##sleep":  Ausführung normal beendet, verstrichene Zeit 1.01 Sekunden', '2026-07-23T21:55:11.100'),
  e('Prozess "##sleep":  Ausführung normal beendet, verstrichene Zeit 3.00 Sekunden', '2026-07-23T21:55:10.094'),
  e('Process "##sleep" run from process "## test1" by user "flameY3T1"', '2026-07-23T21:55:10.094'),
  e('Process "##sleep" run from process "## test1" by user "flameY3T1"', '2026-07-23T21:55:07.092'),
  e('Process "## test1" executed by user "flameY3T1"', '2026-07-23T21:55:04.077'),
];

describe('analyze — call tree', () => {
  it('reconstructs one root with two children and correct self-time', () => {
    const r = analyze(CLEAN);
    expect(r.parsedRuns).toBe(1);
    expect(r.trees).toHaveLength(1);
    const root = r.trees[0];
    expect(root.name).toBe('## test1');
    expect(root.elapsedSec).toBe(8.03);
    expect(root.status).toBe('ok');
    // Children are display-ordered newest-started first: the :10.094 run (1.01s)
    // before the :07.092 run (3.00s) — see the same-millisecond test below for why
    // the 3.00s end belongs to the EARLIER start.
    expect(root.children.map(c => c.elapsedSec)).toEqual([1.01, 3.0]);
    // self = 8.03 - (3.00 + 1.01) = 4.02
    expect(root.selfSec).toBe(4.02);
    expect(root.selfPct).toBeCloseTo(50.06, 1);
    expect(root.children[0].selfSec).toBe(1.01);
    expect(root.children[0].selfPct).toBeCloseTo(12.58, 1);
    expect(root.children.every(c => !c.ambiguous)).toBe(true);
  });

  // CLEAN[2]/CLEAN[3] share the millisecond 21:55:10.094 (one end, one start) and
  // `$orderby=TimeStamp desc` gives no tie-break, so the start may be walked before
  // the end. Pinned behaviour: the 3.00s end is paired by ELAPSED PLAUSIBILITY with
  // the run started at :07.092 (delta 3.002s), never with the run starting in the
  // same millisecond (delta 0s) — regardless of the order the two entries arrive in.
  it('pairs a same-millisecond start/end pair by elapsed time, not by arrival order', () => {
    const swapped = [...CLEAN];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    for (const input of [CLEAN, swapped]) {
      const root = analyze(input).trees[0];
      const early = root.children.find(c => c.startTs.endsWith('07.092'))!;
      const late = root.children.find(c => c.startTs.endsWith('10.094'))!;
      expect(early.elapsedSec).toBe(3.0);
      expect(late.elapsedSec).toBe(1.01);
    }
  });

  it('marks a start without matching end as running', () => {
    const r = analyze([e('Process "P" executed by user "U"', '2026-07-23T10:00:00')]);
    expect(r.trees[0].status).toBe('running');
    expect(r.trees[0].elapsedSec).toBeNull();
    expect(r.trees[0].selfSec).toBeNull();
  });

  it('marks a child whose parent is outside the window as orphan root', () => {
    const r = analyze([
      e('Prozess "C":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-07-23T10:00:02'),
      e('Process "C" run from process "GONE" by user "U"', '2026-07-23T10:00:01'),
    ]);
    expect(r.parsedRuns).toBe(1);
    expect(r.trees[0].name).toBe('C');
    expect(r.trees[0].status).toBe('orphan');
    expect(r.trees[0].elapsedSec).toBe(1.0);
  });

  it('an orphan child that later errors is marked error, not orphan (failure not lost)', () => {
    const r = analyze([
      e('Prozess "C": Ausführung wurde mit Fehlern beendet. Fehlerdatei: <x.log>', '2026-07-23T10:00:02'),
      e('Process "C" run from process "GONE" by user "U"', '2026-07-23T10:00:01'),
    ]);
    expect(r.trees[0].name).toBe('C');
    expect(r.trees[0].status).toBe('error');
  });

  it('a rollback closes the run as error with null elapsed', () => {
    const r = analyze([
      e('Process "## test1": Execution rolling back due to lock exception', '2026-07-23T19:53:03.719'),
      e('Process "## test1" executed by user "U"', '2026-07-23T19:53:03.716'),
    ]);
    expect(r.trees[0].status).toBe('error');
    expect(r.trees[0].elapsedSec).toBeNull();
  });

  it('counts non-process lines as ignored', () => {
    const r = analyze([e('Some unrelated log line', '2026-07-23T10:00:00')]);
    expect(r.ignoredLines).toBe(1);
    expect(r.entryCount).toBe(1);
    expect(r.parsedRuns).toBe(0);
  });

  it('reads the alternate Timestamp/Text field names', () => {
    const r = analyze([
      { Timestamp: '2026-07-23T10:00:05', Text: 'Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden' },
      { Timestamp: '2026-07-23T10:00:00', Text: 'Process "P" executed by user "U"' },
    ]);
    expect(r.ignoredLines).toBe(0);
    expect(r.trees[0].startTs).toBe('2026-07-23T10:00:00');
    expect(r.trees[0].elapsedSec).toBe(5.0);
  });

  it('nests a process that recurses into itself', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-07-23T10:00:03'),
      e('Process "P" run from process "P" by user "U"', '2026-07-23T10:00:01'),
      e('Process "P" executed by user "U"', '2026-07-23T10:00:00'),
    ]);
    expect(r.trees).toHaveLength(1);
    const outer = r.trees[0];
    expect(outer.elapsedSec).toBe(5.0);
    expect(outer.children).toHaveLength(1);
    expect(outer.children[0].elapsedSec).toBe(1.0);
    expect(outer.selfSec).toBe(4.0);
    expect(outer.ambiguous).toBe(false);
  });
});

// ── H4: concurrent runs of one process name ──────────────────────────────────
describe('analyze — concurrent same-name runs (H4)', () => {
  it('pairs ends by elapsed plausibility, not LIFO (runtimes not swapped)', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 100.00 Sekunden', '2026-07-23T10:01:40'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:06'),
      e('Process "P" executed by user "bob"', '2026-07-23T10:00:01'),
      e('Process "P" executed by user "alice"', '2026-07-23T10:00:00'),
    ]);
    const first = r.trees.find(n => n.startTs === '2026-07-23T10:00:00')!;
    const second = r.trees.find(n => n.startTs === '2026-07-23T10:00:01')!;
    expect(first.elapsedSec).toBe(100.0);
    expect(second.elapsedSec).toBe(5.0);
    // Pairing is right, but the two starts are only 1 s apart — a 1 s log-write lag
    // would swap the owners, so the pairing is reported as uncertain (LOW-2).
    expect(first.ambiguous).toBe(true);
    expect(second.ambiguous).toBe(true);
  });

  it('reports a confident pairing when the starts are far enough apart', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 100.00 Sekunden', '2026-07-23T10:01:40'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:35'),
      e('Process "P" executed by user "bob"', '2026-07-23T10:00:30'),
      e('Process "P" executed by user "alice"', '2026-07-23T10:00:00'),
    ]);
    const first = r.trees.find(n => n.startTs === '2026-07-23T10:00:00')!;
    const second = r.trees.find(n => n.startTs === '2026-07-23T10:00:30')!;
    expect(first.elapsedSec).toBe(100.0);
    expect(second.elapsedSec).toBe(5.0);
    expect(first.ambiguous).toBe(false);
    expect(second.ambiguous).toBe(false);
  });

  // LOW-2: a start spacing in the order of the plausible log-write lag makes the
  // arithmetic winner a coin flip — it must NOT be reported as confident.
  it('flags a pairing whose runner-up is within the plausible logging lag', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 8.00 Sekunden', '2026-07-23T10:00:10'),
      e('Process "P" executed by user "bob"', '2026-07-23T10:00:02'),
      e('Process "P" executed by user "alice"', '2026-07-23T10:00:00'),
    ]);
    const closed = r.trees.find(n => n.elapsedSec === 8.0)!;
    expect(closed).toBeDefined();
    expect(r.trees.every(n => n.ambiguous)).toBe(true);
  });

  // LOW-3: for sub-second runs a FIXED 0.5 s runner-up margin flags everything.
  // The margin has to scale with the reported runtime.
  it('does not over-flag two short runs that are arithmetically clean', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 0.40 Sekunden', '2026-07-23T10:00:00.700'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 0.40 Sekunden', '2026-07-23T10:00:00.400'),
      e('Process "P" executed by user "bob"', '2026-07-23T10:00:00.300'),
      e('Process "P" executed by user "alice"', '2026-07-23T10:00:00.000'),
    ]);
    expect(r.trees).toHaveLength(2);
    expect(r.trees.every(n => n.elapsedSec === 0.4)).toBe(true);
    expect(r.trees.every(n => !n.ambiguous)).toBe(true);
    expect(r.stats.find(s => s.name === 'P')!.uncertain).toBe(0);
  });

  it('attaches a child to the parent instance with the matching user', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 60.00 Sekunden', '2026-07-23T10:01:00'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 50.00 Sekunden', '2026-07-23T10:00:51'),
      e('Prozess "C":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-07-23T10:00:03'),
      e('Process "C" run from process "P" by user "alice"', '2026-07-23T10:00:02'),
      e('Process "P" executed by user "bob"', '2026-07-23T10:00:01'),
      e('Process "P" executed by user "alice"', '2026-07-23T10:00:00'),
    ]);
    const alice = r.trees.find(n => n.startTs === '2026-07-23T10:00:00')!;
    const bob = r.trees.find(n => n.startTs === '2026-07-23T10:00:01')!;
    expect(alice.elapsedSec).toBe(60.0);
    expect(alice.children.map(c => c.name)).toEqual(['C']);
    expect(bob.children).toEqual([]);
    expect(alice.selfSec).toBe(59.0);
    expect(alice.children[0].ambiguous).toBe(false);
  });

  it('marks BOTH runs ambiguous when an end cannot be attributed', () => {
    // Two runs started at the same instant, two different runtimes: the first end
    // line fits both candidates equally well, and the pick decides WHICH row gets
    // the 5 s and which the 7 s — a visible difference, so the flag must stay.
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 7.00 Sekunden', '2026-07-23T10:00:07'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Process "P" executed by chore "B"', '2026-07-23T10:00:00'),
      e('Process "P" executed by chore "A"', '2026-07-23T10:00:00'),
    ]);
    expect(r.trees).toHaveLength(2);
    expect(r.trees.every(n => n.ambiguous)).toBe(true);
    expect(r.stats.find(s => s.name === 'P')!.uncertain).toBe(2);
  });

  // The flag is a warning that the tree might be wrong. Where every candidate
  // renders identically, picking the other one yields the very same tree, so the
  // warning is about a difference that does not exist — on a live 11.8 log this is
  // the bulk of the flags (a process re-run within milliseconds, 0.00 s each time)
  // and it buries the ties that DO matter.
  it('drops the flag when the tied runs are indistinguishable in the result', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Process "P" executed by chore "B"', '2026-07-23T10:00:00'),
      e('Process "P" executed by chore "A"', '2026-07-23T10:00:00'),
    ]);
    expect(r.trees).toHaveLength(2);
    expect(r.trees.every(n => n.ambiguous)).toBe(false);
    const p = r.stats.find(s => s.name === 'P')!;
    expect(p.uncertain).toBe(0);
    // …and the runtimes are then real measurements again, not guesses parked in
    // `uncertainSec`.
    expect(p.totalSec).toBe(10.0);
    expect(p.uncertainSec).toBe(0);
  });

  // A node that takes part in even ONE unresolvable tie keeps its flag, even if it
  // is also part of a tie that on its own would be suppressible.
  it('keeps the flag on a node that is also tied to a distinguishable run', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 9.00 Sekunden', '2026-07-23T10:00:09'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Process "P" executed by chore "C"', '2026-07-23T10:00:00'),
      e('Process "P" executed by chore "B"', '2026-07-23T10:00:00'),
      e('Process "P" executed by chore "A"', '2026-07-23T10:00:00'),
    ]);
    expect(r.trees.every(n => n.ambiguous)).toBe(true);
  });

  it('marks an error end without elapsed ambiguous while two runs are open', () => {
    const r = analyze([
      e('Prozess "P": Ausführung wurde mit Fehlern beendet. Fehlerdatei: <x.log>', '2026-07-23T10:00:09'),
      e('Process "P" executed by user "bob"', '2026-07-23T10:00:01'),
      e('Process "P" executed by user "alice"', '2026-07-23T10:00:00'),
    ]);
    expect(r.trees.every(n => n.ambiguous)).toBe(true);
    expect(r.trees.filter(n => n.status === 'error')).toHaveLength(1);
  });
});

// ── M3: end lines without a start in the fetched window ──────────────────────
/**
 * A run whose end line never arrives stays in the open-candidate pool. Without an age
 * limit it kept competing for every later line of the same name, so runs that are
 * perfectly well determined were flagged `≈` and landed in the "Uncertain" column next
 * to genuinely uncertain ones — which is exactly what devalues the marker.
 *
 * The window may only ever DISCARD a candidate while a plausible one survives, so the
 * two directions below both have to hold: stale candidates stop creating ambiguity, and
 * a genuinely long-running parent keeps adopting its children.
 */
describe('analyze — stale open runs (candidate plausibility window)', () => {
  it('drops a two-day-old open run as a parent candidate instead of flagging the child', () => {
    const r = analyze([
      e('Process "C" run from process "P" by user "u"', '2026-07-25T10:00:05'),
      e('Process "P" executed by user "u"', '2026-07-25T10:00:00'),
      // never closed — TM1 wrote no end line for it at all
      e('Process "P" executed by user "u"', '2026-07-23T10:00:00'),
    ]);
    const fresh = r.trees.find(n => n.startTs === '2026-07-25T10:00:00')!;
    const stale = r.trees.find(n => n.startTs === '2026-07-23T10:00:00')!;
    expect(fresh.children.map(c => c.name)).toEqual(['C']);
    expect(fresh.children[0].ambiguous).toBe(false);
    expect(fresh.ambiguous).toBe(false);
    expect(stale.ambiguous).toBe(false);
    expect(stale.children).toEqual([]);
    // Display is NOT changed: an open run whose end fell outside the fetched window is
    // honestly `running`. It only stops being a candidate.
    expect(stale.status).toBe('running');
    expect(r.stats.find(s => s.name === 'P')!.uncertain).toBe(0);
  });

  it('still lets a genuinely long-running parent compete for a late child', () => {
    // Four hours is an ordinary overnight-load runtime — well inside the window, so
    // both instances remain plausible parents and the tie is reported (H4).
    const r = analyze([
      e('Process "C" run from process "P" by user "u"', '2026-07-25T10:00:00'),
      e('Process "P" executed by user "u"', '2026-07-25T09:59:55'),
      e('Process "P" executed by user "u"', '2026-07-25T06:00:00'),
    ]);
    const long = r.trees.find(n => n.startTs === '2026-07-25T06:00:00')!;
    const recent = r.trees.find(n => n.startTs === '2026-07-25T09:59:55')!;
    expect(long.ambiguous).toBe(true);
    expect(recent.ambiguous).toBe(true);
    expect(recent.children.map(c => c.name)).toEqual(['C']);
    expect(recent.children[0].ambiguous).toBe(true);
  });

  it('adopts the child of a days-old parent when that parent is the ONLY candidate', () => {
    // The window can never orphan anything: a sole candidate wins however old it is.
    const r = analyze([
      e('Process "C" run from process "P" by user "u"', '2026-07-25T10:00:00'),
      e('Process "P" executed by user "u"', '2026-07-22T10:00:00'),
    ]);
    expect(r.trees).toHaveLength(1);
    const p = r.trees[0];
    expect(p.name).toBe('P');
    expect(p.children.map(c => c.name)).toEqual(['C']);
    expect(p.children[0].status).not.toBe('orphan');
    expect(p.ambiguous).toBe(false);
  });

  it('does not let a stale run make an end line without a runtime ambiguous', () => {
    // An error end carries no elapsed value, so the matcher has no arithmetic at all —
    // with the stale run still in the pool this pairing was a coin flip.
    const r = analyze([
      e('Prozess "P":  Ausführung wurde mit Fehlern beendet.', '2026-07-25T10:00:05'),
      e('Process "P" executed by user "u"', '2026-07-25T10:00:00'),
      e('Process "P" executed by user "u"', '2026-07-23T10:00:00'),
    ]);
    const closed = r.trees.find(n => n.status === 'error')!;
    expect(closed.startTs).toBe('2026-07-25T10:00:00');
    expect(r.trees.every(n => !n.ambiguous)).toBe(true);
    // Filtering happens at lookup time only — nothing was starved into a stray root.
    expect(r.trees.every(n => !n.truncated)).toBe(true);
    expect(r.trees).toHaveLength(2);
  });

  // H4 must survive the window: it may only remove candidates that cannot compete,
  // never suppress a tie between candidates that genuinely can.
  it('still flags a tie between two fresh runs that truly cannot be told apart', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung wurde mit Fehlern beendet.', '2026-07-25T10:00:05'),
      e('Process "P" executed by user "u"', '2026-07-25T10:00:02'),
      e('Process "P" executed by user "u"', '2026-07-25T10:00:00'),
      e('Process "P" executed by user "u"', '2026-07-23T10:00:00'),
    ]);
    const stale = r.trees.find(n => n.startTs === '2026-07-23T10:00:00')!;
    const fresh = r.trees.filter(n => n.startTs.startsWith('2026-07-25'));
    expect(fresh).toHaveLength(2);
    expect(fresh.every(n => n.ambiguous)).toBe(true);
    // The stale run took no part in the decision, so it must not be marked either.
    expect(stale.ambiguous).toBe(false);
    expect(r.stats.find(s => s.name === 'P')!.uncertain).toBe(2);
  });
});

describe('analyze — truncated window (M3)', () => {
  it('marks an end without a start as truncated and does NOT fabricate a start time', () => {
    const r = analyze([
      e('Prozess "Sub":  Ausführung normal beendet, verstrichene Zeit 2.00 Sekunden', '2026-07-23T10:00:05'),
    ]);
    expect(r.trees).toHaveLength(1);
    const n = r.trees[0];
    expect(n.truncated).toBe(true);
    expect(n.startTs).toBe('');
    expect(n.elapsedSec).toBe(2.0);
  });

  it('collapses a rollback + final end pair for the same run into ONE run', () => {
    const r = analyze([
      e('Prozess "P": Ausführung wurde mit Fehlern beendet. Fehlerdatei: <x.log>', '2026-07-23T10:00:06'),
      e('Process "P": Execution rolling back due to lock exception', '2026-07-23T10:00:05'),
    ]);
    expect(r.parsedRuns).toBe(1);
    expect(r.trees).toHaveLength(1);
    const p = r.stats.find(s => s.name === 'P')!;
    expect(p.calls).toBe(1);
    expect(p.failures).toBe(1);
  });

  it('collapses rollback + final end for a run that DID start in the window', () => {
    const r = analyze([
      e('Prozess "P": Ausführung wurde mit Fehlern beendet. Fehlerdatei: <x.log>', '2026-07-23T10:00:06'),
      e('Process "P": Execution rolling back due to lock exception', '2026-07-23T10:00:05'),
      e('Process "P" executed by user "U"', '2026-07-23T10:00:00'),
    ]);
    expect(r.parsedRuns).toBe(1);
    expect(r.trees[0].truncated).toBe(false);
    expect(r.trees[0].status).toBe('error');
    expect(r.stats.find(s => s.name === 'P')!.failures).toBe(1);
  });

  // MED-2: the rollback merge must be bounded. A LATER, unrelated run of the same
  // name whose start was cut off must not be folded into the rolled-back run — that
  // hides one run and gives the survivor a runtime it cannot have had.
  it('does not merge an unrelated later end into a rolled-back run', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 99.00 Sekunden', '2026-07-23T10:00:20'),
      e('Process "P": Execution rolling back due to lock exception', '2026-07-23T10:00:05'),
      e('Process "P" executed by user "U"', '2026-07-23T10:00:00'),
    ]);
    expect(r.parsedRuns).toBe(2);
    expect(r.trees).toHaveLength(2);
    const started = r.trees.find(n => n.startTs === '2026-07-23T10:00:00')!;
    expect(started.status).toBe('error');
    expect(started.elapsedSec).toBeNull();
    expect(started.truncated).toBe(false);
    const stray = r.trees.find(n => n.truncated)!;
    expect(stray.elapsedSec).toBe(99.0);
    const p = r.stats.find(s => s.name === 'P')!;
    expect(p.calls).toBe(2);
    expect(p.failures).toBe(1);
  });

  it('still merges a late final end whose runtime fits the rolled-back run exactly', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 20.00 Sekunden', '2026-07-23T10:00:20'),
      e('Process "P": Execution rolling back due to lock exception', '2026-07-23T10:00:05'),
      e('Process "P" executed by user "U"', '2026-07-23T10:00:00'),
    ]);
    expect(r.parsedRuns).toBe(1);
    expect(r.trees[0].elapsedSec).toBe(20.0);
    expect(r.trees[0].status).toBe('error');
  });

  it('keeps two genuinely separate truncated runs apart', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-07-23T10:00:20'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 2.00 Sekunden', '2026-07-23T10:00:05'),
    ]);
    expect(r.parsedRuns).toBe(2);
    expect(r.stats.find(s => s.name === 'P')!.calls).toBe(2);
  });
});

// ── M5: chores ───────────────────────────────────────────────────────────────
describe('analyze — chores (M5)', () => {
  it('nests a chore-launched process under its chore and keeps the chore out of the stats', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 4.00 Sekunden', '2026-07-23T10:00:05'),
      e('Process "P" executed by chore "Nightly"', '2026-07-23T10:00:01'),
      e('Chore "Nightly" executed by user "TM1_SERVICE"', '2026-07-23T10:00:00'),
    ]);
    expect(r.trees).toHaveLength(1);
    const chore = r.trees[0];
    expect(chore.kind).toBe('chore');
    expect(chore.status).toBe('group');
    expect(chore.children.map(c => c.name)).toEqual(['P']);
    expect(chore.children[0].elapsedSec).toBe(4.0);
    expect(chore.children[0].selfPct).toBeCloseTo(100, 5);
    // The chore container is not a run of its own.
    expect(r.parsedRuns).toBe(1);
    expect(r.stats.map(s => s.name)).toEqual(['P']);
  });

  it('never emits a zero-second stats row for a chore without processes', () => {
    const r = analyze([
      e('Chore "Nightly Batch" executed by user "TM1_SERVICE"', '2026-07-23T10:00:00'),
    ]);
    expect(r.stats).toEqual([]);
    expect(r.parsedRuns).toBe(0);
    expect(r.trees[0].kind).toBe('chore');
    expect(r.trees[0].status).toBe('group');
    expect(r.trees[0].elapsedSec).toBeNull();
  });

  // MED-1: a process end line must never close a same-named CHORE node. The chore
  // would turn into an 'ok' run and — because chores are skipped in the stats — the
  // process run would vanish from the statistics completely.
  it('does not close a chore node with a same-named process end line', () => {
    const r = analyze([
      e('Prozess "Nightly":  Ausführung normal beendet, verstrichene Zeit 4.00 Sekunden', '2026-07-23T10:00:05'),
      e('Chore "Nightly" executed by user "TM1_SERVICE"', '2026-07-23T10:00:00'),
    ]);
    const chore = r.trees.find(n => n.kind === 'chore')!;
    expect(chore.status).toBe('group');
    expect(chore.elapsedSec).toBeNull();
    const proc = r.trees.find(n => n.kind === 'process')!;
    expect(proc.truncated).toBe(true);
    expect(proc.elapsedSec).toBe(4.0);
    expect(r.parsedRuns).toBe(1);
    expect(r.stats.map(s => s.name)).toEqual(['Nightly']);
    expect(r.stats[0].totalSec).toBe(4.0);
  });

  it('does not attach a child to a same-named chore as parent', () => {
    const r = analyze([
      e('Process "C" run from process "Nightly" by user "U"', '2026-07-23T10:00:01'),
      e('Chore "Nightly" executed by user "TM1_SERVICE"', '2026-07-23T10:00:00'),
    ]);
    const chore = r.trees.find(n => n.kind === 'chore')!;
    expect(chore.children).toEqual([]);
    const child = r.trees.find(n => n.name === 'C')!;
    expect(child.status).toBe('orphan');
  });

  it('keeps a chore-launched process as a root when its chore is outside the window', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 4.00 Sekunden', '2026-07-23T10:00:05'),
      e('Process "P" executed by chore "Nightly"', '2026-07-23T10:00:01'),
    ]);
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0].name).toBe('P');
    expect(r.parsedRuns).toBe(1);
  });
});

// ── M6: impossible self-time ─────────────────────────────────────────────────
describe('analyze — inconsistent runtimes (M6)', () => {
  it('clamps selfPct AND flags the child-longer-than-parent case', () => {
    const r = analyze([
      e('Prozess "R":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden', '2026-07-23T10:00:51'),
      e('Prozess "C":  Ausführung normal beendet, verstrichene Zeit 50.00 Sekunden', '2026-07-23T10:00:51'),
      e('Process "C" run from process "R" by user "U"', '2026-07-23T10:00:01'),
      e('Process "R" executed by user "U"', '2026-07-23T10:00:00'),
    ]);
    const root = r.trees[0];
    const child = root.children[0];
    expect(child.elapsedSec).toBe(50.0);
    // 50s self inside a 1s root would be 5000% — clamp for text AND bar…
    expect(child.selfPct).toBe(100);
    // …and flag it instead of hiding the impossibility behind the clamp.
    expect(child.inconsistent).toBe(true);
    expect(root.selfSec).toBe(0);
    expect(root.inconsistent).toBe(true);
  });
});

describe('analyze — statistics', () => {
  it('aggregates per process name, sorted by total elapsed desc', () => {
    const { stats } = analyze(CLEAN);
    expect(stats.map(s => s.name)).toEqual(['## test1', '##sleep']);

    const test1 = stats.find(s => s.name === '## test1')!;
    expect(test1.calls).toBe(1);
    expect(test1.totalSec).toBe(8.03);
    expect(test1.avgSec).toBe(8.03);
    expect(test1.uncertain).toBe(0);

    const sleep = stats.find(s => s.name === '##sleep')!;
    expect(sleep.calls).toBe(2);
    expect(sleep.totalSec).toBe(4.01);
    expect(sleep.avgSec).toBe(2.005);
    expect(sleep.minSec).toBe(1.01);
    expect(sleep.maxSec).toBe(3.0);
    expect(sleep.failures).toBe(0);
  });

  it('counts a failed/running call in calls + failures but not in time columns', () => {
    const r = analyze([
      e('Prozess "P":  Ausführung wurde mit Fehlern beendet. Fehlerdatei: <x.log>', '2026-07-23T10:00:02'),
      e('Process "P" run from process "R" by user "U"', '2026-07-23T10:00:01'),
      e('Process "R" executed by user "U"', '2026-07-23T10:00:00'),
    ]);
    const p = r.stats.find(s => s.name === 'P')!;
    expect(p.calls).toBe(1);
    expect(p.failures).toBe(1);
    expect(p.totalSec).toBe(0);
    expect(p.avgSec).toBe(0);
  });

  // LOW-4: a runtime that could not be attributed to a single instance must not sit
  // in total/avg/min/max as if it were measured — it is reported separately.
  it('keeps ambiguous runtimes out of the time columns and reports them separately', () => {
    // Distinct runtimes, so the tie really does change which row shows what and the
    // flag survives the "indistinguishable tie" suppression.
    const r = analyze([
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 7.00 Sekunden', '2026-07-23T10:00:07'),
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 5.00 Sekunden', '2026-07-23T10:00:05'),
      e('Process "P" executed by chore "B"', '2026-07-23T10:00:00'),
      e('Process "P" executed by chore "A"', '2026-07-23T10:00:00'),
    ]);
    const p = r.stats.find(s => s.name === 'P')!;
    expect(p.calls).toBe(2);
    expect(p.uncertain).toBe(2);
    expect(p.totalSec).toBe(0);
    expect(p.avgSec).toBe(0);
    expect(p.minSec).toBe(0);
    expect(p.maxSec).toBe(0);
    // Not silently dropped: the excluded time stays visible in its own field.
    expect(p.uncertainSec).toBe(12.0);
  });

  it('a running-only call (no matching end) is counted in calls but excluded from times', () => {
    const r = analyze([
      // second start of "P", never closes -> stays 'running', elapsedSec:null
      e('Process "P" executed by user "U"', '2026-07-23T10:00:20'),
      // first "P" run completes normally with elapsed 2.50s
      e('Prozess "P":  Ausführung normal beendet, verstrichene Zeit 2.50 Sekunden', '2026-07-23T10:00:11'),
      e('Process "P" executed by user "U"', '2026-07-23T10:00:10'),
    ]);
    expect(r.parsedRuns).toBe(2);
    const running = r.trees.find(n => n.status === 'running')!;
    expect(running).toBeDefined();
    expect(running.elapsedSec).toBeNull();

    const p = r.stats.find(s => s.name === 'P')!;
    expect(p.calls).toBe(2);
    // only the one completed run (2.50s) feeds avg/min/max/total — the running
    // instance (elapsedSec:null) must not corrupt these.
    expect(p.totalSec).toBe(2.5);
    expect(p.avgSec).toBe(2.5);
    expect(p.minSec).toBe(2.5);
    expect(p.maxSec).toBe(2.5);
  });
});

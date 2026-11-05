import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseLine, analyze, type RawEntry, type CallNode } from '../../messageLog/messageLogAnalysisPure';

/**
 * Regression guard built from VERBATIM lines of a live TM1 11.8 message log.
 *
 * The parser was written against a synthetic line set and then run against 5000
 * real entries, which surfaced five end-line variants it did not recognise — every
 * run whose end line falls into one of them stays at `running` forever. The fixture
 * is a representative slice of that log (fetched order = newest first, exactly what
 * `/MessageLogEntries?$orderby=TimeStamp desc` returns) and covers all five plus the
 * lines that must stay unmatched.
 */
const FIXTURE: RawEntry[] = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/messageLog', 'real-tm1-11.8-end-variants.json'), 'utf-8'),
);

function flatten(nodes: CallNode[]): CallNode[] {
  return nodes.flatMap(n => [n, ...flatten(n.children)]);
}

// ── The individual variants, each on the exact bytes the server wrote ──────────
describe('parseLine — end-line variants from live TM1 11.8', () => {
  it('recognises the chore runtime line', () => {
    expect(parseLine('Chore "ttt" time = 0.11 seconds'))
      .toEqual({ type: 'choreEnd', name: 'ttt', elapsedSec: 0.11 });
  });

  it('recognises the chore finished line', () => {
    expect(parseLine('Chore "ttt" finished executing'))
      .toEqual({ type: 'choreEnd', name: 'ttt', elapsedSec: null });
  });

  it('still reads the chore START variants as starts, not as ends', () => {
    expect(parseLine('Chore "ttt" executed by scheduler'))
      .toEqual({ type: 'top', name: 'ttt', kind: 'chore' });
    expect(parseLine('Chore "ZZ_MCP_LIVE_CHORE_A" executed by user "tm1user"'))
      .toEqual({ type: 'top', name: 'ZZ_MCP_LIVE_CHORE_A', kind: 'chore' });
  });

  // Note the DOUBLED colon behind the name — RE_END_ERROR's colon-free gap cannot
  // cross it, which is why this needs its own pattern.
  it('recognises the aborted end (doubled colon, no elapsed) as an error end', () => {
    expect(parseLine('Prozess "}tm1ide_dspreview": : Die Ausführung wurde abgebrochen. Fehlerdatei: <TM1ProcessError_20260725111242_83307564_}tm1ide_dspreview.log>'))
      .toEqual({ type: 'end', name: '}tm1ide_dspreview', elapsedSec: null, error: true });
  });

  // Same doubled colon, but the cause is named INSIDE the sentence: `Die Ausführung
  // wurde von der ProcessQuit-Funktion abgebrochen.` — the words the abort pattern
  // required adjacent are split by the cause phrase, so the line fell through every
  // end pattern and the run sat at `running` (call tree + statistics both wrong).
  it('recognises the ProcessQuit abort (cause named between the verb and "abgebrochen")', () => {
    expect(parseLine('Prozess "1002 Test2 Sleep3_Quit": : Die Ausführung wurde von der ProcessQuit-Funktion abgebrochen.'))
      .toEqual({ type: 'end', name: '1002 Test2 Sleep3_Quit', elapsedSec: null, error: true });
  });

  it('recognises the English ProcessQuit abort', () => {
    expect(parseLine('Process "1002 Test2 Sleep3_Quit": : Execution was aborted by the ProcessQuit function.'))
      .toEqual({ type: 'end', name: '1002 Test2 Sleep3_Quit', elapsedSec: null, error: true });
  });

  // The English build is not live-evidenced, so the backstop must not depend on the
  // sentence opening with `Execution` — naming ProcessQuit plus an abort verb is enough.
  it.each([
    'Process "P": : Aborted by the ProcessQuit function.',
    'Process "P": : The process was terminated by ProcessQuit.',
    'Process "P": : Execution has been cancelled by the ProcessQuit function.',
    'Prozess "P": : Abbruch durch die ProcessQuit-Funktion, Ausführung abgebrochen.',
  ])('recognises a ProcessQuit abort regardless of wording: %s', line => {
    expect(parseLine(line)).toEqual({ type: 'end', name: 'P', elapsedSec: null, error: true });
  });

  // …but a TI `LogOutput` line merely TALKING about ProcessQuit must not end the run:
  // the tokens have to sit in the first segment behind the name, and a LogOutput body
  // is separated from it by the colon TM1 writes after the line number.
  it('does not end a run on a LogOutput line that mentions ProcessQuit', () => {
    expect(parseLine('Prozess "P": Zeile 42: kein ProcessQuit, nichts abgebrochen')).toBeNull();
  });

  it('recognises the ProcessBreak end as a NON-error end', () => {
    expect(parseLine('Prozess "}bedrock.cube.data.copy":  mit ProcessBreak beendet'))
      .toEqual({ type: 'end', name: '}bedrock.cube.data.copy', elapsedSec: null, error: false });
  });

  // German prefix, English body — 11.8 mixes languages inside ONE log file, so a
  // prefix must never be taken as evidence for the language of the body.
  it('recognises an English message body under a German prefix', () => {
    expect(parseLine('Prozess "}zzDir":  finished executing normally.  Check new message in the file: <TM1ProcessError_20260725075432_58816196_}zzDir.log>'))
      .toEqual({ type: 'end', name: '}zzDir', elapsedSec: null, error: false });
  });

  it('recognises a German message body under an English prefix', () => {
    expect(parseLine('Process "}zzDir":  Ausführung normal beendet'))
      .toEqual({ type: 'end', name: '}zzDir', elapsedSec: null, error: false });
  });

  it('still prefers the elapsed-time form when the line carries a runtime', () => {
    expect(parseLine('Prozess "_test":  Ausführung normal beendet, verstrichene Zeit 0.11 Sekunden'))
      .toEqual({ type: 'end', name: '_test', elapsedSec: 0.11, error: false });
  });

  // ── Lines that MUST stay unmatched ──────────────────────────────────────────

  // ── The compile failure: an end line that does not look like one ────────────
  //
  // This is the ONLY end TM1 writes with no follow-up whatsoever — no runtime, no
  // "mit Fehlern beendet", nothing. Left unmatched, the run sat at `running` for the
  // rest of the log AND stayed an open candidate, which turned every later run of the
  // same name into a tie (15 such lines on the 5000-entry log; they alone accounted
  // for 15 of 33 `ambiguous` flags).
  it.each([
    ['}zzP', 'Prozess "}zzP": Fehler in Zeile 2\nVariable "recordnumber" ist nicht definiert.\nIF(RecordNumber<=8);: Der Prozess konnte nicht initialisiert werden'],
    ['zzz_smoke_ti', 'Prozess "zzz_smoke_ti": Fehler in Zeile 1\nSyntaxfehler bei oder vor: \n1);\nfehlende Klammer: Der Prozess konnte nicht initialisiert werden'],
    ['__tm1ide_dimedit_b6xqv0aomrwed598', 'Prozess "__tm1ide_dimedit_b6xqv0aomrwed598": Fehler in Zeile 863\nUnerwartete Klammer\nElementAttrPutS(\'100001\',\'Stations_2\',\'100001\',\'Caption\');: Der Prozess konnte nicht initialisiert werden'],
  ])('reads the compile-failure verdict of %s as an error end', (name, line) => {
    expect(parseLine(line)).toEqual({ type: 'end', name, elapsedSec: null, error: true, initFail: true });
  });

  // The `Fehler in Zeile N` head on its own is the detail of an ordinary RUNTIME
  // error, whose real end line still arrives — closing on it would end the run before
  // its own end line and push that line onto the truncated-root path (M3).
  it('leaves the same head WITHOUT the verdict unmatched', () => {
    expect(parseLine('Prozess "##sleep": Fehler in Zeile 12\nUngültiger Schlüssel: Dimensionsname: "Datenquellen", Elementname (Schlüssel): ""')).toBeNull();
  });

  // DECISION: nameless runs stay out. TM1 logs them for transient processes it
  // deleted before it could resolve the name; in the live log the nameless END is
  // even written BEFORE its start line, so matching them would produce one
  // truncated stray root plus one node stuck at 'running' — and every unrelated
  // nameless run would share a single `""` statistics row.
  it('deliberately ignores nameless runs', () => {
    expect(parseLine('Process "" executed by user "tm1user"')).toBeNull();
    expect(parseLine('Prozess "":  Ausführung normal beendet, verstrichene Zeit 0.00 Sekunden')).toBeNull();
  });
});

/**
 * The whole run a user reported: one parent that calls eight children, one of them
 * exiting via `ProcessBreak` and the last one via `ProcessQuit`. Verbatim lines from
 * a live 11.8 German log, written oldest-first for readability and reversed into the
 * fetched order at the end; `ID` carries the server write sequence, which is the only
 * tie-break inside a shared millisecond.
 */
const QUIT_RUN: RawEntry[] = ([
  ['00.824', 'info', 'Process "1001 Test2" executed by user "Admin"'],
  ['00.825', 'info', 'Process "1002 Test2 Sleep3_ProcessBreak" run from process "1001 Test2" by user "Admin"'],
  ['01.037', 'info', 'Prozess "1002 Test2 Sleep3_ProcessBreak":  mit ProcessBreak beendet'],
  ['01.037', 'info', 'Process "1002 Test2 Sleep1" run from process "1001 Test2" by user "Admin"'],
  ['01.502', 'info', 'Prozess "1002 Test2 Sleep1":  Ausführung normal beendet, verstrichene Zeit 0.47 Sekunden'],
  ['01.502', 'info', 'Process "1002 Test2 Sleep1" run from process "1001 Test2" by user "Admin"'],
  ['01.612', 'info', 'Prozess "1002 Test2 Sleep1":  Ausführung normal beendet, verstrichene Zeit 0.11 Sekunden'],
  ['01.612', 'info', 'Process "1002 Test2 Sleep1" run from process "1001 Test2" by user "Admin"'],
  ['02.067', 'info', 'Prozess "1002 Test2 Sleep1":  Ausführung normal beendet, verstrichene Zeit 0.45 Sekunden'],
  ['02.067', 'info', 'Process "1002 Test2 Sleep2" run from process "1001 Test2" by user "Admin"'],
  ['02.223', 'info', 'Process "1002 Test2 Sleep1" run from process "1002 Test2 Sleep2" by user "Admin"'],
  ['02.488', 'info', 'Prozess "1002 Test2 Sleep1":  Ausführung normal beendet, verstrichene Zeit 0.26 Sekunden'],
  ['02.488', 'info', 'Prozess "1002 Test2 Sleep2":  Ausführung normal beendet, verstrichene Zeit 0.42 Sekunden'],
  ['02.488', 'info', 'Process "1002 Test2 Sleep3" run from process "1001 Test2" by user "Admin"'],
  ['02.861', 'info', 'Prozess "1002 Test2 Sleep3":  Ausführung normal beendet, verstrichene Zeit 0.37 Sekunden'],
  ['02.861', 'info', 'Process "1002 Test2 Sleep1" run from process "1001 Test2" by user "Admin"'],
  ['02.970', 'info', 'Prozess "1002 Test2 Sleep1":  Ausführung normal beendet, verstrichene Zeit 0.11 Sekunden'],
  ['02.970', 'info', 'Process "1002 Test2 Sleep3_Quit" run from process "1001 Test2" by user "Admin"'],
  ['03.126', 'error', 'Prozess "1002 Test2 Sleep3_Quit": : Die Ausführung wurde von der ProcessQuit-Funktion abgebrochen.'],
  ['03.129', 'error', 'Prozess "1001 Test2":  Ausführung wurde mit Fehlern beendet. Fehlerdatei: <TM1ProcessError_20260802063603_12626700_1001 Test2.log>'],
] as [string, string, string][]).map(([sec, Level, Message], i) => ({
  TimeStamp: `2026-08-02T06:36:${sec}Z`, ID: 26700 + i, Level, Message,
})).reverse(); // analyze() takes the fetched order: newest first

describe('analyze — parent whose last child exits via ProcessQuit', () => {
  const r = analyze(QUIT_RUN);
  const all = flatten(r.trees);

  it('closes every run — the ProcessQuit child no longer hangs at "running"', () => {
    expect(all.filter(n => n.status === 'running')).toEqual([]);
    expect(r.ignoredLines).toBe(0);
  });

  it('marks the ProcessQuit child as an error and the ProcessBreak child as ok', () => {
    const quit = all.find(n => n.name === '1002 Test2 Sleep3_Quit')!;
    expect(quit.status).toBe('error');
    expect(quit.elapsedSec).toBeNull();
    expect(all.find(n => n.name === '1002 Test2 Sleep3_ProcessBreak')!.status).toBe('ok');
  });

  it('keeps the parent a single tree with all eight children, itself in error', () => {
    expect(r.trees).toHaveLength(1);
    const root = r.trees[0];
    expect(root.name).toBe('1001 Test2');
    expect(root.status).toBe('error');
    // Display order is newest-started first, same as the roots.
    expect(root.children.map(c => c.name)).toEqual([
      '1002 Test2 Sleep3_Quit',
      '1002 Test2 Sleep1',
      '1002 Test2 Sleep3',
      '1002 Test2 Sleep2',
      '1002 Test2 Sleep1',
      '1002 Test2 Sleep1',
      '1002 Test2 Sleep1',
      '1002 Test2 Sleep3_ProcessBreak',
    ]);
    // The nested call keeps its own parent, not the root.
    expect(root.children[3].children.map(c => c.name)).toEqual(['1002 Test2 Sleep1']);
  });

  it('counts the aborted run in the statistics as a failure', () => {
    const s = r.stats.find(x => x.name === '1002 Test2 Sleep3_Quit')!;
    expect(s.calls).toBe(1);
    expect(s.failures).toBe(1);
  });
});

describe('analyze — live 11.8 fixture', () => {
  const r = analyze(FIXTURE);
  const all = flatten(r.trees);
  const byName = (name: string): CallNode[] => all.filter(n => n.name === name);

  it('leaves no run at "running" — every end variant in the window is recognised', () => {
    expect(all.filter(n => n.status === 'running')).toEqual([]);
  });

  it('ignores exactly the two lines that must stay unmatched', () => {
    // The 2 nameless lines, and nothing else.
    expect(r.ignoredLines).toBe(2);
  });

  it('closes a chore and gives it the scheduler runtime, in either line order', () => {
    // `time = …` first, `finished executing` second.
    const ttt = byName('ttt')[0];
    expect(ttt.kind).toBe('chore');
    expect(ttt.status).toBe('ok');
    expect(ttt.elapsedSec).toBe(0.11);
    expect(ttt.children.map(c => c.name)).toEqual(['_test']);
    // With a chore total the launched processes are percentages OF it: _test used
    // the whole 0.11 s the chore took.
    expect(ttt.children[0].selfPct).toBeCloseTo(100, 5);
    expect(ttt.selfSec).toBe(0);

    // `finished executing` first, `time = …` second — the half that arrives after
    // the node left `open` must still reach it.
    const tt = byName('tt')[0];
    expect(tt.kind).toBe('chore');
    expect(tt.status).toBe('ok');
    expect(tt.elapsedSec).toBe(0.10);
  });

  it('keeps closed chores out of the statistics and out of parsedRuns (M5)', () => {
    expect(r.stats.map(s => s.name)).not.toContain('ttt');
    expect(r.stats.map(s => s.name)).not.toContain('tt');
    expect(r.stats.every(s => s.kind === 'process')).toBe(true);
    // 6 process roots + the one process the chore `ttt` launched; chore `tt`
    // launched nothing inside the window and contributes 0.
    expect(r.parsedRuns).toBe(7);
  });

  it('no chore is left at the "group" placeholder when its end line is in the window', () => {
    expect(all.filter(n => n.status === 'group')).toEqual([]);
  });

  it('closes both }zzP runs as errors — the compile failure and the abort', () => {
    const zzP = byName('}zzP');
    expect(zzP.map(n => n.startTs)).toEqual(['2026-07-25T07:50:44.225Z', '2026-07-25T07:50:09.376Z']);
    expect(zzP.every(n => n.status === 'error')).toBe(true);
    expect(zzP.every(n => n.elapsedSec === null)).toBe(true);
    expect(r.stats.find(s => s.name === '}zzP')!.failures).toBe(2);
  });

  it('closes both ProcessBreak runs under their parent', () => {
    const breaks = byName('}bedrock.cube.data.copy');
    expect(breaks).toHaveLength(2);
    expect(breaks.every(n => n.status === 'ok')).toBe(true);
    expect(breaks.every(n => n.elapsedSec === null)).toBe(true);
    const parent = byName('00303_copy_data_snapshot')[0];
    expect(parent.children).toHaveLength(2);
    // A ProcessBreak is a deliberate exit, not a failure.
    expect(r.stats.find(s => s.name === '}bedrock.cube.data.copy')!.failures).toBe(0);
  });

  it('closes the English-body / German-prefix end', () => {
    const zzDir = byName('}zzDir')[0];
    // "normally", but the line names an error file: TM1 answers such a run with
    // CompletedWithMessages, the run v12 logs as `finished with messages` (an error
    // here) — see RE_ERROR_FILE.
    expect(zzDir.status).toBe('error');
    expect(zzDir.errorFile).toBe('TM1ProcessError_20260725075432_58816196_}zzDir.log');
    expect(zzDir.elapsedSec).toBeNull();
  });

  it('drops the ambiguity flag where the tie changes nothing observable', () => {
    // The two `}bedrock…` runs open at the same instant are closed by two
    // identical ProcessBreak lines that carry no runtime, so the matcher cannot
    // tell them apart — but both end up as `ok` leaves with no runtime, so the
    // pick is invisible and the ≈ marker would only be noise.
    expect(byName('}bedrock.cube.data.copy').map(n => n.ambiguous)).toEqual([false, false]);
  });

  it('no longer has a tie at all where both runs are individually determined', () => {
    // The abort at 07:50:44.227 used to have two open `}zzP` runs to choose from,
    // because the compile failure of 07:50:09.376 never left the candidate pool. Its
    // own verdict now closes it, so the abort has exactly one candidate left and the
    // ≈ marker disappears from a decision that was never open in the first place.
    expect(byName('}zzP').some(n => n.ambiguous)).toBe(false);
    expect(r.stats.find(s => s.name === '}zzP')!.uncertain).toBe(0);
  });

  it('flags nothing in the whole live fixture — every run in it is determined', () => {
    expect(all.filter(n => n.ambiguous)).toEqual([]);
  });

  it('no run is silently dropped: every process node is in the statistics', () => {
    const procNames = new Set(all.filter(n => n.kind === 'process').map(n => n.name));
    expect(new Set(r.stats.map(s => s.name))).toEqual(procNames);
  });
});

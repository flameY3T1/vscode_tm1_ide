/**
 * The v12 substitute message log: run-log files instead of `MessageLogEntries`.
 *
 * Every literal in here — filenames, JSONL fields, the six end verdicts — is a
 * transcript of what TM1 12.5.9 wrote on 2026-08-26 when throwaway processes
 * were run against it for each exit path, not an invented shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRunLogFilename,
  parseRunLogContent,
  sortRunLogsNewestFirst,
  sortEntriesByTime,
  isRunLogComplete,
  v12Level,
} from '../../messageLog/messageLogV12Pure';
import { parseLine, analyze, withoutControlRuns } from '../../messageLog/messageLogAnalysisPure';
import { isStartupAnalysisAvailable, levelToggleFor } from '../../messageLog/messageLogPure';

vi.mock('../../tm1Client', () => ({
  apiRequest: vi.fn(),
  assertOk: (res: { statusCode: number; body: string }) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`HTTP ${res.statusCode}: ${res.body}`);
    }
  },
}));
// messageLogV12 imports the deep layers, not the facade — same doubles there.
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));
vi.mock('../../tm1Rest/transport/http', async () => await import('../../tm1Client'));

import { apiRequest } from '../../tm1Client';
import { fetchV12RunLogEntries, listRunLogFiles, clearV12RunLogCache } from '../../messageLog/messageLogV12';

const cfg = { serverUrl: 'http://x', version: 'v12' } as never;
const ok = (body: string) => ({ statusCode: 200, body });

describe('parseRunLogFilename', () => {
  it('decomposes a process run log', () => {
    expect(parseRunLogFilename('ProcessLog_20260826051823_178772150300010_ZZ_VSC_BREAK.jsonl')).toEqual({
      filename: 'ProcessLog_20260826051823_178772150300010_ZZ_VSC_BREAK.jsonl',
      kind: 'process',
      object: 'ZZ_VSC_BREAK',
      startedAt: '2026-08-26T05:18:23Z',
    });
  });
  it('decomposes a chore run log', () => {
    expect(parseRunLogFilename('ChoreLog_20260821183114_1787337074000_ZZ_MCP_LIVE_CHEXIT_CH.jsonl'))
      .toMatchObject({ kind: 'chore', object: 'ZZ_MCP_LIVE_CHEXIT_CH' });
  });
  it('keeps an object name that itself starts with digits and holds spaces and #', () => {
    // Live on the test server: a process literally named `1000 Test2 #####`.
    expect(parseRunLogFilename('ProcessLog_20260703190010_1783105210000_1000 Test2 #####.jsonl'))
      .toMatchObject({ object: '1000 Test2 #####' });
  });
  it('keeps a control object name with its brace', () => {
    expect(parseRunLogFilename('ProcessLog_20260719063210_17844427300000_}tm1-mcp-save-data.jsonl'))
      .toMatchObject({ object: '}tm1-mcp-save-data' });
  });
  it('rejects anything that is not a run log', () => {
    expect(parseRunLogFilename('TM1ProcessError_20260723195228_12510784_##sleep.log')).toBeNull();
    expect(parseRunLogFilename('ProcessLog_short_1_x.jsonl')).toBeNull();
    expect(parseRunLogFilename('')).toBeNull();
  });
});

describe('sortRunLogsNewestFirst', () => {
  it('orders by the timestamp, not by the filename string', () => {
    // `$orderby=Filename desc` would put …0300010 before …030002 (string length
    // before value) — both are the same second, and the second is all that means
    // anything. What must NOT happen is the older FILE overtaking the newer one.
    const files = [
      'ProcessLog_20260703190010_1783105210000_alt.jsonl',
      'ProcessLog_20260826051823_178772150300010_neu.jsonl',
      'ChoreLog_20260821183114_1787337074000_mitte.jsonl',
    ].map(f => parseRunLogFilename(f)!);
    expect(sortRunLogsNewestFirst(files).map(f => f.object)).toEqual(['neu', 'mitte', 'alt']);
  });
});

describe('v12Level', () => {
  it('maps the wire levels onto the 11.8 spelling the toggles use', () => {
    expect(v12Level('info')).toBe('Info');
    expect(v12Level('error')).toBe('Error');
    expect(v12Level('warn')).toBe('Warning');
    expect(v12Level('warning')).toBe('Warning');
    expect(v12Level('debug')).toBe('Debug');
    expect(v12Level('fatal')).toBe('Fatal');
    expect(v12Level(undefined)).toBe('Unknown');
  });
  it('lands on the toggles the panel draws', () => {
    // The point of mapping at all: a v12 error must be sieved by the error
    // toggle, exactly like an 11.8 error is by its `$filter`.
    expect(levelToggleFor(v12Level('error'))).toBe('error');
    expect(levelToggleFor(v12Level('warn'))).toBe('warn');
    expect(levelToggleFor(v12Level('info'))).toBe('info');
    expect(levelToggleFor(v12Level(undefined))).toBe('info');
  });
});

const PARENT_CHILD_FILE = [
  '{"id":1,"level":"info","timestamp":"2026-08-26T05:17:14.081Z","name":"ZZ_VSC_ELTERN","message":"Process \\"ZZ_VSC_ELTERN\\" executed by user \\"Admin\\"."}',
  '{"id":1,"level":"info","timestamp":"2026-08-26T05:17:14.284Z","name":"ZZ_VSC_KIND","message":"Process \\"ZZ_VSC_KIND\\" executed by Process \\"ZZ_VSC_ELTERN\\" via ExecuteProcess."}',
  '{"id":1,"level":"info","timestamp":"2026-08-26T05:17:14.692Z","name":"ZZ_VSC_KIND","message":"Process execution finished normally."}',
  '{"id":1,"level":"error","timestamp":"2026-08-26T05:17:14.692Z","name":"ZZ_VSC_ELTERN","message":"Error: Prolog procedure line (3): eltern fehler"}',
  '{"id":1,"level":"info","timestamp":"2026-08-26T05:17:14.692Z","name":"ZZ_VSC_ELTERN","message":"Process execution finished with messages."}',
].join('\n');

describe('parseRunLogContent', () => {
  const file = parseRunLogFilename('ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl')!;

  it('maps every line onto a panel entry', () => {
    const entries = parseRunLogContent(PARENT_CHILD_FILE, file);
    expect(entries).toHaveLength(5);
    expect(entries[0]).toEqual({
      TimeStamp: '2026-08-26T05:17:14.081Z',
      Level: 'Info',
      Message: 'Process "ZZ_VSC_ELTERN" executed by user "Admin".',
      Logger: 'ZZ_VSC_ELTERN',
      Name: 'ZZ_VSC_ELTERN',
      RunFile: file.filename,
    });
    expect(entries[3].Level).toBe('Error');
  });

  it('carries the CHILD process on the child lines, not the file name', () => {
    // A parent and its children share one file; the `name` field is what tells
    // them apart, so it must win over the filename.
    const entries = parseRunLogContent(PARENT_CHILD_FILE, file);
    expect(entries[1].Name).toBe('ZZ_VSC_KIND');
    expect(entries[2].Name).toBe('ZZ_VSC_KIND');
  });

  it('never maps the line id onto ID', () => {
    // `ID` means "server-side write sequence" to the ordering code; v12's `id`
    // restarts per run, so mapping it would order entries by a number that means
    // nothing across files.
    for (const e of parseRunLogContent(PARENT_CHILD_FILE, file)) {
      expect((e as { ID?: number }).ID).toBeUndefined();
    }
  });

  it('skips a malformed line instead of losing the run', () => {
    const entries = parseRunLogContent('not json\n' + PARENT_CHILD_FILE + '\n\n', file);
    expect(entries).toHaveLength(5);
  });

  it('falls back to the filename facts when a line omits them', () => {
    const entries = parseRunLogContent('{"level":"info","message":"x"}', file);
    expect(entries[0]).toMatchObject({ Name: 'ZZ_VSC_ELTERN', TimeStamp: '2026-08-26T05:17:14Z' });
  });
});

describe('sortEntriesByTime', () => {
  it('reverses ties for descending, so reading it backwards gives the file order', () => {
    const e = [
      { TimeStamp: '2026-08-26T05:17:14.692Z', Message: 'a' },
      { TimeStamp: '2026-08-26T05:17:14.692Z', Message: 'b' },
      { TimeStamp: '2026-08-26T05:17:14.081Z', Message: 'c' },
    ];
    // `analyze()` reverses its input, so what must come out of THAT is a, b —
    // hence b before a here.
    expect(sortEntriesByTime(e, false).map(x => x.Message)).toEqual(['b', 'a', 'c']);
    expect(sortEntriesByTime(e, true).map(x => x.Message)).toEqual(['c', 'a', 'b']);
  });

  it('keeps a run whose start and end share one millisecond intact', () => {
    // The failure this guards: measured against the live server, 35 of 231 run
    // logs are written entirely inside ONE millisecond. With the tie left in file
    // order every one of them showed up TWICE — once stuck at `running`, once as
    // a truncated stray root — because analyze()'s reverse put the end first.
    const file = parseRunLogFilename('ProcessLog_20260826052904_17877221290002_Q.jsonl')!;
    const entries = parseRunLogContent([
      '{"level":"info","timestamp":"2026-08-26T05:29:04.269Z","name":"Q","message":"Process \\"Q\\" executed by user \\"Admin\\"."}',
      '{"level":"info","timestamp":"2026-08-26T05:29:04.269Z","name":"Q","message":"Process execution finished with ProcessQuit()."}',
    ].join('\n'), file);
    const r = analyze(sortEntriesByTime(entries, false));
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0]).toMatchObject({ name: 'Q', status: 'error', truncated: false, elapsedSec: 0 });
  });
});

describe('parseLine on v12 forms', () => {
  it('reads the child start with its parent', () => {
    expect(parseLine('Process "ZZ_VSC_KIND" executed by Process "ZZ_VSC_ELTERN" via ExecuteProcess.'))
      .toEqual({ type: 'child', name: 'ZZ_VSC_KIND', parent: 'ZZ_VSC_ELTERN' });
  });
  it('does NOT let the v11 top-level pattern claim the child line', () => {
    // `Process "X" executed by` matches the v11 top form too; if it won, every
    // child would become its own root and the tree would be flat.
    expect(parseLine('Process "K" executed by Process "E" via ExecuteProcess.'))
      .toMatchObject({ type: 'child' });
  });
  it('still reads the v11 top-level start unchanged', () => {
    expect(parseLine('Process "ZZ_VSC_ELTERN" executed by user "Admin".'))
      .toEqual({ type: 'top', name: 'ZZ_VSC_ELTERN', kind: 'process', user: 'Admin' });
  });

  const ENDS: [string, boolean, boolean][] = [
    // message, isError, isInitFail — all six measured live
    ['Process execution finished normally.', false, false],
    ['Process execution finished with messages.', true, false],
    ['Process execution finished with minor errors.', true, false],
    ['Process execution finished with ProcessQuit().', true, false],
    ['Process execution aborted with errors.', true, false],
    ['Process execution aborted with ProcessRollback().', true, false],
    ['Process execution aborted on initialization.', true, true],
  ];
  for (const [msg, error, initFail] of ENDS) {
    it(`reads "${msg}" with the name from the entry`, () => {
      const ev = parseLine(msg, 'P');
      expect(ev).toMatchObject({ type: 'end', name: 'P', elapsedSec: null, elapsedFromClock: true, error });
      expect((ev as { initFail?: true }).initFail).toBe(initFail ? true : undefined);
    });
  }

  it('refuses a nameless end line rather than guessing whose it is', () => {
    expect(parseLine('Process execution finished normally.')).toBeNull();
  });

  it('leaves the error detail lines unparsed, as v11 does', () => {
    expect(parseLine('Error: Prolog procedure line (3): eltern fehler', 'P')).toBeNull();
  });
});

describe('v12 RunProcess lines hang under their caller', () => {
  // Measured 2026-10-14. The line names the caller only by a thread number —
  // SaaS `process '3' via RunProcess()`, on-prem `Process [1] via RunProcess` —
  // so the caller comes from the run log file the line sits in.
  const lines = (rows: [string, string, string][]): string => rows
    .map(([ts, name, message]) => JSON.stringify({ id: 1, level: 'info', timestamp: ts, name, message }))
    .join('\n');
  const tree = (text: string, file: string) => analyze(sortEntriesByTime(
    parseRunLogContent(text, parseRunLogFilename(file)!), false));

  it('SaaS: the async run starts after its caller ended and still hangs under it', () => {
    const r = tree(lines([
      ['2026-10-14T19:37:31.102Z', '_sleep', "Process '_sleep' executed by user 'u' with parameters: (pnMS = 1000.00)."],
      ['2026-10-14T19:37:32.129Z', '_sleep_copy', "Process '_sleep_copy' executed by process '_sleep' via ExecuteProcess() with parameters: (pnMS = 1000.00)."],
      ['2026-10-14T19:37:33.130Z', '_sleep_copy', 'Process execution finished normally.'],
      ['2026-10-14T19:37:43.336Z', '_sleep', 'Process execution finished normally.'],
      ['2026-10-14T19:37:43.336Z', '_sleep_copy', "Process '_sleep_copy' executed by process '3' via RunProcess() with parameters: (pnMS = 10000.00)."],
      ['2026-10-14T19:37:53.337Z', '_sleep_copy', 'Process execution finished normally.'],
    ]), 'ProcessLog_20261014193731_1792006651000__sleep.jsonl');
    expect(r.trees).toHaveLength(1);
    const root = r.trees[0];
    expect(root).toMatchObject({ name: '_sleep', status: 'ok' });
    expect(root.elapsedSec).toBeCloseTo(12.23, 2);
    const asyncKid = root.children.find(c => c.asyncAttached);
    expect(asyncKid).toMatchObject({ name: '_sleep_copy', status: 'ok' });
    expect(asyncKid!.elapsedSec).toBeCloseTo(10, 2);
    // Async time is not the caller's: its own time stays 12.23 - 1.00.
    expect(root.selfSec).toBeCloseTo(11.23, 2);
  });

  it('overlapping RunProcess calls are siblings under the caller, not a chain', () => {
    const r = tree(lines([
      ['2026-10-14T19:52:08.058Z', '_sleep', "Process '_sleep' executed by user 'u' with parameters: (pnMS = 1000.00)."],
      ['2026-10-14T19:52:20.661Z', '_sleep_copy', "Process '_sleep_copy' executed by process '5' via RunProcess() with parameters: (pnMS = 10000.00)."],
      ['2026-10-14T19:52:20.663Z', '_sleep_copy', "Process '_sleep_copy' executed by process '5' via RunProcess() with parameters: (pnMS = 500.00)."],
      ['2026-10-14T19:52:20.664Z', '_sleep_copy', "Process '_sleep_copy' executed by process '5' via RunProcess() with parameters: (pnMS = 10000.00)."],
      ['2026-10-14T19:52:21.163Z', '_sleep_copy', 'Process execution finished normally.'],
      ['2026-10-14T19:52:30.662Z', '_sleep_copy', 'Process execution finished normally.'],
      ['2026-10-14T19:52:30.664Z', '_sleep_copy', 'Process execution finished normally.'],
      ['2026-10-14T19:52:30.666Z', '_sleep', 'Process execution finished normally.'],
    ]), 'ProcessLog_20261014195208_1792007528000__sleep.jsonl');
    expect(r.trees).toHaveLength(1);
    const kids = r.trees[0].children;
    expect(kids).toHaveLength(3);
    expect(kids.every(k => k.asyncAttached && k.children.length === 0)).toBe(true);
  });

  it('on-prem: the innermost open run of the file is the caller', () => {
    const r = tree(lines([
      ['2026-10-14T19:48:52.290Z', 'P', 'Process "P" executed by user "Admin".'],
      ['2026-10-14T19:48:53.000Z', 'K', 'Process "K" executed by Process "P" via ExecuteProcess.'],
      ['2026-10-14T19:48:53.100Z', 'A', 'Process "A" executed by Process [1] via RunProcess with parameters: (pnMS = 10000.00)'],
      ['2026-10-14T19:48:53.200Z', 'K', 'Process execution finished normally.'],
      ['2026-10-14T19:48:54.000Z', 'P', 'Process execution finished normally.'],
      ['2026-10-14T19:49:03.100Z', 'A', 'Process execution finished normally.'],
    ]), 'ProcessLog_20261014194852_17914013320001_P.jsonl');
    expect(r.trees).toHaveLength(1);
    const k = r.trees[0].children.find(c => c.name === 'K')!;
    expect(k.children.map(c => [c.name, c.asyncAttached])).toEqual([['A', true]]);
  });
});

describe('withoutControlRuns', () => {
  it('drops } roots and their statistics, keeps a } child under a user run', () => {
    const r = analyze([
      { TimeStamp: '2026-01-01T00:00:04Z', Message: 'Process "P": finished executing normally, elapsed time 4 seconds.' },
      { TimeStamp: '2026-01-01T00:00:02Z', Message: 'Process "}Child": finished executing normally, elapsed time 1 seconds.' },
      { TimeStamp: '2026-01-01T00:00:01Z', Message: 'Process "}Child" run from process "P" by user "u"' },
      { TimeStamp: '2026-01-01T00:00:00Z', Message: 'Process "P" executed by user "u"' },
      { TimeStamp: '2025-12-31T00:00:01Z', Message: 'Process "}Probe": finished executing normally, elapsed time 1 seconds.' },
      { TimeStamp: '2025-12-31T00:00:00Z', Message: 'Process "}Probe" executed by user "u"' },
    ] as never);
    expect(r.trees.map(t => t.name).sort()).toEqual(['P', '}Probe']);
    const f = withoutControlRuns(r);
    expect(f.trees.map(t => t.name)).toEqual(['P']);
    expect(f.trees[0].children.map(c => c.name)).toEqual(['}Child']);
    expect(f.stats.map(s => s.name)).toEqual(['P']);
    // The status line counts what the tree shows, not what was parsed.
    expect(r.parsedRuns).toBe(2);
    expect(f.parsedRuns).toBe(1);
  });

  it('drops the time a hidden } root spent in a user child', () => {
    const r = analyze([
      { TimeStamp: '2026-01-01T00:00:05Z', Message: 'Process "V": finished executing normally, elapsed time 2 seconds.' },
      { TimeStamp: '2026-01-01T00:00:03Z', Message: 'Process "V" executed by user "u"' },
      { TimeStamp: '2026-01-01T00:00:02Z', Message: 'Process "}Control": finished executing normally, elapsed time 2 seconds.' },
      { TimeStamp: '2026-01-01T00:00:01Z', Message: 'Process "V": finished executing normally, elapsed time 1 seconds.' },
      { TimeStamp: '2026-01-01T00:00:00Z', Message: 'Process "V" run from process "}Control" by user "u"' },
      { TimeStamp: '2026-01-01T00:00:00Z', Message: 'Process "}Control" executed by user "u"' },
    ] as never);
    const v = withoutControlRuns(r).stats.find(s => s.name === 'V')!;
    expect(v.calls).toBe(1);
    expect(v.totalSec).toBe(2);
  });
});

describe('PA as a Service run log (12.6.4)', () => {
  // Measured 2026-10-14 against a PA as a Service tenant: single quotes, a
  // lowercase `process`, `ExecuteProcess()` with parentheses and a parameter
  // tail. With the double-quote-only patterns both starts parsed as null and the
  // child stood as a stray root beside its parent.
  const SAAS_FILE = [
    `{"id":1,"level":"info","timestamp":"2026-10-14T19:34:17.100Z","name":"_sleep","message":"Process '_sleep' executed by user 'someone@example.com' with parameters: (pnMS = 1000.00)."}`,
    `{"id":1,"level":"info","timestamp":"2026-10-14T19:34:18.100Z","name":"_sleep_copy","message":"Process '_sleep_copy' executed by process '_sleep' via ExecuteProcess() with parameters: (pnMS = 1000.00)."}`,
    `{"id":1,"level":"info","timestamp":"2026-10-14T19:34:19.100Z","name":"_sleep_copy","message":"Process execution finished normally."}`,
    `{"id":1,"level":"info","timestamp":"2026-10-14T19:34:19.200Z","name":"_sleep","message":"Process execution finished normally."}`,
  ].join('\n');

  it('reads the single-quoted start with its user', () => {
    expect(parseLine("Process '_sleep' executed by user 'someone@example.com' with parameters: (pnMS = 1000.00)."))
      .toEqual({ type: 'top', name: '_sleep', kind: 'process', user: 'someone@example.com' });
  });

  it('reads the single-quoted child line with its parent', () => {
    expect(parseLine("Process '_sleep_copy' executed by process '_sleep' via ExecuteProcess() with parameters: (pnMS = 1000.00)."))
      .toEqual({ type: 'child', name: '_sleep_copy', parent: '_sleep' });
  });

  it('keeps a quote of the other kind inside a name', () => {
    expect(parseLine(`Process 'it"s' executed by user 'u'.`)).toMatchObject({ name: 'it"s', user: 'u' });
    expect(parseLine(`Process "it's" executed by user "u".`)).toMatchObject({ name: "it's", user: 'u' });
  });

  it('rebuilds the tree from the whole file', () => {
    const r = analyze(sortEntriesByTime(
      parseRunLogContent(SAAS_FILE, parseRunLogFilename('ProcessLog_20261014193417_1792006457000__sleep.jsonl')!),
      false,
    ));
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0]).toMatchObject({ name: '_sleep', status: 'ok' });
    expect(r.trees[0].elapsedSec).toBeCloseTo(2.1, 2);
    expect(r.trees[0].children).toHaveLength(1);
    expect(r.trees[0].children[0]).toMatchObject({ name: '_sleep_copy', status: 'ok' });
  });
});

describe('analyze over a v12 run log', () => {
  // NEWEST FIRST, because that is what the fetch path hands over and what
  // `analyze` expects: it reverses its input (v11 fetches
  // `$orderby=TimeStamp desc`). Feeding file order instead turns every end line
  // into a truncated stray root and leaves the runs stuck at `running` — the
  // failure mode this ordering exists to prevent.
  const entries = sortEntriesByTime(
    parseRunLogContent(
      PARENT_CHILD_FILE,
      parseRunLogFilename('ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl')!,
    ),
    false,
  );

  it('rebuilds the tree, the verdicts and the runtimes off the clock', () => {
    const r = analyze(entries);
    expect(r.trees).toHaveLength(1);
    const parent = r.trees[0];
    expect(parent).toMatchObject({ name: 'ZZ_VSC_ELTERN', status: 'error' });
    // 05:17:14.081 → .692 = 0.61 s. v12 reports no seconds at all; the wall clock
    // is the only source, and it is a real measurement of this run.
    expect(parent.elapsedSec).toBeCloseTo(0.61, 2);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toMatchObject({ name: 'ZZ_VSC_KIND', status: 'ok' });
    expect(parent.children[0].elapsedSec).toBeCloseTo(0.41, 2);
  });

  it('counts the run and both statistics rows', () => {
    const r = analyze(entries);
    expect(r.parsedRuns).toBe(1);
    expect(r.stats.map(s => s.name).sort()).toEqual(['ZZ_VSC_ELTERN', 'ZZ_VSC_KIND']);
    expect(r.stats.find(s => s.name === 'ZZ_VSC_ELTERN')?.failures).toBe(1);
  });

  it('leaves v11 error ends without a fabricated runtime', () => {
    // The clock fallback is gated on the v12 flag. A v11 abort reports no
    // seconds BECAUSE the end form carries none — timing it off the clock would
    // invent a number the log never claimed.
    const v11 = analyze([
      { TimeStamp: '2026-08-26T05:00:09.000Z', Message: 'Prozess "P": Ausführung abnormal beendet.' },
      { TimeStamp: '2026-08-26T05:00:00.000Z', Message: 'Process "P" executed by user "u"' },
    ]);
    expect(v11.trees[0]).toMatchObject({ name: 'P', status: 'error', elapsedSec: null });
  });
});

describe('fetchV12RunLogEntries', () => {
  const mocked = vi.mocked(apiRequest);
  beforeEach(() => { mocked.mockReset(); clearV12RunLogCache(); });

  const listBody = (names: string[]) => JSON.stringify({ value: names.map(Filename => ({ Filename })) });

  it('hands the entries over newest-first, the order analyze() reverses', async () => {
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?')
        ? ok(listBody(['ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl']))
        : ok(PARENT_CHILD_FILE));
    const res = await fetchV12RunLogEntries(cfg, { top: 100 });
    const r = analyze(res.entries);
    expect(r.trees).toHaveLength(1);
    expect(r.trees[0].children).toHaveLength(1);
  });

  it('hideControl skips } run logs before reading, so the window holds real runs', async () => {
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?')
        ? ok(listBody([
          'ProcessLog_20261007203733_1791397582000_}VSCode_Probe.jsonl',
          'ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl',
        ]))
        : ok(PARENT_CHILD_FILE));
    const res = await fetchV12RunLogEntries(cfg, { top: 100, hideControl: true });
    expect(res.filesAvailable).toBe(1);
    expect(mocked.mock.calls.some(([, p]) => String(p).includes('VSCode_Probe'))).toBe(false);
    expect(analyze(res.entries).trees.map(t => t.name)).toEqual(['ZZ_VSC_ELTERN']);
  });

  it('lists only run logs and reads them newest first', async () => {
    mocked.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('ErrorLogFiles?')) {
        return ok(listBody([
          'ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl',
          'ProcessLog_20260703190010_1783105210000_alt.jsonl',
          'random.txt',
        ]));
      }
      if (path.includes('ZZ_VSC_ELTERN')) { return ok(PARENT_CHILD_FILE); }
      return ok('{"level":"info","timestamp":"2026-07-03T19:00:10.000Z","name":"alt","message":"Process execution finished normally."}');
    });
    const res = await fetchV12RunLogEntries(cfg, { top: 100 });
    expect(res.filesAvailable).toBe(2); // random.txt is not a run log
    expect(res.entries[0].TimeStamp).toBe('2026-08-26T05:17:14.692Z'); // newest first
    expect(res.entries.at(-1)?.Name).toBe('alt');
  });

  it('stops opening files once the depth is covered', async () => {
    const names = Array.from({ length: 40 }, (_, i) =>
      `ProcessLog_2026082605${String(i).padStart(2, '0')}00_1787721434000${i}_P${i}.jsonl`);
    mocked.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('ErrorLogFiles?')) { return ok(listBody(names)); }
      return ok(PARENT_CHILD_FILE); // 5 entries per file
    });
    const res = await fetchV12RunLogEntries(cfg, { top: 5 });
    // One batch of 6 files covers 5 rows many times over; the remaining 34 files
    // must not be opened.
    expect(res.filesRead).toBe(6);
    expect(res.entries).toHaveLength(5);
    expect(res.truncated).toBe(true);
  });

  it('cuts between runs, never inside one', async () => {
    // Depth 7 against 5-line runs: two whole runs would be 10, so the second is
    // dropped whole. Half a run would leave a start with no end (`running`
    // forever) plus a truncated stray — the damage the window exists to prevent.
    const names = [
      'ProcessLog_20260826051714_17877214340005_A.jsonl',
      'ProcessLog_20260826051700_17877214340001_B.jsonl',
    ];
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?') ? ok(listBody(names)) : ok(PARENT_CHILD_FILE));
    const res = await fetchV12RunLogEntries(cfg, { top: 7 });
    expect(res.entries).toHaveLength(5);
    expect(res.truncated).toBe(true);
    expect(analyze(res.entries).trees.every(t => !t.truncated)).toBe(true);
  });

  it('shows one whole run even when the depth is smaller than it', async () => {
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?')
        ? ok(listBody(['ProcessLog_20260826051714_17877214340005_A.jsonl']))
        : ok(PARENT_CHILD_FILE));
    const res = await fetchV12RunLogEntries(cfg, { top: 2 });
    expect(res.entries).toHaveLength(5);
  });

  it('sieves by the panel toggles, since there is no filter to push', async () => {
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?')
        ? ok(listBody(['ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl']))
        : ok(PARENT_CHILD_FILE));
    const res = await fetchV12RunLogEntries(cfg, {
      top: 100,
      levels: { info: false, warn: false, error: true, debug: false },
    });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].Level).toBe('Error');
  });

  it('survives a file that was pruned between listing and reading', async () => {
    mocked.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('ErrorLogFiles?')) {
        return ok(listBody([
          'ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl',
          'ProcessLog_20260826051700_17877214340001_WEG.jsonl',
        ]));
      }
      if (path.includes('WEG')) { return { statusCode: 404, body: 'gone' }; }
      return ok(PARENT_CHILD_FILE);
    });
    const res = await fetchV12RunLogEntries(cfg, { top: 100 });
    expect(res.entries).toHaveLength(5);
  });

  it('reports a hard read failure instead of showing a short log', async () => {
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?')
        ? ok(listBody(['ProcessLog_20260826051714_17877214340005_X.jsonl']))
        : ({ statusCode: 500, body: 'boom' }));
    await expect(fetchV12RunLogEntries(cfg, { top: 10 })).rejects.toThrow('500');
  });

  it('honours the file cap and says the window was cut', async () => {
    const names = Array.from({ length: 30 }, (_, i) =>
      `ProcessLog_2026082605${String(i).padStart(2, '0')}00_1787721434000${i}_P${i}.jsonl`);
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?') ? ok(listBody(names)) : ok('{"level":"info","message":"x"}'));
    const res = await fetchV12RunLogEntries(cfg, { top: 1000, maxFiles: 6 });
    expect(res.filesRead).toBe(6);
    expect(res.truncated).toBe(true);
  });

  it('asks only for the field it uses', async () => {
    mocked.mockResolvedValue(ok(listBody([])));
    await listRunLogFiles(cfg);
    expect(mocked.mock.calls[0][1]).toBe('ErrorLogFiles?$select=Filename');
  });
});

describe('the run-log cache', () => {
  const mocked = vi.mocked(apiRequest);
  const listBody = (names: string[]) => JSON.stringify({ value: names.map(Filename => ({ Filename })) });
  const FILE = 'ProcessLog_20260826051714_17877214340005_ZZ_VSC_ELTERN.jsonl';

  beforeEach(() => { mocked.mockReset(); clearV12RunLogCache(); });

  const serve = (content: string) => {
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?') ? ok(listBody([FILE])) : ok(content));
  };
  const contentReads = () => mocked.mock.calls.filter(c => String(c[1]).includes('/Content')).length;

  it('reads a finished run once, however often the panel polls', async () => {
    serve(PARENT_CHILD_FILE);
    await fetchV12RunLogEntries(cfg, { top: 100 });
    await fetchV12RunLogEntries(cfg, { top: 100 });
    await fetchV12RunLogEntries(cfg, { top: 100 });
    expect(contentReads()).toBe(1);
  });

  it('re-reads a run that is still going', async () => {
    // No verdict line yet → the file is still being appended to. Caching it here
    // would freeze the run at `running` for as long as the panel stays open.
    serve(PARENT_CHILD_FILE.split('\n').slice(0, 2).join('\n'));
    await fetchV12RunLogEntries(cfg, { top: 100 });
    await fetchV12RunLogEntries(cfg, { top: 100 });
    expect(contentReads()).toBe(2);
  });

  it('reads a long-empty run log once, and a fresh empty one again', async () => {
    // An empty file has no verdict line, so completeness alone would re-read it
    // on every poll — 55 of the test server's 73 chore logs are empty.
    const alt = 'ChoreLog_20200101000000_1000_ALT.jsonl';
    const neu = `ChoreLog_${new Date(Date.now() - 5_000).toISOString().replace(/[-:T]/g, '').slice(0, 14)}_1000_NEU.jsonl`;
    mocked.mockImplementation(async (_m: string, path: string) =>
      path.startsWith('ErrorLogFiles?') ? ok(listBody([alt, neu])) : ok(''));
    await fetchV12RunLogEntries(cfg, { top: 100 });
    await fetchV12RunLogEntries(cfg, { top: 100 });
    const reads = mocked.mock.calls.filter(c => String(c[1]).includes('/Content'));
    expect(reads.filter(c => String(c[1]).includes('ALT'))).toHaveLength(1);
    expect(reads.filter(c => String(c[1]).includes('NEU'))).toHaveLength(2);
  });

  it('forgets a server on disconnect and keeps the others', async () => {
    serve(PARENT_CHILD_FILE);
    const other = { serverUrl: 'http://andere', version: 'v12' } as never;
    await fetchV12RunLogEntries(cfg, { top: 100 });
    await fetchV12RunLogEntries(other, { top: 100 });
    expect(contentReads()).toBe(2); // keyed per server, so no cross-server hit
    clearV12RunLogCache('http://x');
    await fetchV12RunLogEntries(cfg, { top: 100 });
    await fetchV12RunLogEntries(other, { top: 100 });
    expect(contentReads()).toBe(3); // cfg re-read, `other` still cached
  });
});

describe('isRunLogComplete', () => {
  it('is true once the verdict line is written', () => {
    expect(isRunLogComplete(PARENT_CHILD_FILE)).toBe(true);
  });
  it('is false while the run is still logging', () => {
    expect(isRunLogComplete(PARENT_CHILD_FILE.split('\n').slice(0, 2).join('\n'))).toBe(false);
  });
  it('is false for an empty or unreadable file', () => {
    expect(isRunLogComplete('')).toBe(false);
    expect(isRunLogComplete('kaputt')).toBe(false);
  });
});

const CHORE_FILE = [
  '{"id":7,"level":"info","timestamp":"2026-08-21T18:31:14.567Z","name":"M1","message":"Process \\"M1\\" executed by user \\"Admin\\"."}',
  '{"id":7,"level":"info","timestamp":"2026-08-21T18:31:14.580Z","name":"M1","message":"Process execution finished normally."}',
  '{"id":7,"level":"info","timestamp":"2026-08-21T18:31:14.581Z","name":"KAPUTT","message":"Process \\"KAPUTT\\" executed by user \\"Admin\\"."}',
  '{"id":7,"level":"error","timestamp":"2026-08-21T18:31:14.582Z","name":"KAPUTT","message":"Error: Prolog procedure line (2): ProcessError()"}',
  '{"id":7,"level":"info","timestamp":"2026-08-21T18:31:14.582Z","name":"KAPUTT","message":"Process execution aborted with errors."}',
].join('\n');

const choreFile = (name = 'ZZ_CH', stamp = '20260821183114', seq = '1787337074000') =>
  parseRunLogFilename(`ChoreLog_${stamp}_${seq}_${name}.jsonl`)!;

describe('chore runs', () => {
  it('stamps the chore and the run onto every line, from the filename', () => {
    // The lines inside a chore log name the PROCESSES and never the chore —
    // checked across all 73 chore logs on the test server. The filename is the
    // only source there is.
    const entries = parseRunLogContent(CHORE_FILE, choreFile());
    expect(entries.every(e => e.Chore === 'ZZ_CH')).toBe(true);
    expect(entries.every(e => e.ChoreRun === 'ChoreLog_20260821183114_1787337074000_ZZ_CH.jsonl')).toBe(true);
    expect(entries[0].Name).toBe('M1');
  });

  it('leaves a process run log unstamped', () => {
    const entries = parseRunLogContent(PARENT_CHILD_FILE, parseRunLogFilename('ProcessLog_20260826051714_17877214340005_P.jsonl')!);
    expect(entries.every(e => e.Chore === undefined && e.ChoreRun === undefined)).toBe(true);
  });

  it('hangs the launched processes under one chore container', () => {
    const r = analyze(sortEntriesByTime(parseRunLogContent(CHORE_FILE, choreFile()), false));
    expect(r.trees).toHaveLength(1);
    const chore = r.trees[0];
    // A failed step fails the chore — KAPUTT below ends in error.
    expect(chore).toMatchObject({ name: 'ZZ_CH', kind: 'chore', status: 'error' });
    // No runtime: a v12 chore logs neither start nor end, and deriving one from
    // the children would report a measurement nobody made.
    expect(chore.elapsedSec).toBeNull();
    expect(chore.children.map(c => `${c.name}:${c.status}`).sort()).toEqual(['KAPUTT:error', 'M1:ok']);
    // A chore is a container, not a run — it is the launched processes that count.
    expect(r.parsedRuns).toBe(2);
  });

  it('keeps two runs of the SAME chore apart', () => {
    // Grouping by name would merge tonight's run with last night's: v12 gives a
    // chore no start line to open and no end line to close, so the file is the
    // only thing that separates two runs.
    const a = parseRunLogContent(CHORE_FILE, choreFile('ZZ_CH', '20260821183114', '1787337074000'));
    const b = parseRunLogContent(
      CHORE_FILE.replace(/18:31:14/g, '19:31:14'),
      choreFile('ZZ_CH', '20260821193114', '1787340674000'),
    );
    const r = analyze(sortEntriesByTime([...a, ...b], false));
    expect(r.trees.filter(t => t.kind === 'chore')).toHaveLength(2);
    expect(r.trees.every(t => t.children.length === 2)).toBe(true);
  });

  it('yields nothing at all for the empty chore logs v12 also writes', () => {
    // 55 of 73 chore logs on the test server are zero bytes.
    expect(parseRunLogContent('', choreFile())).toEqual([]);
  });
});

describe('isStartupAnalysisAvailable', () => {
  it('is false on v12 and true everywhere else', () => {
    // A startup writes only to the server log, which v12 does not expose.
    expect(isStartupAnalysisAvailable('v12')).toBe(false);
    expect(isStartupAnalysisAvailable('v11')).toBe(true);
    expect(isStartupAnalysisAvailable(undefined)).toBe(true);
  });
});

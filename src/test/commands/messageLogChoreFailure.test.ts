import { describe, it, expect } from 'vitest';
import { analyze, onlyChoreRuns, type RawEntry, type CallNode } from '../../messageLog/messageLogAnalysisPure';
import { parseRunLogContent, parseRunLogFilename, sortEntriesByTime } from '../../messageLog/messageLogV12Pure';
import { renderNode } from '../../webviewClient/messageLogAnalysis/render';
import type { MlaTexts } from '../../webviewClient/messageLogAnalysis/protocol';

/**
 * A chore whose step 2 fails (ItemReject in the Prolog), run once per version with
 * the live probe `choreFailureTraceProbe.js` on 2026-10-29. Lines verbatim; the v11
 * ones in the order `/MessageLogEntries?$orderby=TimeStamp desc` returned them.
 */
const V11: RawEntry[] = ([
  [154067, '18:26:35.307Z', 'Process "zzProbe_choreFail_p3":  finished executing normally, elapsed time 0.00 seconds'],
  [154066, '18:26:35.307Z', 'Process "zzProbe_choreFail_p3" executed by chore "zzProbe_choreFail"'],
  [154065, '18:26:35.307Z', 'Process "zzProbe_choreFail_p2":  finished executing normally.  Check new message in the file: <TM1ProcessError_20261029182635_30306752_zzProbe_choreFail_p2.log>'],
  [154068, '18:26:35.307Z', 'Chore "zzProbe_choreFail" finished executing'],
  [154063, '18:26:35.306Z', 'Process "zzProbe_choreFail_p1":  finished executing normally, elapsed time 0.00 seconds'],
  [154064, '18:26:35.306Z', 'Process "zzProbe_choreFail_p2" executed by chore "zzProbe_choreFail"'],
  [154061, '18:26:35.305Z', 'Chore "zzProbe_choreFail" executed by user "Admin"'],
  [154062, '18:26:35.305Z', 'Process "zzProbe_choreFail_p1" executed by chore "zzProbe_choreFail"'],
] as const).map(([ID, t, Message]) => ({ ID, ThreadID: 6752, TimeStamp: '2026-10-29T' + t, Message, Level: 'Info' }));

const V12_FILE = 'ChoreLog_20261029182641_17932984010002_zzProbe_choreFail.jsonl';
const V12_BODY = [
  ['info', 'zzProbe_choreFail_p1', "Process 'zzProbe_choreFail_p1' executed by user 'u'."],
  ['info', 'zzProbe_choreFail_p1', 'Process execution finished normally.'],
  ['info', 'zzProbe_choreFail_p2', "Process 'zzProbe_choreFail_p2' executed by user 'u'."],
  ['error', 'zzProbe_choreFail_p2', 'Error: Prolog procedure line (1): probe step two rejects'],
  ['info', 'zzProbe_choreFail_p2', 'Process execution finished with messages.'],
  ['info', 'zzProbe_choreFail_p3', "Process 'zzProbe_choreFail_p3' executed by user 'u'."],
  ['info', 'zzProbe_choreFail_p3', 'Process execution finished normally.'],
].map(([level, name, message]) => JSON.stringify({ id: 1, level, timestamp: '2026-10-29T18:26:41.980Z', name, message })).join('\n');

const byName = (nodes: CallNode[], name: string): CallNode =>
  nodes.flatMap(function all(n): CallNode[] { return [n, ...n.children.flatMap(all)]; }).find(n => n.name === name)!;

describe('failed chore step', () => {
  it('v11: an end line naming an error file is a failure, and the chore fails with it', () => {
    const [chore] = analyze(V11).trees;
    expect(chore.kind).toBe('chore');
    expect(chore.status).toBe('error');
    const p2 = byName([chore], 'zzProbe_choreFail_p2');
    expect(p2.status).toBe('error');
    expect(p2.errorFile).toBe('TM1ProcessError_20261029182635_30306752_zzProbe_choreFail_p2.log');
    expect(byName([chore], 'zzProbe_choreFail_p1').status).toBe('ok');
    expect(byName([chore], 'zzProbe_choreFail_p3').status).toBe('ok');
  });

  it('v12: the failed step carries the run log and its first error line', () => {
    const entries = sortEntriesByTime(parseRunLogContent(V12_BODY, parseRunLogFilename(V12_FILE)!), false);
    const [chore] = analyze(entries).trees;
    expect(chore.status).toBe('error');
    const p2 = byName([chore], 'zzProbe_choreFail_p2');
    expect(p2.errorFile).toBe(V12_FILE);
    expect(p2.errorText).toBe('Error: Prolog procedure line (1): probe step two rejects');
    expect(byName([chore], 'zzProbe_choreFail_p3').errorFile).toBeUndefined();
  });

  it('renders a log link only on the failed step', () => {
    const [chore] = analyze(V11).trees;
    const html = renderNode(chore, { errorLog: 'Error log' } as MlaTexts);
    expect(html.match(/class="errlog"/g)).toHaveLength(1);
    expect(html).toContain('data-file="TM1ProcessError_20261029182635_30306752_zzProbe_choreFail_p2.log"');
  });
});

describe('onlyChoreRuns', () => {
  it('keeps only the named chore, case-insensitively, and recounts', () => {
    const lone: RawEntry = { TimeStamp: '2026-10-29T18:00:00.000Z', Message: 'Process "other":  finished executing normally, elapsed time 0.00 seconds', Level: 'Info' };
    const r = onlyChoreRuns(analyze([...V11, lone]), 'ZZPROBE_choreFail');
    expect(r.trees.map(t => t.name)).toEqual(['zzProbe_choreFail']);
    expect(r.parsedRuns).toBe(3);
    expect(r.stats.map(s => s.name).sort()).toEqual(['zzProbe_choreFail_p1', 'zzProbe_choreFail_p2', 'zzProbe_choreFail_p3']);
  });
});

describe('v12 error text of overlapping runs', () => {
  it('each run keeps the error line from its own run log', () => {
    const line = (t: string, RunFile: string, Level: string, Message: string): RawEntry =>
      ({ TimeStamp: `2026-10-29T18:00:0${t}.000Z`, Level, Message, Name: 'P', RunFile });
    const entries = [
      line('5', 'A.jsonl', 'Info', 'Process execution finished with messages.'),
      line('4', 'B.jsonl', 'Info', 'Process execution finished with messages.'),
      line('3', 'B.jsonl', 'Error', 'Error B'),
      line('2', 'A.jsonl', 'Error', 'Error A'),
      line('1', 'B.jsonl', 'Info', "Process 'P' executed by user 'u'."),
      line('0', 'A.jsonl', 'Info', "Process 'P' executed by user 'u'."),
    ];
    const runs = analyze(entries).trees;
    const text = (file: string) => runs.find(n => n.errorFile === file)?.errorText;
    expect(text('A.jsonl')).toBe('Error A');
    expect(text('B.jsonl')).toBe('Error B');
  });
});

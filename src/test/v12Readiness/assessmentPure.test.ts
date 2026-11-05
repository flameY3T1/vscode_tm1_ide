import { describe, it, expect } from 'vitest';
import { analyse } from '../../v12Readiness/analysisPure';
import { compare, parseAssessmentFile, toAssessmentFile, causeId, usageId, baselineOf } from '../../v12Readiness/assessmentPure';
import { toMarkdown, type ReportL10n } from '../../v12Readiness/renderPure';
import type { ScanInput, SourceProcess } from '../../v12Readiness/types';

const p = (name: string, prolog: string, ds: SourceProcess['dataSource'] = { type: 'None' }): SourceProcess =>
  ({ name, dataSource: ds, code: { prolog, metadata: '', data: '', epilog: '' } });

const scanOf = (processes: SourceProcess[], extra: Partial<ScanInput> = {}): ScanInput => ({
  serverAlias: 'srv', scannedAt: '2026-10-01T10:00:00Z', complete: true, processes,
  activeChoreProcessesLc: [], calls: [], gaps: [], runLog: { lines: 1, capped: false, processesLc: [] }, ...extra,
});

const first = scanOf([
  p('A', "ExecuteCommand('x', 0);"),
  p('B', "ExecuteCommand('y', 0);\nSaveDataAll;"),
  p('Odbc', '', { type: 'ODBC', nameForServer: 'DWH', ...({ password: 'secret', userName: 'u' } as object) }),
]);
const a1 = analyse(first);

describe('assessment file', () => {
  it('round-trips decisions and baseline', () => {
    const decisions = {
      [causeId({ rule: 'removed-function', key: 'ExecuteCommand' })]: { status: 'not-an-issue' as const, updatedAt: 'x' },
      [usageId('Odbc')]: { status: 'retire' as const, updatedAt: 'x' },
    };
    const text = JSON.stringify(toAssessmentFile(first, a1, decisions, '2026-10-01T11:00:00Z'));
    const back = parseAssessmentFile(text);
    expect(back.decisions).toEqual(decisions);
    expect(back.baseline).toEqual(baselineOf(first, a1));
  });

  it('writes no code, no credentials, no data source details', () => {
    const text = JSON.stringify(toAssessmentFile(first, a1, {}, 'now'));
    expect(text).not.toContain('secret');
    expect(text).not.toContain('ExecuteCommand(');
    expect(text).not.toContain('userName');
  });

  it('rejects foreign and newer files, drops unknown statuses and extra fields', () => {
    expect(() => parseAssessmentFile('{"kind":"other"}')).toThrow();
    expect(() => parseAssessmentFile(JSON.stringify({ ...toAssessmentFile(first, a1, {}, 'n'), schemaVersion: 2 }))).toThrow(/schema/);
    const f = toAssessmentFile(first, a1, {}, 'n') as unknown as { decisions: Record<string, unknown> };
    f.decisions = { a: { status: 'hacked', updatedAt: '' }, b: { status: 'not-an-issue', note: 'x', owner: 'y', updatedAt: '' } };
    const back = parseAssessmentFile(JSON.stringify(f));
    expect(back.decisions).toEqual({ b: { status: 'not-an-issue', updatedAt: '' } });
  });
});

describe('compare', () => {
  const base = baselineOf(first, a1);

  it('reports new, gone and changed causes; gone is never "fixed"', () => {
    const second = scanOf([p('A', "ExecuteCommand('x', 0);"), p('C', "AsciiOutput('C:\\\\TM1\\\\Out\\\\a.csv', 'x');")], { scannedAt: '2026-10-08T10:00:00Z' });
    const c = compare(base, second, analyse(second));
    expect(c.newCauses).toEqual(['file-path|c:\\tm1\\out']);
    expect(c.goneCauses.map(g => g.id).sort()).toEqual(['odbc|dwh', 'removed-function|savedataall']);
    expect(c.changedCount).toEqual({ 'removed-function|executecommand': 2 });
    expect(c.comparable).toBe(true);
  });

  it('is not comparable when the new scan missed a source the baseline read', () => {
    const later = scanOf(first.processes, { scannedAt: '2026-10-08T10:00:00Z', gaps: ['cube rules'] });
    expect(compare(base, later, analyse(later)).comparable).toBe(false);
  });

  it('is not comparable when the baseline was compiled and the new scan was not', () => {
    const compiled = scanOf(first.processes, { compile: { server: 'v12', checked: 3, partial: false, notCheckable: [], failures: [
      { process: 'Odbc', section: 'data', line: 0, message: "Variable 'x' undefined." }] } });
    const b = baselineOf(compiled, analyse(compiled));
    expect(b.compiled).toBe(true);
    const later = scanOf(first.processes, { scannedAt: '2026-10-08T10:00:00Z' });
    expect(compare(b, later, analyse(later)).comparable).toBe(false);
    const partial = { ...later, compile: { ...compiled.compile!, partial: true } };
    expect(compare(b, partial, analyse(partial)).comparable).toBe(false);
    const again = { ...later, compile: { ...compiled.compile!, failures: [] } };
    expect(compare(b, again, analyse(again)).comparable).toBe(true);
  });

  it('is not comparable when a scan was cancelled', () => {
    const partial = scanOf([], { complete: false });
    expect(compare(base, partial, analyse(partial)).comparable).toBe(false);
  });
});

describe('report with state', () => {
  const L = new Proxy({} as ReportL10n, {
    get: (_t, k: string) => {
      if (k.endsWith('Items')) { return []; }
      if (k === 'ruleNames') { return { 'removed-function': 'RF', 'file-path': 'FP', odbc: 'ODBC', 'control-cube': 'CC' }; }
      if (k === 'statusLabels') { return { open: 'OPEN', 'not-an-issue': 'NAI', unclear: 'UNCLEAR', retire: 'RETIRE', keep: 'KEEP' }; }
      if (k === 'formatDate') { return undefined; }
      return k.includes('{0}') ? k : `${k} {0}`;
    },
  });

  it('shows decisions in the export and the comparison section', () => {
    const second = scanOf([p('A', "ExecuteCommand('x', 0);")], { scannedAt: '2026-10-08T10:00:00Z' });
    const a2 = analyse(second);
    const md = toMarkdown(second, a2, L, 'full', {
      decisions: { [causeId({ rule: 'removed-function', key: 'ExecuteCommand' })]: { status: 'not-an-issue', updatedAt: '' } },
      comparison: compare(baselineOf(first, a1), second, a2),
    });
    expect(md).toContain('NAI');
    expect(md).toContain('changesSince 2026-10-01T10:00:00Z');
    expect(md).toContain('goneCauses');
  });
});


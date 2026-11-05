import { describe, it, expect } from 'vitest';
import { analyse } from '../../v12Readiness/analysisPure';
import { toHtmlBody, toHtmlDocument, toMarkdown, summarize, escMd, type ReportL10n } from '../../v12Readiness/renderPure';
import type { ScanInput, SourceProcess } from '../../v12Readiness/types';

// Every text is its key, so the assertions read the structure, not a translation.
const L = new Proxy({} as ReportL10n, {
  get: (_t, k: string) => {
    if (k === 'notCheckedItems' || k === 'manualCheckItems') { return [`${k}-1`, `${k}-2`]; }
    if (k === 'statusLabels') { return new Proxy({}, { get: (_x, y) => String(y) }); }
    if (k === 'ruleNames') { return { 'removed-function': 'RF', 'file-path': 'FP', odbc: 'ODBC', 'control-cube': 'CC' }; }
    if (['controlProcesses', 'processesN'].includes(k)) { return `${k}={0}`; }
    if (k === 'formatDate') { return undefined; }
    if (k === 'runLogWindow') { return 'window {0}..{1} {2}'; }
    return k;
  },
});

const p = (name: string, prolog: string, ds: SourceProcess['dataSource'] = { type: 'None' }): SourceProcess =>
  ({ name, dataSource: ds, code: { prolog, metadata: '', data: '', epilog: '' } });

const scan: ScanInput = {
  serverAlias: 'srv', productVersion: '11.8', scannedAt: '2026-10-07T20:00Z', complete: true,
  processes: [
    p('A <script>alert(1)</script>', "ExecuteCommand('x', 0);"),
    p('B|pipe', "ExecuteCommand('y', 0);\nAsciiOutput('C:\\Out\\a.csv', 'x');"),
    p('Odbc', '', { type: 'ODBC', nameForServer: 'DWH' }),
  ],
  activeChoreProcessesLc: [], calls: [], gaps: [],
  runLog: { lines: 5, capped: true, from: '2026-05-01', to: '2026-10-07', processesLc: [] },
};
const a = analyse(scan);

describe('renderPure', () => {
  it('counts a cause once, however many occurrences it has', () => {
    expect(summarize(a)).toEqual({ userProcesses: 3, processesWithBlocker: 2, causesBlocker: 2, causesIntegration: 1 });
  });

  it('extract shows the same overview numbers as the full report', () => {
    const overview = (md: string) => { const i = md.indexOf('## overview'); return md.slice(i, md.indexOf('\n## ', i + 1)); };
    expect(overview(toMarkdown(scan, a, L, 'full'))).toContain('**2** tileWithBlocker');
    expect(overview(toMarkdown(scan, a, L, 'extract'))).toBe(overview(toMarkdown(scan, a, L, 'full')));
  });

  it('extract leaves out occurrences and usage list, keeps manual checks', () => {
    const md = toMarkdown(scan, a, L, 'extract');
    expect(md).not.toContain('usageNotEvidencedNote');
    expect(md).not.toContain('C:\\\\Out\\\\a.csv');
    expect(md).toContain('manualCheckItems-1');
    expect(md).toContain('extractNote');
  });

  it('states the read window and that the cap was hit', () => {
    expect(toMarkdown(scan, a, L, 'extract')).toContain('window 2026-05-01..2026-10-07 5 runLogCapped');
    const Ld = new Proxy(L, { get: (t, k: string) => (k === 'formatDate' ? (iso: string) => `D(${iso})` : (t as any)[k]) });
    expect(toMarkdown(scan, a, Ld, 'extract')).toContain('window D(2026-05-01)..D(2026-10-07)');
  });

  it('escapes process names in HTML', () => {
    const html = toHtmlDocument(scan, a, L, 'full');
    expect(html).not.toContain('<script>');
    expect(html).toContain('A &lt;script&gt;');
  });

  it('escapes pipes in Markdown', () => {
    expect(escMd('B|pipe')).toBe('B\\|pipe');
    expect(toMarkdown(scan, a, L, 'full')).toContain('B\\|pipe');
  });

  it('jump links only in the interactive body', () => {
    expect(toHtmlBody(scan, a, L, 'full', true)).toContain('data-process="B|pipe" data-section="prolog" data-line="1"');
    expect(toHtmlBody(scan, a, L, 'full', true, '<button>X</button>')).toMatch(/class="head">.*<button>X<\/button><\/div>/);
    expect(toHtmlDocument(scan, a, L, 'full')).not.toContain('data-process');
    expect(toHtmlDocument(scan, a, L, 'full')).not.toContain('<script');
  });

  it('lists cube rules as not checked only when they were not read', () => {
    expect(toMarkdown(scan, a, L, 'extract')).toContain('notChecked: notCheckedRules, notCheckedItems-1');
    const withRules = { ...scan, cubeRules: [] };
    const md = toMarkdown(withRules, analyse(withRules), L, 'extract');
    expect(md).not.toContain('notCheckedRules');
    expect(md).toContain('notChecked: notCheckedItems-1');
  });

  it('marks a cancelled scan', () => {
    expect(toMarkdown({ ...scan, complete: false }, a, L, 'extract')).toContain('partialScan');
  });
});

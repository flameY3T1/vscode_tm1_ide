import { describe, it, expect } from 'vitest';
import {
  parseNotebookFile, stringifyNotebookFile, cellsetToHtml,
  parseParams, applyParams, parseCheck, shownValue, stripCheckLine, evaluateCheck, buildReport, cellsetToMarkdown,
  parseCellName, reconcile, tableSum, parseSince, parseStatusLines, errorLogsSince, choreRunSince, TEMPLATES,
  runStamp, storedSum,
} from '../../notebook/notebookPure';
import type { CellsetTable } from '../../mdx/cellsetParser';

describe('notebookPure', () => {
  it('round-trips cells and defaults a code cell without language to MDX', () => {
    const file = parseNotebookFile(JSON.stringify({ cells: [
      { kind: 'markdown', source: '# Close' },
      { kind: 'code', source: 'SELECT {} ON 0 FROM [c]' },
      { kind: 'code', language: 'ti', source: 'SaveDataAll;' },
    ] }));
    expect(file.cells.map(c => c.language)).toEqual([undefined, 'tm1mdx', 'ti']);
    expect(parseNotebookFile(stringifyNotebookFile(file))).toEqual(file);
  });

  it('opens an empty file as an empty notebook', () => {
    expect(parseNotebookFile('  ')).toEqual({ cells: [] });
  });

  it('escapes server names in the result table', () => {
    const html = cellsetToHtml({
      colHierarchies: ['Month'], colHeaders: [['<Jan>']],
      rowHierarchies: ['Account'], rowHeaders: [['A&B']],
      titleHeaders: [], cells: [[{ value: 1, formatted: '1.00' }]], dims: { rows: 1, cols: 1 },
    });
    expect(html).toContain('&lt;Jan&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('text-align:right');
  });
});

function table(values: Array<number | string | null>, rows = values.map((_, i) => `R${i}`)): CellsetTable {
  return {
    colHierarchies: ['Version'], colHeaders: [['Actual']],
    rowHierarchies: ['Account'], rowHeaders: rows.map(r => [r]),
    titleHeaders: [], cells: values.map(v => [{ value: v, formatted: String(v ?? '') }]),
    dims: { rows: rows.length, cols: 1 },
  };
}

describe('notebook parameters', () => {
  it('parses Name = Value, skips comments, later wins', () => {
    expect(parseParams('# c\nMonth = 09\n-- x\nYear=2026\nMonth = 10')).toEqual({ Month: '10', Year: '2026' });
  });

  it('replaces only defined names and leaves MDX sets alone', () => {
    const p = { Month: '09' };
    expect(applyParams('{[Month].[{month}]} {Other}', p)).toBe('{[Month].[09]} {Other}');
  });

  it('escapes a value only inside an MDX name or a TI string', () => {
    const p = { V: "a]b'c" };
    expect(applyParams('[D].[{V}] {V}', p, 'mdx')).toBe("[D].[a]]b'c] a]b'c");
    expect(applyParams('[x]]{V}]', p, 'mdx')).toBe("[x]]a]]b'c]");
    expect(applyParams("s = '{V}'; t = {V};\n# it's\nu = {V};", p, 'ti')).toBe("s = 'a]b''c'; t = a]b'c;\n# it's\nu = a]b'c;");
  });
});

describe('notebook checks', () => {
  it('parses the check line forms', () => {
    expect(parseCheck('SELECT 1')).toBeUndefined();
    expect(parseCheck('// check: empty\nSELECT')).toEqual({ kind: 'empty' });
    expect(parseCheck('-- check: zero')).toEqual({ kind: 'compare', op: '=', value: 0, abs: false });
    expect(parseCheck('// check: abs < 0,5')).toEqual({ kind: 'compare', op: '<', value: 0.5, abs: true });
    expect(parseCheck('// check: <> 1')).toEqual({ kind: 'compare', op: '!=', value: 1, abs: false });
    expect(parseCheck('// check: maybe')).toBe('maybe');
  });

  it('strips the check line before the query goes to TM1', () => {
    expect(stripCheckLine('// check: zero\nSELECT 1').trim()).toBe('SELECT 1');
  });

  it('zero: empty cells count as 0, strings are skipped, failures are named', () => {
    const r = evaluateCheck({ kind: 'compare', op: '=', value: 0, abs: false }, table([0, null, 'x', 3]));
    expect(r.ok).toBe(false);
    expect(r.failureCount).toBe(1);
    expect(r.failures[0]).toContain('R3');
  });

  it('abs tolerance passes small deviations in both directions', () => {
    expect(evaluateCheck({ kind: 'compare', op: '<', value: 0.01, abs: true }, table([0.001, -0.005])).ok).toBe(true);
  });

  it('empty: fails for every row tuple', () => {
    expect(evaluateCheck({ kind: 'empty' }, table([], [])).ok).toBe(true);
    expect(evaluateCheck({ kind: 'empty' }, table([1, 2])).failureCount).toBe(2);
  });
});

describe('notebook report', () => {
  const L = {
    title: 'Report', server: 'Server', user: 'User', date: 'Date', parameters: 'Parameters',
    summary: 'Result', passed: 'passed', failed: 'failed', notRun: 'not run',
  };

  it('counts code cells, skips parameter cells, keeps markdown', () => {
    const md = buildReport(
      { title: 'close', server: 'dev', user: 'u', date: 'd', params: { Month: '09' } },
      [
        { kind: 'markdown', source: '# Intro' },
        { kind: 'code', language: 'tm1params', source: 'Month = 09', ok: true },
        { kind: 'code', language: 'ti', source: 'x;', ok: true, result: 'done' },
        { kind: 'code', language: 'tm1mdx', source: 'SELECT', ok: false },
        { kind: 'code', language: 'tm1mdx', source: 'SELECT' },
      ],
      L,
    );
    expect(md).toContain('Result: 1 passed, 1 failed, 1 not run');
    expect(md).toContain('Parameters: Month = 09');
    expect(md).toContain('# Intro');
    expect(md).not.toContain('Month = 09\n```');
    expect(md).toContain('```ti\nx;\n```\n\ndone');
  });

  it('escapes pipes in the Markdown table', () => {
    expect(cellsetToMarkdown(table([1], ['a|b']))).toContain('a\\|b');
  });
});

describe('notebook reconciliation', () => {
  it('parses name and reconcile lines and strips both', () => {
    expect(parseCellName('// name: source\nSELECT')).toBe('source');
    expect(parseCheck('// check: = source')).toEqual({ kind: 'reconcile', ref: 'source', tol: 0 });
    expect(parseCheck('-- check: = gl.total ± 0,5')).toEqual({ kind: 'reconcile', ref: 'gl.total', tol: 0.5 });
    expect(parseCheck('// check: = source +- 1')).toEqual({ kind: 'reconcile', ref: 'source', tol: 1 });
    expect(parseCheck('// check: = 0')).toEqual({ kind: 'compare', op: '=', value: 0, abs: false });
    expect(parseCheck('// check: = 1234567 ± 0,5')).toEqual({ kind: 'compare', op: '=', value: 1234567, abs: false, tol: 0.5 });
    const near = { kind: 'compare', op: '=', value: 1234567, abs: false, tol: 0.5 } as const;
    expect(evaluateCheck(near, table([1234567.37])).ok).toBe(true);
    expect(evaluateCheck(near, table([1234567.6])).failures[0]).toMatch(/: 1234567\.6$/);
    expect(shownValue({ value: 1234567.37, formatted: '1.234.567' })).toBe('1234567.37');
    expect(shownValue({ value: 1234567, formatted: '1.234.567' })).toBe('1.234.567');
    expect(shownValue({ value: 'x', formatted: 'x' })).toBe('x');
    expect(shownValue({ value: 1234.5, formatted: '1,234.50' })).toBe('1,234.50');
    expect(shownValue({ value: 0.5, formatted: '50%' })).toBe('50%');
    expect(shownValue({ value: 1234.5600000000002, formatted: '1,234.56' })).toBe('1,234.56');
    expect(shownValue({ value: 1234.4, formatted: '1,234' })).toBe('1234.4');
    expect(stripCheckLine('// name: a\n// check: = b\nSELECT 1').trim()).toBe('SELECT 1');
  });

  it('sums numbers only and compares within tolerance', () => {
    expect(tableSum(table([1.5, null, 'x', 2]))).toBe(3.5);
    expect(reconcile(100, 100.004, 0.01).ok).toBe(true);
    expect(reconcile(100, 101, 0.01)).toMatchObject({ ok: false, diff: -1 });
    // float drift of a long sum passes an exact check
    expect(reconcile(0.1 + 0.2, 0.3, 0).ok).toBe(true);
    // the drift allowance must not outgrow a written tolerance on large sums
    expect(reconcile(1_000_000_000.5, 1_000_000_000, 0.01).ok).toBe(false);
    expect(reconcile(1_000_000_000_000.5, 1_000_000_000_000, 0).ok).toBe(false);
    expect(reconcile(1e12, 1e12 + 0.05, 0.01).ok).toBe(false);
  });
});

describe('notebook status cells', () => {
  const now = new Date(2026, 8, 26, 15, 30);

  it('parses since forms in local time', () => {
    expect(parseSince('today', now)).toEqual(new Date(2026, 8, 26));
    expect(parseSince('yesterday', now)).toEqual(new Date(2026, 8, 25));
    expect(parseSince('2026-09-01 08:15', now)).toEqual(new Date(2026, 8, 1, 8, 15));
    expect(parseSince('2026-02-30', now)).toBeUndefined();
    expect(parseSince('soon', now)).toBeUndefined();
  });

  it('parses lines, skips comments, flags the rest', () => {
    const lines = parseStatusLines('# c\nno errors since today\nchore "Nightly Load" ran since 2026-09-25\nwhatever', now);
    expect(lines.map(l => l.kind)).toEqual(['errors', 'chore', 'invalid']);
    expect(lines[1]).toMatchObject({ name: 'Nightly Load' });
  });

  it('error logs: only v11 error files at or after since, newest first', () => {
    const files = [
      'TM1ProcessError_20260926080000_123_Load.log',
      'TM1ProcessError_20260925235959_1_Old.log',
      'TM1ProcessError_20260926140000_9_Copy.log',
      'ProcessLog_20260926090000_1_X.jsonl',
      'tm1server.log',
    ];
    expect(errorLogsSince(files, new Date(2026, 8, 26))).toEqual([
      'TM1ProcessError_20260926140000_9_Copy.log',
      'TM1ProcessError_20260926080000_123_Load.log',
    ]);
  });

  it('chore: finished, running or none since', () => {
    const since = new Date(2026, 8, 26).getTime();
    const runs = [
      { name: 'Nightly', startMs: since - 5000, endMs: since - 1000 },
      { name: 'Nightly', startMs: since + 1000, endMs: since + 9000 },
      { name: 'Hourly', startMs: since + 2000 },
    ];
    expect(choreRunSince(runs, 'nightly', since)).toEqual({ state: 'finished', endMs: since + 9000 });
    expect(choreRunSince(runs, 'Hourly', since)).toEqual({ state: 'running', startMs: since + 2000 });
    expect(choreRunSince(runs, 'Weekly', since)).toEqual({ state: 'none' });
  });
});

describe('notebook templates', () => {
  it('closing checklist uses every cell kind and its checks parse', () => {
    const cells = TEMPLATES.closing;
    expect(new Set(cells.map(c => c.language ?? 'markdown'))).toEqual(
      new Set(['markdown', 'tm1params', 'ti', 'tm1status', 'tm1mdx']));
    for (const c of cells.filter(c => c.language === 'tm1mdx')) {
      expect(typeof parseCheck(c.source)).not.toBe('string');
    }
    for (const c of cells.filter(c => c.language === 'tm1status')) {
      expect(parseStatusLines(c.source).some(l => l.kind === 'invalid')).toBe(false);
    }
  });
});

describe('notebook examples template', () => {
  it('uses every cell kind, every check kind parses, and each check kind appears', () => {
    const cells = TEMPLATES.example;
    expect(new Set(cells.map(c => c.language ?? 'markdown'))).toEqual(
      new Set(['markdown', 'tm1params', 'ti', 'tm1status', 'tm1mdx']));
    const params = parseParams(cells.find(c => c.language === 'tm1params')!.source);
    const checks = cells.filter(c => c.language === 'tm1mdx')
      .map(c => parseCheck(applyParams(c.source, params, 'mdx')))
      .filter(c => c !== undefined);
    expect(checks.every(c => typeof c === 'object')).toBe(true);
    expect(new Set(checks.map(c => (c as { kind: string }).kind))).toEqual(new Set(['compare', 'empty', 'reconcile']));
    // a lower and an upper bound are shown, not only equality
    const ops = new Set(checks.filter(c => typeof c === 'object' && c.kind === 'compare').map(c => (c as { op: string }).op));
    expect([...ops].sort()).toEqual(['!=', '<', '=', '>=']);
  });
});

describe('storedSum', () => {
  it('trusts a sum only for the same server and parameters', () => {
    const stamp = runStamp('dev', { Year: '2026', Month: '09' });
    // Key order of the parameter cells does not matter.
    expect(storedSum({ sum: 5, stamp: runStamp('dev', { Month: '09', Year: '2026' }) }, stamp)).toBe(5);
    expect(storedSum({ sum: 5, stamp: runStamp('prod', { Year: '2026', Month: '09' }) }, stamp)).toBe('stale');
    expect(storedSum({ sum: 5, stamp: runStamp('dev', { Year: '2026', Month: '08' }) }, stamp)).toBe('stale');
    expect(storedSum({ sum: 5 }, stamp)).toBe('stale');
    // Base and a sandbox are different data on the same server.
    expect(storedSum({ sum: 5, stamp: runStamp('dev', { Year: '2026', Month: '09' }, 'What-if') }, stamp)).toBe('stale');
    expect(storedSum(undefined, stamp)).toBe('missing');
  });
});

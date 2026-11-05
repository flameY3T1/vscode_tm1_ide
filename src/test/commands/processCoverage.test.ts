import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  buildModel, branchTaken, summarize, type CoverageRun, type Sections,
} from '../../commands/processCoveragePure';
import { walkCoverage, type CoverageDebugClient } from '../../commands/processCoverageWalk';
import { MAX_UNREACHABLE_POLLS } from '../../debug/tm1DebugClient';
import { readFileSync } from 'fs';
import { join } from 'path';
import { doRun, renderHtml, type State } from '../../commands/processCoverage';

vi.mock('../../tm1Rest/processApi', () => ({
  getProcessParameters: vi.fn(async () => []),
  fetchProcessSections: vi.fn(async () => ({ prolog: 'x = 1;', metadata: '', data: '', epilog: '' })),
}));
vi.mock('../../commands/processCoverageWalk', async (orig) => {
  const real = await orig<typeof import('../../commands/processCoverageWalk')>();
  return { ...real, walkCoverage: vi.fn(real.walkCoverage) };
});

const sections = (prolog: string): Sections => ({ prolog, metadata: '', data: '', epilog: '' });

const PROLOG = [
  '#comment',          // 1
  'nX = 1;',           // 2
  'IF(nX = 1);',       // 3
  "  sA = 'a' |",      // 4
  "    'b';",          // 5
  'ELSEIF(nX = 2);',   // 6
  "  sA = 'c';",       // 7
  'ENDIF;',            // 8
  'WHILE(nX < 3);',    // 9
  '  nX = nX + 1;',    // 10
  'END;',              // 11
].join('\n');

const run = (hits: Record<string, number>, cap = 1000, capped: string[] = []): CoverageRun =>
  ({ at: '2026-09-23T10:00:00Z', params: [], hits, capped, cap, status: 'CompletedSuccessfully', durationMs: 1 });

describe('buildModel', () => {
  it('anchors each statement on its closing line — where TM1 stops (measured 2026-09-23)', () => {
    const m = buildModel(sections(PROLOG));
    // 4–5 is ONE statement; the debugger stops at 5, a breakpoint at 4 never takes effect.
    expect(m.prolog.lines).toEqual([2, 3, 5, 6, 7, 9, 10]);
    expect(m.prolog.starts).toEqual({ 5: 4 });
    expect(m.prolog.branches.map(b => `${b.line}:${b.kind}:${b.firstLine ?? '-'}`)).toEqual([
      '3:if:5', '3:elseif:7', '3:implicitElse:-', '9:whileBody:10', '9:whileSkipped:-',
    ]);
  });

  it('falls back to rough lines when the parser gives up', () => {
    const m = buildModel(sections('IF(1=1);\nx=1;'));
    expect(m.prolog.parseError).toBeTruthy();
    expect(m.prolog.lines).toEqual([1, 2]);
    expect(m.prolog.branches).toEqual([]);
  });
});

describe('branchTaken', () => {
  const m = buildModel(sections(PROLOG));
  const br = m.prolog.branches;
  const [ifB, elseifB, implicit, whileBody, whileSkipped] = br;

  it('reads a taken IF branch from its first line', () => {
    const r = run({ 'prolog:3': 1, 'prolog:5': 1, 'prolog:9': 3, 'prolog:10': 2 });
    expect(branchTaken(ifB, br, r)).toBe(1);
    expect(branchTaken(elseifB, br, r)).toBe(0);
    expect(branchTaken(implicit, br, r)).toBe(0);
    expect(branchTaken(whileBody, br, r)).toBe(2);
    // Whether the loop was ever left without a single iteration, the totals do not say.
    expect(branchTaken(whileSkipped, br, r)).toBeUndefined();
  });

  it('derives the silent fall-through from exact counts', () => {
    expect(branchTaken(implicit, br, run({ 'prolog:3': 5, 'prolog:5': 2, 'prolog:7': 1 }))).toBe(2);
    expect(branchTaken(whileSkipped, br, run({ 'prolog:9': 1 }))).toBe(1);
  });

  it('refuses to derive the fall-through from capped or reach-only counts', () => {
    expect(branchTaken(implicit, br, run({ 'prolog:3': 1, 'prolog:5': 1 }, 1))).toBeUndefined();
    expect(branchTaken(implicit, br, run({ 'prolog:3': 10, 'prolog:5': 3 }, 10, ['prolog:3']))).toBeUndefined();
  });

  it('knows nothing was taken when the head never ran', () => {
    expect(branchTaken(ifB, br, run({}))).toBe(0);
  });
});

describe('summary', () => {
  const m = buildModel(sections(PROLOG));
  const runs = [run({ 'prolog:2': 1, 'prolog:3': 1, 'prolog:5': 1, 'prolog:9': 1 })];

  it('unions lines and branches over runs', () => {
    const one = summarize(m, runs);
    expect(one).toMatchObject({ lines: 7, hitLines: 4, branches: 5 });
    const two = summarize(m, [...runs, run({ 'prolog:3': 1, 'prolog:6': 1, 'prolog:7': 1 })]);
    expect(two.hitLines).toBe(6);
    expect(two.takenBranches).toBeGreaterThan(one.takenBranches);
  });

});

describe('walkCoverage', () => {
  /** A debugger that plays back a fixed sequence of stops until breakpoints are missing. */
  function fake(stops: Array<[string, number]>, opts: { failAt?: number } = {}) {
    const bps = new Set<number>();
    const calls: string[] = [];
    let i = 0;
    let status = 'Paused';
    const client: CoverageDebugClient = {
      startDebug: async () => ({ id: 'ctx', status: 'Paused' }),
      addBreakpoint: async (_id, _p, _proc, _line, bp) => { bps.add(bp!); },
      removeBreakpoint: async (_id, bp) => { bps.delete(bp); calls.push(`rm ${bp}`); },
      clearBreakpoints: async () => { bps.clear(); calls.push('clear'); },
      getCallStack: async () => {
        if (opts.failAt === i) { throw new Error('boom'); }
        return [{ id: '1', procedure: stops[i][0], lineNumber: stops[i][1] }];
      },
      continue: async () => {
        calls.push('continue');
        // Next stop: the next entry whose breakpoint is still in place.
        i++;
        while (i < stops.length && !bps.has(stops[i][1])) { i++; }
        status = i < stops.length ? 'Paused' : 'Complete';
      },
      pollUntilPaused: async () => ({ id: 'ctx', status }),
      isEnded: (s) => s === 'Complete',
      stop: async (_id, name) => { calls.push(`stop ${name ?? ''}`); },
    };
    return { client, calls };
  }
  const model = buildModel(sections('x = 1;\nWHILE(x < 4);\n  x = x + 1;\nEND;'));
  const loop: Array<[string, number]> = [['Prolog', 1], ['Prolog', 2], ['Prolog', 3], ['Prolog', 2], ['Prolog', 3], ['Prolog', 2], ['Prolog', 3], ['Prolog', 2]];

  it('fails instead of reporting 0 % when TM1 rejects every breakpoint (review 2026-10-03, A6)', async () => {
    const { client, calls } = fake(loop);
    client.addBreakpoint = async () => { throw new Error('HTTP 400'); };
    await expect(walkCoverage(client, 'P', [], model, { cap: 1, isCancelled: () => false }))
      .rejects.toThrow(/rejected all 3 breakpoints: HTTP 400/);
    // The paused debug process is still released.
    expect(calls.some(c => c.startsWith('stop'))).toBe(true);
  });

  it('stops once per line when only reach is recorded', async () => {
    const { client } = fake(loop);
    const r = await walkCoverage(client, 'P', [], model, { cap: 1, isCancelled: () => false });
    expect(r.hits).toEqual({ 'prolog:1': 1, 'prolog:2': 1, 'prolog:3': 1 });
    expect(r.status).toBe('Complete');
  });

  it('counts loop passes up to the cap', async () => {
    const { client } = fake(loop);
    const r = await walkCoverage(client, 'P', [], model, { cap: 3, isCancelled: () => false });
    expect(r.hits).toEqual({ 'prolog:1': 1, 'prolog:2': 3, 'prolog:3': 3 });
    expect(r.capped).toEqual(['prolog:2', 'prolog:3']);
  });

  it('lets the process finish without breakpoints when recording is cancelled', async () => {
    const { client, calls } = fake(loop);
    let n = 0;
    const r = await walkCoverage(client, 'P', [], model, { cap: 1000, isCancelled: () => ++n > 2 });
    expect(r.cancelled).toBe(true);
    expect(calls).toContain('clear');
    // Without breakpoints it runs through; no kill (stop without a process name).
    expect(calls[calls.length - 1]).toBe('stop ');
  });

  it('gives up releasing once the server stops answering, so the run can end', async () => {
    let polls = 0;
    const client: CoverageDebugClient = {
      startDebug: async () => ({ id: 'ctx', status: 'Paused' }),
      addBreakpoint: async () => undefined,
      removeBreakpoint: async () => undefined,
      clearBreakpoints: async () => undefined,
      getCallStack: async () => [],
      continue: async () => undefined,
      pollUntilPaused: async () => { polls++; return { id: 'ctx', status: 'Running', timedOut: true, pollError: 'ECONNREFUSED' }; },
      isEnded: (s) => s === 'Complete',
      stop: async () => undefined,
    };
    let n = 0;
    const r = await walkCoverage(client, 'P', [], model, { cap: 1, isCancelled: () => ++n > 1 });
    expect(r.cancelled).toBe(true);
    // One poll from the run, then the release up to the upper limit.
    expect(polls).toBe(1 + MAX_UNREACHABLE_POLLS);
  });

  it('ends the walk when the server stops answering instead of polling forever', async () => {
    let polls = 0;
    const stops: Array<string | undefined> = [];
    const client: CoverageDebugClient = {
      startDebug: async () => ({ id: 'ctx', status: 'Paused' }),
      addBreakpoint: async () => undefined,
      removeBreakpoint: async () => undefined,
      clearBreakpoints: async () => undefined,
      getCallStack: async () => [],
      continue: async () => undefined,
      pollUntilPaused: async () => { polls++; return { id: 'ctx', status: 'Running', timedOut: true, pollError: 'ECONNREFUSED' }; },
      isEnded: (s) => s === 'Complete',
      stop: async (_id, name) => { stops.push(name); },
    };
    await expect(walkCoverage(client, 'P', [], model, { cap: 1, isCancelled: () => false })).rejects.toThrow('ECONNREFUSED');
    // Walk gives up after the cap, release gives up after the cap, then stop.
    expect(polls).toBe(2 * MAX_UNREACHABLE_POLLS);
    expect(stops).toEqual(['P']);
  });

  it('releases the process on an error and still tears the session down', async () => {
    const { client, calls } = fake(loop, { failAt: 1 });
    await expect(walkCoverage(client, 'P', [], model, { cap: 1, isCancelled: () => false })).rejects.toThrow('boom');
    expect(calls).toContain('clear');
    expect(calls[calls.length - 1]).toMatch(/^stop/);
  });
});

describe('coverage webview', () => {
  const webview = { cspSource: 'vscode-webview:' } as unknown as vscode.Webview;
  const st: State = {
    cfg: { serverUrl: 'http://tm1' } as never, processName: 'Load', sections: sections(PROLOG),
    model: buildModel(sections(PROLOG)), runs: [run({ 'prolog:2': 1, 'prolog:3': 1, 'prolog:5': 1 })], running: false, cap: 1,
  };
  const html = renderHtml(webview, st);

  it('carries every control the bundle wires', () => {
    // The script is the bundle webviewClient/processCoverage/ since 2026-10.
    const script = readFileSync(join(__dirname, '../../webviewClient/processCoverage/index.ts'), 'utf8');
    for (const id of ['runBtn', 'capSel', 'missChk', 'resetBtn']) {
      expect(html).toContain(`id="${id}"`);
      expect(script).toContain(`'${id}'`);
    }
  });

  it('marks reached and missed lines and escapes the source', () => {
    expect(html).toMatch(/class="ln hit"[^>]*data-l="2"/);
    expect(html).toMatch(/class="ln miss"[^>]*data-l="7"/);
    expect(html).toContain('sA = &#39;a&#39; |');
    // The first line of the multi-line statement carries its colour.
    expect(html).toMatch(/class="ln hit"[^>]*data-l="4"/);
  });

});

describe('doRun', () => {
  const panelFor = () => ({ webview: { cspSource: 'vscode-webview:', html: '' } }) as unknown as vscode.WebviewPanel;
  const fresh = (): State => ({
    cfg: { serverUrl: 'http://tm1' } as never, processName: 'Load', sections: sections('x = 1;'),
    model: buildModel(sections('x = 1;')), runs: [], running: false, cap: 1,
  });

  it('runs the process once when Run arrives twice before the first confirmation returns', async () => {
    const walk = vi.mocked(walkCoverage);
    walk.mockClear();
    walk.mockResolvedValueOnce(run({}));
    const warn = vi.mocked(vscode.window.showWarningMessage);
    warn.mockClear();
    let confirm!: (v: unknown) => void;
    warn.mockImplementationOnce(() => new Promise(r => { confirm = r; }) as never);
    const st = fresh();
    const panel = panelFor();
    const first = doRun(st, panel, 1);
    await doRun(st, panel, 1);
    confirm('Run');
    await first;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(st.running).toBe(false);
  });

  it('stops drawing once the window is gone', async () => {
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined as never);
    const st = fresh();
    st.disposed = true;
    const panel = panelFor();
    Object.defineProperty(panel.webview, 'html', { set: () => { throw new Error('Webview is disposed'); } });
    await expect(doRun(st, panel, 1)).resolves.toBeUndefined();
  });

  it('asks for parameters inside the coverage window, once its page is ready', async () => {
    const { getProcessParameters } = await import('../../tm1Rest/processApi');
    vi.mocked(getProcessParameters).mockResolvedValueOnce([{ Name: 'pYear', Type: 'Numeric', Value: 2026, Prompt: '' }] as never);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Run' as never);
    const walk = vi.mocked(walkCoverage);
    walk.mockClear();
    walk.mockResolvedValueOnce(run({}));
    const posted: Array<{ type: string; requestId?: string }> = [];
    const panel = {
      webview: { cspSource: 'vscode-webview:', html: '', postMessage: async (m: { type: string }) => { posted.push(m); return true; } },
      onDidDispose: () => ({ dispose() { /* stub */ } }),
    } as unknown as vscode.WebviewPanel;
    const st = fresh();
    let ready!: () => void;
    st.ready = new Promise((r) => { ready = r; });

    const done = doRun(st, panel, 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toHaveLength(0); // page not ready yet: nothing posted, nothing lost
    ready();
    await vi.waitFor(() => expect(posted.map(m => m.type)).toEqual(['askParams']));
    const { answerParamAsk } = await import('../../commands/processEditor/processParams');
    answerParamAsk(String(posted[0].requestId), { pYear: '2027' });
    await done;
    expect(walk.mock.calls[0][2]).toEqual([{ Name: 'pYear', Value: 2027 }]);
  });
});

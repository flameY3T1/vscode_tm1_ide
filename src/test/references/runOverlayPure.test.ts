// The mapping of measured calls to static call sites.
//
// The log line of a child process carries NO source location — two calls
// to the same target are character-identical. The mapping is therefore done via the
// order (`ExecuteProcess` runs synchronously on the parent thread), and
// `RunProcess` drops out entirely, because it writes no child line at all.
import { describe, it, expect } from 'vitest';
import { alignChildren, extraCalls, attachAsync, type RootRun } from '../../references/runOverlayPure';
import type { CallGraphNode, CallEdge } from '../../references/callGraph';
import type { CallNode } from '../../messageLog/messageLogAnalysisPure';

function kante(callee: string, section: string, line: number, funcName = 'ExecuteProcess'): CallEdge {
  return { caller: 'P', callee, section, line, funcName, snippet: '', params: [] };
}

function statisch(callee: string, section: string, line: number, funcName = 'ExecuteProcess'): CallGraphNode {
  return { process: callee, incomingEdge: kante(callee, section, line, funcName), children: [], cycle: false };
}

function gemessen(name: string, elapsedSec: number | null): CallNode {
  return {
    name, kind: 'process', startTs: '2026-08-26T07:00:00Z',
    elapsedSec, selfSec: elapsedSec, selfPct: 100, status: 'ok',
    truncated: false, ambiguous: false, inconsistent: false, children: [],
  };
}

describe('alignChildren — as many calls as call sites', () => {
  it('maps in order: first call to the first site', () => {
    const stat = [statisch('sleep', 'prolog', 5), statisch('sleep', 'epilog', 9)];
    const mess = [gemessen('sleep', 3.0), gemessen('sleep', 1.01)];
    const zu = alignChildren(stat, mess);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([3.0]);
    expect(zu[1].map(c => c.elapsedSec)).toEqual([1.01]);
  });

  it('keeps different targets apart', () => {
    const stat = [statisch('a', 'prolog', 1), statisch('b', 'prolog', 2)];
    const mess = [gemessen('b', 2.0), gemessen('a', 1.0)];
    const zu = alignChildren(stat, mess);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([1.0]);
    expect(zu[1].map(c => c.elapsedSec)).toEqual([2.0]);
  });

  it('is case-insensitive', () => {
    const zu = alignChildren([statisch('Sleep', 'prolog', 5)], [gemessen('sleep', 2.0)]);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([2.0]);
  });
});

describe('alignChildren — count does not match', () => {
  it('loop: more calls than sites — the remaining ones go to the LAST site', () => {
    const stat = [statisch('sleep', 'prolog', 5)];
    const mess = [gemessen('sleep', 1.0), gemessen('sleep', 2.0), gemessen('sleep', 3.0)];
    const zu = alignChildren(stat, mess);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([1.0, 2.0, 3.0]);
  });

  it('two sites, three calls: the third one hangs on the second site', () => {
    const stat = [statisch('sleep', 'prolog', 5), statisch('sleep', 'epilog', 9)];
    const mess = [gemessen('sleep', 1.0), gemessen('sleep', 2.0), gemessen('sleep', 3.0)];
    const zu = alignChildren(stat, mess);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([1.0]);
    expect(zu[1].map(c => c.elapsedSec)).toEqual([2.0, 3.0]);
  });

  it('fewer calls than sites: BOTH sites get the one call', () => {
    // One site was skipped under an IF; the log does not say which one.
    const stat = [statisch('sleep', 'prolog', 5), statisch('sleep', 'epilog', 9)];
    const mess = [gemessen('sleep', 1.0)];
    const zu = alignChildren(stat, mess);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([1.0]);
    expect(zu[1].map(c => c.elapsedSec)).toEqual([1.0]);
  });

  it('no call at all: the site stays empty', () => {
    const zu = alignChildren([statisch('sleep', 'prolog', 5)], []);
    expect(zu[0]).toEqual([]);
  });
});

describe('alignChildren — RunProcess does not appear here at all', () => {
  it('leaves a RunProcess edge EMPTY', () => {
    // Confirmed live: RunProcess writes no `run from process` line. The
    // child tree of the parent run says nothing about it — the time comes via
    // `attachAsync` from the root runs of the window.
    const stat = [statisch('sleep', 'prolog', 5, 'RunProcess')];
    const zu = alignChildren(stat, []);
    expect(zu[0]).toEqual([]);
  });

  it('mixed: the synchronous edge gets the call, the asynchronous one does not', () => {
    const stat = [
      statisch('sleep', 'prolog', 5, 'ExecuteProcess'),
      statisch('sleep', 'epilog', 9, 'RunProcess'),
    ];
    const mess = [gemessen('sleep', 1.0)];
    const zu = alignChildren(stat, mess);
    expect(zu[0].map(c => c.elapsedSec)).toEqual([1.0]);
    expect(zu[1]).toEqual([]);
  });
});

describe('extraCalls', () => {
  it('reports measured calls without a static counterpart', () => {
    const stat = [statisch('a', 'prolog', 1)];
    const mess = [gemessen('a', 1.0), gemessen('recalc', 0.31)];
    expect(extraCalls(stat, mess).map(c => c.name)).toEqual(['recalc']);
  });

  it('reports nothing when everything is mapped', () => {
    const stat = [statisch('a', 'prolog', 1)];
    expect(extraCalls(stat, [gemessen('a', 1.0)])).toEqual([]);
  });
});

describe('attachAsync', () => {
  const wurzeln = [
    { ...gemessen('bg', 3.0), startTs: '2026-08-26T07:00:10Z', originator: 'n' },
    { ...gemessen('bg', 2.0), startTs: '2026-08-26T07:00:11Z', originator: 'n' },
    { ...gemessen('bg', 9.0), startTs: '2026-08-26T07:10:00Z', originator: 'n' },   // ausserhalb
    { ...gemessen('bg', 4.0), startTs: '2026-08-26T07:00:12Z', originator: 'x' },   // fremder Urheber
    { ...gemessen('andere', 5.0), startTs: '2026-08-26T07:00:12Z', originator: 'n' },
  ] as RootRun[];
  const fenster = { from: '2026-08-26T07:00:09Z', to: '2026-08-26T07:00:20Z', originator: 'n' };

  it('counts the runs of the target that started WITHIN the window', () => {
    const t = attachAsync('bg', wurzeln, fenster);
    expect(t.count).toBe(2);
    expect(t.elapsedSec).toBeCloseTo(5.0, 5);
    expect(t.certainty).toBe('async');
  });

  it('shows NO share — the time of the parent process does not contain them', () => {
    expect(attachAsync('bg', wurzeln, fenster).pctOfRoot).toBeNull();
  });

  it('ignores the originator when the window carries none', () => {
    const t = attachAsync('bg', wurzeln, { ...fenster, originator: undefined });
    expect(t.count).toBe(3);          // now the foreign originator too
  });

  it('ignores the originator when the RUN carries none', () => {
    const ohne = [{ ...gemessen('bg', 3.0), startTs: '2026-08-26T07:00:10Z' }] as RootRun[];
    expect(attachAsync('bg', ohne, fenster).count).toBe(1);
  });

  it('reports zero runs as count 0, not as null', () => {
    const t = attachAsync('gibtsnicht', wurzeln, fenster);
    expect(t.count).toBe(0);
    expect(t.elapsedSec).toBeNull();
  });

  it('colors the row when a run failed', () => {
    const mitFehler = [
      { ...gemessen('bg', 3.0), startTs: '2026-08-26T07:00:10Z', originator: 'n' },
      { ...gemessen('bg', 0.01), startTs: '2026-08-26T07:00:11Z', originator: 'n', status: 'error' },
    ] as RootRun[];
    expect(attachAsync('bg', mitFehler, fenster).status).toBe('error');
  });

  it('also counts runs without a reported run time', () => {
    // A rollback on a lock conflict reports no time — it still
    // happened, and 484 such runs are the interesting finding.
    const roll = [
      { ...gemessen('bg', null), startTs: '2026-08-26T07:00:10Z', originator: 'n', status: 'error' },
    ] as RootRun[];
    const t = attachAsync('bg', roll, fenster);
    expect(t.count).toBe(1);
    expect(t.elapsedSec).toBeNull();
  });
});

// ── Der ganze Baum ─────────────────────────────────────────────────────────
import { buildRunOverlay } from '../../references/runOverlayPure';

function statMit(process: string, children: CallGraphNode[]): CallGraphNode {
  return { process, incomingEdge: null, children, cycle: false };
}
function messMit(name: string, elapsedSec: number, children: CallNode[]): CallNode {
  return { ...gemessen(name, elapsedSec), children };
}

describe('buildRunOverlay', () => {
  it('computes the share at the root and the self time', () => {
    const stat = statMit('Load_All', [statisch('A', 'prolog', 1), statisch('B', 'prolog', 2)]);
    const mess = messMit('Load_All', 8.03, [gemessen('A', 3.0), gemessen('B', 1.01)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.timing!.elapsedSec).toBe(8.03);
    expect(ov.timing!.selfSec).toBeCloseTo(4.02, 2);
    expect(ov.children[0].timing!.elapsedSec).toBe(3.0);
    expect(ov.children[0].timing!.pctOfRoot).toBeCloseTo(37.36, 1);
    expect(ov.children[0].timing!.certainty).toBe('exact');
  });

  it('marks an edge that never ran with null', () => {
    const stat = statMit('Load_All', [statisch('A', 'prolog', 1), statisch('Archive', 'epilog', 9)]);
    const mess = messMit('Load_All', 3.0, [gemessen('A', 3.0)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.children[1].timing).toBeNull();
  });

  it('sums up the loop and keeps the individual values', () => {
    const stat = statMit('P', [statisch('sleep', 'prolog', 5)]);
    const mess = messMit('P', 7.0, [gemessen('sleep', 1.0), gemessen('sleep', 2.0), gemessen('sleep', 3.0)]);
    const t = buildRunOverlay(stat, mess, { roots: [] }).children[0].timing!;
    expect(t.elapsedSec).toBeCloseTo(6.0, 5);
    expect(t.count).toBe(3);
    expect(t.occurrences).toEqual([1.0, 2.0, 3.0]);
    expect(t.certainty).toBe('loop');
  });

  it('flags the ambiguous case', () => {
    const stat = statMit('P', [statisch('sleep', 'prolog', 5), statisch('sleep', 'epilog', 9)]);
    const mess = messMit('P', 2.0, [gemessen('sleep', 1.0)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.children[0].timing!.certainty).toBe('ambiguous');
    expect(ov.children[1].timing!.certainty).toBe('ambiguous');
  });

  it('fetches a RunProcess edge from the root runs, not from the children', () => {
    // The parent tree has NO child for it — RunProcess writes no
    // `run from process` line. The runs appear as roots of their own in the window.
    const stat = statMit('P', [statisch('bg', 'prolog', 5, 'RunProcess')]);
    const mess = { ...messMit('P', 2.0, []), startTs: '2026-08-26T07:00:00Z' };
    const wurzeln = [
      { ...gemessen('bg', 10.0), startTs: '2026-08-26T07:00:01Z', originator: 'n' },
    ] as RootRun[];
    const ov = buildRunOverlay(stat, mess, { roots: wurzeln, originator: 'n' });
    expect(ov.children[0].timing!.certainty).toBe('async');
    expect(ov.children[0].timing!.elapsedSec).toBe(10.0);
    expect(ov.children[0].timing!.pctOfRoot).toBeNull();
    // The asynchronous time is NOT subtracted — otherwise the result would be -8 s.
    expect(ov.timing!.selfSec).toBe(2.0);
  });

  it('leaves a RunProcess edge without runs in the window empty', () => {
    const stat = statMit('P', [statisch('bg', 'prolog', 5, 'RunProcess')]);
    const mess = { ...messMit('P', 2.0, []), startTs: '2026-08-26T07:00:00Z' };
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.children[0].timing).toBeNull();
  });

  it('appends only measured calls as extra', () => {
    const stat = statMit('P', [statisch('A', 'prolog', 1)]);
    const mess = messMit('P', 2.0, [gemessen('A', 1.0), gemessen('recalc', 0.3)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.extra.map(e => e.name)).toEqual(['recalc']);
    expect(ov.extra[0].timing.elapsedSec).toBe(0.3);
  });

  it('descends into the depth', () => {
    const enkel = statisch('Helper', 'epilog', 3);
    const kind: CallGraphNode = { ...statisch('A', 'prolog', 1), children: [enkel] };
    const stat = statMit('P', [kind]);
    const mess = messMit('P', 5.0, [messMit('A', 3.0, [gemessen('Helper', 0.5)])]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.children[0].children[0].timing!.elapsedSec).toBe(0.5);
  });

  it('stops at the cycle node instead of descending endlessly', () => {
    const zyklus: CallGraphNode = { ...statisch('P', 'prolog', 1), cycle: true };
    const stat = statMit('P', [zyklus]);
    const mess = messMit('P', 2.0, [gemessen('P', 1.0)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.children[0].children).toEqual([]);
  });

  it('keeps the child list index-aligned with the static tree', () => {
    // The renderer reads both via the same index.
    const stat = statMit('P', [statisch('A', 'prolog', 1), statisch('B', 'prolog', 2), statisch('C', 'prolog', 3)]);
    const mess = messMit('P', 2.0, [gemessen('B', 1.0)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.children).toHaveLength(3);
    expect(ov.children[0].timing).toBeNull();
    expect(ov.children[1].timing!.elapsedSec).toBe(1.0);
    expect(ov.children[2].timing).toBeNull();
  });

  it('copes with a root without a reported run time', () => {
    const stat = statMit('P', [statisch('A', 'prolog', 1)]);
    const mess = messMit('P', null as unknown as number, [gemessen('A', 1.0)]);
    const ov = buildRunOverlay(stat, mess, { roots: [] });
    expect(ov.timing!.selfSec).toBeNull();
    expect(ov.children[0].timing!.pctOfRoot).toBeNull();
  });
});

// ── Run-through: real log through analyze() and the overlay ────────────
import { readFileSync } from 'fs';
import { analyze, type RawEntry } from '../../messageLog/messageLogAnalysisPure';

describe('Durchlauf am echten Log', () => {
  it('separates the two calls of ##sleep from "## test1"', () => {
    const roh = JSON.parse(readFileSync('src/test/fixtures/messageLog/real-tm1-11.8-same-ms.json', 'utf8'));
    const entries: RawEntry[] = Array.isArray(roh) ? roh : (roh.value ?? []);
    const res = analyze(entries);
    const lauf = res.trees.find(t => t.name === '## test1' && (t.elapsedSec ?? 0) > 8);
    expect(lauf, 'Lauf mit 8,03 s im Fixture').toBeTruthy();

    // Static: "## test1" calls "##sleep" in two places.
    const stat: CallGraphNode = {
      process: '## test1', incomingEdge: null, cycle: false,
      children: [statisch('##sleep', 'prolog', 5), statisch('##sleep', 'epilog', 9)],
    };
    const ov = buildRunOverlay(stat, lauf!, { roots: res.trees as RootRun[] });

    // Both call sites carry their OWN time — exactly the case the
    // ordering rule was built for.
    const zeiten = ov.children.map(c => c.timing?.elapsedSec).sort();
    expect(zeiten).toEqual([1.01, 3]);
    expect(ov.children.every(c => c.timing?.certainty === 'exact')).toBe(true);
    // 8.03 in total minus 4.01 in the children.
    expect(ov.timing!.selfSec).toBeCloseTo(4.02, 2);
  });
});

// ── Aufrufer-Ansicht ───────────────────────────────────────────────────────
import { buildUpstreamOverlay } from '../../references/runOverlayPure';

describe('buildUpstreamOverlay', () => {
  const stat = statMit('Blatt', [statisch('Master', 'prolog', 1), statisch('Anderer', 'prolog', 2)]);
  const mess = { ...gemessen('Blatt', 2.5), selfSec: 2.5 };

  it('shows the own run time at the root — that is what you look for here', () => {
    const ov = buildUpstreamOverlay(stat, mess, 'Master');
    expect(ov.timing!.elapsedSec).toBe(2.5);
    expect(ov.timing!.pctOfRoot).toBe(100);
  });

  it('marks the caller that THIS run came from', () => {
    const ov = buildUpstreamOverlay(stat, mess, 'Master');
    expect(ov.children[0].timing).not.toBeNull();
    expect(ov.children[1].timing).toBeNull();
  });

  it('invents NO run time for the caller', () => {
    // The window begins at the start of this run; the caller started earlier
    // and its time is not contained in it.
    const ov = buildUpstreamOverlay(stat, mess, 'Master');
    expect(ov.children[0].timing!.elapsedSec).toBeNull();
  });

  it('leaves all callers empty when the run was started at the top', () => {
    const ov = buildUpstreamOverlay(stat, mess, undefined);
    expect(ov.children.every(c => c.timing === null)).toBe(true);
  });

  it('is case-insensitive regarding the caller name', () => {
    const ov = buildUpstreamOverlay(stat, mess, 'MASTER');
    expect(ov.children[0].timing).not.toBeNull();
  });
});

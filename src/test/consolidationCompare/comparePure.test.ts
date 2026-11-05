import { describe, it, expect } from 'vitest';
import {
  applyChanges, buildModel, classify, compare, netOps, rootsUsing, wouldCycle,
  subtreeCsv, changesCsv, growableModel, sameEdges, probe, CycleError, parseEdgeText, matchNames, nameKey, draftFromImport, ALL_LEAVES, allLeavesModel, bulkFix, suggestParent, groupByRefParent, csvLine, type Edge,
} from '../../consolidationCompare/comparePure';

const E = (rows: Array<[string, string, number]>): Edge[] =>
  rows.map(([parent, child, weight]) => ({ parent, child, weight }));

// The example from the clickable prototype: four structures over the same
// companies, with five planted errors in Segment and Region.
const SAMPLE = E([
  ['Konzern_Legal', 'Holding_DE', 1],
  ['Konzern_Legal', 'Holding_EU', 1],
  ['Konzern_Legal', 'Holding_US', 1],
  ['Konzern_Legal', 'Holding_APAC', 1],
  ['Holding_DE', 'GES_DE01', 1],
  ['Holding_DE', 'GES_DE02', 1],
  ['Holding_DE', 'GES_DE03', 1],
  ['Holding_DE', 'GES_AT01', 1],
  ['Holding_DE', 'GES_CH01', 1],
  ['Holding_EU', 'GES_FR01', 1],
  ['Holding_EU', 'GES_IT01', 1],
  ['Holding_EU', 'GES_ES01', 1],
  ['Holding_US', 'GES_US01', 1],
  ['Holding_US', 'GES_US02', 1],
  ['Holding_APAC', 'GES_CN01', 1],
  ['Holding_APAC', 'GES_JP01', 1],
  ['Konzern_Segment', 'Seg_Fahrrad', 1],
  ['Konzern_Segment', 'Seg_EBike', 1],
  ['Seg_Fahrrad', 'GES_DE01', 1],
  ['Seg_Fahrrad', 'GES_DE02', 1],
  ['Seg_Fahrrad', 'GES_AT01', 1],
  ['Seg_Fahrrad', 'GES_FR01', 1],
  ['Seg_Fahrrad', 'GES_US01', 1],
  ['Seg_Fahrrad', 'GES_US02', 1],
  ['Seg_Fahrrad', 'GES_CN01', 1],
  ['Seg_EBike', 'GES_DE03', 1],
  ['Seg_EBike', 'GES_CH01', 1],
  ['Seg_EBike', 'GES_IT01', 1],
  ['Seg_EBike', 'GES_ES01', 1],
  ['Seg_EBike', 'GES_US02', 1],
  ['Seg_EBike', 'GES_XX99', 1],
  ['Konzern_Region', 'Europa', 1],
  ['Konzern_Region', 'Amerika', 1],
  ['Konzern_Region', 'Asien', 1],
  ['Europa', 'DACH', 1],
  ['Europa', 'Europa_West', 1],
  ['Europa', 'Europa_Sued', 1],
  ['DACH', 'GES_DE01', 1],
  ['DACH', 'GES_DE02', 1],
  ['DACH', 'GES_DE03', 1],
  ['DACH', 'GES_AT01', 1],
  ['DACH', 'GES_CH01', 1],
  ['Europa_West', 'GES_FR01', 1],
  ['Europa_West', 'GES_DE03', 1],
  ['Europa_Sued', 'GES_IT01', 1],
  ['Europa_Sued', 'GES_ES01', 1],
  ['Amerika', 'GES_US01', 1],
  ['Amerika', 'GES_US02', 1],
  ['Asien', 'GES_CN01', 1],
  ['Asien', 'GES_JP01', -1],
  ['Konzern_Vertrieb', 'Vertrieb_Inland', 1],
  ['Konzern_Vertrieb', 'Vertrieb_Export', 1],
  ['Vertrieb_Inland', 'DACH', 1],
  ['Vertrieb_Export', 'GES_FR01', 1],
  ['Vertrieb_Export', 'GES_IT01', 1],
  ['Vertrieb_Export', 'GES_ES01', 1],
  ['Vertrieb_Export', 'GES_US01', 1],
  ['Vertrieb_Export', 'GES_US02', 1],
  ['Vertrieb_Export', 'GES_CN01', 1],
  ['Vertrieb_Export', 'GES_JP01', 1],]);

describe('classify', () => {
  it.each([
    [1, 1, 'ok'], [0, 0, 'ok'], [1, 0, 'missing'], [0, 1, 'extra'],
    [1, 2, 'double'], [1, -1, 'wrongWeight'], [2, 1, 'wrongWeight'], [-1, -2, 'double'],
  ] as const)('expected %d, actual %d → %s', (s, i, k) => {
    expect(classify(s, i)).toBe(k);
  });
});

describe('effectiveWeights', () => {
  it('counts a diamond twice', () => {
    const m = buildModel(E([['T', 'A', 1], ['T', 'B', 1], ['A', 'X', 1], ['B', 'X', 1]]));
    expect(m.effectiveWeights('T').get('X')).toBe(2);
    expect(m.paths('T', 'X').map(p => p.map(e => e.child))).toEqual([['A', 'X'], ['B', 'X']]);
  });

  it('cancels +1/-1 to zero', () => {
    const m = buildModel(E([['T', 'A', 1], ['T', 'B', -1], ['A', 'X', 1], ['B', 'X', 1]]));
    expect(m.effectiveWeights('T').get('X')).toBe(0);
  });

  it('multiplies weights along the path', () => {
    const m = buildModel(E([['T', 'A', 2], ['A', 'X', 0.5], ['A', 'Y', -1]]));
    const w = m.effectiveWeights('T');
    expect(w.get('X')).toBe(1);
    expect(w.get('Y')).toBe(-2);
  });

  it('returns an empty map for an unknown root or a leaf', () => {
    const m = buildModel(E([['T', 'X', 1]]));
    expect(m.effectiveWeights('nope').size).toBe(0);
    expect(m.effectiveWeights('X').size).toBe(0);
  });

  it('throws CycleError on a cycle', () => {
    const m = buildModel(E([['T', 'A', 1], ['A', 'B', 1], ['B', 'A', 1]]));
    expect(() => m.effectiveWeights('T')).toThrow(CycleError);
  });
});

describe('compare on the prototype sample', () => {
  const m = buildModel(SAMPLE);
  const roots = ['Konzern_Segment', 'Konzern_Region', 'Konzern_Vertrieb'];
  const r = compare(m, 'Konzern_Legal', roots.map(id => ({ id, model: m, root: id })));
  const off = (root: string) =>
    Object.fromEntries([...(r.cls.get(root) ?? [])].filter(([, k]) => k !== 'ok'));

  it('finds the tops', () => {
    expect(m.tops).toEqual(['Konzern_Legal', 'Konzern_Segment', 'Konzern_Region', 'Konzern_Vertrieb']);
  });

  it('finds every planted error and nothing else', () => {
    expect(off('Konzern_Segment')).toEqual({ GES_US02: 'double', GES_XX99: 'extra', GES_JP01: 'missing' });
    expect(off('Konzern_Region')).toEqual({ GES_DE03: 'double', GES_JP01: 'wrongWeight' });
    expect(off('Konzern_Vertrieb')).toEqual({});
  });

  it('counts per class', () => {
    expect(r.counts.get('Konzern_Segment')).toEqual({ ok: 10, missing: 1, double: 1, extra: 1, wrongWeight: 0 });
    expect(r.counts.get('Konzern_Vertrieb')).toEqual({ ok: 12, missing: 0, double: 0, extra: 0, wrongWeight: 0 });
  });

  it('probes leaves and sum', () => {
    expect(probe(r.expected)).toEqual({ leaves: 12, sum: 12 });
    expect(probe(r.actual.get('Konzern_Region') as Map<string, number>)).toEqual({ leaves: 12, sum: 11 });
  });

  it('reports the shared node DACH', () => {
    expect(rootsUsing(m, 'DACH', 'Konzern_Region')).toEqual(['Konzern_Vertrieb']);
  });

  it('turns green once the draft fixes Region', () => {
    const fixed = buildModel(applyChanges(SAMPLE, [
      { action: 'remove', parent: 'Europa_West', child: 'GES_DE03' },
      { action: 'weight', parent: 'Asien', child: 'GES_JP01', weight: 1 },
    ]));
    const r2 = compare(fixed, 'Konzern_Legal', [{ id: 'Konzern_Region', model: fixed, root: 'Konzern_Region' }]);
    expect([...(r2.cls.get('Konzern_Region') ?? []).values()].every(k => k === 'ok')).toBe(true);
  });
});

describe('draft', () => {
  const base = E([['T', 'A', 1], ['T', 'B', 1]]);

  it('applies add, remove and weight', () => {
    expect(applyChanges(base, [
      { action: 'remove', parent: 'T', child: 'A' },
      { action: 'weight', parent: 'T', child: 'B', weight: -1 },
      { action: 'add', parent: 'T', child: 'C', weight: 2 },
    ])).toEqual(E([['T', 'B', -1], ['T', 'C', 2]]));
  });

  it('netOps cancels add-then-remove and folds add-then-weight', () => {
    expect(netOps(base, [
      { action: 'add', parent: 'T', child: 'C', weight: 1 },
      { action: 'remove', parent: 'T', child: 'C' },
      { action: 'add', parent: 'T', child: 'D', weight: 1 },
      { action: 'weight', parent: 'T', child: 'D', weight: 3 },
      { action: 'weight', parent: 'T', child: 'A', weight: 2 },
      { action: 'remove', parent: 'T', child: 'B' },
    ])).toEqual({
      remove: E([['T', 'B', 1]]),
      patch: E([['T', 'A', 2]]),
      add: E([['T', 'D', 3]]),
    });
  });

  it('netOps ignores a weight set back to its base value', () => {
    expect(netOps(base, [
      { action: 'weight', parent: 'T', child: 'A', weight: 5 },
      { action: 'weight', parent: 'T', child: 'A', weight: 1 },
    ])).toEqual({ remove: [], patch: [], add: [] });
  });

  it('wouldCycle refuses an edge back up the tree', () => {
    const m = buildModel(E([['T', 'A', 1], ['A', 'X', 1]]));
    expect(wouldCycle(m, 'X', 'T')).toBe(true);
    expect(wouldCycle(m, 'A', 'A')).toBe(true);
    expect(wouldCycle(m, 'T', 'X')).toBe(false);
  });

  it('sameEdges ignores order but not weight', () => {
    expect(sameEdges(base, [...base].reverse())).toBe(true);
    expect(sameEdges(base, E([['T', 'A', 1], ['T', 'B', 2]]))).toBe(false);
  });
});

describe('export', () => {
  it('writes the subtree and the change list', () => {
    const m = buildModel(E([['T', 'A', 1], ['A', 'X', -1], ['U', 'Y', 1]]));
    expect(subtreeCsv(m, 'T')).toBe('Parent;Child;Weight\nT;A;1\nA;X;-1');
    expect(changesCsv([
      { action: 'remove', parent: 'T', child: 'A' },
      { action: 'add', parent: 'U', child: 'X', weight: 2 },
    ])).toBe('Action;Parent;Child;Weight\nremove;T;A;\nadd;U;X;2');
  });
});

describe('growableModel', () => {
  it('answers for added edges like a fresh build', () => {
    const w = growableModel(E([['T', 'A', 1]]));
    expect(w.model.effectiveWeights('T')).toEqual(new Map([['A', 1]]));
    w.add({ parent: 'X', child: 'T', weight: 2 });
    w.add({ parent: 'T', child: 'B', weight: -1 });
    expect(w.model.tops).toEqual(['X']);
    expect(w.model.effectiveWeights('X')).toEqual(new Map([['A', 2], ['B', -2]]));
    expect(w.model.reach('B').has('X')).toBe(false);
    expect(w.model.edges).toHaveLength(3);
  });
});

describe('import', () => {
  it('parses semicolon, tab and comma lines, skips the header, defaults weight 1', () => {
    expect(parseEdgeText('Parent;Child;Weight\nT;A;1\nT;B;-1,5\nT;C')).toEqual(E([['T', 'A', 1], ['T', 'B', -1.5], ['T', 'C', 1]]));
    expect(parseEdgeText('\uFEFFT\tA\t2\r\nT\tB\t\r\n')).toEqual(E([['T', 'A', 2], ['T', 'B', 1]]));
    expect(parseEdgeText('"T","A",1')).toEqual(E([['T', 'A', 1]]));
  });

  it('skips a header without a weight column', () => {
    expect(parseEdgeText('Parent;Child\nT;A')).toEqual(E([['T', 'A', 1]]));
    expect(parseEdgeText('ParentName,ComponentName,\nT,A,2')).toEqual(E([['T', 'A', 2]]));
    // Only the first line is a header candidate.
    expect(parseEdgeText('T;A\nParent;Child')).toEqual(E([['T', 'A', 1], ['Parent', 'Child', 1]]));
  });

  it('parses the REST JSON', () => {
    expect(parseEdgeText('{"value":[{"ParentName":"T","ComponentName":"A","Weight":-1},{"ParentName":"T","ComponentName":"B"}]}'))
      .toEqual(E([['T', 'A', -1], ['T', 'B', 1]]));
  });

  it('matches names like TM1 does and lists the unknown ones', () => {
    expect(nameKey('GES DE 01')).toBe(nameKey('ges de01'));
    const r = matchNames(E([['konzern legal', 'ges_de01', 1], ['Konzern Legal', 'NEU', 1]]), ['KonzernLegal', 'GES_DE01']);
    expect(r.edges).toEqual(E([['KonzernLegal', 'GES_DE01', 1], ['KonzernLegal', 'NEU', 1]]));
    expect(r.unknown).toEqual(['NEU']);
  });

  it('compares an imported model as its own column', () => {
    const server = buildModel(SAMPLE);
    const file = buildModel(E([['Neu', 'GES_DE01', 1], ['Neu', 'GES_DE01b', 1]]));
    const r = compare(server, 'Holding_DE', [{ id: 'import:1', model: file, root: 'Neu' }]);
    const off = Object.fromEntries([...(r.cls.get('import:1') ?? [])].filter(([, k]) => k !== 'ok'));
    expect(off).toEqual({ GES_DE02: 'missing', GES_DE03: 'missing', GES_AT01: 'missing', GES_CH01: 'missing', GES_DE01b: 'extra' });
  });
});

describe('draftFromImport', () => {
  const server = buildModel(E([
    ['R', 'Eu', 1], ['Eu', 'DACH', 1], ['Eu', 'X', 1], ['DACH', 'A', 1], ['DACH', 'B', 1],
    ['V', 'DACH', 1],
  ]));

  it('replaces children of every import consolidation, leaves named-only nodes alone', () => {
    // Import root "New" stands for R. Eu keeps DACH (untouched), drops X, gains Y with weight 2.
    const imp = buildModel(E([['New', 'Eu', 1], ['Eu', 'DACH', 1], ['Eu', 'Y', 2]]));
    const r = draftFromImport(server, 'R', imp, 'New', new Set());
    expect(r.changes).toEqual([
      { action: 'remove', parent: 'Eu', child: 'X' },
      { action: 'add', parent: 'Eu', child: 'Y', weight: 2 },
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.shared).toEqual([]);
  });

  it('flags a changed shared node and skips unknown elements', () => {
    const imp = buildModel(E([['R', 'Eu', 1], ['Eu', 'DACH', 1], ['DACH', 'A', 1], ['DACH', 'Ghost', 1]]));
    const r = draftFromImport(server, 'R', imp, 'R', new Set(['Ghost']));
    expect(r.changes).toEqual([
      { action: 'remove', parent: 'Eu', child: 'X' },
      { action: 'remove', parent: 'DACH', child: 'B' },
    ]);
    expect(r.skipped).toEqual(E([['DACH', 'Ghost', 1]]));
    expect(r.shared).toEqual(['DACH']);
  });

  it('skips an add that would close a cycle', () => {
    const imp2 = buildModel(E([['T', 'DACH', 1], ['DACH', 'A', 1], ['DACH', 'B', 1], ['DACH', 'R', 1]]));
    const r2 = draftFromImport(server, 'V', imp2, 'T', new Set());
    expect(r2.skipped).toEqual(E([['DACH', 'R', 1]]));
  });
});

describe('scope, all-leaves reference, bulk fix, grouping', () => {
  const m = buildModel(SAMPLE);
  const col = (id: string) => ({ id, model: m, root: id });

  it('all leaves as reference finds the orphan and doubles in every structure', () => {
    const leaves = [...new Set(SAMPLE.map(e => e.child))].filter(n => !m.children(n).length).concat('GES_WAISE');
    const ref = allLeavesModel(leaves);
    const r = compare(ref, ALL_LEAVES, [col('Konzern_Legal')]);
    const off = Object.fromEntries([...(r.cls.get('Konzern_Legal') ?? [])].filter(([, k]) => k !== 'ok'));
    expect(off).toEqual({ GES_XX99: 'missing', GES_WAISE: 'missing' });
  });

  it('scope limits leaves and counts', () => {
    const r = compare(m, 'Konzern_Legal', [col('Konzern_Segment')], new Set(['GES_US02', 'GES_DE01']));
    expect(r.leaves).toEqual(['GES_DE01', 'GES_US02']);
    expect(r.counts.get('Konzern_Segment')).toEqual({ ok: 1, missing: 0, double: 1, extra: 0, wrongWeight: 0 });
  });

  it('suggests the parent by reference siblings', () => {
    // GES_JP01 is missing in Segment; its Legal siblings (GES_CN01) hang under Seg_Fahrrad.
    expect(suggestParent(m, 'Konzern_Segment', m, 'Konzern_Legal', 'GES_JP01')).toBe('Seg_Fahrrad');
    // Same-name parent wins: Region contains no Holding_* so siblings decide; GES_FR01 siblings are in Europa_West/Sued.
    expect(suggestParent(m, 'Konzern_Region', m, 'Konzern_Legal', 'GES_FR01')).toBe('Europa_Sued');
  });

  it('bulk fix attaches missing and detaches extra, column turns green except doubles', () => {
    const r = compare(m, 'Konzern_Legal', [col('Konzern_Segment')]);
    const fix = bulkFix(m, 'Konzern_Segment', m, 'Konzern_Legal', r.cls.get('Konzern_Segment') as Map<string, never>, r.expected);
    expect(fix.changes).toEqual([
      { action: 'remove', parent: 'Seg_EBike', child: 'GES_XX99' },
      { action: 'add', parent: 'Seg_Fahrrad', child: 'GES_JP01', weight: 1 },
    ]);
    const after = buildModel(applyChanges(SAMPLE, fix.changes));
    const r2 = compare(after, 'Konzern_Legal', [{ id: 'Konzern_Segment', model: after, root: 'Konzern_Segment' }]);
    expect(r2.counts.get('Konzern_Segment')).toMatchObject({ missing: 0, extra: 0, double: 1 });
  });

  it('groups by the reference parent', () => {
    const g = groupByRefParent(m, 'Konzern_Legal', ['GES_DE01', 'GES_US01', 'GES_XX99']);
    expect([...g]).toEqual([['GES_DE01', 'Holding_DE'], ['GES_US01', 'Holding_US'], ['GES_XX99', '']]);
  });

  it('quotes CSV fields only where needed', () => {
    expect(csvLine(['a', 'b;c', 'd"e', 1])).toBe('a;"b;c";"d""e";1');
  });

  it('edge CSV export and import round-trip names holding the separator, quotes and line breaks', () => {
    const m = buildModel(E([['R', 'A;B', 1], ['R', 'say "hi"', 2], ['R', 'two\nlines', -1]]));
    expect(parseEdgeText(subtreeCsv(m, 'R'))).toEqual(m.edges);
    expect(changesCsv([{ action: 'add', parent: 'R', child: 'A;B', weight: 1 }])).toBe('Action;Parent;Child;Weight\nadd;R;"A;B";1');
  });

  it('edge import rejects a bad weight below the header instead of skipping it', () => {
    expect(() => parseEdgeText('Parent;Child;Weight\nR;A;1\nR;B;x')).toThrow(/Line 3/);
  });

  it('bulkFix divides by the parent factor so the re-compare is ok', () => {
    const fixed = (target: Array<[string, string, number]>): ReturnType<typeof compare> => {
      const m = buildModel(E([['Ref', 'A', 1], ['Ref', 'B', 1], ...target]));
      const r = compare(m, 'Ref', [{ id: 'Target', root: 'Target', model: m }]);
      const fix = bulkFix(m, 'Target', m, 'Ref', r.cls.get('Target') as Map<string, never>, r.expected);
      const after = buildModel(applyChanges(m.edges, fix.changes));
      return compare(after, 'Ref', [{ id: 'Target', root: 'Target', model: after }]);
    };
    for (const t of [
      [['Target', 'Mid', 2], ['Mid', 'A', 0.5]],
      [['Target', 'Mid', -1], ['Mid', 'A', -1]],
      [['Target', 'X', 1], ['Target', 'Y', 1], ['X', 'Mid', 1], ['Y', 'Mid', 1], ['Mid', 'A', 0.5]],
    ] as Array<Array<[string, string, number]>>) {
      expect(fixed(t).cls.get('Target')?.get('B')).toBe('ok');
    }
    // Factor 0: nothing sensible to add.
    const m = buildModel(E([['Ref', 'A', 1], ['Ref', 'B', 1], ['Target', 'Mid', 0], ['Mid', 'A', 1]]));
    const r = compare(m, 'Ref', [{ id: 'Target', root: 'Target', model: m }]);
    const zero = bulkFix(m, 'Target', m, 'Ref', r.cls.get('Target') as Map<string, never>, r.expected);
    expect(zero.changes).toEqual([]);
    expect(zero.skipped).toContain('B');
  });
});

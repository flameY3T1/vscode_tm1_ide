import { describe, it, expect } from 'vitest';
import { runSearch, buildObjectEdits, planReplace, collectMatchIds, filterCorpus, ObjectCorpusEntry } from '../../findReplace/model';

const opts = { wholeWord: false, regex: false };

const proc: ObjectCorpusEntry = {
  objectKind: 'process', objectName: 'P1',
  units: [
    { key: 'prolog', text: "s = 'OldCube';" },
    { key: 'data',   text: "CellPutN(x,'OldCube',e);\nCellGetN('OldCube',e);" },
  ],
};
const rule: ObjectCorpusEntry = {
  objectKind: 'rule', objectName: 'C1',
  units: [{ key: 'rule', text: "['x'] = N: DB('OldCube', !d);" }],
};

describe('runSearch', () => {
  it('groups matches per object with stable ids', () => {
    const groups = runSearch([proc, rule], 'OldCube', opts);
    expect(groups.map(g => g.objectName)).toEqual(['P1', 'C1']);
    const p1 = groups[0];
    expect(p1.matches).toHaveLength(3);
    expect(p1.matches[0].id).toBe('process:P1:prolog:1:6:7'); // …:line:col:length (OldCube=7)
    expect(p1.matches[1].unit).toBe('data');
  });

  it('returns no group for objects without matches', () => {
    const groups = runSearch([proc], 'NoSuchToken', opts);
    expect(groups).toEqual([]);
  });
});

describe('filterCorpus', () => {
  const corpus: ObjectCorpusEntry[] = [
    { objectKind: 'process', objectName: 'bedrock.cube.data', units: [{ key: 'prolog', text: 'x' }] },
    { objectKind: 'process', objectName: 'zzz.load.master', units: [{ key: 'prolog', text: 'x' }] },
    { objectKind: 'rule', objectName: 'Sales', units: [{ key: 'rule', text: 'x' }] },
  ];
  const base = { includeProcesses: true, includeRules: true, prefixes: [], suffixes: [], contains: [] };

  it('drops rules when includeRules is false', () => {
    const out = filterCorpus(corpus, { ...base, includeRules: false });
    expect(out.map(e => e.objectName)).toEqual(['bedrock.cube.data', 'zzz.load.master']);
  });

  it('drops processes when includeProcesses is false', () => {
    const out = filterCorpus(corpus, { ...base, includeProcesses: false });
    expect(out.map(e => e.objectName)).toEqual(['Sales']);
  });

  it('keeps processes matching any prefix (case-insensitive), rules unaffected', () => {
    const out = filterCorpus(corpus, { ...base, prefixes: ['BEDROCK.'] });
    expect(out.map(e => e.objectName)).toEqual(['bedrock.cube.data', 'Sales']);
  });

  it('keeps processes matching any suffix', () => {
    const out = filterCorpus(corpus, { ...base, suffixes: ['.master'] });
    expect(out.map(e => e.objectName)).toEqual(['zzz.load.master', 'Sales']);
  });

  it('prefix OR suffix union', () => {
    const out = filterCorpus(corpus, { ...base, prefixes: ['bedrock.'], suffixes: ['.master'] });
    expect(out.map(e => e.objectName)).toEqual(['bedrock.cube.data', 'zzz.load.master', 'Sales']);
  });

  it('contains substring match (unioned with prefix/suffix)', () => {
    const out = filterCorpus(corpus, { ...base, contains: ['load'] });
    expect(out.map(e => e.objectName)).toEqual(['zzz.load.master', 'Sales']);
  });

  it('empty prefix/suffix/contains imposes no name restriction', () => {
    expect(filterCorpus(corpus, base)).toHaveLength(3);
  });

  it('ignores empty-string entries in prefix list', () => {
    const out = filterCorpus(corpus, { ...base, prefixes: [''], suffixes: [] });
    expect(out).toHaveLength(3);
  });

  it('excludes }-prefixed control objects by default (includeControl omitted)', () => {
    const withControl: ObjectCorpusEntry[] = [
      ...corpus,
      { objectKind: 'process', objectName: '}bedrock.updateServerParams', units: [{ key: 'prolog', text: 'x' }] },
      { objectKind: 'rule', objectName: '}ElementAttributes_Sales', units: [{ key: 'rule', text: 'x' }] },
    ];
    const out = filterCorpus(withControl, base);
    expect(out.map(e => e.objectName)).toEqual(['bedrock.cube.data', 'zzz.load.master', 'Sales']);
  });

  it('excludes }-prefixed control objects when includeControl is false', () => {
    const withControl: ObjectCorpusEntry[] = [
      ...corpus,
      { objectKind: 'process', objectName: '}bedrock.updateServerParams', units: [{ key: 'prolog', text: 'x' }] },
    ];
    const out = filterCorpus(withControl, { ...base, includeControl: false });
    expect(out.map(e => e.objectName)).toEqual(['bedrock.cube.data', 'zzz.load.master', 'Sales']);
  });

  it('includes }-prefixed control objects when includeControl is true', () => {
    const withControl: ObjectCorpusEntry[] = [
      ...corpus,
      { objectKind: 'process', objectName: '}bedrock.updateServerParams', units: [{ key: 'prolog', text: 'x' }] },
      { objectKind: 'rule', objectName: '}ElementAttributes_Sales', units: [{ key: 'rule', text: 'x' }] },
    ];
    const out = filterCorpus(withControl, { ...base, includeControl: true });
    expect(out.map(e => e.objectName)).toEqual([
      'bedrock.cube.data', 'zzz.load.master', 'Sales', '}bedrock.updateServerParams', '}ElementAttributes_Sales',
    ]);
  });
});

describe('buildObjectEdits', () => {
  it('rebuilds only selected sections of a process', () => {
    const groups = runSearch([proc], 'OldCube', opts);
    const ids = new Set(groups[0].matches.filter(m => m.unit === 'data').map(m => m.id));
    const edit = buildObjectEdits(proc, ids, 'NewCube', 'OldCube', opts);
    expect(edit).not.toBeNull();
    expect(edit!.changedSections.data).toBe("CellPutN(x,'NewCube',e);\nCellGetN('NewCube',e);");
    expect(edit!.changedSections.prolog).toBeUndefined();
  });

  it('rebuilds rule text', () => {
    const groups = runSearch([rule], 'OldCube', opts);
    const ids = new Set(groups[0].matches.map(m => m.id));
    const edit = buildObjectEdits(rule, ids, 'NewCube', 'OldCube', opts);
    expect(edit!.newRules).toBe("['x'] = N: DB('NewCube', !d);");
  });

  it('returns null when nothing selected for the entry', () => {
    expect(buildObjectEdits(proc, new Set(), 'X', 'OldCube', opts)).toBeNull();
  });
});

describe('collectMatchIds', () => {
  it('collects exactly the ids that runSearch produced', () => {
    const ids = collectMatchIds([proc, rule], 'OldCube', opts);
    // proc: prolog:1, data:1, data:2  +  rule:1  = 4
    expect(ids.size).toBe(4);
    const searchIds = runSearch([proc, rule], 'OldCube', opts).flatMap(g => g.matches.map(m => m.id));
    expect(new Set(searchIds)).toEqual(ids);
  });
});

describe('planReplace (Bug #1 — verify against fresh corpus)', () => {
  // Search-time snapshot: two OldCube hits on lines 1 and 3, a plain line between.
  const original: ObjectCorpusEntry = {
    objectKind: 'process', objectName: 'P1',
    units: [{ key: 'data', text: "a = 'OldCube';\nb = 1;\nc = 'OldCube';" }],
  };
  const selectedIds = () => runSearch([original], 'OldCube', opts)[0].matches.map(m => m.id);

  it('rebuilds edits from FRESH text — a colleague edit on an untouched line is preserved', () => {
    // Colleague changed line 2 (no OldCube there) between search and replace.
    const fresh: ObjectCorpusEntry = {
      objectKind: 'process', objectName: 'P1',
      units: [{ key: 'data', text: "a = 'OldCube';\nb = 2;\nc = 'OldCube';" }],
    };
    const { edits, skipped } = planReplace([fresh], selectedIds(), 'NewCube', 'OldCube', opts);
    expect(skipped).toBe(0);
    expect(edits).toHaveLength(1);
    // both OldCube replaced AND the colleague's "b = 2;" kept (not reverted to "b = 1;")
    expect(edits[0].changedSections.data).toBe("a = 'NewCube';\nb = 2;\nc = 'NewCube';");
  });

  it('drops a selected match whose source changed — the foreign fix is NOT reverted', () => {
    // Colleague removed the OldCube on line 3 (the "fix") between search and replace.
    const fresh: ObjectCorpusEntry = {
      objectKind: 'process', objectName: 'P1',
      units: [{ key: 'data', text: "a = 'OldCube';\nb = 1;\nc = 'FixedByColleague';" }],
    };
    const { edits, skipped } = planReplace([fresh], selectedIds(), 'NewCube', 'OldCube', opts);
    expect(skipped).toBe(1); // the stale line-3 id no longer has a live match
    // only the still-valid line-1 match is written; line 3 keeps the colleague's fix
    expect(edits[0].changedSections.data).toBe("a = 'NewCube';\nb = 1;\nc = 'FixedByColleague';");
  });

  it('skips everything when every line shifted (foreign insert above)', () => {
    const fresh: ObjectCorpusEntry = {
      objectKind: 'process', objectName: 'P1',
      units: [{ key: 'data', text: "# added by colleague\na = 'OldCube';\nb = 1;\nc = 'OldCube';" }],
    };
    const { edits, skipped } = planReplace([fresh], selectedIds(), 'NewCube', 'OldCube', opts);
    expect(skipped).toBe(2);
    expect(edits).toHaveLength(0); // nothing written — user must re-search
  });
});

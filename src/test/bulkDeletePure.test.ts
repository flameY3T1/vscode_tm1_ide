import { describe, it, expect } from 'vitest';
import { sortForDelete, isBlocked, blockingHolders, emptyUsage, DELETE_ORDER, choresOf } from '../webviews/bulkDeletePure';
import { matchesPattern, rowKey, rowLabel, qualifiedLabel } from '../webviews/bulkObjectsPure';
import { isControlName, type ObjKind } from '../utils/objectKinds';

describe('matchesPattern', () => {
  it('an empty pattern matches everything', () => {
    expect(matchesPattern('Sales', '')).toBe(true);
    expect(matchesPattern('Sales', '   ')).toBe(true);
  });

  it('without wildcards, one occurrence anywhere is enough', () => {
    expect(matchesPattern('zzTest_Load', 'test')).toBe(true);
    expect(matchesPattern('zzTest_Load', 'Load')).toBe(true);
    expect(matchesPattern('zzTest_Load', 'Sales')).toBe(false);
  });

  it('with *, the pattern must cover the WHOLE name', () => {
    expect(matchesPattern('zzTest_Load', 'zzTest_*')).toBe(true);
    expect(matchesPattern('Load_zzTest', 'zzTest_*')).toBe(false);
    expect(matchesPattern('zzTest_Load', '*Load')).toBe(true);
  });

  it('? covers exactly one character', () => {
    expect(matchesPattern('Cube1', 'Cube?')).toBe(true);
    expect(matchesPattern('Cube12', 'Cube?')).toBe(false);
  });

  it('regexp special characters stay literal', () => {
    // The dot must not pass as "any character", otherwise
    // a pattern would delete more than it shows.
    expect(matchesPattern('}ElementAttributes_Product', '}*')).toBe(true);
    expect(matchesPattern('axb', 'a.b*')).toBe(false);
    expect(matchesPattern('a.bc', 'a.b*')).toBe(true);
  });

  it('ignores upper and lower case in both forms', () => {
    expect(matchesPattern('SALES', 'sales')).toBe(true);
    expect(matchesPattern('SALES', 'sal*')).toBe(true);
  });
});

describe('isControlName', () => {
  it('recognizes the curly brace of TM1', () => {
    expect(isControlName('}Groups')).toBe(true);
    expect(isControlName('Sales')).toBe(false);
  });

  it('for view and subset, the parent object decides', () => {
    // `Default` in the control cube has a harmless name and is not harmless.
    expect(isControlName('Default', '}ClientProperties')).toBe(true);
    expect(isControlName('Default', 'Sales')).toBe(false);
  });
});

describe('blockingHolders', () => {
  const cube = (name: string) => ({ kind: 'cube' as ObjKind, name });

  it('control cubes are no lock', () => {
    // Measured: most "bound" dimensions only hang on their
    // own `}ElementAttributes_<Dim>`, and that one goes away with them.
    expect(blockingHolders([cube('}ElementAttributes_Produkt')])).toEqual([]);
    expect(blockingHolders([cube('Sales'), cube('}ElementAttributes_Produkt')]))
      .toEqual([cube('Sales')]);
  });

  it('a view in the control cube is no lock either', () => {
    // For view and subset, the parent object decides — `Default` in
    // `}ClientProperties` has a harmless name and is not harmless.
    const view = { kind: 'view' as ObjKind, name: 'Default', parent: '}ClientProperties' };
    expect(blockingHolders([view])).toEqual([]);
  });
});

describe('sortForDelete', () => {
  it('clears children before parents and cubes before dimensions', () => {
    const items: Array<{ kind: ObjKind; name: string }> = [
      { kind: 'dimension', name: 'Product' },
      { kind: 'cube', name: 'Sales' },
      { kind: 'process', name: 'Load' },
      { kind: 'chore', name: 'Nightly' },
      { kind: 'subset', name: 'Top10' },
      { kind: 'view', name: 'Default' },
    ];
    expect(sortForDelete(items).map(i => i.kind))
      .toEqual(['view', 'subset', 'chore', 'process', 'cube', 'dimension']);
  });

  it('keeps the order stable within one kind', () => {
    const items: Array<{ kind: ObjKind; name: string }> = [
      { kind: 'cube', name: 'B' }, { kind: 'cube', name: 'A' },
    ];
    expect(sortForDelete(items).map(i => i.name)).toEqual(['B', 'A']);
  });

  it('knows every object kind — otherwise one would land at index -1 right at the front', () => {
    const kinds: ObjKind[] = ['cube', 'dimension', 'process', 'chore', 'view', 'subset'];
    for (const k of kinds) { expect(DELETE_ORDER).toContain(k); }
  });
});

describe('isBlocked', () => {
  const cube = (name: string) => ({ kind: 'cube' as ObjKind, name });
  const held = { ...emptyUsage(), hard: [cube('Sales'), cube('Forecast')] };
  const keys = (...refs: Array<{ kind: ObjKind; name: string; parent?: string }>) =>
    new Set(refs.map(rowKey));

  it('not locked without holders', () => {
    expect(isBlocked(emptyUsage(), new Set())).toBe(false);
    expect(isBlocked(undefined, new Set())).toBe(false);
  });

  it('locked as long as a holder stands outside the selection', () => {
    expect(isBlocked(held, keys(cube('Sales')))).toBe(true);
  });

  it('a control cube alone does not lock', () => {
    const nurSteuer = { ...emptyUsage(), hard: [cube('}ElementAttributes_Product')] };
    expect(isBlocked(nurSteuer, new Set())).toBe(false);
  });

  it('free when ALL holders are selected too — they go away first', () => {
    expect(isBlocked(held, keys(cube('Sales'), cube('Forecast')))).toBe(false);
  });

  it('a view as holder resolves via ITS row, not via the name', () => {
    // Delete order: views before subsets — whoever selects both gets
    // through. A cube of the same name must NOT lift the lock.
    const view = { kind: 'view' as ObjKind, name: 'Standard', parent: 'Planung' };
    const heldByView = { ...emptyUsage(), hard: [view] };
    expect(isBlocked(heldByView, keys(cube('Standard')))).toBe(true);
    expect(isBlocked(heldByView, keys(view))).toBe(false);
  });
});

describe('rowKey', () => {
  const sub = (hier: string) =>
    ({ kind: 'subset' as ObjKind, name: 'Default', parent: 'Region', hierarchy: hier });

  it('separates subsets of the same name in different hierarchies', () => {
    // Without the hierarchy in the key, one click selected both and the
    // delete list contained two items at a count of one.
    expect(rowKey(sub('Region'))).not.toBe(rowKey(sub('Sales')));
    const selected = new Set([rowKey(sub('Sales'))]);
    expect(selected.has(rowKey(sub('Region')))).toBe(false);
    expect(selected.has(rowKey(sub('Sales')))).toBe(true);
  });

  it('parentless kinds hit the key of the reference answer', () => {
    // The reference list comes without `parent`/`hierarchy` — both sides must
    // build the same key, otherwise `usage` stays empty.
    expect(rowKey({ kind: 'dimension', name: 'Region' }))
      .toBe(rowKey({ kind: 'dimension', name: 'Region', parent: undefined }));
  });

  it('keeps names apart that contain a separator', () => {
    expect(rowKey({ kind: 'cube', name: 'A|B' })).not.toBe(rowKey({ kind: 'cube', name: 'A', parent: 'B' }));
  });
});

describe('rowLabel', () => {
  it('names dimension and hierarchy when they differ', () => {
    expect(rowLabel({ kind: 'subset', name: 'Default', parent: 'Region', hierarchy: 'Sales' }))
      .toBe('Region / Sales / Default');
  });

  it('leaves out the hierarchy of the same name', () => {
    expect(rowLabel({ kind: 'subset', name: 'Default', parent: 'Region', hierarchy: 'Region' }))
      .toBe('Region / Default');
  });

  it('parentless kinds stand bare', () => {
    expect(rowLabel({ kind: 'process', name: 'Load' })).toBe('Load');
  });
});

describe('choresOf', () => {
  // Keyed in lower case, as the reference index delivers it.
  const byProcess = new Map<string, string[]>([
    ['load_sales', ['Nightly', 'Weekly']],
    ['load_costs', ['Nightly']],
  ]);

  it('finds the chore via the process, not via the object name', () => {
    // Exactly the gap: a cube names no chore, but the process that
    // hangs on the cube is in the schedule.
    expect(choresOf(byProcess, ['Load_Sales'])).toEqual(['Nightly', 'Weekly']);
  });

  it('names the same chore once, even when two processes pull it', () => {
    expect(choresOf(byProcess, ['Load_Sales', 'Load_Costs'])).toEqual(['Nightly', 'Weekly']);
  });

  it('ignores upper and lower case', () => {
    expect(choresOf(byProcess, ['LOAD_COSTS'])).toEqual(['Nightly']);
  });

  it('returns nothing when no process is in a schedule', () => {
    expect(choresOf(byProcess, ['Rebuild'])).toEqual([]);
    expect(choresOf(byProcess, [])).toEqual([]);
  });
});

describe('qualifiedLabel', () => {
  it('a view is called Cube / View', () => {
    expect(qualifiedLabel('Sales:ByRegion', 'view')).toBe('Sales / ByRegion');
  });

  it('a subset leaves out the hierarchy of the same name', () => {
    expect(qualifiedLabel('Region:Region:Top10', 'subset')).toBe('Region / Top10');
  });

  it('a differing hierarchy is included', () => {
    expect(qualifiedLabel('Region:Sales:Top10', 'subset')).toBe('Region / Sales / Top10');
  });

  it('a colon IN the name stays with the name', () => {
    // v12 allows `:` in the object name; over-split, this would read `Q1`.
    expect(qualifiedLabel('Sales:Q1:2026', 'view')).toBe('Sales / Q1:2026');
    expect(qualifiedLabel('Region:Region:A:B', 'subset')).toBe('Region / A:B');
  });
});

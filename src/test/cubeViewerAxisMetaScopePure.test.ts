import { describe, it, expect } from 'vitest';
import { scopeParentMaps } from '../commands/cubeViewer/axisMetaScopePure';
import { mergeParentDelta } from '../webviewClient/cubeViewerMonaco/parentMergePure';

const FULL = {
  first: { blatt: 'zwischen', zwischen: 'wurzel', fremd: 'wurzel', tief: 'fremd' },
  all: { blatt: ['zwischen', 'zweit'], zwischen: ['wurzel'], fremd: ['wurzel'], tief: ['fremd'] },
};
const PARENTS = new Set(['zwischen', 'zweit', 'wurzel', 'fremd']);

describe('scopeParentMaps', () => {
  it('takes the ancestors of the known names along, the rest not', () => {
    const s = scopeParentMaps(['blatt'], FULL, PARENTS);
    expect(Object.keys(s.first).sort()).toEqual(['blatt', 'zwischen']);
    expect(s.first.blatt).toBe('zwischen');
    expect(s.first.zwischen).toBe('wurzel');
    expect(s.first.tief).toBeUndefined();
    expect(s.first.fremd).toBeUndefined();
  });

  it('follows EVERY parent, not only the first', () => {
    const s = scopeParentMaps(['blatt'], FULL, PARENTS);
    expect(s.all.blatt).toEqual(['zwischen', 'zweit']);
  });

  it('keeps all only for multi-parent elements — single-parent ones fall back to first', () => {
    const s = scopeParentMaps(['blatt'], FULL, PARENTS);
    expect(s.all.zwischen).toBeUndefined();
    expect(s.first.zwischen).toBe('wurzel');
  });

  it('marks hasChildren for known names that are a parent', () => {
    const s = scopeParentMaps(['blatt', 'zwischen'], FULL, PARENTS);
    expect(s.hasChildren.zwischen).toBe(true);
    expect(s.hasChildren.blatt).toBeUndefined();
  });

  it('does not run endlessly on a cycle', () => {
    const zyklus = { first: { a: 'b', b: 'a' }, all: { a: ['b'], b: ['a'] } };
    const s = scopeParentMaps(['a'], zyklus, new Set(['a', 'b']));
    expect(Object.keys(s.first).sort()).toEqual(['a', 'b']);
  });

  it('copes with unknown names without an entry', () => {
    const s = scopeParentMaps(['gibtsnicht'], FULL, PARENTS);
    expect(s.first).toEqual({});
    expect(s.hasChildren).toEqual({});
  });

  it('includes flat names without their ancestors', () => {
    const s = scopeParentMaps([], FULL, PARENTS, ['tief']);
    expect(s.first.tief).toBe('fremd');
    expect(s.first.fremd).toBeUndefined();   // NO ancestor walk
    expect(s.all.tief).toBeUndefined();      // `all` only for the hull
  });

  it('counts flat names for hasChildren too', () => {
    const s = scopeParentMaps([], FULL, PARENTS, ['zwischen']);
    expect(s.hasChildren.zwischen).toBe(true);
  });

  it('lets the hull win when a name stands in both sets', () => {
    const s = scopeParentMaps(['blatt'], FULL, PARENTS, ['blatt']);
    expect(s.all.blatt).toEqual(['zwischen', 'zweit']);
    expect(s.first.zwischen).toBe('wurzel');
  });
});

describe('mergeParentDelta', () => {
  it('adds new rows without losing existing ones', () => {
    const base = [{ a: 'p' }];
    const out = mergeParentDelta(base, [{ b: 'q' }]);
    expect(out[0]).toEqual({ a: 'p', b: 'q' });
  });

  it('leaves the base untouched (no in-place writing)', () => {
    const base = [{ a: 'p' }];
    mergeParentDelta(base, [{ b: 'q' }]);
    expect(base[0]).toEqual({ a: 'p' });
  });

  it('copes with a missing delta', () => {
    expect(mergeParentDelta([{ a: 'p' }], undefined)[0]).toEqual({ a: 'p' });
  });

  it('copes with more delta dimensions than base dimensions', () => {
    expect(mergeParentDelta([], [{ a: 'p' }])[0]).toEqual({ a: 'p' });
  });
});

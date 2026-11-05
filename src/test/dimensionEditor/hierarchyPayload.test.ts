import { describe, it, expect } from 'vitest';
import { buildElements, buildEdges, collectAttrValues } from '../../dimensionEditor/hierarchyPayload';
import type { DimDraftState } from '../../dimensionEditor/model';

function state(partial: Partial<DimDraftState>): DimDraftState {
  return { serverId: 's', dimName: 'D', hierName: 'D', hierarchies: ['D'],
    elements: new Map(), edges: [], attrDefs: [],
    snapshot: { dimName: 'D', hierarchies: ['D'], perHier: {} }, dirty: true, ...partial };
}

describe('hierarchyPayload', () => {
  it('buildElements drops deleted, keeps insertion order + type', () => {
    const els = new Map();
    els.set('T', { name: 'T', type: 'C', attrs: {}, marked: 'clean' });
    els.set('A', { name: 'A', type: 'N', attrs: {}, marked: 'new' });
    els.set('X', { name: 'X', type: 'N', attrs: {}, marked: 'deleted' });
    expect(buildElements(state({ elements: els }))).toEqual([
      { name: 'T', type: 'C' }, { name: 'A', type: 'N' }]);
  });

  it('buildEdges sorts by order within parent, drops deleted', () => {
    const edges = [
      { parent: 'T', child: 'B', weight: 1, marked: 'clean' as const, order: 1 },
      { parent: 'T', child: 'A', weight: 2, marked: 'clean' as const, order: 0 },
      { parent: 'T', child: 'Z', weight: 1, marked: 'deleted' as const, order: 2 },
    ];
    expect(buildEdges(state({ edges }))).toEqual([
      { parent: 'T', child: 'A', weight: 2 }, { parent: 'T', child: 'B', weight: 1 }]);
  });

  it('collectAttrValues returns non-empty values only for DEFINED attrs (excludes implicit Caption), skips deleted elements', () => {
    const els = new Map();
    // 'Caption' is TM1's implicit attribute (present on every element, no def, no cube cell);
    // 'empty' is a defined attr with an empty value; both must be excluded.
    els.set('A', { name: 'A', type: 'N', attrs: { alias: 'aa', empty: '', Caption: 'A' }, marked: 'new' });
    els.set('D', { name: 'D', type: 'N', attrs: { alias: 'dd', Caption: 'D' }, marked: 'deleted' });
    const st = state({ elements: els, attrDefs: [
      { name: 'alias', type: 'Alias', marked: 'new' },
      { name: 'empty', type: 'String', marked: 'new' },
    ] });
    expect(collectAttrValues(st, 'H')).toEqual([{ hier: 'H', element: 'A', attr: 'alias', value: 'aa' }]);
  });

  it('collectAttrValues returns [] when the dimension has no attribute definitions (no attr cube)', () => {
    const els = new Map();
    // No attrDefs → even though elements carry an implicit Caption, nothing is collected,
    // so the caller never touches the non-existent }ElementAttributes_<dim> cube.
    els.set('A', { name: 'A', type: 'N', attrs: { Caption: 'A' }, marked: 'new' });
    expect(collectAttrValues(state({ elements: els, attrDefs: [] }), 'H')).toEqual([]);
  });
});

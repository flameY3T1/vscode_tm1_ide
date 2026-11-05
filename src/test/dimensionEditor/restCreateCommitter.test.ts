import { describe, it, expect, vi } from 'vitest';
import { commitNewDimension } from '../../dimensionEditor/restCreateCommitter';
import type { DimDraftState } from '../../dimensionEditor/model';

function mkState(): DimDraftState {
  const els = new Map();
  els.set('T', { name: 'T', type: 'C', attrs: {}, marked: 'new' });
  els.set('A', { name: 'A', type: 'N', attrs: { alias: 'aa' }, marked: 'new' });
  return { serverId: 's', dimName: 'New', hierName: 'New', hierarchies: ['New'],
    elements: els, edges: [{ parent: 'T', child: 'A', weight: 1, marked: 'new', order: 0 }],
    attrDefs: [{ name: 'alias', type: 'Alias', marked: 'new' }],
    snapshot: { dimName: 'New', hierarchies: ['New'], perHier: {} }, dirty: true };
}

describe('commitNewDimension', () => {
  it('creates dim full, then attr defs, then attr values', async () => {
    const api = {
      createDimensionFull: vi.fn().mockResolvedValue(undefined),
      createAttrDef: vi.fn().mockResolvedValue(undefined),
      writeAttrValues: vi.fn().mockResolvedValue(undefined),
    } as any;
    const r = await commitNewDimension(mkState(), 'New', 'New', api);
    expect(r.ok).toBe(true);
    expect(api.createDimensionFull).toHaveBeenCalledWith('New', 'New',
      [{ name: 'T', type: 'C' }, { name: 'A', type: 'N' }],
      [{ parent: 'T', child: 'A', weight: 1 }]);
    expect(api.createAttrDef).toHaveBeenCalledWith('New', 'alias', 'Alias', 'New');
    expect(api.writeAttrValues).toHaveBeenCalledWith([{ hier: 'New', element: 'A', attr: 'alias', value: 'aa' }]);
  });

  it('collects error + serverMayHaveChanged when attr write fails after create', async () => {
    const api = {
      createDimensionFull: vi.fn().mockResolvedValue(undefined),
      createAttrDef: vi.fn().mockResolvedValue(undefined),
      writeAttrValues: vi.fn().mockRejectedValue(new Error('boom')),
    } as any;
    const r = await commitNewDimension(mkState(), 'New', 'New', api);
    expect(r.ok).toBe(false);
    expect(r.serverMayHaveChanged).toBe(true);
    expect(r.errors[0].message).toContain('boom');
  });

  it('skips values whose attr def failed to create (no column => whole MDX would 400)', async () => {
    const api = {
      createDimensionFull: vi.fn().mockResolvedValue(undefined),
      createAttrDef: vi.fn().mockRejectedValue(new Error('bad def')),
      writeAttrValues: vi.fn().mockResolvedValue(undefined),
    } as any;
    const r = await commitNewDimension(mkState(), 'New', 'New', api);
    // def creation failed => its value is filtered out => writeAttrValues gets []
    expect(api.writeAttrValues).toHaveBeenCalledWith([]);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toContain('bad def');
  });

  it('create failure => not created, serverMayHaveChanged false', async () => {
    const api = {
      createDimensionFull: vi.fn().mockRejectedValue(new Error('exists')),
      createAttrDef: vi.fn(), writeAttrValues: vi.fn(),
    } as any;
    const r = await commitNewDimension(mkState(), 'New', 'New', api);
    expect(r.ok).toBe(false);
    expect(r.serverMayHaveChanged).toBe(false);
    expect(api.createAttrDef).not.toHaveBeenCalled();
  });
});

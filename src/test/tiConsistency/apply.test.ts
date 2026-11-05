import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/processApi', () => ({ updateProcess: vi.fn() }));
vi.mock('../../references/referenceIndexService', () => ({ invalidateReferenceIndex: vi.fn() }));
import { updateProcess } from '../../tm1Rest/processApi';
import { invalidateReferenceIndex } from '../../references/referenceIndexService';
import { applyConsistencyEdits } from '../../tiConsistency/apply';
import type { ConsistencyProcess } from '../../tiConsistency/types';

const cfg = { serverUrl: 'http://x' } as any;
beforeEach(() => vi.clearAllMocks());

function proc(name: string): ConsistencyProcess {
  return { name, units: [{ key: 'prolog', text: '' }], params: [{ name: 'Month', type: 'String' }],
    datasourceVars: [], rawParams: [{ Name: 'Month', Type: 'String', Value: '', Prompt: '' }], rawVariables: [] };
}

describe('applyConsistencyEdits', () => {
  it('PATCHes section body without a top-level Name field', async () => {
    (updateProcess as any).mockResolvedValue(undefined);
    const rep = await applyConsistencyEdits(cfg, [{ process: 'A', changedSections: { prolog: 'sDim=1;' } }], [proc('A')], []);
    const body = (updateProcess as any).mock.calls[0][2];
    expect(body.Name).toBeUndefined();
    expect(body.PrologProcedure).toBe('sDim=1;');
    expect(rep.applied).toEqual(['A']);
    expect(invalidateReferenceIndex).toHaveBeenCalledWith(cfg);
  });
  it('rebuilds Parameters array with renamed Name on declPatch', async () => {
    (updateProcess as any).mockResolvedValue(undefined);
    await applyConsistencyEdits(cfg, [{ process: 'A', changedSections: { prolog: 'nX=pMonth;' },
      declPatch: { params: [{ from: 'Month', to: 'pMonth' }] } }], [proc('A')], []);
    const body = (updateProcess as any).mock.calls[0][2];
    expect(body.Parameters).toEqual([{ Name: 'pMonth', Type: 'String', Value: '', Prompt: '' }]);
  });
  it('rebuilds top-level Variables array with renamed Name on declPatch (never DataSource.Variables)', async () => {
    (updateProcess as any).mockResolvedValue(undefined);
    const p = proc('A');
    p.rawVariables = [{ Name: 'V1', Type: 'String', Position: 1, StartByte: 0, EndByte: 5 }];
    await applyConsistencyEdits(cfg, [{ process: 'A', changedSections: { data: 'nX=V1;' },
      declPatch: { datasourceVars: [{ from: 'V1', to: 'vDim' }] } }], [p], []);
    const body = (updateProcess as any).mock.calls[0][2];
    expect(body.Variables).toEqual([{ Name: 'vDim', Type: 'String', Position: 1, StartByte: 0, EndByte: 5 }]);
    expect(body.Name).toBeUndefined();
    expect(body.DataSource).toBeUndefined();
  });
  it('stops and reports on error', async () => {
    (updateProcess as any).mockRejectedValueOnce(new Error('boom'));
    const rep = await applyConsistencyEdits(cfg, [
      { process: 'A', changedSections: { prolog: 'x' } },
      { process: 'B', changedSections: { prolog: 'y' } },
    ], [proc('A'), proc('B')], []);
    expect(rep.failed).toMatchObject({ process: 'A' });
    expect(rep.notAttempted).toEqual(['B']);
    expect(invalidateReferenceIndex).toHaveBeenCalledWith(cfg);
  });
});

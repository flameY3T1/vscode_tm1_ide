import { describe, it, expect, vi, beforeEach } from 'vitest';

// Live 11.8 (2026-10-27): the member bind of step 3 answers 404 for an element
// that no longer exists, after steps 1+2 already emptied the subset.
const api = vi.hoisted(() => ({
  subsetExists: vi.fn(), updateSubset: vi.fn(), clearSubsetElements: vi.fn(),
  getSubset: vi.fn(), listSubsetElementNames: vi.fn(), subsetElementCount: vi.fn(),
  listSubsetInfos: vi.fn(), createSubset: vi.fn(),
}));
vi.mock('../../tm1Rest/subsetApi', () => api);

import { saveSubset } from '../../commands/dimension/dimensionSubsetSave';

const cfg = { serverUrl: 'http://tm1' } as never;
const bindFails = (_c: unknown, _d: unknown, _h: unknown, _n: unknown, body: Record<string, unknown>) =>
  'Elements@odata.bind' in body && (body['Elements@odata.bind'] as string[]).some(b => b.includes('GONE'))
    ? Promise.reject(new Error("'GONE' can not be found")) : Promise.resolve();

describe('static subset overwrite restores the old content when the member write fails', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.subsetExists.mockResolvedValue(true);
    api.clearSubsetElements.mockResolvedValue(undefined);
    api.updateSubset.mockImplementation(bindFails);
  });

  it('puts the old members back and rethrows the original error', async () => {
    api.getSubset.mockResolvedValue({ ok: true, Name: 's', Expression: null, Alias: null });
    api.listSubsetElementNames.mockResolvedValue({ elements: ['A', 'B'], complete: true });
    await expect(saveSubset('D', 'D', 's', false, ['A', 'GONE'], true, cfg, null, 'all'))
      .rejects.toThrow("'GONE' can not be found");
    const last = api.updateSubset.mock.calls.at(-1)![4] as Record<string, string[]>;
    expect(last['Elements@odata.bind']).toEqual([
      "Dimensions('D')/Hierarchies('D')/Elements('A')",
      "Dimensions('D')/Hierarchies('D')/Elements('B')",
    ]);
  });

  it('puts the old MDX back on a dynamic subset', async () => {
    api.getSubset.mockResolvedValue({ ok: true, Name: 's', Expression: '{TM1SUBSETALL([D])}', Alias: null });
    await expect(saveSubset('D', 'D', 's', false, ['GONE'], true, cfg, null, 'all')).rejects.toThrow('GONE');
    expect(api.updateSubset.mock.calls.at(-1)![4]).toEqual({ Expression: '{TM1SUBSETALL([D])}' });
    expect(api.listSubsetElementNames).not.toHaveBeenCalled();
  });

  it('writes nothing when the old members could not be read completely', async () => {
    api.getSubset.mockResolvedValue({ ok: true, Name: 's', Expression: null, Alias: null });
    api.listSubsetElementNames.mockResolvedValue({ elements: ['A'], complete: false, statusCode: 500 });
    await expect(saveSubset('D', 'D', 's', false, ['GONE'], true, cfg, null, 'all')).rejects.toThrow();
    expect(api.updateSubset).not.toHaveBeenCalled();
    expect(api.clearSubsetElements).not.toHaveBeenCalled();
  });

  it('writes nothing when the snapshot read itself failed (ok:false)', async () => {
    api.getSubset.mockResolvedValue({ ok: false, Name: 's', Expression: null, Alias: null });
    await expect(saveSubset('D', 'D', 's', false, ['GONE'], true, cfg, null, 'all')).rejects.toThrow();
    expect(api.updateSubset).not.toHaveBeenCalled();
    expect(api.clearSubsetElements).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../tm1Rest/client';
import { fetchConsistencyCorpus } from '../../tiConsistency/corpus';

const cfg = { serverUrl: 'http://x', username: 'u', authType: 'basic' } as any;

describe('fetchConsistencyCorpus', () => {
  it('maps process rows into ConsistencyProcess', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ value: [{
      Name: 'P', PrologProcedure: 'sDim=1;', MetadataProcedure: '', DataProcedure: '', EpilogProcedure: '',
      Parameters: [{ Name: 'pM', Type: 'String', Value: '', Prompt: '' }],
      Variables: [{ Name: 'vSrc', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
    }] }) });
    const { processes, unreadable } = await fetchConsistencyCorpus(cfg);
    expect(unreadable).toEqual([]);
    expect(processes[0]).toMatchObject({ name: 'P' });
    expect(processes[0].units.map(u => u.key)).toEqual(['prolog']);
    expect(processes[0].params).toEqual([{ name: 'pM', type: 'String' }]);
    expect(processes[0].datasourceVars).toEqual([{ name: 'vSrc', type: 'String' }]);
    expect(processes[0].rawParams[0].Name).toBe('pM');
  });
  it('reports unreadable on error', async () => {
    (apiRequest as any).mockRejectedValue(new Error('boom'));
    expect((await fetchConsistencyCorpus(cfg)).unreadable).toEqual(['Processes']);
  });
  it('reports unreadable on a non-200 answer instead of "no processes"', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 403, body: JSON.stringify({ error: { message: 'denied' } }) });
    expect((await fetchConsistencyCorpus(cfg)).unreadable).toEqual(['Processes']);
  });
});

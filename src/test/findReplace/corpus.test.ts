import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapProcessRows, mapRuleRows, fetchCorpus } from '../../findReplace/corpus';
import { apiRequest } from '../../tm1Rest/client';

vi.mock('../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));

const mockApi = vi.mocked(apiRequest);
const ok = (body: string) => ({ statusCode: 200, body });

describe('mapProcessRows', () => {
  it('maps 4 procedures into non-empty units', () => {
    const out = mapProcessRows([{
      Name: 'P1', PrologProcedure: 'a', MetadataProcedure: '', DataProcedure: 'b', EpilogProcedure: '',
    }]);
    expect(out).toHaveLength(1);
    expect(out[0].objectKind).toBe('process');
    expect(out[0].units.map(u => u.key)).toEqual(['prolog', 'data']); // empties dropped
  });
});

describe('mapRuleRows', () => {
  it('maps cubes with rules, drops empty', () => {
    const out = mapRuleRows([{ Name: 'C1', Rules: 'x' }, { Name: 'C2', Rules: '' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ objectKind: 'rule', objectName: 'C1' });
    expect(out[0].units[0]).toMatchObject({ key: 'rule', text: 'x' });
  });
});

describe('fetchCorpus corrupt-200 handling (L2)', () => {
  beforeEach(() => mockApi.mockReset());

  it('surfaces a corrupt process body as unreadable, not "0 matches"', async () => {
    // Processes 200 with an HTML error page (invalid JSON); Cubes valid.
    mockApi
      .mockResolvedValueOnce(ok('<html>proxy error</html>'))
      .mockResolvedValueOnce(ok(JSON.stringify({ value: [{ Name: 'C1', Rules: 'x' }] })));
    const { corpus, unreadable } = await fetchCorpus({} as never);
    expect(unreadable).toContain('Processes');
    expect(unreadable).not.toContain('Cubes');
    // Cubes still parsed through — corrupt Processes does not zero everything.
    expect(corpus.map(e => e.objectName)).toEqual(['C1']);
  });

  it('no unreadable entry when both bodies parse (empty valid collection ≠ error)', async () => {
    mockApi
      .mockResolvedValueOnce(ok(JSON.stringify({ value: [] })))
      .mockResolvedValueOnce(ok(JSON.stringify({ value: [] })));
    const { corpus, unreadable } = await fetchCorpus({} as never);
    expect(unreadable).toEqual([]);
    expect(corpus).toEqual([]);
  });

  it('surfaces a non-200 answer as unreadable — an error body is valid JSON', async () => {
    mockApi
      .mockResolvedValueOnce({ statusCode: 500, body: JSON.stringify({ error: { message: 'boom' } }) })
      .mockResolvedValueOnce({ statusCode: 403, body: JSON.stringify({ error: { message: 'denied' } }) });
    const { corpus, unreadable } = await fetchCorpus({} as never);
    expect(unreadable).toEqual(['Processes', 'Cubes']);
    expect(corpus).toEqual([]);
  });
});

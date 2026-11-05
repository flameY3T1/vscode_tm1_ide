/**
 * Review 2026-10-02 (silent fallback): a failed read of rules, chores,
 * processes, dimension names or the cube list behind the MDX views returned
 * `[]`, so `buildReferenceIndex` never listed the source in `incomplete`.
 * Bulk Delete then reported "not referenced" without the warning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
vi.mock('../../tm1Rest/processApi', () => ({ getParametersOrEmpty: vi.fn(() => []) }));

import { apiRequest } from '../../tm1Rest/client';
import { getOrBuildIndex, invalidateReferenceIndex } from '../../references/referenceIndexService';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const cfg = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' } as unknown as Tm1Config;
const ok = (body: unknown) => ({ statusCode: 200, body: JSON.stringify(body), headers: {} });
const fail = { statusCode: 500, body: '{"error":{"message":"boom"}}', headers: {} };

describe('reference index — a failed source is reported, not read as empty', () => {
  beforeEach(() => { invalidateReferenceIndex(); vi.mocked(apiRequest).mockReset(); });

  it('lists every source whose list request failed in `incomplete`', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_m: string, url: string) => {
      if (url.startsWith('Processes')) { return ok({ value: [{ Name: 'p1', PrologProcedure: '' }] }) as never; }
      if (url.startsWith('Cubes?$select=Name&$expand=Views')) { return ok({ value: [] }) as never; }
      return fail as never;
    });
    const idx = await getOrBuildIndex(cfg);
    expect(idx.incomplete).toEqual(expect.arrayContaining(
      ['cube rules', 'chores', 'MDX views', 'dimension names', 'subsets'],
    ));
  });

  it('reports a failed process read as well', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_m: string, url: string) =>
      (url.startsWith('Processes') ? fail : ok({ value: [] })) as never);
    const idx = await getOrBuildIndex(cfg);
    expect(idx.incomplete).toContain('processes');
  });

  it('reports a single failed dimension or cube in the fan-out (review 2026-10-03, A5)', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_m: string, url: string) => {
      if (url.startsWith('Dimensions?$select=Name&$expand')) { return fail as never; } // deep expand → per-dim fallback
      if (url.startsWith('Dimensions?$select=Name')) { return ok({ value: [{ Name: 'A' }, { Name: 'B' }] }) as never; }
      if (url.startsWith("Dimensions('B')")) { return fail as never; }
      if (url.startsWith("Dimensions('A')")) { return ok({ Name: 'A', Hierarchies: [] }) as never; }
      if (url.startsWith('Cubes?$select=Name') && !url.includes('$expand')) { return ok({ value: [{ Name: 'C1' }, { Name: 'C2' }] }) as never; }
      if (url.startsWith("Cubes('C2')/Views")) { return fail as never; }
      return ok({ value: [] }) as never;
    });
    const idx = await getOrBuildIndex(cfg);
    expect(idx.incomplete).toEqual(expect.arrayContaining(['subsets (1 dimensions)', 'MDX views (1 cubes)']));
  });
});

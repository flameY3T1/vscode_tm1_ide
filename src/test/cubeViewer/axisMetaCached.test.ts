import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `_buildAxisMeta` runs on EVERY refresh — and expanding/collapsing a row is
 * a refresh. It must obtain the dimension structure via `getDimStructure`
 * so that a second click does not pull it from the server again (measured live:
 * 16.9 MB + 23.7 MB for `Konten` alone, see `dimStructCache.ts`).
 *
 * Second promise here: ONE stamp probe per dimension and call. Levels and
 * edges used to hang off two separate fetch functions; if each validated
 * on its own, every refresh would pay for the probe twice.
 */

vi.mock('../../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));

import { apiRequest } from '../../tm1Client';
import { _buildAxisMeta } from '../../commands/cubeViewer/axisMeta';
import { _clearDimStructCacheForTest } from '../../commands/cubeViewer/dimStructCache';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;
const CFG = { serverUrl: 'https://tm1.example:12354/api/v1' } as unknown as Tm1Config;

function callKinds(): { probe: number; elements: number; edges: number } {
  const urls = mockApi.mock.calls.map((c) => String(c[1]));
  return {
    probe: urls.filter((u) => /Hierarchies\('[^']+'\)\?/.test(u)).length,
    elements: urls.filter((u) => u.includes('/Elements?')).length,
    edges: urls.filter((u) => u.includes('/Edges?')).length,
  };
}

beforeEach(() => {
  _clearDimStructCacheForTest();
  mockApi.mockReset();
  mockApi.mockImplementation((_m: string, url: string) => {
    if (/Hierarchies\('[^']+'\)\?/.test(url)) {
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ '@odata.etag': 'W/"v1"' }) });
    }
    if (url.includes('/Elements?')) {
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: [
        { Name: 'Total', Level: 1 }, { Name: 'A', Level: 0 }, { Name: 'B', Level: 0 },
      ] }) });
    }
    if (url.includes('/Edges?')) {
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: [
        { ParentName: 'Total', ComponentName: 'A' }, { ParentName: 'Total', ComponentName: 'B' },
      ] }) });
    }
    throw new Error(`unerwarteter Request: ${url}`);
  });
});

describe('_buildAxisMeta via the structure cache', () => {
  it('assembles levels and parent maps as before', async () => {
    const meta = await _buildAxisMeta(['dimA'], [['Total'], ['A']], CFG);

    expect(meta.levels).toEqual([[1], [0]]);
    expect(meta.parents[0]['A']).toBe('Total');
    // Since task 3 (trimming) `all` only holds elements with MULTIPLE PARENTS — 'B'
    // has exactly one parent ('Total'), which is already in `parents[0]`.
    expect(meta.allParents[0]['B']).toBeUndefined();
    expect(meta.levelMaps[0].get('Total')).toBe(1);
  });

  it('queries exactly ONE stamp probe per dimension, not one per sub-query', async () => {
    await _buildAxisMeta(['dimA'], [['Total']], CFG);
    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
  });

  it('fetches no more structure on the second refresh', async () => {
    await _buildAxisMeta(['dimA', 'dimB'], [['Total', 'Total']], CFG);
    mockApi.mockClear();

    const meta = await _buildAxisMeta(['dimA', 'dimB'], [['Total', 'Total']], CFG);

    expect(callKinds()).toEqual({ probe: 2, elements: 0, edges: 0 });
    expect(meta.levels).toEqual([[1, 1]]);
  });

  it('falls back to empty per dimension when its query fails', async () => {
    mockApi.mockImplementation((_m: string, url: string) => {
      if (/Hierarchies\('[^']+'\)\?/.test(url)) {
        return Promise.resolve({ statusCode: 200, body: JSON.stringify({ '@odata.etag': 'W/"v1"' }) });
      }
      return Promise.reject(new Error('boom'));
    });

    const meta = await _buildAxisMeta(['dimA'], [['Total']], CFG);

    expect(meta.levels).toBeNull();
    expect(meta.parents).toEqual([{}]);
    expect(meta.allParents).toEqual([{}]);
  });
});

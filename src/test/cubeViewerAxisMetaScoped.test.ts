import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../commands/cubeViewer/dimStructCache', () => ({
  getDimStructure: vi.fn(),
  getDimChildIndex: vi.fn(),
}));

import { getDimStructure, getDimChildIndex } from '../commands/cubeViewer/dimStructCache';
import { _buildAxisMeta } from '../commands/cubeViewer/axisMeta';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfg = { serverUrl: 'http://x', username: 'u', password: 'p', rejectUnauthorized: false } as Tm1Config;

beforeEach(() => {
  vi.mocked(getDimStructure).mockResolvedValue({
    levels: new Map([['blatt', 0], ['zwischen', 1], ['wurzel', 2], ['fern', 0]]),
    parents: {
      first: { blatt: 'zwischen', zwischen: 'wurzel', fern: 'wurzel' },
      all: { blatt: ['zwischen'], zwischen: ['wurzel'], fern: ['wurzel'] },
    },
  });
  vi.mocked(getDimChildIndex).mockResolvedValue({
    children: new Map([['zwischen', ['blatt']], ['wurzel', ['zwischen', 'fern']]]),
    parentSet: new Set(['zwischen', 'wurzel']),
  });
});

describe('_buildAxisMeta (scoped)', () => {
  it('sends only the chain above the loaded tuples', async () => {
    const m = await _buildAxisMeta(['D'], [['blatt']], cfg);
    expect(Object.keys(m.parents[0]).sort()).toEqual(['blatt', 'zwischen']);
    expect(m.parents[0].fern).toBeUndefined();
  });

  it('additionally includes named names (active filter list)', async () => {
    const m = await _buildAxisMeta(['D'], [['blatt']], cfg, [['fern']]);
    expect(Object.keys(m.parents[0]).sort()).toEqual(['blatt', 'fern', 'zwischen']);
  });

  it('reports hasChildren for visible consolidations', async () => {
    const m = await _buildAxisMeta(['D'], [['zwischen'], ['blatt']], cfg);
    expect(m.hasChildren[0].zwischen).toBe(true);
    expect(m.hasChildren[0].blatt).toBeUndefined();
  });

  it('stays at the previous empty values with an empty dimension list', async () => {
    const m = await _buildAxisMeta([], [], cfg);
    expect(m.levels).toBeNull();
    expect(m.parents).toEqual([]);
    expect(m.hasChildren).toEqual([]);
  });

  it('survives a dimension whose structure cannot be loaded', async () => {
    vi.mocked(getDimStructure).mockRejectedValueOnce(new Error('weg'));
    const m = await _buildAxisMeta(['D'], [['blatt']], cfg);
    expect(m.parents[0]).toEqual({});
    expect(m.hasChildren[0]).toEqual({});
  });
});

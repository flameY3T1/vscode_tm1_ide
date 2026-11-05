import { describe, it, expect } from 'vitest';
import { levelsForSlice, _buildAxisMeta } from '../../commands/cubeViewer/axisMeta';

describe('_buildAxisMeta returns levelMaps', () => {
  it('includes a levelMaps array parallel to dims', async () => {
    const meta = await _buildAxisMeta([], [], undefined as never);
    expect(meta).toHaveProperty('levelMaps');
    expect(Array.isArray(meta.levelMaps)).toBe(true);
    expect(meta.levelMaps).toEqual([]); // no dims → empty
  });
});

describe('levelsForSlice', () => {
  it('returns per-row level array indexed [ri][di] from per-dim level maps', () => {
    const dims = ['dimA', 'dimB'];
    const maps = [
      new Map([['S1', 1], ['Top', 0]]),
      new Map([['Jan', 0], ['Q1', 1]]),
    ];
    const tuples = [['S1', 'Jan'], ['Top', 'Q1']];
    expect(levelsForSlice(tuples, dims, maps)).toEqual([[1, 0], [0, 1]]);
  });

  it('defaults unknown elements to level 0', () => {
    expect(levelsForSlice([['X', 'Y']], ['a', 'b'], [new Map(), new Map()])).toEqual([[0, 0]]);
  });
});

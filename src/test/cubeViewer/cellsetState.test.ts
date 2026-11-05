import { describe, it, expect, beforeEach } from 'vitest';
import { _cellsets } from '../../commands/cubeViewer/state';
import { _stashPageContext } from '../../commands/cubeViewer/cellsetState';

describe('_stashPageContext', () => {
  beforeEach(() => _cellsets.clear());

  it('stores rowDims + levelMaps on an existing panel cellset', () => {
    _cellsets.set('p1', { id: 'c', numCols: 1, totalRows: 9999, config: undefined as never });
    const maps = [new Map([['x', 1]])];
    _stashPageContext('p1', ['dimA'], maps);
    const cs = _cellsets.get('p1')!;
    expect(cs.rowDims).toEqual(['dimA']);
    expect(cs.levelMaps).toBe(maps);
  });

  it('is a no-op when no cellset is registered (non-paged view)', () => {
    expect(() => _stashPageContext('missing', ['d'], [])).not.toThrow();
    expect(_cellsets.get('missing')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { findInconsistentCasing } from '../tiLogicVisualizer/tiLinter';

const empty = { prolog: '', metadata: '', data: '', epilog: '' };

describe('findInconsistentCasing', () => {
  it('flags occurrences that differ from canonical, not the canonical itself', () => {
    const r = findInconsistentCasing(
      { ...empty, prolog: 'vCount = 1;\nvcount = vCount + 1;' }, [], [],
    );
    expect(r).toEqual([
      { name: 'vcount', canonical: 'vCount', section: 'prolog', line: 1 },
    ]);
  });
  it('ignores identifiers inside strings and comments', () => {
    const r = findInconsistentCasing(
      { ...empty, prolog: "vX = 1;\nsMsg = 'vx happened'; # vx note" }, [], [],
    );
    expect(r.filter(x => x.name.toLowerCase() === 'vx')).toHaveLength(0);
  });
  it('normalizes a read against a param canonical', () => {
    const r = findInconsistentCasing({ ...empty, data: 'x = puser;' }, ['pUser'], []);
    expect(r).toEqual([{ name: 'puser', canonical: 'pUser', section: 'data', line: 0 }]);
  });
  it('ignores identifiers inside [...] reference brackets (lint == formatter mask)', () => {
    const r = findInconsistentCasing(
      { ...empty, prolog: "vX = 1;\ny = DB('Cube', [vx]);" }, [], [],
    );
    expect(r.filter(x => x.name.toLowerCase() === 'vx')).toHaveLength(0);
  });
});

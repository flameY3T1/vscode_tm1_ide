import { describe, it, expect } from 'vitest';
import { scanValueGroups } from '../../tiValueNaming/scan';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(name: string, prolog: string): ConsistencyProcess {
  return { name, units: [{ key: 'prolog', text: prolog }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

describe('scanValueGroups', () => {
  it('groups same value under different names across processes', () => {
    const groups = scanValueGroups([
      proc('A', "sAllElementsA = 'alleElementeDimA';"),
      proc('B', "sConsolidatedA = 'alleElementeDimA';"),
    ]);
    const g = groups.find(x => x.valueKey === 'alleelementedima');
    expect(g).toBeDefined();
    expect(g!.names.map(n => n.name).sort()).toEqual(['sAllElementsA', 'sConsolidatedA']);
  });
  it('ignores a value used under a single name only', () => {
    const groups = scanValueGroups([proc('A', "sX = 'v';"), proc('B', "sX = 'v';")]);
    expect(groups).toEqual([]);
  });
  it('groups case-insensitively on value', () => {
    const groups = scanValueGroups([proc('A', "sX = 'Region';"), proc('B', "sY = 'region';")]);
    expect(groups.find(x => x.valueKey === 'region')?.names.length).toBe(2);
  });
  it('excludes a variable that has TWO different literal values (Phase 2 case)', () => {
    const groups = scanValueGroups([proc('A', "f = 'a';\nf = 'b';"), proc('B', "sX = 'a';")]);
    // f is multi-value → not a Phase-1 candidate; value 'a' then has only sX → no >=2-name group
    expect(groups.find(x => x.valueKey === 'a')).toBeUndefined();
  });
});

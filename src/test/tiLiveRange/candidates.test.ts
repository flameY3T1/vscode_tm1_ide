import { describe, it, expect } from 'vitest';
import { multiValueVars } from '../../tiLiveRange/candidates';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(prolog: string): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text: prolog }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

describe('multiValueVars', () => {
  it('surfaces a var with two distinct literal values, both splittable linear', () => {
    const mv = multiValueVars(proc("f = 'a';\nu(f);\nf = 'b';\nu(f);"));
    expect(mv).toHaveLength(1);
    expect(mv[0].varName).toBe('f');
    expect(mv[0].defs.map(d => [d.value, d.splittable])).toEqual([['a', true], ['b', true]]);
  });

  it('ignores a single-value var', () => {
    expect(multiValueVars(proc("f = 'a';\nu(f);"))).toEqual([]);
  });

  it('marks a merge def as not splittable', () => {
    const mv = multiValueVars(proc("IF(x=1);\nf = 'a';\nELSE;\nf = 'b';\nENDIF;\nu(f);"));
    expect(mv[0].defs.every(d => !d.splittable)).toBe(true);
    expect(mv[0].defs[0].refused).toBe('merge');
  });

  it('excludes reserved/system variable names', () => {
    expect(multiValueVars(proc("DatasourceQuery = 'a';\nDatasourceQuery = 'b';"))).toEqual([]);
  });

  it('marks defs on a multi-statement physical line as not splittable (ambiguous)', () => {
    const mv = multiValueVars(proc("sX = 'a'; nY = LONG(sX); sX = 'b'; sProc = sX;"));
    const v = mv.find(m => m.varName === 'sX');
    expect(v).toBeTruthy();
    expect(v!.defs.filter(d => d.value !== undefined).every(d => !d.splittable && d.refused === 'ambiguous')).toBe(true);
  });
});

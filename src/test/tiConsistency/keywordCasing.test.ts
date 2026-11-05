import { describe, expect, it } from 'vitest';
import { keywordCasingRule } from '../../tiConsistency/rules/keywordCasing';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(text: string): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

describe('keywordCasingRule.scan', () => {
  it('flags lowercase keywords with UPPER target', () => {
    const f = keywordCasingRule.scan(proc('if(1=1);\nnX=1;\nend;'));
    expect(f.find(x => x.key === 'if')?.target).toBe('IF');
    expect(f.find(x => x.key === 'if')?.spelling).toBe('if');
    expect(f.find(x => x.key === 'end')?.target).toBe('END');
  });

  it('ignores already-uppercase keywords', () => {
    expect(keywordCasingRule.scan(proc('IF(1=1);\nEND;')).length).toBe(0);
  });

  it('ignores keyword text inside strings', () => {
    expect(keywordCasingRule.scan(proc("s = 'if end';")).length).toBe(0);
  });
});

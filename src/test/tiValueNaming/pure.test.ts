import { describe, it, expect } from 'vitest';
import { groupByProcess } from '../../webviewClient/tiValueNaming/pure';

describe('groupByProcess', () => {
  it('groups vars by process preserving first-seen order', () => {
    const list = [
      { process: 'ProcA', varName: 'sFoo' },
      { process: 'ProcB', varName: 'sBaz' },
      { process: 'ProcA', varName: 'sBar' },
    ];
    const out = groupByProcess(list);
    expect(out.map(g => g.process)).toEqual(['ProcA', 'ProcB']);
    expect(out[0].vars.map(v => v.varName)).toEqual(['sFoo', 'sBar']);
    expect(out[1].vars.map(v => v.varName)).toEqual(['sBaz']);
  });

  it('returns empty array for empty input', () => {
    expect(groupByProcess([])).toEqual([]);
  });

  it('keeps a single process as one group', () => {
    const out = groupByProcess([{ process: 'P', varName: 'a' }, { process: 'P', varName: 'b' }]);
    expect(out).toHaveLength(1);
    expect(out[0].vars).toHaveLength(2);
  });
});

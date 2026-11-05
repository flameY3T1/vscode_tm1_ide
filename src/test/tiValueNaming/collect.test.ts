import { describe, it, expect } from 'vitest';
import { collectStringAssignments } from '../../tiValueNaming/collect';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(prolog: string): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text: prolog }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

describe('collectStringAssignments', () => {
  it('collects string-literal assignments with decoded value + line', () => {
    const a = collectStringAssignments(proc("sDim = 'alleElementeDimA';\nnX = 5;"));
    expect(a).toEqual([{ process: 'P', varName: 'sDim', varLc: 'sdim', value: 'alleElementeDimA', unit: 'prolog', line: 1 }]);
  });
  it('ignores numeric and dynamic assignments', () => {
    const a = collectStringAssignments(proc("nX = 5;\nsY = pParam;\nsZ = CellGetS(1,2);"));
    expect(a).toEqual([]);
  });
  it('recurses into IF/WHILE bodies', () => {
    const a = collectStringAssignments(proc("IF(1=1);\nsA = 'x';\nENDIF;\nWHILE(0=1);\nsB = 'y';\nEND;"));
    expect(a.map(x => x.varName).sort()).toEqual(['sA', 'sB']);
  });
  it('decodes escaped apostrophes', () => {
    const a = collectStringAssignments(proc("sT = 'it''s here';"));
    expect(a[0].value).toBe("it's here");
  });
  it('maps a combined-doc line in a NON-first unit to that unit + a section-relative line', () => {
    const multiUnitProc: ConsistencyProcess = {
      name: 'P',
      units: [{ key: 'prolog', text: "sA = 'x';" }, { key: 'metadata', text: "sB = 'y';" }],
      params: [], datasourceVars: [], rawParams: [], rawVariables: [],
    };
    const a = collectStringAssignments(multiUnitProc);
    const sB = a.find(x => x.varName === 'sB');
    expect(sB).toBeDefined();
    // combined-doc line 2 (prolog is 1 line) must map to metadata, line 1 — NOT combined line 2.
    expect(sB).toMatchObject({ unit: 'metadata', line: 1 });
    const sA = a.find(x => x.varName === 'sA');
    expect(sA).toMatchObject({ unit: 'prolog', line: 1 });
  });
  it('does not collect a TI SYSTEM datasource-config var assignment', () => {
    // DatasourceType is a TI SYSTEM pseudo-var configuring the datasource in the Prolog —
    // renaming it breaks the process, so it must never be offered as a value-naming candidate.
    const a = collectStringAssignments(proc("DatasourceType = 'CHAR';"));
    expect(a.find(x => x.varLc === 'datasourcetype')).toBeUndefined();
  });
  it('does not collect an empty-string initializer', () => {
    // `sX = '';` is a common init, not a meaningful value; a real value for sX is still collected.
    const a = collectStringAssignments(proc("sX = '';\nsY = 'region';"));
    expect(a.find(x => x.varName === 'sX')).toBeUndefined();
    expect(a.find(x => x.varName === 'sY')?.value).toBe('region');
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildTupleBind, mapCalcNode, mapFeederTrace, mapFedCell,
} from '../../tm1Rest/cellTraceTypes';

describe('buildTupleBind', () => {
  it('builds one Dimensions/Hierarchies/Elements ref per dim, hier == dim', () => {
    expect(buildTupleBind(['Year', 'Region'], ['2025', 'North'])).toEqual([
      "Dimensions('Year')/Hierarchies('Year')/Elements('2025')",
      "Dimensions('Region')/Hierarchies('Region')/Elements('North')",
    ]);
  });
  it("escapes single quotes ('->'')", () => {
    expect(buildTupleBind(["O'Dim"], ["A'B"])).toEqual([
      "Dimensions('O''Dim')/Hierarchies('O''Dim')/Elements('A''B')",
    ]);
  });
  it('URL-encodes `/` in dim/element names (legal in TM1) so bind path stays intact', () => {
    expect(buildTupleBind(['Fiscal/Year'], ['2024/2025'])).toEqual([
      "Dimensions('Fiscal%2FYear')/Hierarchies('Fiscal%2FYear')/Elements('2024%2F2025')",
    ]);
  });
  it('throws on length mismatch', () => {
    expect(() => buildTupleBind(['A'], ['x', 'y'])).toThrow(/mismatch/i);
  });
});

describe('mapCalcNode', () => {
  it('maps a rule root with 2 inline components and tuple names', () => {
    const raw = {
      Type: 'Rule', Status: 'Data', Value: -0.52,
      Statements: ["['PAQ'] = ['PA'] \\ ['Um'];"],
      Tuple: [{ Name: 'PAQ' }, { Name: 'Wert' }],
      Components: [
        { Type: 'Consolidation', Status: 'Data', Value: -43859265.1, Statements: [], Tuple: [{ Name: 'PA' }], Components: [] },
        { Type: 'Consolidation', Status: 'Data', Value: 84320694.3, Statements: [], Tuple: [{ Name: 'Um' }], Components: [] },
      ],
    };
    const n = mapCalcNode(raw);
    expect(n.type).toBe('Rule');
    expect(n.value).toBe(-0.52);
    expect(n.statements).toHaveLength(1);
    expect(n.tuple).toEqual(['PAQ', 'Wert']);
    expect(n.components.map(c => c.tuple[0])).toEqual(['PA', 'Um']);
  });
  it('reads the cube of each node and whether its children came along', () => {
    const n = mapCalcNode({
      Type: 'Rule', Cube: { Name: 'Sales' }, Tuple: [{ Name: 'A' }],
      Components: [{ Type: 'Simple', Value: 58, Cube: { Name: 'Prices' }, Tuple: [{ Name: 'P' }] }],
    });
    expect(n.cube).toBe('Sales');
    expect(n.childrenLoaded).toBe(true);
    expect(n.components[0].cube).toBe('Prices');
    // A one-level trace leaves `Components` off the children: not loaded yet,
    // which is different from "loaded and empty".
    expect(n.components[0].childrenLoaded).toBe(false);
    expect(mapCalcNode({ Components: [] }).childrenLoaded).toBe(true);
  });

  it('defaults missing fields (no Components key, no Tuple)', () => {
    const n = mapCalcNode({ Type: 'Simple', Status: 'Data', Value: 5 });
    expect(n.components).toEqual([]);
    expect(n.tuple).toEqual([]);
    expect(n.statements).toEqual([]);
  });
});

describe('mapFeederTrace / mapFedCell', () => {
  it('maps fed cells + statements', () => {
    const r = mapFeederTrace({
      Statements: ["['x'] => ['y'];"],
      FedCells: [{ Tuple: [{ Name: 'A' }, { Name: 'B' }], Fed: true, Value: 1 }],
    });
    expect(r.statements).toEqual(["['x'] => ['y'];"]);
    expect(r.fedCells).toEqual([{ tuple: ['A', 'B'], fed: true, value: 1 }]);
  });
  it('mapFedCell defaults fed=false', () => {
    expect(mapFedCell({ Tuple: [{ Name: 'A' }] })).toEqual({ tuple: ['A'], fed: false, value: null });
  });
});
describe('buildTupleBind — alternate hierarchy keys', () => {
  it('addresses the hierarchy a `dim:hier` key names', () => {
    expect(buildTupleBind(['D:Alt', 'E'], ['GroupA', 'x'])).toEqual([
      "Dimensions('D')/Hierarchies('Alt')/Elements('GroupA')",
      "Dimensions('E')/Hierarchies('E')/Elements('x')",
    ]);
  });
});

import { describe, it, expect } from 'vitest';
import { build, type BuilderModel } from '../tiLogicVisualizer/areaDbBuilderPure';

const db = (cube: string, dims: Array<[string, string[]]>): BuilderModel =>
  ({ mode: 'DB', cube, dims: dims.map(([name, elements]) => ({ name, elements })) });
const area = (dims: Array<[string, string[]]>): BuilderModel =>
  ({ mode: 'AREA', dims: dims.map(([name, elements]) => ({ name, elements })) });

describe('areaDbBuilder.build — DB', () => {
  it('all dims variable → !dim per dim', () => {
    expect(build(db('Sales', [['Region', []], ['Month', []]])))
      .toBe("DB('Sales', !Region, !Month)");
  });

  it('mixes fixed elements and !dim in storage order', () => {
    expect(build(db('Prices', [['Product', ['P100']], ['Month', []], ['Measure', ['Price']]])))
      .toBe("DB('Prices', 'P100', !Month, 'Price')");
  });

  it('escapes apostrophes in cube and element names', () => {
    expect(build(db("O'Brien", [['Cust', ["O'Neil"]]])))
      .toBe("DB('O''Brien', 'O''Neil')");
  });

  it('DB ignores extra picks beyond the first (single-cell)', () => {
    expect(build(db('C', [['D', ['a', 'b']]])))
      .toBe("DB('C', 'a')");
  });
});

describe('areaDbBuilder.build — AREA', () => {
  it('omits dims without picks, qualifies single element', () => {
    expect(build(area([['Version', ['Actual']], ['Month', []], ['Measure', ['Amount']]])))
      .toBe("['Version':'Actual', 'Measure':'Amount']");
  });

  it('emits a set for 2+ picks', () => {
    expect(build(area([['Month', ['Jan', 'Feb', 'Mar']]])))
      .toBe("['Month':{'Jan','Feb','Mar'}]");
  });

  it('escapes apostrophes in dim and element names', () => {
    expect(build(area([["O'Dim", ["O'Elem"]]])))
      .toBe("['O''Dim':'O''Elem']");
  });

  it('empty area → []', () => {
    expect(build(area([['A', []], ['B', []]]))).toBe('[]');
  });
});

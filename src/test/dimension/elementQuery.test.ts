import { describe, it, expect } from 'vitest';
import { buildNameFilters } from '../../tm1Rest/elementQuery';

describe('buildNameFilters (name list → $filter blocks)', () => {
  it('builds an or chain', () => {
    expect(buildNameFilters(['A', 'B'])).toEqual([`Name eq 'A' or Name eq 'B'`]);
  });
  it("escapt Hochkommata (OData: ' → '')", () => {
    expect(buildNameFilters(["O'Brien"])).toEqual([`Name eq 'O''Brien'`]);
  });
  it('deduplicates and drops empty names', () => {
    expect(buildNameFilters(['A', 'A', '', 'B'])).toEqual([`Name eq 'A' or Name eq 'B'`]);
  });
  it('splits into blocks of the chunk size', () => {
    expect(buildNameFilters(['A', 'B', 'C'], 2)).toEqual([
      `Name eq 'A' or Name eq 'B'`,
      `Name eq 'C'`,
    ]);
  });
  it('no names, no blocks', () => {
    expect(buildNameFilters([])).toEqual([]);
  });
});

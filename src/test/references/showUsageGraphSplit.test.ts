import { describe, it, expect } from 'vitest';
import { splitQualifiedName } from '../../utils/qualifiedName';

describe('splitQualifiedName', () => {
  it('splits Dim:Hier:Subset', () => {
    expect(splitQualifiedName('Region:Region:Europe')).toEqual(['Region', 'Region', 'Europe']);
  });
  it('preserves an alternate hierarchy distinct from the dimension', () => {
    // Finding #8: hier is the middle segment and must be threaded through the
    // open-subset path — for alternate-hier subsets it differs from the dim.
    const [dim, hier, subset] = splitQualifiedName('Region:Continents:Europe');
    expect(dim).toBe('Region');
    expect(hier).toBe('Continents');
    expect(subset).toBe('Europe');
    expect(hier).not.toBe(dim);
  });
  it('splits Cube:View', () => {
    expect(splitQualifiedName('Sales:V1')).toEqual(['Sales', 'V1']);
  });

  // Finding L8: v12 permits ':' in object names. A bounded split lets the last
  // field absorb overflow colons so the key round-trips instead of over-splitting.
  it('bounds subset split (maxParts=3): last field absorbs ":"', () => {
    expect(splitQualifiedName('Region:Continents:Eu:rope', 3))
      .toEqual(['Region', 'Continents', 'Eu:rope']);
  });
  it('bounds view split (maxParts=2): last field absorbs ":"', () => {
    expect(splitQualifiedName('Sales:V:1', 2)).toEqual(['Sales', 'V:1']);
  });
  it('unbounded split is unchanged (back-compat)', () => {
    expect(splitQualifiedName('Region:Region:Europe')).toEqual(['Region', 'Region', 'Europe']);
  });
  it('fewer parts than maxParts: no change', () => {
    expect(splitQualifiedName('Sales:V1', 3)).toEqual(['Sales', 'V1']);
  });
});

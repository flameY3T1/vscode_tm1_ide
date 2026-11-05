import { describe, it, expect } from 'vitest';
import { filterProcessNames } from '../../tiConsistency/filter';

describe('filterProcessNames', () => {
  const names = ['Load.Sales', 'Load.Costs', 'Report.Sales', 'Sync.Inventory'];
  it('single-term prefix / suffix / contains, case-insensitive', () => {
    expect(filterProcessNames(names, { prefix: ['load'], suffix: [], contains: [] })).toEqual(['Load.Sales', 'Load.Costs']);
    expect(filterProcessNames(names, { prefix: [], suffix: ['sales'], contains: [] })).toEqual(['Load.Sales', 'Report.Sales']);
    expect(filterProcessNames(names, { prefix: [], suffix: [], contains: ['cost'] })).toEqual(['Load.Costs']);
  });
  it('multiple terms per axis match ANY (OR within an axis)', () => {
    expect(filterProcessNames(names, { prefix: ['load', 'report'], suffix: [], contains: [] }))
      .toEqual(['Load.Sales', 'Load.Costs', 'Report.Sales']);
    expect(filterProcessNames(names, { prefix: [], suffix: [], contains: ['sales', 'inventory'] }))
      .toEqual(['Load.Sales', 'Report.Sales', 'Sync.Inventory']);
  });
  it('axes combine with AND', () => {
    expect(filterProcessNames(names, { prefix: ['load', 'report'], suffix: ['sales'], contains: [] }))
      .toEqual(['Load.Sales', 'Report.Sales']);
  });
  it('blank / whitespace-only terms are ignored', () => {
    expect(filterProcessNames(names, { prefix: ['  ', ''], suffix: [], contains: [] })).toEqual(names);
  });
  it('empty filter returns all', () => {
    expect(filterProcessNames(names, { prefix: [], suffix: [], contains: [] })).toEqual(names);
  });
});

describe('filterProcessNames — control objects', () => {
  const withControl = ['Load.Sales', '}bedrock.updateServerParams', '}ElementAttributes_Sales'];

  it('excludes }-prefixed names by default (includeControl omitted)', () => {
    expect(filterProcessNames(withControl, { prefix: [], suffix: [], contains: [] })).toEqual(['Load.Sales']);
  });

  it('excludes }-prefixed names when includeControl is false', () => {
    expect(filterProcessNames(withControl, { prefix: [], suffix: [], contains: [], includeControl: false }))
      .toEqual(['Load.Sales']);
  });

  it('includes }-prefixed names when includeControl is true', () => {
    expect(filterProcessNames(withControl, { prefix: [], suffix: [], contains: [], includeControl: true }))
      .toEqual(withControl);
  });

  it('control exclusion combines with term filters (AND)', () => {
    expect(filterProcessNames(withControl, { prefix: ['}bedrock'], suffix: [], contains: [], includeControl: false }))
      .toEqual([]);
    expect(filterProcessNames(withControl, { prefix: ['}bedrock'], suffix: [], contains: [], includeControl: true }))
      .toEqual(['}bedrock.updateServerParams']);
  });
});

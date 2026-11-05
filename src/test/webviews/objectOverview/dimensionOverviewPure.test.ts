// src/test/webviews/objectOverview/dimensionOverviewPure.test.ts
import { describe, it, expect } from 'vitest';
import { buildDimensionRows, buildDimensionKpis, defaultCardinality, hasAlternateHierarchies } from '../../../commands/dimension/dimensionOverviewPure';
import type { RawDimension } from '../../../tm1Rest/dimensionApi';

const d = (o: RawDimension): RawDimension => o;

describe('defaultCardinality', () => {
  it('uses the hierarchy matching the dim name, else the first', () => {
    expect(defaultCardinality(d({ Name: 'Region', Hierarchies: [{ Name: 'Leaves', Cardinality: 9 }, { Name: 'Region', Cardinality: 12 }] }))).toBe(12);
    expect(defaultCardinality(d({ Name: 'X', Hierarchies: [{ Name: 'H1', Cardinality: 4 }] }))).toBe(4);
    expect(defaultCardinality(d({ Name: 'X' }))).toBe(0);
  });
});

describe('hasAlternateHierarchies', () => {
  it('true when >1 hierarchy excluding Leaves', () => {
    expect(hasAlternateHierarchies(d({ Name: 'X', Hierarchies: [{ Name: 'X' }, { Name: 'Alt' }, { Name: 'Leaves' }] }))).toBe(true);
    expect(hasAlternateHierarchies(d({ Name: 'X', Hierarchies: [{ Name: 'X' }, { Name: 'Leaves' }] }))).toBe(false);
  });
});

describe('buildDimensionRows + KPIs', () => {
  const raw: RawDimension[] = [
    d({ Name: 'Region', Hierarchies: [{ Name: 'Region', Cardinality: 12 }, { Name: 'Alt', Cardinality: 5 }] }),
    d({ Name: '}Groups', Hierarchies: [{ Name: '}Groups', Cardinality: 3 }] }),
  ];
  const rows = buildDimensionRows(raw);
  it('flags control + maps elements + hierarchies', () => {
    const r = rows.find(x => x.id === 'Region')!;
    expect(r.isControl).toBe(false);
    expect(r.cells.elements).toBe(12);
    expect(r.cells.hierarchies).toEqual(['Region', 'Alt']);
    expect(r.cells.altHier).toBe(true);
    expect(rows.find(x => x.id === '}Groups')!.isControl).toBe(true);
  });
  it('KPIs sum elements over non-control dims', () => {
    const k = buildDimensionKpis(rows);
    expect(k.find(x => x.key === 'total')!.value).toBe('2');
    expect(k.find(x => x.key === 'elements')!.value).toBe('12');
    expect(k.find(x => x.key === 'largest')!.value).toBe('Region');
  });
});

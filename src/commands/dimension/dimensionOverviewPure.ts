// src/commands/dimension/dimensionOverviewPure.ts
import type { RawDimension } from '../../tm1Rest/dimensionApi';
import type { OverviewRow, KpiValue } from '../../webviews/objectOverview/overviewTypes';

export function defaultCardinality(dim: RawDimension): number {
  const hiers = dim.Hierarchies ?? [];
  const named = hiers.find(h => h.Name === dim.Name);
  return (named ?? hiers[0])?.Cardinality ?? 0;
}

export function hasAlternateHierarchies(dim: RawDimension): boolean {
  return (dim.Hierarchies ?? []).filter(h => h.Name !== 'Leaves').length > 1;
}

export function buildDimensionRows(raw: RawDimension[]): OverviewRow[] {
  return raw.map(dim => ({
    id: dim.Name,
    isControl: dim.Name.startsWith('}'),
    cells: {
      name: dim.Name,
      hierarchies: (dim.Hierarchies ?? []).map(h => h.Name),
      elements: defaultCardinality(dim),
      attributes: null,   // lazy (attribute names)
      altHier: hasAlternateHierarchies(dim), // internal: feeds the "alt hierarchies" KPI (no column)
      usedInCubes: null,  // lazy (cube names)
    },
  }));
}

export function buildDimensionKpis(rows: OverviewRow[]): KpiValue[] {
  const nonCtrl = rows.filter(r => !r.isControl);
  const totalElems = nonCtrl.reduce((n, r) => n + Number(r.cells.elements ?? 0), 0);
  const alt = rows.filter(r => r.cells.altHier === true).map(r => r.id);
  const largest = rows.slice().sort((a, b) => Number(b.cells.elements ?? 0) - Number(a.cells.elements ?? 0))[0];
  return [
    { key: 'total', label: 'Dimensions', value: String(rows.length) },
    { key: 'elements', label: 'Σ elements', value: String(totalElems) },
    { key: 'alt', label: 'With alt. hierarchies', value: String(alt.length), rowIds: alt },
    { key: 'largest', label: 'Largest', value: largest ? String(largest.id) : '—' },
  ];
}

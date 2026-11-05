import type { RawCube } from '../../tm1Rest/cubeApi';
import type { OverviewRow, KpiValue } from '../../webviews/objectOverview/overviewTypes';

export function ruleLineCount(rules: string): number {
  if (!rules.trim()) { return 0; }
  return rules.split(/\r?\n/).filter(l => l.trim() !== '').length;
}

export function hasFeeders(rules: string): boolean {
  const idx = rules.search(/^\s*FEEDERS\s*;/im);
  if (idx < 0) { return false; }
  const after = rules.slice(idx).replace(/^\s*FEEDERS\s*;/im, '');
  return after.trim().length > 0;
}

export function buildCubeRows(raw: RawCube[]): OverviewRow[] {
  return raw.map(cube => ({
    id: cube.Name,
    isControl: cube.Name.startsWith('}'),
    cells: {
      name: cube.Name,
      dims: (cube.Dimensions ?? []).length,
      dimList: (cube.Dimensions ?? []).map(d => d.Name),
      hasRules: null,   // lazy
      ruleLines: null,  // lazy
      hasFeeders: null, // lazy
      cells: null,      // lazy
      ram: null,        // lazy
      views: null,      // lazy
    },
  }));
}

export function buildCubeKpis(rows: OverviewRow[]): KpiValue[] {
  return [
    { key: 'total', label: 'Cubes', value: String(rows.length) },
    { key: 'ram', label: 'Σ RAM', value: '—' },      // updated by lazy kpi
    { key: 'withRules', label: 'With rules', value: '—' },
    { key: 'withFeeders', label: 'With feeders', value: '—' },
  ];
}

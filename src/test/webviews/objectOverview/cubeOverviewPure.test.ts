import { describe, it, expect } from 'vitest';
import { buildCubeRows, buildCubeKpis, hasFeeders, ruleLineCount } from '../../../commands/cubeViewer/cubeOverviewPure';
import type { RawCube } from '../../../tm1Rest/cubeApi';

const c = (o: RawCube): RawCube => o;

describe('hasFeeders', () => {
  it('true only when a FEEDERS; section has content', () => {
    expect(hasFeeders("['a']=N: 1;\r\nFEEDERS;\r\n['a']=>['b'];")).toBe(true);
    expect(hasFeeders("['a']=N: 1;")).toBe(false);
    expect(hasFeeders('FEEDERS;')).toBe(false);
  });
});

describe('ruleLineCount', () => {
  it('counts non-empty lines', () => {
    expect(ruleLineCount("['a']=N: 1;\r\n\r\n['b']=N: 2;")).toBe(2);
    expect(ruleLineCount('')).toBe(0);
  });
});

describe('buildCubeRows + KPIs', () => {
  const raw: RawCube[] = [
    c({ Name: 'Sales', Dimensions: [{ Name: 'Region' }, { Name: 'Time' }] }),
    c({ Name: '}Stats', Dimensions: [{ Name: '}Cubes' }] }),
  ];
  const rows = buildCubeRows(raw);
  it('flags control + maps dims', () => {
    const r = rows.find(x => x.id === 'Sales')!;
    expect(r.isControl).toBe(false);
    expect(r.cells.dims).toBe(2);
    expect(r.cells.dimList).toEqual(['Region', 'Time']);
    expect(rows.find(x => x.id === '}Stats')!.isControl).toBe(true);
  });
  it('KPIs count cubes', () => {
    expect(buildCubeKpis(rows).find(x => x.key === 'total')!.value).toBe('2');
  });
});

import { describe, it, expect } from 'vitest';
import { judgeViewSize, subsetAllDimension } from '../commands/cubeViewer/viewSizeGuardPure';

const LIMIT = 5_000_000;
const a = (dim: string, count: number | null) => ({ dim, count });

describe('subsetAllDimension', () => {
  it('recognises the whole-dimension selection', () => {
    expect(subsetAllDimension('TM1SubsetAll([Konten])')).toBe('Konten');
    expect(subsetAllDimension('  tm1subsetall ( [Jahre] ) ')).toBe('Jahre');
  });

  it('resolves ]] to a literal ]', () => {
    expect(subsetAllDimension('TM1SubsetAll([A]]B])')).toBe('A]B');
  });

  it('leaves everything else untouched — otherwise it would be guessing', () => {
    expect(subsetAllDimension(undefined)).toBeNull();
    expect(subsetAllDimension('')).toBeNull();
    expect(subsetAllDimension('{[Konten].[Umsatz]}')).toBeNull();
    expect(subsetAllDimension('TM1FILTERBYLEVEL(TM1SubsetAll([Konten]),0)')).toBeNull();
  });
});

describe('judgeViewSize', () => {
  it('blocks the provably unbounded cross product', () => {
    // The real case: 11 whole dimensions on the rows, columns empty.
    const rows = [
      a('Datenquellen', 85), a('Jahre', 24), a('Monate', 68), a('Datenarten', 105),
      a('Stations', 309), a('Cost_Frames', 13936),
      a('AllocStations', 211852), a('AllocCostCenters', 10839),
      a('Konten', 160659), a('Service_Types', 82), a('ValueFields', 9),
    ];
    const v = judgeViewSize(rows, [], false, LIMIT);
    expect(v.block).toBe(true);
    expect(v.drivers[0]).toEqual({ dim: 'AllocStations', count: 211852 });
  });

  it('lets an ordinary view through', () => {
    expect(judgeViewSize([a('Konten', 500)], [a('Jahre', 12)], false, LIMIT).block).toBe(false);
  });

  it('never blocks when an axis size is unknown', () => {
    // A dynamic subset can be small; blocking would mean guessing and would
    // make a legitimate view impossible to open.
    const v = judgeViewSize([a('Konten', 160659), a('Unbekannt', null)], [], false, LIMIT);
    expect(v.block).toBe(false);
    expect(v.tuples).toBeNull();
  });

  it('never blocks with zero suppression active', () => {
    // With suppression, TM1 only materialises populated tuples — the cross
    // product then says nothing about the actual size.
    const rows = [a('Konten', 160659), a('AllocStations', 211852)];
    expect(judgeViewSize(rows, [], true, LIMIT).block).toBe(false);
  });

  it('counts an empty axis as one tuple, not as zero', () => {
    // Otherwise every product would be 0 and nothing would ever be blocked.
    const v = judgeViewSize([a('Konten', 160659), a('AllocStations', 211852)], [], false, LIMIT);
    expect(v.block).toBe(true);
    expect(v.tuples).toBeGreaterThan(LIMIT);
  });

  it('does not run into wrong comparisons with huge products', () => {
    const many = Array.from({ length: 20 }, (_, i) => a(`D${i}`, 1000));
    const v = judgeViewSize(many, [], false, LIMIT);
    expect(v.block).toBe(true);
    expect(v.tuples).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('a truly empty view does not block', () => {
    expect(judgeViewSize([], [], false, LIMIT).block).toBe(false);
  });

  it('an axis with 0 members does not block', () => {
    expect(judgeViewSize([a('Leer', 0)], [a('Jahre', 12)], false, LIMIT).block).toBe(false);
  });
});

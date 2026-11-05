import { describe, it, expect } from 'vitest';
import {
  parseLog,
  buildCubeFixturesJsonl,
  buildAttrReadsJsonl,
} from '../../../tiTestFramework/log/logParser';

describe('extractCellReads', () => {

  it('parseLog ignores __CELLREAD__ markers (no unknown-op warning, no diff row)', () => {
    const r = parseLog('"__CELLREAD__","S","C","e1","e2","V"\n');
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  describe('buildCubeFixturesJsonl', () => {
    it('serialises captures to JSONL, de-duping repeated coords (last wins)', () => {
      const log =
        '"__CELLREAD__","S","C","e","V1"\n' +
        '"__CELLREAD__","S","C","e","V2"\n' +
        '"__CELLREAD__","N","C","x","5"\n';
      const { jsonl, droppedCount } = buildCubeFixturesJsonl(log);
      const rows = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(rows).toEqual([
        { cube: 'C', coord: ['e'], value: 'V2' },
        { cube: 'C', coord: ['x'], value: 5 },
      ]);
      expect(droppedCount).toBe(0);
    });

    it('returns empty string when there are no captures', () => {
      expect(buildCubeFixturesJsonl('"CellPutN","S","x"\n')).toEqual({
        jsonl: '',
        droppedCount: 0,
        conflictCount: 0,
      });
    });

    it('reports dropped ambiguous numeric reads and omits them from the JSONL', () => {
      const log =
        '"__CELLREAD__","N","C","ok","42.5"\n' +
        '"__CELLREAD__","N","C","bad","1.234,56"\n';
      const { jsonl, droppedCount } = buildCubeFixturesJsonl(log);
      const rows = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(rows).toEqual([{ cube: 'C', coord: ['ok'], value: 42.5 }]);
      expect(droppedCount).toBe(1);
    });

    it('counts a coord read twice with CHANGING values as a conflict (keeps last)', () => {
      const log =
        '"__CELLREAD__","N","C","x","5"\n' +
        '"__CELLREAD__","N","C","x","7"\n';
      const { jsonl, conflictCount } = buildCubeFixturesJsonl(log);
      const rows = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      // keep-last behaviour is unchanged: the LAST value survives dedup.
      expect(rows).toEqual([{ cube: 'C', coord: ['x'], value: 7 }]);
      expect(conflictCount).toBe(1);
    });

    it('does NOT count a coord read twice with the SAME value as a conflict', () => {
      const log =
        '"__CELLREAD__","N","C","x","5"\n' +
        '"__CELLREAD__","N","C","x","5"\n';
      const { conflictCount } = buildCubeFixturesJsonl(log);
      expect(conflictCount).toBe(0);
    });

    it('does NOT count two different coords as a conflict', () => {
      const log =
        '"__CELLREAD__","N","C","x","5"\n' +
        '"__CELLREAD__","N","C","y","7"\n';
      const { conflictCount } = buildCubeFixturesJsonl(log);
      expect(conflictCount).toBe(0);
    });

    it('counts DISTINCT conflicting keys, not total overwrites', () => {
      const log =
        '"__CELLREAD__","N","C","x","1"\n' +
        '"__CELLREAD__","N","C","x","2"\n' +
        '"__CELLREAD__","N","C","x","3"\n' + // key x conflicts (>1 distinct) → 1
        '"__CELLREAD__","N","C","y","9"\n' +
        '"__CELLREAD__","N","C","y","9"\n'; // key y same value → not a conflict
      const { conflictCount } = buildCubeFixturesJsonl(log);
      expect(conflictCount).toBe(1);
    });
  });
});

describe('extractAttrReads', () => {

  it('parseLog ignores __ATTRREAD__ markers (no unknown-op warning, no diff row)', () => {
    const r = parseLog('"__ATTRREAD__","S","CubeAttrS","}Cubes","Owner","X"\n');
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([]);
  });

  describe('buildAttrReadsJsonl', () => {
    it('serialises captures to JSONL, de-duping repeated keys (last wins)', () => {
      const log =
        '"__ATTRREAD__","S","CubeAttrS","}Cubes","Owner","V1"\n' +
        '"__ATTRREAD__","S","CubeAttrS","}Cubes","Owner","V2"\n' +
        '"__ATTRREAD__","N","CubeAttrN","}Cubes","Rank","5"\n';
      const { jsonl, droppedCount } = buildAttrReadsJsonl(log);
      const rows = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(rows).toEqual([
        { fn: 'cubeattrs', args: ['}Cubes', 'Owner'], value: 'V2' },
        { fn: 'cubeattrn', args: ['}Cubes', 'Rank'], value: 5 },
      ]);
      expect(droppedCount).toBe(0);
    });

    it('returns empty string when there are no captures', () => {
      expect(buildAttrReadsJsonl('"CellPutN","S","x"\n')).toEqual({
        jsonl: '',
        droppedCount: 0,
      });
    });

    it('reports dropped ambiguous numeric attr reads and omits them from the JSONL', () => {
      const log =
        '"__ATTRREAD__","N","CubeAttrN","C","ok","42.5"\n' +
        '"__ATTRREAD__","N","CubeAttrN","C","bad","1.234,56"\n';
      const { jsonl, droppedCount } = buildAttrReadsJsonl(log);
      const rows = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(rows).toEqual([{ fn: 'cubeattrn', args: ['C', 'ok'], value: 42.5 }]);
      expect(droppedCount).toBe(1);
    });
  });
});

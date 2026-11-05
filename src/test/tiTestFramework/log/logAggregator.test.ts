import { describe, it, expect } from 'vitest';
import { aggregateLog, normalizeFilePathMetaRow } from '../../../tiTestFramework/log/logAggregator';
import { cellKey, type LogRow } from '../../../tiTestFramework/log/logSchema';

describe('aggregateLog — cells', () => {
  it('CellPutN sets final value', () => {
    const rows: LogRow[] = [
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 100 },
    ];
    const a = aggregateLog(rows);
    const c = a.cells.get(cellKey('P', ['A']))!;
    expect(c.value).toBe(100);
    expect(c.hasIncrement).toBe(false);
    expect(c.lastOp).toBe('CellPutN');
  });

  it('later CellPutN overwrites earlier', () => {
    const rows: LogRow[] = [
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 100 },
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 200 },
    ];
    const a = aggregateLog(rows);
    expect(a.cells.get(cellKey('P', ['A']))!.value).toBe(200);
  });

  it('CellIncrementN sums on top of base 0', () => {
    const rows: LogRow[] = [
      { op: 'CellIncrementN', cube: 'P', coord: ['A'], value: 10 },
      { op: 'CellIncrementN', cube: 'P', coord: ['A'], value: 5 },
    ];
    const a = aggregateLog(rows);
    const c = a.cells.get(cellKey('P', ['A']))!;
    expect(c.value).toBe(15);
    expect(c.hasIncrement).toBe(true);
  });

  it('CellIncrementN sums on top of CellPutN', () => {
    const rows: LogRow[] = [
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 100 },
      { op: 'CellIncrementN', cube: 'P', coord: ['A'], value: 50 },
    ];
    const a = aggregateLog(rows);
    expect(a.cells.get(cellKey('P', ['A']))!.value).toBe(150);
  });

  it('CellPutN after CellIncrementN resets', () => {
    const rows: LogRow[] = [
      { op: 'CellIncrementN', cube: 'P', coord: ['A'], value: 50 },
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 999 },
    ];
    const a = aggregateLog(rows);
    const c = a.cells.get(cellKey('P', ['A']))!;
    expect(c.value).toBe(999);
    expect(c.hasIncrement).toBe(false);
  });

  it('CellPutS overrides previous numeric value', () => {
    const rows: LogRow[] = [
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 100 },
      { op: 'CellPutS', cube: 'P', coord: ['A'], value: 'hello' },
    ];
    const a = aggregateLog(rows);
    expect(a.cells.get(cellKey('P', ['A']))!.value).toBe('hello');
  });

  it('different coords stay separate', () => {
    const rows: LogRow[] = [
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 1 },
      { op: 'CellPutN', cube: 'P', coord: ['B'], value: 2 },
    ];
    const a = aggregateLog(rows);
    expect(a.cells.size).toBe(2);
  });

  it('different cubes stay separate', () => {
    const rows: LogRow[] = [
      { op: 'CellPutN', cube: 'P', coord: ['A'], value: 1 },
      { op: 'CellPutN', cube: 'F', coord: ['A'], value: 2 },
    ];
    expect(aggregateLog(rows).cells.size).toBe(2);
  });
});

describe('aggregateLog — dim/attr/subset/view/cube ops', () => {
  it('collects DimElement ops in insertion order', () => {
    const rows: LogRow[] = [
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' },
      { op: 'DimElementDelete', dim: 'D', hier: '', name: 'OLD' },
    ];
    const a = aggregateLog(rows);
    expect(a.dimOps).toHaveLength(2);
    expect(a.dimOps[0].op).toBe('DimElementInsert');
  });

  it('collects AttrPut* ops', () => {
    const rows: LogRow[] = [
      { op: 'AttrPutS', dim: 'D', hier: '', element: 'E', attribute: 'A', value: 'v' },
      { op: 'AttrPutN', dim: 'D', hier: '', element: 'E', attribute: 'B', value: 1 },
    ];
    expect(aggregateLog(rows).attrOps).toHaveLength(2);
  });

  it('collects subset ops', () => {
    const rows: LogRow[] = [
      { op: 'SubsetCreate', dim: 'D', hier: '', subset: 'S' },
      { op: 'SubsetElementInsert', dim: 'D', hier: '', subset: 'S', element: 'E', position: 0 },
    ];
    expect(aggregateLog(rows).subsetOps).toHaveLength(2);
  });

  it('collects view + cube ops', () => {
    const rows: LogRow[] = [
      { op: 'ViewCreate', cube: 'P', view: 'V' },
      { op: 'CubeCreate', name: 'NewCube', dimensions: ['D1', 'D2'] },
    ];
    const a = aggregateLog(rows);
    expect(a.viewOps).toHaveLength(1);
    expect(a.cubeOps).toHaveLength(1);
  });

  it('collects Phase-A typed lifecycle ops in correct buckets', () => {
    const rows: LogRow[] = [
      { op: 'DimensionDestroy', name: 'OldDim' },
      { op: 'HierarchyCreate', dim: 'D', hier: 'H' },
      { op: 'HierarchyDestroy', dim: 'D', hier: 'H' },
      { op: 'CubeDestroy', name: 'OldCube' },
      { op: 'CubeDelete', name: 'X' },
      { op: 'RuleDestroy', name: 'X' },
      { op: 'CubeRuleDestroy', name: 'X' },
      { op: 'ViewDelete', cube: 'C', view: 'V' },
      { op: 'ViewDestroy', cube: 'C', view: 'V' },
      { op: 'ViewMDXSet', cube: 'C', view: 'V', mdx: 'SELECT' },
      { op: 'SubsetDestroy', dim: 'D', hier: '', subset: 'S' },
      { op: 'SubsetMDXSet', dim: 'D', hier: '', subset: 'S', mdx: 'SELECT' },
      { op: 'SubsetIsAllSet', dim: 'D', hier: '', subset: 'S', flag: 1 },
      { op: 'SubsetAliasSet', dim: 'D', hier: '', subset: 'S', alias: 'A' },
    ];
    const a = aggregateLog(rows);
    expect(a.dimOps).toHaveLength(3);
    expect(a.cubeOps).toHaveLength(4);
    expect(a.viewOps).toHaveLength(3);
    expect(a.subsetOps).toHaveLength(4);
    expect(a.metaOps).toHaveLength(0);
  });
});

describe('normalizeFilePathMetaRow — file-output path basename', () => {
  it('strips the directory from a Windows path arg (ASCIIOUTPUT)', () => {
    const row = { op: '__ASCIIOUTPUT__', args: ['c:\\workspace\\tm1server\\sales\\logs\\x.txt', 'lalala', 'Hallo'] };
    expect(normalizeFilePathMetaRow(row)).toEqual({ op: '__ASCIIOUTPUT__', args: ['x.txt', 'lalala', 'Hallo'] });
  });

  it('strips the directory from a POSIX path arg (TEXTOUTPUT)', () => {
    const row = { op: '__TEXTOUTPUT__', args: ['/var/tm1/logs/out.csv', 'a', 'b'] };
    expect(normalizeFilePathMetaRow(row).args[0]).toBe('out.csv');
  });

  it('makes capture (full path) and replay (basename) line up to the same key', () => {
    const expected = aggregateLog([{ op: '__ASCIIOUTPUT__', args: ['c:\\srv\\logs\\x.txt', 'lalala', 'Hallo'] }]);
    const actual = aggregateLog([{ op: '__ASCIIOUTPUT__', args: ['x.txt', 'lalala', 'Hallo'] }]);
    expect(expected.metaOps).toEqual(actual.metaOps);
  });

  it('leaves a bare filename untouched', () => {
    const row = { op: '__ASCIIOUTPUT__', args: ['x.txt', 'lalala'] };
    expect(normalizeFilePathMetaRow(row)).toBe(row);
  });

  it('leaves non-file meta ops untouched', () => {
    const row = { op: '__SETOUTPUTCHARSET__', args: ['TM1CS_ISO_8859_1\\weird'] };
    expect(normalizeFilePathMetaRow(row)).toBe(row);
  });

  it('handles empty args', () => {
    const row = { op: '__ASCIIOUTPUTCLOSE__', args: [] };
    expect(normalizeFilePathMetaRow(row)).toBe(row);
  });

  it('canonicalizes negative-zero value args to positive (both diff key and value)', () => {
    // TM1 `NumberToStringEx` keeps `-0`; the source-dump `NumberToString` drops
    // the sign → replay emits `0`. Same number — the `≠` value-diff must vanish.
    const row = { op: '__TEXTOUTPUT__', args: ['exp.txt', '2025', 'ACC_PEND', '-0'] };
    expect(normalizeFilePathMetaRow(row).args).toEqual(['exp.txt', '2025', 'ACC_PEND', '0']);
  });
});

describe('aggregateLog — capture markers', () => {
  it('drops __CALL__ / __PARAM__ / __SUB_LIVE_FALLBACK__ from every bucket', () => {
    // simulateOne relies on this instead of filtering the expected log itself.
    const rows: LogRow[] = [
      { op: '__CALL__', callee: 'sub', callIndex: 0, params: [] },
      { op: '__PARAM__', name: 'p', type: 'S', value: 'x' },
      { op: '__SUB_LIVE_FALLBACK__', line: 1, reason: 'dynamic' },
    ];
    const a = aggregateLog(rows);
    expect(a.cells.size).toBe(0);
    expect([a.dimOps, a.attrOps, a.subsetOps, a.viewOps, a.cubeOps, a.tranOps, a.metaOps].flat()).toEqual([]);
  });
});

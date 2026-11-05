import { describe, it, expect } from 'vitest';
import { NO_VALUE, cellDisplayState, applyCellPatches } from '../../../webviews/objectOverview/overviewCellsPure';
import type { ColumnDef, OverviewRow } from '../../../webviews/objectOverview/overviewTypes';

const lazyNum: ColumnDef = { key: 'cells', label: 'Cells', kind: 'number', lazy: true };
const lazyFlag: ColumnDef = { key: 'hasRules', label: 'Rules', kind: 'flag', lazy: true };
const eager: ColumnDef = { key: 'name', label: 'Name', kind: 'text' };

describe('cellDisplayState', () => {
  it('treats null/undefined on a lazy column as still loading', () => {
    expect(cellDisplayState(lazyNum, null)).toBe('loading');
    expect(cellDisplayState(lazyNum, undefined)).toBe('loading');
    expect(cellDisplayState(lazyFlag, null)).toBe('loading');
  });

  it('treats the NO_VALUE sentinel as resolved-but-empty for every kind', () => {
    // The point of the sentinel: a flag column would otherwise read the string
    // as truthy and render "✓" for a failed fetch.
    expect(cellDisplayState(lazyFlag, NO_VALUE)).toBe('empty');
    expect(cellDisplayState(lazyNum, NO_VALUE)).toBe('empty');
    expect(cellDisplayState(eager, NO_VALUE)).toBe('empty');
  });

  it('does not mistake a falsy real value for loading or empty', () => {
    expect(cellDisplayState(lazyFlag, false)).toBe('value');
    expect(cellDisplayState(lazyNum, 0)).toBe('value');
    expect(cellDisplayState(eager, '')).toBe('value');
  });

  it('never spins on a non-lazy column', () => {
    expect(cellDisplayState(eager, null)).toBe('value');
  });
});

describe('applyCellPatches', () => {
  const rows = (): OverviewRow[] => [
    { id: 'a', isControl: false, cells: { ram: null } },
    { id: 'b', isControl: false, cells: { ram: null } },
  ];

  it('writes the value and the raw sort key', () => {
    const r = rows();
    applyCellPatches(r, [{ rowId: 'a', columnKey: 'ram', value: '1.02 GB', sortValue: 1095216660 }]);
    expect(r[0].cells.ram).toBe('1.02 GB');
    expect(r[0].sortValues?.ram).toBe(1095216660);
  });

  it('keeps a sortValue of 0 (not dropped as falsy)', () => {
    const r = rows();
    applyCellPatches(r, [{ rowId: 'a', columnKey: 'ram', value: '0 B', sortValue: 0 }]);
    expect(r[0].sortValues?.ram).toBe(0);
  });

  it('drops a stale sortValue when a later patch has none', () => {
    // Otherwise the cell displays "—" but still sorts as the old byte count.
    const r = rows();
    applyCellPatches(r, [{ rowId: 'a', columnKey: 'ram', value: '1.02 GB', sortValue: 1095216660 }]);
    applyCellPatches(r, [{ rowId: 'a', columnKey: 'ram', value: NO_VALUE }]);
    expect(r[0].cells.ram).toBe(NO_VALUE);
    expect(r[0].sortValues?.ram).toBeUndefined();
  });

  it('leaves other columns sort keys alone and ignores unknown row ids', () => {
    const r = rows();
    applyCellPatches(r, [
      { rowId: 'a', columnKey: 'ram', value: '1 KB', sortValue: 1024 },
      { rowId: 'a', columnKey: 'cells', value: 5 },
      { rowId: 'ghost', columnKey: 'ram', value: 'x' },
    ]);
    expect(r[0].sortValues?.ram).toBe(1024);
    expect(r[0].cells.cells).toBe(5);
    expect(r.map(x => x.id)).toEqual(['a', 'b']);
  });
});

import { describe, it, expect } from 'vitest';
import {
  KNOWN_OPS,
  isCellOp,
  isDimOp,
  isAttrOp,
  cellKey,
  type LogRow,
} from '../../../tiTestFramework/log/logSchema';

describe('logSchema', () => {
  it('KNOWN_OPS lists all expected op-names', () => {
    expect(KNOWN_OPS.has('CellPutN')).toBe(true);
    expect(KNOWN_OPS.has('CellPutS')).toBe(true);
    expect(KNOWN_OPS.has('CellIncrementN')).toBe(true);
    expect(KNOWN_OPS.has('DimElementInsert')).toBe(true);
    expect(KNOWN_OPS.has('AttrPutN')).toBe(true);
    expect(KNOWN_OPS.has('AttrInsert')).toBe(true);
    expect(KNOWN_OPS.has('AttrDelete')).toBe(true);
    expect(KNOWN_OPS.has('SubsetCreate')).toBe(true);
    expect(KNOWN_OPS.has('ViewCreate')).toBe(true);
    expect(KNOWN_OPS.has('CubeCreate')).toBe(true);
    expect(KNOWN_OPS.has('DimensionCreate')).toBe(true);
  });

  it('rejects unknown ops', () => {
    expect(KNOWN_OPS.has('FooBar')).toBe(false);
    expect(KNOWN_OPS.has('CellGetN')).toBe(false);
  });

  describe('cellKey', () => {
    it('joins cube + coords with tab', () => {
      expect(cellKey('Plan', ['Jan', '2026'])).toBe('Plan\tJan\t2026');
    });

    it('handles empty coord', () => {
      expect(cellKey('Cube', [])).toBe('Cube\t');
    });
  });

  describe('type-guards', () => {
    it('isCellOp narrows correctly', () => {
      const r: LogRow = { op: 'CellPutN', cube: 'C', coord: ['a'], value: 1 };
      expect(isCellOp(r)).toBe(true);
      expect(isDimOp(r)).toBe(false);
      expect(isAttrOp(r)).toBe(false);
    });

    it('isDimOp matches all dim-op variants', () => {
      const a: LogRow = { op: 'DimElementInsert', dim: 'D', hier: '', name: 'N', type: 'N', insertAfter: '' };
      const b: LogRow = { op: 'DimensionCreate', name: 'D' };
      expect(isDimOp(a)).toBe(true);
      expect(isDimOp(b)).toBe(true);
    });

    it('isAttrOp matches AttrPutS, AttrPutN, AttrInsert, AttrDelete', () => {
      const s: LogRow = { op: 'AttrPutS', dim: 'D', hier: '', element: 'E', attribute: 'A', value: 'v' };
      const n: LogRow = { op: 'AttrPutN', dim: 'D', hier: '', element: 'E', attribute: 'A', value: 1 };
      const ins: LogRow = {
        op: 'AttrInsert',
        dim: 'D',
        hier: '',
        element: '',
        attribute: 'A',
        type: 'S',
        prevAttr: '',
      };
      const del: LogRow = { op: 'AttrDelete', dim: 'D', hier: '', element: '', attribute: 'A' };
      expect(isAttrOp(s)).toBe(true);
      expect(isAttrOp(n)).toBe(true);
      expect(isAttrOp(ins)).toBe(true);
      expect(isAttrOp(del)).toBe(true);
    });
  });
});

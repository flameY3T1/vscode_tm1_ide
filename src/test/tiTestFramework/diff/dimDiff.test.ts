import { describe, it, expect } from 'vitest';
import {
  diffOpList,
  dimOpKey,
  attrOpKey,
  subsetOpKey,
  metaOpKey,
} from '../../../tiTestFramework/diff/dimDiff';
import type { DimOp, AttrOp, SubsetOp } from '../../../tiTestFramework/log/logSchema';

describe('metaOpKey', () => {
  it('treats negative-zero args as equal to positive zero', () => {
    // TM1 NumberToStringEx keeps `-0`; the source-dump NumberToString drops the
    // sign → replay emits `0`. Same number, must not diff.
    const exp = { op: '__TEXTOUTPUT__', args: ['exp.txt', '2025', 'M05', 'ACC_PEND', '-0'] };
    const act = { op: '__TEXTOUTPUT__', args: ['exp.txt', '2025', 'M05', 'ACC_PEND', '0'] };
    expect(metaOpKey(exp)).toBe(metaOpKey(act));
  });

  it('leaves non-zero and non-numeric args untouched', () => {
    expect(metaOpKey({ op: 'X', args: ['-0.5', '-01', 'A-0'] })).toBe('X|-0.5|-01|A-0');
  });
});

describe('diffOpList', () => {
  it('reports equal for matching ops', () => {
    const e: DimOp[] = [{ op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' }];
    const a: DimOp[] = [{ op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' }];
    const r = diffOpList(e, a, dimOpKey);
    expect(r.equal).toHaveLength(1);
    expect(r.valueDiff).toHaveLength(0);
  });

  it('reports valueDiff when payload differs but key matches', () => {
    const e: DimOp[] = [{ op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' }];
    const a: DimOp[] = [{ op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'C', insertAfter: '' }];
    const r = diffOpList(e, a, dimOpKey);
    expect(r.valueDiff).toHaveLength(1);
  });

  it('reports missing/extra by key', () => {
    const e: DimOp[] = [
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' },
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'B', type: 'N', insertAfter: '' },
    ];
    const a: DimOp[] = [
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' },
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'C', type: 'N', insertAfter: '' },
    ];
    const r = diffOpList(e, a, dimOpKey);
    expect(r.missing).toHaveLength(1);
    expect(r.extra).toHaveLength(1);
  });

  it('order-independent compare', () => {
    const e: DimOp[] = [
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'A', type: 'N', insertAfter: '' },
      { op: 'DimElementInsert', dim: 'D', hier: '', name: 'B', type: 'N', insertAfter: '' },
    ];
    const a: DimOp[] = [...e].reverse();
    const r = diffOpList(e, a, dimOpKey);
    expect(r.equal).toHaveLength(2);
    expect(r.valueDiff).toHaveLength(0);
  });

  it('attrOpKey distinguishes attribute name', () => {
    const e: AttrOp[] = [{ op: 'AttrPutS', dim: 'D', hier: '', element: 'E', attribute: 'Code', value: 'NR' }];
    const a: AttrOp[] = [{ op: 'AttrPutS', dim: 'D', hier: '', element: 'E', attribute: 'Code', value: 'XX' }];
    const r = diffOpList(e, a, attrOpKey);
    expect(r.valueDiff).toHaveLength(1);
  });

  it('attrOpKey separates same element different attribute', () => {
    const e: AttrOp[] = [{ op: 'AttrPutS', dim: 'D', hier: '', element: 'E', attribute: 'Code', value: 'X' }];
    const a: AttrOp[] = [{ op: 'AttrPutS', dim: 'D', hier: '', element: 'E', attribute: 'Other', value: 'Y' }];
    const r = diffOpList(e, a, attrOpKey);
    expect(r.missing).toHaveLength(1);
    expect(r.extra).toHaveLength(1);
  });

  it('subsetOpKey distinguishes subset + element', () => {
    const e: SubsetOp[] = [
      { op: 'SubsetElementInsert', dim: 'D', hier: '', subset: 'S1', element: 'E1', position: 0 },
    ];
    const a: SubsetOp[] = [
      { op: 'SubsetElementInsert', dim: 'D', hier: '', subset: 'S1', element: 'E1', position: 0 },
    ];
    const r = diffOpList(e, a, subsetOpKey);
    expect(r.equal).toHaveLength(1);
  });

  it('handles empty lists', () => {
    const r = diffOpList<DimOp>([], [], dimOpKey);
    expect(r.equal).toEqual([]);
    expect(r.valueDiff).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
  });

  it('Phase-A: SubsetMDXSet detects mdx valueDiff at same key', () => {
    const e: SubsetOp[] = [
      { op: 'SubsetMDXSet', dim: 'D', hier: '', subset: 'S', mdx: 'SELECT [a]' },
    ];
    const a: SubsetOp[] = [
      { op: 'SubsetMDXSet', dim: 'D', hier: '', subset: 'S', mdx: 'SELECT [b]' },
    ];
    const r = diffOpList(e, a, subsetOpKey);
    expect(r.valueDiff).toHaveLength(1);
    expect(r.equal).toHaveLength(0);
  });

  it('Phase-A: HierarchyCreate vs HierarchyDestroy on same dim/hier are different keys', () => {
    const e: DimOp[] = [{ op: 'HierarchyCreate', dim: 'D', hier: 'H' }];
    const a: DimOp[] = [{ op: 'HierarchyDestroy', dim: 'D', hier: 'H' }];
    const r = diffOpList(e, a, dimOpKey);
    expect(r.missing).toHaveLength(1);
    expect(r.extra).toHaveLength(1);
  });
});

import { describe, it, expect } from 'vitest';
import { buildOpRow } from '../../../tiSimulator/output/opEmitter';

describe('buildOpRow — Dim element ops', () => {
  it('DimensionElementInsert maps to DimElementInsert with empty hier', () => {
    expect(buildOpRow('DimensionElementInsert', ['D', '', 'NewE', 'N'])).toEqual({
      op: 'DimElementInsert',
      dim: 'D',
      hier: '',
      name: 'NewE',
      type: 'N',
      insertAfter: '',
    });
  });

  it('HierarchyElementInsert preserves hier', () => {
    expect(buildOpRow('HierarchyElementInsert', ['D', 'H', 'AfterE', 'NewE', 'N'])).toEqual({
      op: 'DimElementInsert',
      dim: 'D',
      hier: 'H',
      name: 'NewE',
      type: 'N',
      insertAfter: 'AfterE',
    });
  });

  it('DimensionElementDelete', () => {
    expect(buildOpRow('DimensionElementDelete', ['D', 'OldE'])).toEqual({
      op: 'DimElementDelete',
      dim: 'D',
      hier: '',
      name: 'OldE',
    });
  });

  it('DimensionElementComponentAdd preserves numeric weight', () => {
    expect(buildOpRow('DimensionElementComponentAdd', ['D', 'Parent', 'Child', 1.5])).toEqual({
      op: 'DimElementComponentAdd',
      dim: 'D',
      hier: '',
      parent: 'Parent',
      child: 'Child',
      weight: 1.5,
    });
  });

  it('DimensionTopElementInsert maps to DimElementInsert without parent/insertAfter', () => {
    expect(buildOpRow('DimensionTopElementInsert', ['D', 'TopE', 'C'])).toEqual({
      op: 'DimElementInsert',
      dim: 'D',
      hier: '',
      name: 'TopE',
      type: 'C',
      insertAfter: '',
    });
  });

  it('ElementDelete legacy 2-arg vs 3-arg', () => {
    expect(buildOpRow('ElementDelete', ['D', 'E'])).toEqual({
      op: 'DimElementDelete',
      dim: 'D',
      hier: '',
      name: 'E',
    });
    expect(buildOpRow('ElementDelete', ['D', 'H', 'E'])).toEqual({
      op: 'DimElementDelete',
      dim: 'D',
      hier: 'H',
      name: 'E',
    });
  });
});

describe('buildOpRow — Attr ops', () => {
  it('AttrPutS reorders args correctly', () => {
    expect(buildOpRow('AttrPutS', ['hello', 'D', 'Jan', 'Code'])).toEqual({
      op: 'AttrPutS',
      dim: 'D',
      hier: '',
      element: 'Jan',
      attribute: 'Code',
      value: 'hello',
    });
  });

  it('AttrPutN passes numeric value', () => {
    expect(buildOpRow('AttrPutN', [42, 'D', 'Jan', 'Order'])).toEqual({
      op: 'AttrPutN',
      dim: 'D',
      hier: '',
      element: 'Jan',
      attribute: 'Order',
      value: 42,
    });
  });

  it('AttrInsert', () => {
    expect(buildOpRow('AttrInsert', ['D', '', 'Description', 'S'])).toEqual({
      op: 'AttrInsert',
      dim: 'D',
      hier: '',
      element: '',
      attribute: 'Description',
      type: 'S',
      prevAttr: '',
    });
  });

  it('AttrDelete', () => {
    expect(buildOpRow('AttrDelete', ['D', 'OldAttr'])).toEqual({
      op: 'AttrDelete',
      dim: 'D',
      hier: '',
      element: '',
      attribute: 'OldAttr',
    });
  });

  it('CubeAttrInsert (object-type schema, no instance)', () => {
    expect(buildOpRow('CubeAttrInsert', ['', 'Owner', 'S'])).toEqual({
      op: 'CubeAttrInsert',
      prevAttr: '',
      attribute: 'Owner',
      type: 'S',
    });
  });

  it('HierarchySubsetAttrInsert preserves subset context', () => {
    expect(buildOpRow('HierarchySubsetAttrInsert', ['D', 'H', 'S', 'Code', 'S'])).toEqual({
      op: 'HierarchySubsetAttrInsert',
      dim: 'D',
      hier: 'H',
      subset: 'S',
      attribute: 'Code',
      type: 'S',
    });
  });
});

describe('buildOpRow — Subset ops emit as diff rows (live + marker)', () => {
  // Rewriter emits log markers for these ops AND keeps the call live; the
  // simulator's buildOpRow must produce matching rows so the diff sees the
  // subset definitions captured during the live run.
  it('SubsetCreate', () => {
    expect(buildOpRow('SubsetCreate', ['D', 'S'])).toEqual({
      op: 'SubsetCreate',
      dim: 'D',
      hier: '',
      subset: 'S',
    });
  });

  it('SubsetMDXSet', () => {
    expect(buildOpRow('SubsetMDXSet', ['D', 'S', 'SELECT [a]'])).toEqual({
      op: 'SubsetMDXSet',
      dim: 'D',
      hier: '',
      subset: 'S',
      mdx: 'SELECT [a]',
    });
  });

  it('HierarchySubsetCreate preserves hier', () => {
    expect(buildOpRow('HierarchySubsetCreate', ['D', 'H', 'S'])).toEqual({
      op: 'SubsetCreate',
      dim: 'D',
      hier: 'H',
      subset: 'S',
    });
  });

  it('SubsetDelete (non-standard spelling → SubsetDestroy, reversed args)', () => {
    expect(buildOpRow('SubsetDelete', ['S', 'D'])).toEqual({
      op: 'SubsetDestroy',
      dim: 'D',
      hier: '',
      subset: 'S',
    });
  });
});

describe('buildOpRow — View / Cube / Tran ops', () => {
  it('ViewMDXSet', () => {
    expect(buildOpRow('ViewMDXSet', ['C', 'V', 'X'])).toEqual({
      op: 'ViewMDXSet',
      cube: 'C',
      view: 'V',
      mdx: 'X',
    });
  });

  it('ViewSuppressZeroesSet', () => {
    expect(buildOpRow('ViewSuppressZeroesSet', ['C', 'V', 1])).toEqual({
      op: 'ViewSuppressZeroesSet',
      cube: 'C',
      view: 'V',
      flag: 1,
    });
  });

  it('CubeDestroy', () => {
    expect(buildOpRow('CubeDestroy', ['OldCube'])).toEqual({
      op: 'CubeDestroy',
      name: 'OldCube',
    });
  });

  it('CubeCreate variadic dimensions', () => {
    expect(buildOpRow('CubeCreate', ['NewCube', 'D1', 'D2', 'D3'])).toEqual({
      op: 'CubeCreate',
      name: 'NewCube',
      dimensions: ['D1', 'D2', 'D3'],
    });
  });

  it('TranSave / TranDelete', () => {
    expect(buildOpRow('TranSave', ['tx-1'])).toEqual({
      op: 'TranSave',
      transactionId: 'tx-1',
    });
    expect(buildOpRow('TranDelete', ['tx-2'])).toEqual({
      op: 'TranDelete',
      transactionId: 'tx-2',
    });
  });

  it('HierarchyElementSecurityPut reorders (level, dim, hier, elem, group)', () => {
    expect(
      buildOpRow('HierarchyElementSecurityPut', ['Read', 'D', 'H', 'E', 'Group1']),
    ).toEqual({
      op: 'HierarchyElementSecurityPut',
      dim: 'D',
      hier: 'H',
      element: 'E',
      group: 'Group1',
      level: 'Read',
    });
  });
});

describe('buildOpRow — case-insensitive + unknown', () => {
  it('case-insensitive name match', () => {
    expect(buildOpRow('attrinsert', ['D', '', 'A', 'S'])?.op).toBe('AttrInsert');
    expect(buildOpRow('CUBEDESTROY', ['C'])?.op).toBe('CubeDestroy');
  });

  it('returns null for non-mutation builtin', () => {
    expect(buildOpRow('NumberToString', [42])).toBeNull();
    expect(buildOpRow('CellGetN', ['C', 'a', 'b'])).toBeNull();
    expect(buildOpRow('UnknownFn', [])).toBeNull();
  });
});

describe('buildOpRow — file-output marker arg split', () => {
  it('splits bedrock-style pre-formatted row into separate args (strips wrapping quotes)', () => {
    expect(
      buildOpRow('TextOutput', [
        'c:\\export\\out.txt',
        '"2026_01";"Budget";"LOC_Berlin";"EUR";"WorkDaysPerMonth";"21"',
      ]),
    ).toEqual({
      op: '__TEXTOUTPUT__',
      args: [
        'c:\\export\\out.txt',
        '2026_01',
        'Budget',
        'LOC_Berlin',
        'EUR',
        'WorkDaysPerMonth',
        '21',
      ],
    });
  });

  it('passes through when no top-level `;` is present', () => {
    expect(buildOpRow('TextOutput', ['c:\\export\\out.txt', 'singleValue'])).toEqual({
      op: '__TEXTOUTPUT__',
      args: ['c:\\export\\out.txt', 'singleValue'],
    });
  });
});

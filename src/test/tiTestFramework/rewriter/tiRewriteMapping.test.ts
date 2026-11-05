import { describe, it, expect } from 'vitest';
import {
  WRITE_CALL_MAPPINGS,
  findMapping,
  emitTextOutput,
  WRITE_CALL_NAMES_LOWER,
} from '../../../tiTestFramework/rewriter/tiRewriteMapping';

const LOG = 'sLogFile';

describe('tiRewriteMapping', () => {
  describe('findMapping', () => {
    it('finds CellPutN case-insensitively', () => {
      expect(findMapping('CellPutN')?.opName).toBe('CellPutN');
      expect(findMapping('cellputn')?.opName).toBe('CellPutN');
      expect(findMapping('CELLPUTN')?.opName).toBe('CellPutN');
    });

    it('returns undefined for non-write call', () => {
      expect(findMapping('CellGetN')).toBeUndefined();
      expect(findMapping('NumberToString')).toBeUndefined();
    });
  });

  describe('WRITE_CALL_NAMES_LOWER', () => {
    it('contains all mapping names lowercased', () => {
      for (const m of WRITE_CALL_MAPPINGS) {
        expect(WRITE_CALL_NAMES_LOWER.has(m.name.toLowerCase())).toBe(true);
      }
    });
  });

  describe('emitTextOutput — Cell ops', () => {
    it('CellPutN: value first → moves to last with NumberToString', () => {
      const m = findMapping('CellPutN')!;
      const out = emitTextOutput(m, ['100', "'Plan'", "'Jan'", "'2026'", "'Sales'"], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'CellPutN', 'Plan', 'Jan', '2026', 'Sales', NumberToString(100))`,
      );
    });

    it('CellPutS: value first → moves to last as raw string', () => {
      const m = findMapping('CellPutS')!;
      const out = emitTextOutput(m, ["'Hello'", "'Comments'", "'A'", "'B'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'CellPutS', 'Comments', 'A', 'B', 'Hello')`);
    });

    it('CellIncrementN: same shape as CellPutN', () => {
      const m = findMapping('CellIncrementN')!;
      const out = emitTextOutput(m, ['v', "'C'", "'a'", "'b'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'CellIncrementN', 'C', 'a', 'b', NumberToString(v))`);
    });

    it('CellPutN with 0 elements (degenerate but accepted)', () => {
      const m = findMapping('CellPutN')!;
      const out = emitTextOutput(m, ['1', "'Cube'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'CellPutN', 'Cube', NumberToString(1))`);
    });
  });

  describe('emitTextOutput — Dim ops', () => {
    it('DimensionElementInsert: dim, ins, name, type → dim, "", name, type, ins', () => {
      const m = findMapping('DimensionElementInsert')!;
      const out = emitTextOutput(m, ["'D'", "''", "'NewElem'", "'N'"], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'DimElementInsert', 'D', '', 'NewElem', 'N', '')`,
      );
    });

    it('DimensionElementDelete: dim, name → dim, "", name', () => {
      const m = findMapping('DimensionElementDelete')!;
      const out = emitTextOutput(m, ["'D'", "'OldElem'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'DimElementDelete', 'D', '', 'OldElem')`);
    });

    it('DimensionElementComponentAdd: dim, parent, child, weight', () => {
      const m = findMapping('DimensionElementComponentAdd')!;
      const out = emitTextOutput(m, ["'D'", "'P'", "'C'", '1'], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'DimElementComponentAdd', 'D', '', 'P', 'C', NumberToString(1))`,
      );
    });

    it('HierarchyElementInsert: dim, hier, ins, name, type', () => {
      const m = findMapping('HierarchyElementInsert')!;
      const out = emitTextOutput(m, ["'D'", "'H'", "''", "'New'", "'N'"], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'DimElementInsert', 'D', 'H', 'New', 'N', '')`,
      );
    });
  });

  describe('emitTextOutput — Attr ops', () => {
    it('AttrPutS: value, dim, elem, attr → dim, "", elem, attr, value', () => {
      const m = findMapping('AttrPutS')!;
      const out = emitTextOutput(m, ["'NR'", "'D'", "'E'", "'Code'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'AttrPutS', 'D', '', 'E', 'Code', 'NR')`);
    });

    it('AttrPutN: value wrapped with NumberToString', () => {
      const m = findMapping('AttrPutN')!;
      const out = emitTextOutput(m, ['42', "'D'", "'E'", "'Order'"], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'AttrPutN', 'D', '', 'E', 'Order', NumberToString(42))`,
      );
    });

    it('ElementAttrPutS: includes hierarchy', () => {
      const m = findMapping('ElementAttrPutS')!;
      const out = emitTextOutput(m, ["'val'", "'D'", "'H'", "'E'", "'A'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'AttrPutS', 'D', 'H', 'E', 'A', 'val')`);
    });

    it('AttrInsert: dim, prev, name, type → dim, "", "", name, type, prev', () => {
      const m = findMapping('AttrInsert')!;
      const out = emitTextOutput(m, ["'AssetType'", "''", "'Description'", "'S'"], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'AttrInsert', 'AssetType', '', '', 'Description', 'S', '')`,
      );
    });

    it('AttrInsert with non-empty prev attr', () => {
      const m = findMapping('AttrInsert')!;
      const out = emitTextOutput(m, ["'D'", "'OldAttr'", "'NewAttr'", "'N'"], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'AttrInsert', 'D', '', '', 'NewAttr', 'N', 'OldAttr')`,
      );
    });

    it('ElementAttrInsert is alias of AttrInsert', () => {
      const m = findMapping('ElementAttrInsert')!;
      expect(m.opName).toBe('AttrInsert');
      const out = emitTextOutput(m, ["'D'", "''", "'Code'", "'S'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'AttrInsert', 'D', '', '', 'Code', 'S', '')`);
    });

    it('AttrDelete: dim, attr → dim, "", "", attr', () => {
      const m = findMapping('AttrDelete')!;
      const out = emitTextOutput(m, ["'D'", "'OldAttr'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'AttrDelete', 'D', '', '', 'OldAttr')`);
    });

    it('ElementAttrDelete is alias of AttrDelete', () => {
      const m = findMapping('ElementAttrDelete')!;
      expect(m.opName).toBe('AttrDelete');
      const out = emitTextOutput(m, ["'D'", "'A'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'AttrDelete', 'D', '', '', 'A')`);
    });
  });

  describe('emitTextOutput — Schicht 2: lifecycle / destroy', () => {
    it('CubeDestroy: single cube name', () => {
      const m = findMapping('CubeDestroy')!;
      expect(emitTextOutput(m, ["'OldCube'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'CubeDestroy', 'OldCube')`,
      );
    });

    it('DimensionDestroy: single dim name', () => {
      const m = findMapping('DimensionDestroy')!;
      expect(emitTextOutput(m, ["'OldDim'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'DimensionDestroy', 'OldDim')`,
      );
    });

    it('HierarchyCreate: dim + hier', () => {
      const m = findMapping('HierarchyCreate')!;
      expect(emitTextOutput(m, ["'D'", "'NewHier'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'HierarchyCreate', 'D', 'NewHier')`,
      );
    });

    it('ViewMDXSet: cube, view, mdx', () => {
      const m = findMapping('ViewMDXSet')!;
      expect(emitTextOutput(m, ["'C'", "'V'", "'SELECT ...'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'ViewMDXSet', 'C', 'V', 'SELECT ...')`,
      );
    });

    it('SubsetMDXSet: dim, subset, mdx', () => {
      const m = findMapping('SubsetMDXSet')!;
      expect(emitTextOutput(m, ["'D'", "'S'", "'SELECT ...'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'SubsetMDXSet', 'D', '', 'S', 'SELECT ...')`,
      );
    });

    it('SubsetIsAllSet: dim, subset, flag (numeric)', () => {
      const m = findMapping('SubsetIsAllSet')!;
      expect(emitTextOutput(m, ["'D'", "'S'", '1'], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'SubsetIsAllSet', 'D', '', 'S', NumberToString(1))`,
      );
    });

    it('HierarchySubsetCreate: aliased to SubsetCreate opName', () => {
      const m = findMapping('HierarchySubsetCreate')!;
      expect(m.opName).toBe('SubsetCreate');
      expect(emitTextOutput(m, ["'D'", "'H'", "'S'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'SubsetCreate', 'D', 'H', 'S')`,
      );
    });

    it('HierarchySubsetMDXSet: dim, hier, subset, mdx', () => {
      const m = findMapping('HierarchySubsetMDXSet')!;
      expect(emitTextOutput(m, ["'D'", "'H'", "'S'", "'X'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'SubsetMDXSet', 'D', 'H', 'S', 'X')`,
      );
    });

    it('ElementInsert (legacy): aliased to DimElementInsert', () => {
      const m = findMapping('ElementInsert')!;
      expect(m.opName).toBe('DimElementInsert');
      expect(emitTextOutput(m, ["'D'", "''", "'P'", "'NewE'", '1'], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'DimElementInsert', 'D', '', 'NewE', '', '')`,
      );
    });

    it('ElementDelete (legacy 2-arg): aliased to DimElementDelete with empty hier', () => {
      const m = findMapping('ElementDelete')!;
      expect(m.opName).toBe('DimElementDelete');
      expect(emitTextOutput(m, ["'D'", "'OldE'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'DimElementDelete', 'D', '', 'OldE')`,
      );
    });

    it('ElementDelete (legacy 3-arg with hier)', () => {
      const m = findMapping('ElementDelete')!;
      expect(emitTextOutput(m, ["'D'", "'H'", "'OldE'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'DimElementDelete', 'D', 'H', 'OldE')`,
      );
    });

    it('TranSave: txnId', () => {
      const m = findMapping('TranSave')!;
      expect(emitTextOutput(m, ["'tx-123'"], LOG)).toBe(
        `ASCIIOutput(sLogFile, 'TranSave', 'tx-123')`,
      );
    });

    it('RuleDestroy: cube name', () => {
      const m = findMapping('RuleDestroy')!;
      expect(emitTextOutput(m, ["'C'"], LOG)).toBe(`ASCIIOutput(sLogFile, 'RuleDestroy', 'C')`);
    });
  });

  describe('emitTextOutput — Subset/View/Cube ops', () => {
    it('SubsetCreate: dim, subset', () => {
      const m = findMapping('SubsetCreate')!;
      const out = emitTextOutput(m, ["'D'", "'S'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'SubsetCreate', 'D', '', 'S')`);
    });

    it('SubsetElementInsert: dim, subset, elem, pos', () => {
      const m = findMapping('SubsetElementInsert')!;
      const out = emitTextOutput(m, ["'D'", "'S'", "'E'", '0'], LOG);
      expect(out).toBe(
        `ASCIIOutput(sLogFile, 'SubsetElementInsert', 'D', '', 'S', 'E', NumberToString(0))`,
      );
    });

    it('SubsetDeleteAllElements: dim, subset', () => {
      const m = findMapping('SubsetDeleteAllElements')!;
      const out = emitTextOutput(m, ["'D'", "'S'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'SubsetDeleteAllElements', 'D', '', 'S')`);
    });

    it('ViewCreate: cube, view', () => {
      const m = findMapping('ViewCreate')!;
      const out = emitTextOutput(m, ["'C'", "'V'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'ViewCreate', 'C', 'V')`);
    });

    it('ViewZeroOut: cube, view', () => {
      const m = findMapping('ViewZeroOut')!;
      const out = emitTextOutput(m, ["'C'", "'V'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'ViewZeroOut', 'C', 'V')`);
    });

    it('CubeCreate: name + variadic dims', () => {
      const m = findMapping('CubeCreate')!;
      const out = emitTextOutput(m, ["'NewCube'", "'D1'", "'D2'", "'D3'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'CubeCreate', 'NewCube', 'D1', 'D2', 'D3')`);
    });

    it('DimensionCreate: name', () => {
      const m = findMapping('DimensionCreate')!;
      const out = emitTextOutput(m, ["'NewDim'"], LOG);
      expect(out).toBe(`ASCIIOutput(sLogFile, 'DimensionCreate', 'NewDim')`);
    });
  });

  describe('emitTextOutput — generic', () => {
    it('passes args verbatim (no escaping)', () => {
      const m = findMapping('CellPutS')!;
      const out = emitTextOutput(m, ["'multi line'", "'C'", "'A'"], LOG);
      expect(out).toContain(`'multi line'`);
    });
  });
});

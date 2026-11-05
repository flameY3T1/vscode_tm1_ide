import { describe, it, expect } from 'vitest';
import { parseLog, parseCsvLine } from '../../../tiTestFramework/log/logParser';

describe('parseCsvLine', () => {
  it('splits simple comma-separated', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted field with comma', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });

  it('handles doubled-quote escape', () => {
    expect(parseCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
  });

  it('keeps TM1-unescaped embedded quotes inside a field (MDX pattern)', () => {
    // TM1 ASCIIOutput quotes fields with "…" but does NOT double embedded quotes,
    // e.g. an MDX pattern `…, "SITE2024_A12_C")`. A naive parser truncates the field
    // at the first inner quote and drops it; the field must survive intact.
    expect(
      parseCsvLine('"SubsetCreateByMDX","SUB","","{FILTERBYPATTERN( x, "SITE2024_A12_C")}"'),
    ).toEqual(['SubsetCreateByMDX', 'SUB', '', '{FILTERBYPATTERN( x, "SITE2024_A12_C")}']);
  });

  it('preserves empty trailing field', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('preserves empty middle field', () => {
    expect(parseCsvLine('a,,b')).toEqual(['a', '', 'b']);
  });

  it('handles single field', () => {
    expect(parseCsvLine('only')).toEqual(['only']);
  });

  it('handles empty input', () => {
    expect(parseCsvLine('')).toEqual(['']);
  });

  it('handles unicode/umlauts in values', () => {
    expect(parseCsvLine('a,Größe,b')).toEqual(['a', 'Größe', 'b']);
  });

  // TM1's ASCIIOutput writes a single-quote value as `"""` (3 chars: open,
  // literal, close) rather than CSV-standard `""""` (open, escape-pair, close).
  // Both forms must yield the same value `"` and not eat following fields.
  it('handles TM1 three-quote form for single-quote value', () => {
    expect(parseCsvLine('a,""",b')).toEqual(['a', '"', 'b']);
  });

  it('handles standard CSV four-quote form for single-quote value', () => {
    expect(parseCsvLine('a,"""",b')).toEqual(['a', '"', 'b']);
  });

  it('handles TM1 three-quote at end of line', () => {
    expect(parseCsvLine('a,"""')).toEqual(['a', '"']);
  });
});

describe('parseLog mixed delimiters', () => {
  it('parses comma __CALL__ marker and semicolon body in the same file', () => {
    const text =
      '"__CALL__","Sub.A","0","p1","v1"\n' +
      '__SETOUTPUTCHARSET__;c:\\export\\out.txt;TM1CS_UTF8\n' +
      '__TEXTOUTPUT__;c:\\export\\out.txt;"col1";"col2";"v"\n';
    const { rows } = parseLog(text);
    expect(rows.map((r) => r.op)).toEqual([
      '__CALL__',
      '__SETOUTPUTCHARSET__',
      '__TEXTOUTPUT__',
    ]);
    const charsetRow = rows[1] as { op: string; args: string[] };
    expect(charsetRow.args).toEqual(['c:\\export\\out.txt', 'TM1CS_UTF8']);
  });
});

describe('parseLog', () => {
  it('parses a CellPutN line', () => {
    const log = `CellPutN,Plan,Jan,2026,Sales,1000\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([
      { op: 'CellPutN', cube: 'Plan', coord: ['Jan', '2026', 'Sales'], value: 1000 },
    ]);
  });

  it('parses a CellPutS line', () => {
    const log = `CellPutS,Notes,Jan,2026,Hello\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'CellPutS', cube: 'Notes', coord: ['Jan', '2026'], value: 'Hello' },
    ]);
  });

  it('parses CellIncrementN', () => {
    const log = `CellIncrementN,Plan,Jan,Region,100\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'CellIncrementN', cube: 'Plan', coord: ['Jan', 'Region'], value: 100 },
    ]);
  });

  it('parses German-locale decimal-comma values (e.g. "615,39")', () => {
    const log = `"CellIncrementN","Plan","Jan","Region","615,39"\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'CellIncrementN', cube: 'Plan', coord: ['Jan', 'Region'], value: 615.39 },
    ]);
  });

  it('parses negative German-locale decimal-comma values', () => {
    const log = `"CellIncrementN","Plan","Jan","Region","-984,99"\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'CellIncrementN', cube: 'Plan', coord: ['Jan', 'Region'], value: -984.99 },
    ]);
  });

  it('rejects ambiguous thousand-grouped values with both dot and comma', () => {
    const log = `"CellIncrementN","Plan","Jan","Region","1,234.56"\n`;
    const r = parseLog(log);
    // "1,234.56" parses as Number()=NaN, ambiguous → row dropped. Avoids
    // mis-parsing US-locale thousand-grouped values as German decimals.
    expect(r.rows).toEqual([]);
  });

  it('parses DimElementInsert', () => {
    const log = `DimElementInsert,Region,,NewElem,N,\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'DimElementInsert', dim: 'Region', hier: '', name: 'NewElem', type: 'N', insertAfter: '' },
    ]);
  });

  it('parses DimElementComponentAdd with weight', () => {
    const log = `DimElementComponentAdd,Region,,Total,EU,1.5\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'DimElementComponentAdd', dim: 'Region', hier: '', parent: 'Total', child: 'EU', weight: 1.5 },
    ]);
  });

  it('parses AttrPutS + AttrPutN', () => {
    const log = `AttrPutS,Region,,EU,Code,EUR\nAttrPutN,Region,,EU,Order,42\n`;
    const r = parseLog(log);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      op: 'AttrPutS', dim: 'Region', hier: '', element: 'EU', attribute: 'Code', value: 'EUR',
    });
    expect(r.rows[1]).toEqual({
      op: 'AttrPutN', dim: 'Region', hier: '', element: 'EU', attribute: 'Order', value: 42,
    });
  });

  it('parses AttrInsert with empty prev', () => {
    const log = `AttrInsert,AssetType,,,Description,S,\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows[0]).toEqual({
      op: 'AttrInsert',
      dim: 'AssetType',
      hier: '',
      element: '',
      attribute: 'Description',
      type: 'S',
      prevAttr: '',
    });
  });

  it('parses AttrInsert with non-empty prev', () => {
    const log = `AttrInsert,D,,,NewAttr,N,OldAttr\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({
      op: 'AttrInsert',
      dim: 'D',
      hier: '',
      element: '',
      attribute: 'NewAttr',
      type: 'N',
      prevAttr: 'OldAttr',
    });
  });

  it('parses TranSave/Delete + ViewStructUpdate as typed', () => {
    const log = `TranSave,tx-123\nTranDelete,tx-456\nViewStructUpdate,C,V\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ op: 'TranSave', transactionId: 'tx-123' });
    expect(r.rows[1]).toEqual({ op: 'TranDelete', transactionId: 'tx-456' });
    expect(r.rows[2]).toEqual({ op: 'ViewStructUpdate', cube: 'C', view: 'V' });
  });

  it('parses View configuration setters as typed', () => {
    const log =
      `ViewSuppressZeroesSet,C,V,1\nViewZeroSuppressionSet,C,V,0\n` +
      `ViewRowDimensionSet,C,V,Time,1\nViewColumnDimensionSet,C,V,Region,2\n` +
      `ViewTitleDimensionSet,C,V,Year,0\nViewTitleElementSet,C,V,Year,2026\n` +
      `ViewExtractSkipCalcsSet,C,V,1\nViewExtractSkipConsolidatedValuesSet,C,V,1\n` +
      `ViewExtractSkipRuleValuesSet,C,V,0\nViewExtractSkipZeroesSet,C,V,1\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows[0]).toEqual({ op: 'ViewSuppressZeroesSet', cube: 'C', view: 'V', flag: 1 });
    expect(r.rows[2]).toEqual({
      op: 'ViewRowDimensionSet',
      cube: 'C',
      view: 'V',
      dim: 'Time',
      position: 1,
    });
    expect(r.rows[5]).toEqual({
      op: 'ViewTitleElementSet',
      cube: 'C',
      view: 'V',
      dim: 'Year',
      element: '2026',
    });
    expect(r.rows[6]).toEqual({ op: 'ViewExtractSkipCalcsSet', cube: 'C', view: 'V', skip: 1 });
  });

  it('parses CellSecurityCubeCreate/Destroy + DR-Release + HierarchyElementSecurityPut', () => {
    const log =
      `CellSecurityCubeCreate,Plan\nCellSecurityCubeDestroy,Plan\n` +
      `CubeDataReservationRelease,Plan,Jan,2026\nCubeDRRelease,Plan,"Jan,2026"\n` +
      `HierarchyElementSecurityPut,D,H,E,Group1,Read\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows[0]).toEqual({ op: 'CellSecurityCubeCreate', name: 'Plan' });
    expect(r.rows[2]).toEqual({
      op: 'CubeDataReservationRelease',
      name: 'Plan',
      elements: ['Jan', '2026'],
    });
    expect(r.rows[3]).toEqual({
      op: 'CubeDRRelease',
      name: 'Plan',
      elementList: 'Jan,2026',
    });
    expect(r.rows[4]).toEqual({
      op: 'HierarchyElementSecurityPut',
      dim: 'D',
      hier: 'H',
      element: 'E',
      group: 'Group1',
      level: 'Read',
    });
  });

  it('parses object-type Attr* schema mutations as typed', () => {
    const log =
      `CubeAttrInsert,,Owner,S\nCubeAttrDelete,Owner\nDimensionAttrInsert,,Code,S\n` +
      `DimensionAttrDelete,Code\nChoreAttrInsert,,Tag,N\nChoreAttrDelete,Tag\n` +
      `ViewAttrInsert,,Author,S\nViewAttrDelete,Author\nSubsetAttrInsert,,Note,S\n` +
      `SubsetAttrDelete,Note\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toHaveLength(10);
    expect(r.rows[0]).toEqual({
      op: 'CubeAttrInsert',
      prevAttr: '',
      attribute: 'Owner',
      type: 'S',
    });
    expect(r.rows[1]).toEqual({ op: 'CubeAttrDelete', attribute: 'Owner' });
  });

  it('parses HierarchySubsetAttr* with subset context', () => {
    const log =
      `HierarchySubsetAttrInsert,D,H,S,MyAttr,N\nHierarchySubsetAttrDelete,D,H,S,MyAttr\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      {
        op: 'HierarchySubsetAttrInsert',
        dim: 'D',
        hier: 'H',
        subset: 'S',
        attribute: 'MyAttr',
        type: 'N',
      },
      {
        op: 'HierarchySubsetAttrDelete',
        dim: 'D',
        hier: 'H',
        subset: 'S',
        attribute: 'MyAttr',
      },
    ]);
  });

  it('parses DimElementComponentDelete as typed', () => {
    const log = `DimElementComponentDelete,D,,Parent,Child\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({
      op: 'DimElementComponentDelete',
      dim: 'D',
      hier: '',
      parent: 'Parent',
      child: 'Child',
    });
  });

  it('parses CubeDestroy/CubeDelete/CubeRuleDestroy/RuleDestroy as typed', () => {
    const log =
      `CubeDestroy,OldCube\nCubeDelete,X\nCubeRuleDestroy,X\nRuleDestroy,X\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([
      { op: 'CubeDestroy', name: 'OldCube' },
      { op: 'CubeDelete', name: 'X' },
      { op: 'CubeRuleDestroy', name: 'X' },
      { op: 'RuleDestroy', name: 'X' },
    ]);
  });

  it('parses ViewMDXSet/ViewDelete/ViewDestroy as typed', () => {
    const log = `ViewMDXSet,C,V,"SELECT [a]"\nViewDelete,C,V\nViewDestroy,C,V\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'ViewMDXSet', cube: 'C', view: 'V', mdx: 'SELECT [a]' },
      { op: 'ViewDelete', cube: 'C', view: 'V' },
      { op: 'ViewDestroy', cube: 'C', view: 'V' },
    ]);
  });

  it('parses SubsetDestroy/MDXSet/IsAllSet/AliasSet as typed', () => {
    const log =
      `SubsetDestroy,D,,S\nSubsetMDXSet,D,H,S,"SELECT [b]"\nSubsetIsAllSet,D,,S,1\nSubsetAliasSet,D,,S,Alias1\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([
      { op: 'SubsetDestroy', dim: 'D', hier: '', subset: 'S' },
      { op: 'SubsetMDXSet', dim: 'D', hier: 'H', subset: 'S', mdx: 'SELECT [b]' },
      { op: 'SubsetIsAllSet', dim: 'D', hier: '', subset: 'S', flag: 1 },
      { op: 'SubsetAliasSet', dim: 'D', hier: '', subset: 'S', alias: 'Alias1' },
    ]);
  });

  it('parses DimensionDestroy/HierarchyCreate/HierarchyDestroy as typed', () => {
    const log = `DimensionDestroy,OldDim\nHierarchyCreate,D,H\nHierarchyDestroy,D,H\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: 'DimensionDestroy', name: 'OldDim' },
      { op: 'HierarchyCreate', dim: 'D', hier: 'H' },
      { op: 'HierarchyDestroy', dim: 'D', hier: 'H' },
    ]);
  });

  it('parses SubsetElementDelete (typed)', () => {
    const log = `SubsetElementDelete,Dim,,Sub,Elem\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({
      op: 'SubsetElementDelete',
      dim: 'Dim',
      hier: '',
      subset: 'Sub',
      element: 'Elem',
    });
  });

  it('parses AttrDelete', () => {
    const log = `AttrDelete,D,,,OldAttr\n`;
    const r = parseLog(log);
    expect(r.warnings).toEqual([]);
    expect(r.rows[0]).toEqual({
      op: 'AttrDelete',
      dim: 'D',
      hier: '',
      element: '',
      attribute: 'OldAttr',
    });
  });

  it('parses ViewCreate + CubeCreate (variadic dims)', () => {
    const log = `ViewCreate,Plan,V1\nCubeCreate,NewCube,D1,D2,D3\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({ op: 'ViewCreate', cube: 'Plan', view: 'V1' });
    expect(r.rows[1]).toEqual({ op: 'CubeCreate', name: 'NewCube', dimensions: ['D1', 'D2', 'D3'] });
  });

  it('detects __START__ + __END__ markers', () => {
    const log = `__START__,test.log\nCellPutN,P,A,1\n__END__,test.log\n`;
    const r = parseLog(log);
    expect(r.hasStart).toBe(true);
    expect(r.hasEnd).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('skips empty lines', () => {
    const log = `\n\nCellPutN,P,A,1\n\n`;
    const r = parseLog(log);
    expect(r.rows).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it('warns on unknown op', () => {
    const log = `CellPutN,P,A,1\nFooBar,x,y\n`;
    const r = parseLog(log);
    expect(r.rows).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain(`unknown op 'FooBar'`);
  });

  it('warns on malformed row (insufficient args)', () => {
    const log = `CellPutN,Plan\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toContain('malformed');
  });

  it('warns on non-numeric value where numeric expected', () => {
    const log = `CellPutN,Plan,A,not-a-number\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it('handles partial log without __END__ (process aborted)', () => {
    const log = `__START__,t\nCellPutN,P,A,1\n`;
    const r = parseLog(log);
    expect(r.hasStart).toBe(true);
    expect(r.hasEnd).toBe(false);
    expect(r.rows).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const log = `CellPutN,P,A,1\r\nCellPutS,P,A,X\r\n`;
    const r = parseLog(log);
    expect(r.rows).toHaveLength(2);
  });

  it('handles values with embedded comma via quoting', () => {
    const log = `CellPutS,Notes,Jan,"hello, world"\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({
      op: 'CellPutS', cube: 'Notes', coord: ['Jan'], value: 'hello, world',
    });
  });

  it('handles values with embedded quote via doubling', () => {
    const log = `CellPutS,Notes,Jan,"it""s"\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({
      op: 'CellPutS', cube: 'Notes', coord: ['Jan'], value: `it"s`,
    });
  });

  it('handles empty hier field for default-hierarchy dim ops', () => {
    const log = `DimElementDelete,Region,,OldElem\n`;
    const r = parseLog(log);
    expect(r.rows[0]).toEqual({ op: 'DimElementDelete', dim: 'Region', hier: '', name: 'OldElem' });
  });

  it('parses __CALL__ op', () => {
    const log = `"__CALL__","Sub.A","0","pPeriod","Jan","pMode","1"\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: '__CALL__', callee: 'Sub.A', callIndex: 0, params: [['pPeriod', 'Jan'], ['pMode', '1']] },
    ]);
  });

  it('parses __PARAM__ op (string)', () => {
    const log = `"__PARAM__","pPeriod","S","Jan"\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: '__PARAM__', name: 'pPeriod', type: 'S', value: 'Jan' },
    ]);
  });

  it('parses __PARAM__ op (numeric)', () => {
    const log = `"__PARAM__","pMode","N","42"\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: '__PARAM__', name: 'pMode', type: 'N', value: 42 },
    ]);
  });

  it('parses __SUB_LIVE_FALLBACK__ op', () => {
    const log = `"__SUB_LIVE_FALLBACK__","42","dynamic"\n`;
    const r = parseLog(log);
    expect(r.rows).toEqual([
      { op: '__SUB_LIVE_FALLBACK__', line: 42, reason: 'dynamic' },
    ]);
  });
});

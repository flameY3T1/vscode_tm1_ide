import { describe, it, expect } from 'vitest';
import { rewriteSource } from '../../../tiTestFramework/rewriter/tiSourceRewriter';

const LOG = 'sLogFile';

describe('rewriteSource', () => {
  it('logs a CellPutN and keeps the original call so it runs live', () => {
    const src = `CellPutN(100, 'Plan', 'Jan', 'Sales');`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toBe(
      `ASCIIOutput(sLogFile, 'CellPutN', 'Plan', 'Jan', 'Sales', NumberToString(100));\n`
      + `CellPutN(100, 'Plan', 'Jan', 'Sales');`,
    );
    expect(res.writeTargets.cubes).toEqual(['Plan']);
    expect(res.writeTargets.dimensions).toEqual([]);
  });

  it('evaluates a dynamic argument once, so marker and live write see the same value', () => {
    const res = rewriteSource(`CellPutN(RAND(), 'Plan', 'Jan');\nCellPutS(sA | 'x', 'Plan', SUBST(sB, 1, 2));`, LOG);
    expect(res.rewritten).toBe(
      `nTiTestCap1 = RAND();\n`
      + `ASCIIOutput(sLogFile, 'CellPutN', 'Plan', 'Jan', NumberToString(nTiTestCap1));\n`
      + `CellPutN(nTiTestCap1, 'Plan', 'Jan');\n`
      + `sTiTestCap2 = sA | 'x';\nsTiTestCap3 = SUBST(sB, 1, 2);\n`
      + `ASCIIOutput(sLogFile, 'CellPutS', 'Plan', sTiTestCap3, sTiTestCap2);\n`
      + `CellPutS(sTiTestCap2, 'Plan', sTiTestCap3);`,
    );
  });

  it('picks a helper name the process does not use', () => {
    const res = rewriteSource(`nTiTestCap1 = 0;\nCellPutN(RAND(), 'Plan', 'Jan');`, LOG);
    expect(res.rewritten).toContain(`nTiTestCapX1 = RAND();`);
  });

  it('preserves surrounding code', () => {
    const src = [
      `# header comment`,
      `nValue = 42;`,
      `CellPutN(nValue, 'Plan', 'Jan');`,
      `nDone = 1;`,
    ].join('\n');
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`# header comment`);
    expect(res.rewritten).toContain(`nValue = 42;`);
    expect(res.rewritten).toContain(`ASCIIOutput(sLogFile, 'CellPutN', 'Plan', 'Jan', NumberToString(nValue));`);
    expect(res.rewritten).toContain(`nDone = 1;`);
  });

  it('rewrites multiple write-calls in order', () => {
    const src = `CellPutN(1,'A','x'); CellPutS('y','B','x'); CellIncrementN(3,'C','x');`;
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.cubes).toEqual(['A', 'B', 'C']);
    expect(res.rewrittenCalls).toEqual(['cellincrementn', 'cellputn', 'cellputs']);
    expect(res.rewritten).toContain(`'CellPutN', 'A'`);
    expect(res.rewritten).toContain(`'CellPutS', 'B'`);
    expect(res.rewritten).toContain(`'CellIncrementN', 'C'`);
  });

  it('does not touch non-write calls', () => {
    const src = `nVal = CellGetN('Plan', 'Jan'); CellPutN(nVal, 'Plan', 'Feb');`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`CellGetN('Plan', 'Jan')`);
    expect(res.rewritten).toContain(`ASCIIOutput(sLogFile, 'CellPutN', 'Plan', 'Feb', NumberToString(nVal));`);
  });

  it('skips identifiers in strings/comments', () => {
    const src = `s = 'CellPutN(1,2,3)'; # CellPutN(99, 'X')\nCellPutN(1,'A','x');`;
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.cubes).toEqual(['A']);
    expect(res.rewritten).toContain(`'CellPutN(1,2,3)'`);
    expect(res.rewritten).toContain(`# CellPutN(99, 'X')`);
  });

  it('handles dim ops and accumulates write-targets', () => {
    const src = [
      `DimensionElementInsert('Region', '', 'NewElem', 'N');`,
      `AttrPutS('NR', 'Region', 'NewElem', 'Code');`,
      `HierarchyElementInsert('Product', 'Main', '', 'WidgetA', 'N');`,
    ].join('\n');
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.dimensions).toEqual(['Product', 'Region']);
    expect(res.rewritten).toContain(`'DimElementInsert', 'Region', '', 'NewElem', 'N', ''`);
    expect(res.rewritten).toContain(`'AttrPutS', 'Region', '', 'NewElem', 'Code', 'NR'`);
    expect(res.rewritten).toContain(`'DimElementInsert', 'Product', 'Main', 'WidgetA', 'N', ''`);
  });

  it('rewrites previously-unmapped mutation calls (Schicht-2 coverage)', () => {
    const src = [
      `CellPutN(1, 'C', 'a');`,
      `CubeDestroy('OldCube');`,
      `DimensionDestroy('OldDim');`,
      `HierarchyCreate('D', 'NewHier');`,
      `ViewDelete('Cube', 'V');`,
    ].join('\n');
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`'CellPutN', 'C', 'a', NumberToString(1)`);
    expect(res.rewritten).toContain(`'CubeDestroy', 'OldCube'`);
    expect(res.rewritten).toContain(`'DimensionDestroy', 'OldDim'`);
    expect(res.rewritten).toContain(`'HierarchyCreate', 'D', 'NewHier'`);
    // ViewDelete is live-passthrough (view metadata only, no cube data mutation):
    expect(res.rewritten).toContain(`ViewDelete('Cube', 'V');`);
  });

  it('leaves read-only calls untouched', () => {
    const src = [
      `nVal = CellGetN('Cube', 'a', 'b');`,
      `sNm = DIMNM('Dim', 1);`,
    ].join('\n');
    expect(rewriteSource(src, LOG).rewritten).toBe(src);
  });

  it('AttrInsert gets a log marker', () => {
    const src = `AttrInsert('D', '', 'A', 'S');`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`'AttrInsert', 'D', '', '', 'A', 'S', ''`);
  });

  it('rewrites AttrInsert (variable dim name + literal args)', () => {
    const src = [
      `sDim = 'AssetType';`,
      `AttrInsert(sDim, '', 'Description', 'S');`,
      `AttrInsert(sDim, '', 'AssetClass', 'S');`,
      `AttrInsert(sDim, '', 'RefreshCycleMonths', 'N');`,
    ].join('\n');
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`AttrInsert(sDim, '', 'Description', 'S');`);
    expect(res.rewritten).toContain(
      `'AttrInsert', sDim, '', '', 'Description', 'S', ''`,
    );
    expect(res.rewritten).toContain(
      `'AttrInsert', sDim, '', '', 'RefreshCycleMonths', 'N', ''`,
    );
  });

  it('rewrites AttrDelete + ElementAttrInsert / ElementAttrDelete', () => {
    const src = [
      `AttrDelete('D', 'OldAttr');`,
      `ElementAttrInsert('D', '', 'NewAttr', 'S');`,
      `ElementAttrDelete('D', 'GoneAttr');`,
    ].join('\n');
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`'AttrDelete', 'D', '', '', 'OldAttr'`);
    expect(res.rewritten).toContain(`'AttrInsert', 'D', '', '', 'NewAttr', 'S', ''`);
    expect(res.rewritten).toContain(`'AttrDelete', 'D', '', '', 'GoneAttr'`);
  });

  it('keeps SaveDataAll and CubeSaveData — capture is a full live run', () => {
    const src = `SaveDataAll();\nCubeSaveData('Plan');`;
    expect(rewriteSource(src, LOG).rewritten).toBe(src);
  });

  it('detects ExecuteProcess as sub-process warning', () => {
    const src = `ExecuteProcess('Helper', 'p1', 'v1');`;
    const res = rewriteSource(src, LOG);
    expect(res.subProcessCalls).toEqual(['ExecuteProcess']);
    expect(res.rewritten).toContain(`ExecuteProcess('Helper'`);
  });

  it('handles cube create + dimension create', () => {
    const src = `DimensionCreate('NewDim');\nCubeCreate('NewCube', 'D1', 'D2');`;
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.cubes).toEqual(['NewCube']);
    expect(res.writeTargets.dimensions).toEqual(['NewDim']);
  });

  it('returns empty source unchanged with no calls', () => {
    const src = `x = 1 + 2;\ny = x * 3;`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toBe(src);
    expect(res.writeTargets.cubes).toEqual([]);
    expect(res.writeTargets.dimensions).toEqual([]);
  });

  it('dedupes write-targets across multiple calls', () => {
    const src = `CellPutN(1,'Plan','a'); CellPutN(2,'Plan','b'); CellPutS('x','Plan','c');`;
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.cubes).toEqual(['Plan']);
  });

  it('ViewZeroOut stays rewritten (mutates cube data) — tracks cube target', () => {
    // ViewCreate is live-passthrough but ALSO gets a log marker so the diff
    // sees the view definition. The original call remains in source so the
    // clone actually creates the view on TM1 (needed for downstream
    // CUBE-view datasources, e.g. }bedrock.cube.data.export).
    const src = `ViewZeroOut('Plan', 'V1');\nViewCreate('Forecast', 'V2');`;
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.cubes).toEqual(['Forecast', 'Plan']);
    // ViewCreate marker is emitted as ASCIIOutput AND the original call kept:
    expect(res.rewritten).toContain(`ASCIIOutput(${LOG}, 'ViewCreate'`);
    expect(res.rewritten).toContain(`ViewCreate('Forecast', 'V2')`);
    // ViewZeroOut still strips to ASCIIOutput (cube-data mutation):
    expect(res.rewritten).toContain(`ASCIIOutput(${LOG}, 'ViewZeroOut'`);
  });

  it('SubsetCreate + SubsetDeleteAllElements are live + marker (dual output)', () => {
    const src = `SubsetCreate('Region', 'TopN');\nSubsetDeleteAllElements('Product', 'X');`;
    const res = rewriteSource(src, LOG);
    // Targets ARE classified — diff captures them as outputs:
    expect(res.writeTargets.dimensions).toEqual(['Product', 'Region']);
    // Marker emitted AND original call preserved (live execution):
    expect(res.rewritten).toContain(`ASCIIOutput(${LOG}, 'SubsetCreate'`);
    expect(res.rewritten).toContain(`SubsetCreate('Region', 'TopN')`);
    expect(res.rewritten).toContain(`ASCIIOutput(${LOG}, 'SubsetDeleteAllElements'`);
    expect(res.rewritten).toContain(`SubsetDeleteAllElements('Product', 'X')`);
  });

  it('hoists nested function-call args into a helper', () => {
    const src = `CellPutN(StringToNumber('42'), 'Plan', 'Jan');`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`nTiTestCap1 = StringToNumber('42');`);
    expect(res.rewritten).toContain(`'Plan', 'Jan', NumberToString(nTiTestCap1)`);
  });

  it('preserves whitespace/indentation around rewrites', () => {
    const src = `   CellPutN(1, 'Plan', 'Jan');\n   x = 2;`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten.startsWith('   ASCIIOutput')).toBe(true);
    expect(res.rewritten).toContain(`\n   x = 2;`);
  });

  it('handles dynamic cube-name (string variable, not literal)', () => {
    const src = `CellPutN(1, sCube, 'a');`;
    const res = rewriteSource(src, LOG);
    expect(res.writeTargets.cubes).toEqual([]);
    expect(res.rewritten).toContain(`'CellPutN', sCube, 'a', NumberToString(1)`);
  });

  it('handles multiple sub-process calls with deduplication', () => {
    const src = `ExecuteProcess('A'); ExecuteProcess('B'); ExecuteProcess('A');`;
    const res = rewriteSource(src, LOG);
    expect(res.subProcessCalls).toEqual(['ExecuteProcess']);
  });

  it('rewrites case-insensitively', () => {
    const src = `cellputn(1, 'C', 'a');`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`'CellPutN', 'C'`);
    expect(res.writeTargets.cubes).toEqual(['C']);
  });

  it('does not touch IF/WHILE/comments around rewrites', () => {
    const src = `IF(x = 1);\n  CellPutN(100, 'P', 'a');\nENDIF;`;
    const res = rewriteSource(src, LOG);
    expect(res.rewritten).toContain(`IF(x = 1);`);
    expect(res.rewritten).toContain(`ENDIF;`);
    expect(res.rewritten).toContain(`ASCIIOutput(sLogFile, 'CellPutN', 'P', 'a'`);
  });
});

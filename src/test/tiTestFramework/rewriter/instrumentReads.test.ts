import { describe, it, expect } from 'vitest';
import { instrumentReads } from '../../../tiTestFramework/rewriter/instrumentReads';

describe('instrumentReads', () => {
  it('logs a CellGetS assignment with a __CELLREAD__ marker before the statement', () => {
    const src = "sAttr = CELLGETS(sCube, sElem, 'Caption');\n";
    const out = instrumentReads(src, 'sLogFile');

    // marker line is emitted…
    expect(out).toContain("'__CELLREAD__'");
    // …before the original statement…
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('sAttr ='));
    // …re-invoking the same read (string type = 'S'), and the original stays.
    expect(out).toContain("ASCIIOutput(sLogFile, '__CELLREAD__', 'S', sCube, sElem, 'Caption', CELLGETS(sCube, sElem, 'Caption'))");
    expect(out).toContain("sAttr = CELLGETS(sCube, sElem, 'Caption');");
  });

  it('wraps numeric reads (CellGetN) in NumberToString and tags them N', () => {
    const src = 'nVal = CellGetN(sCube, sE1, sE2);\n';
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__CELLREAD__', 'N', sCube, sE1, sE2, NumberToString(CellGetN(sCube, sE1, sE2)));",
    );
  });

  it('inserts the marker after the previous statement boundary, not at file start', () => {
    const src = "x = 1;\nsV = CellGetS(sCube, sE1, sE2);\n";
    const out = instrumentReads(src, 'sLogFile');
    // untouched first statement precedes the marker
    expect(out.indexOf('x = 1;')).toBeLessThan(out.indexOf('__CELLREAD__'));
    // marker precedes the read statement it guards
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('sV = CellGetS'));
  });

  it('leaves source untouched when there are no reads', () => {
    const src = "CellPutN(1, sCube, sE1, sE2);\nDimensionElementInsert('D', '', 'E', 'n');\n";
    expect(instrumentReads(src, 'sLogFile')).toBe(src);
  });

  it('captures each read in a statement with two reads', () => {
    const src = 'n = CellGetN(c, a, b) + CellGetN(c, a, d);\n';
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain('NumberToString(CellGetN(c, a, b))');
    expect(out).toContain('NumberToString(CellGetN(c, a, d))');
  });

  // --- Bug #1: reads nested inside another call / guard must be instrumented ---

  it('captures a read nested inside a write-call argument', () => {
    const src = "CellPutN(CellGetN('S','J','A')*1.1, 'B','J','A');\n";
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain("'__CELLREAD__'");
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__CELLREAD__', 'N', 'S', 'J', 'A', NumberToString(CellGetN('S', 'J', 'A')));",
    );
    // marker precedes the enclosing top-level statement
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('CellPutN('));
    // original statement is preserved
    expect(out).toContain("CellPutN(CellGetN('S','J','A')*1.1, 'B','J','A');");
  });

  it('captures a read nested inside a WHILE guard once at loop entry', () => {
    const src = "WHILE(CellGetN('C','E1','E2')>0);\n";
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__CELLREAD__', 'N', 'C', 'E1', 'E2', NumberToString(CellGetN('C', 'E1', 'E2')));",
    );
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('WHILE('));
  });

  it('captures a read nested inside an IF guard', () => {
    const src = "IF(CellGetS('C','E1','E2')@<>'');\n";
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__CELLREAD__', 'S', 'C', 'E1', 'E2', CellGetS('C', 'E1', 'E2'));",
    );
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('IF('));
  });

  // --- Bug #2: statement-boundary detection must be string/comment aware ---

  it('does not treat a semicolon inside a string literal as a boundary', () => {
    const src = "vV = 'A;B' | CellGetN('C','E1','E2');\n";
    const out = instrumentReads(src, 'sLogFile');
    // the original statement (incl. the string 'A;B') is intact — nothing spliced in
    expect(out).toContain("vV = 'A;B' | CellGetN('C','E1','E2');");
    // and a marker precedes the whole statement
    expect(out).toContain("'__CELLREAD__'");
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('vV ='));
  });

  it('does not treat a semicolon inside a comment as a boundary', () => {
    const src = "vPrev=1;\r\n# skip a;b\r\nvV = CellGetN('C','E1','E2');\n";
    const out = instrumentReads(src, 'sLogFile');
    // the comment line stays intact — the marker is not spliced into it
    expect(out).toContain('# skip a;b');
    expect(out).toContain("'__CELLREAD__'");
    // marker precedes the real read statement
    expect(out.indexOf('__CELLREAD__')).toBeLessThan(out.indexOf('vV = CellGetN'));
  });

  // --- Attribute reads: separate __ATTRREAD__ marker (funcName + all args) ---

  it('logs a CubeAttrS read with an __ATTRREAD__ marker (retType S + funcName)', () => {
    const src = "sX = CubeAttrS(csCube, 'Owner');\n";
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain("'__ATTRREAD__'");
    // marker before the statement…
    expect(out.indexOf('__ATTRREAD__')).toBeLessThan(out.indexOf('sX ='));
    // …fields: retType 'S', funcName 'CubeAttrS', then ALL args, then the re-invoke
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__ATTRREAD__', 'S', 'CubeAttrS', csCube, 'Owner', CubeAttrS(csCube, 'Owner'))",
    );
    expect(out).toContain("sX = CubeAttrS(csCube, 'Owner');");
  });

  it('wraps a numeric attr read (CubeAttrN) in NumberToString and tags it N', () => {
    const src = "n = CubeAttrN(c,'Rank');\n";
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__ATTRREAD__', 'N', 'CubeAttrN', c, 'Rank', NumberToString(CubeAttrN(c, 'Rank')));",
    );
  });

  it('captures an attr read nested inside a write-call argument', () => {
    const src = "CellPutS(CubeAttrS(csCube, 'Owner'), 'B','J','A');\n";
    const out = instrumentReads(src, 'sLogFile');
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__ATTRREAD__', 'S', 'CubeAttrS', csCube, 'Owner', CubeAttrS(csCube, 'Owner'));",
    );
    // marker precedes the enclosing top-level statement
    expect(out.indexOf('__ATTRREAD__')).toBeLessThan(out.indexOf('CellPutS('));
    // original statement is preserved
    expect(out).toContain("CellPutS(CubeAttrS(csCube, 'Owner'), 'B','J','A');");
  });

  it('captures an attr read nested inside an IF guard', () => {
    const src = "IF(CubeAttrN('C','A')=1);\n";
    const out = instrumentReads(src, 'sLogFile');
    // name ends in N → retType 'N'
    expect(out).toContain(
      "ASCIIOutput(sLogFile, '__ATTRREAD__', 'N', 'CubeAttrN', 'C', 'A', NumberToString(CubeAttrN('C', 'A')));",
    );
    expect(out.indexOf('__ATTRREAD__')).toBeLessThan(out.indexOf('IF('));
  });
});

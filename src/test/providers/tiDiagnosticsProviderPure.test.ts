import { describe, it, expect } from 'vitest';
import {
  parseSectionsWithOffsets,
  computeV12DeprecatedRanges,
} from '../../providers/tiDiagnosticsProviderPure';
import { V12_DEPRECATED } from '../../tiLogicVisualizer/tiLinter/versionCompatPure';

describe('parseSectionsWithOffsets', () => {
  it('returns null when no section markers exist (plain .ti)', () => {
    expect(parseSectionsWithOffsets('CellPutN(1, "C", "D");\nProcessQuit;')).toBeNull();
  });

  it('parses all 4 sections with correct line offsets', () => {
    const text = [
      '602,"MyProc"',
      '572,1',
      "PROL := 'p';",
      '573,1',
      "META := 'm';",
      '574,1',
      "DATA := 'd';",
      '575,1',
      "EPIL := 'e';",
    ].join('\n');
    const result = parseSectionsWithOffsets(text);
    expect(result).toHaveLength(4);
    expect(result![0]).toEqual({ section: 'prolog',   code: "PROL := 'p';", lineOffset: 2 });
    expect(result![1]).toEqual({ section: 'metadata', code: "META := 'm';", lineOffset: 4 });
    expect(result![2]).toEqual({ section: 'data',     code: "DATA := 'd';", lineOffset: 6 });
    expect(result![3]).toEqual({ section: 'epilog',   code: "EPIL := 'e';", lineOffset: 8 });
  });

  it('captures multi-line section bodies', () => {
    const text = [
      '572,3',
      'line1;',
      'line2;',
      'line3;',
      '573,0',
    ].join('\n');
    const result = parseSectionsWithOffsets(text);
    expect(result![0].code).toBe('line1;\nline2;\nline3;');
    expect(result![0].lineOffset).toBe(1);
  });

  it('stops a section at non-section trailer markers (576, etc.)', () => {
    const text = [
      '572,1',
      'PROLOG_LINE;',
      '576,trailer-data',
      'should-not-be-included',
    ].join('\n');
    const result = parseSectionsWithOffsets(text);
    expect(result).toHaveLength(1);
    expect(result![0].code).toBe('PROLOG_LINE;');
  });

  it('handles CRLF line endings', () => {
    const text = '572,1\r\nx := 1;\r\n573,0\r\n';
    const result = parseSectionsWithOffsets(text);
    expect(result![0].code).toBe('x := 1;');
  });

  it('handles empty section bodies (572,0)', () => {
    const text = '572,0\n573,0\n574,0\n575,0\n';
    const result = parseSectionsWithOffsets(text);
    expect(result).toHaveLength(4);
    for (const r of result!) { expect(r.code).toBe(''); }
  });
});

describe('V12_DEPRECATED map', () => {
  it('is non-empty (tiSignatures has deprecated entries)', () => {
    expect(V12_DEPRECATED.size).toBeGreaterThan(0);
  });
  it('keys are lowercase', () => {
    for (const key of V12_DEPRECATED.keys()) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});

describe('computeV12DeprecatedRanges', () => {
  const sampleKey = [...V12_DEPRECATED.keys()][0];
  const sampleOriginal = V12_DEPRECATED.get(sampleKey)!;

  it('returns empty array when text has no deprecated calls', () => {
    expect(computeV12DeprecatedRanges('CellPutN(1, "C");')).toEqual([]);
  });

  it('finds deprecated function call and reports line/cols', () => {
    const text = `  ${sampleOriginal}(arg);`;
    const ranges = computeV12DeprecatedRanges(text);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      line: 0,
      startCol: 2,
      endCol: 2 + sampleOriginal.length,
      originalName: sampleOriginal,
    });
  });

  it('finds multiple calls on the same line', () => {
    const text = `${sampleOriginal}(1); x := ${sampleOriginal}(2);`;
    const ranges = computeV12DeprecatedRanges(text);
    expect(ranges).toHaveLength(2);
  });

  it('skips calls inside single-quoted strings', () => {
    const text = `s := '${sampleOriginal}(x)';`;
    expect(computeV12DeprecatedRanges(text)).toEqual([]);
  });

  it('skips calls after # comment', () => {
    const text = `# ${sampleOriginal}(x);`;
    expect(computeV12DeprecatedRanges(text)).toEqual([]);
  });

  it('is case-insensitive', () => {
    const upper = sampleOriginal.toUpperCase();
    const lower = sampleOriginal.toLowerCase();
    const text = `${upper}(1);\n${lower}(2);`;
    const ranges = computeV12DeprecatedRanges(text);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].line).toBe(0);
    expect(ranges[1].line).toBe(1);
    expect(ranges[0].originalName).toBe(sampleOriginal);
  });

  it('respects multi-line input with correct line indexing', () => {
    const text = `// line 0\n${sampleOriginal}(x);\n// line 2\n${sampleOriginal}(y);`;
    const ranges = computeV12DeprecatedRanges(text);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].line).toBe(1);
    expect(ranges[1].line).toBe(3);
  });
});

describe('computeV12DeprecatedRanges — klammerlose Schreibweise', () => {
  // TI makes the parentheses optional for a call without arguments, and the
  // data source pseudo-variables are ASSIGNED instead of called. The
  // opening parenthesis that used to be required therefore let 17 of the 48 removed
  // names slip through completely — neither diagnostic nor strikethrough
  // (measured 2026-08-31).
  it('knows the names this block builds on', () => {
    expect(V12_DEPRECATED.get('savedataall')).toBe('SaveDataAll');
    expect(V12_DEPRECATED.get('datasourceodbocatalog')).toBe('DatasourceODBOCatalog');
  });

  it('reports a zero-argument call WITHOUT parentheses', () => {
    const ranges = computeV12DeprecatedRanges('SaveDataAll;');
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      line: 0,
      startCol: 0,
      endCol: 'SaveDataAll'.length,
      originalName: 'SaveDataAll',
    });
  });

  it('meldet denselben Aufruf weiterhin MIT Klammern', () => {
    expect(computeV12DeprecatedRanges('SaveDataAll();')).toHaveLength(1);
    expect(computeV12DeprecatedRanges('SaveDataAll ( );')).toHaveLength(1);
  });

  it('reports the assignment to a removed data source pseudo-variable', () => {
    const ranges = computeV12DeprecatedRanges("DatasourceODBOCatalog = 'x';");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].originalName).toBe('DatasourceODBOCatalog');
  });

  it('does NOT report when the name is only part of a longer identifier', () => {
    expect(computeV12DeprecatedRanges('SaveDataAllX;')).toEqual([]);
    expect(computeV12DeprecatedRanges('nSaveDataAll = 1;')).toEqual([]);
    expect(computeV12DeprecatedRanges('sSaveDataAll_Alt = 1;')).toEqual([]);
  });

  it('meldet NICHT in doppelten Anfuehrungszeichen (.pro-Kopfzeile)', () => {
    expect(computeV12DeprecatedRanges('602,"SaveDataAll"')).toEqual([]);
    expect(computeV12DeprecatedRanges('LogOutput("INFO", "SaveDataAll");')).toEqual([]);
  });

  it('takes the longest matching name, not the first', () => {
    // BatchUpdateFinish is a prefix of BatchUpdateFinishWait — the
    // alternation is first-match and must not cut short here.
    if (!V12_DEPRECATED.has('batchupdatefinishwait')) { return; }
    const ranges = computeV12DeprecatedRanges('BatchUpdateFinishWait;');
    expect(ranges).toHaveLength(1);
    expect(ranges[0].originalName).toBe('BatchUpdateFinishWait');
    expect(ranges[0].endCol).toBe('BatchUpdateFinishWait'.length);
  });
});

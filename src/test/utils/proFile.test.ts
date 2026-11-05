import { describe, it, expect } from 'vitest';
import { parseSections, toRestVariables, toRestParameters, toRestDataSource, toProHasSecurity } from '../../utils/proFile';

describe('parseSections', () => {
  it('parses all four sections', () => {
    const pro = [
      '572,2',
      'prologLine1',
      'prologLine2',
      '573,1',
      'metadataLine',
      '574,1',
      'dataLine',
      '575,1',
      'epilogLine',
    ].join('\n');

    const out = parseSections(pro);
    expect(out).toEqual({
      prolog: 'prologLine1\nprologLine2',
      metadata: 'metadataLine',
      data: 'dataLine',
      epilog: 'epilogLine',
    });
  });

  it('handles empty sections (count=0)', () => {
    const pro = [
      '572,0',
      '573,0',
      '574,0',
      '575,0',
    ].join('\n');
    expect(parseSections(pro)).toEqual({ prolog: '', metadata: '', data: '', epilog: '' });
  });

  it('reads ALL lines between headers, ignoring count hint', () => {
    const pro = [
      '572,1',
      'a',
      'b',
      'c',
      '573,0',
    ].join('\n');
    expect(parseSections(pro).prolog).toBe('a\nb\nc');
  });

  it('stops at non-section numeric header (576, 930) inside a section', () => {
    const pro = [
      '572,1',
      'p',
      '573,0',
      '574,0',
      '575,1',
      'e',
      '576,0',
      'noise',
    ].join('\n');
    const out = parseSections(pro);
    expect(out.epilog).toBe('e');
  });

  it('strips trailing carriage returns (Windows line endings)', () => {
    const pro = ['572,1', 'line-with-cr\r', '573,0', '574,0', '575,0'].join('\n');
    expect(parseSections(pro).prolog).toBe('line-with-cr');
  });

  it('handles file without any section headers', () => {
    expect(parseSections('602,"Proc"\nrandom')).toEqual({
      prolog: '', metadata: '', data: '', epilog: '',
    });
  });

  it('trims trailing whitespace from each section but preserves internal blank lines', () => {
    const pro = [
      '572,3',
      'a',
      '',
      'b',
      '',
      '',
      '573,0',
    ].join('\n');
    expect(parseSections(pro).prolog).toBe('a\n\nb');
  });

  it('keeps trailing blank lines the count covers (TM1 stores them)', () => {
    const pro = ['572,3', 'a', '', '', '573,1', 'm', '574,0', '575,0', '576,x', '930,0'].join('\n');
    expect(parseSections(pro).prolog).toBe('a\n\n');
    expect(parseSections(pro).metadata).toBe('m');
  });

  it('drops trailing blank lines when the count is too HIGH (hand-shortened section)', () => {
    const pro = ['572,5', 'a', '', '', '573,0', '574,0', '575,0', '576,'].join('\n');
    expect(parseSections(pro).prolog).toBe('a');
  });

  it('keeps a code line that looks like a footer header', () => {
    const pro = ['572,0', '573,0', '574,0', '575,2', 'x = 1;', '930,0', '576,', '930,0'].join('\n');
    expect(parseSections(pro).epilog).toBe('x = 1;\n930,0');
  });

  it('reads past a count that is too low (Bedrock string.validate: 572,185 over 189 lines)', () => {
    const pro = ['572,2', 'WHILE(1=1);', 'n = 1;', 'END;', '#EndRegion', '', '573,0', '574,0', '575,0', '576,'].join('\n');
    expect(parseSections(pro).prolog).toBe('WHILE(1=1);\nn = 1;\nEND;\n#EndRegion');
  });

  it('parses multiple section headers in order', () => {
    const pro = [
      '572,1', 'P1',
      '573,2', 'M1', 'M2',
      '574,1', 'D1',
      '575,1', 'E1',
    ].join('\n');
    expect(parseSections(pro)).toEqual({
      prolog: 'P1', metadata: 'M1\nM2', data: 'D1', epilog: 'E1',
    });
  });
});

describe('toRestVariables', () => {
  it('parses 577 (names) + 578 (types) into REST variables', () => {
    const pro = [
      '577,2',
      'V1',
      'V2',
      '578,2',
      '1',
      '2',
      '572,0',
    ].join('\n');
    expect(toRestVariables(pro)).toEqual([
      { Name: 'V1', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 0 },
      { Name: 'V2', Type: 'String',  Position: 2, StartByte: 0, EndByte: 0 },
    ]);
  });

  it('parses full var block (577–581)', () => {
    const pro = [
      '577,1', 'X',
      '578,1', '1',
      '579,1', '5',
      '580,1', '10',
      '581,1', '20',
      '572,0',
    ].join('\n');
    expect(toRestVariables(pro)).toEqual([
      { Name: 'X', Type: 'Numeric', Position: 5, StartByte: 10, EndByte: 20 },
    ]);
  });

  it('defaults type to String when missing or zero', () => {
    const pro = [
      '577,2', 'A', 'B',
      '578,2', '0', '',
      '572,0',
    ].join('\n');
    const out = toRestVariables(pro);
    expect(out[0].Type).toBe('String');
    expect(out[1].Type).toBe('String');
  });

  it('defaults Position to (idx+1) when 579 is missing', () => {
    const pro = ['577,3', 'A', 'B', 'C', '572,0'].join('\n');
    const out = toRestVariables(pro);
    expect(out.map(v => v.Position)).toEqual([1, 2, 3]);
  });

  it('returns empty array when no 577 block exists', () => {
    expect(toRestVariables('572,0\n')).toEqual([]);
  });

  it('only scans pre-prolog block (ignores 577 INSIDE prolog section)', () => {
    const pro = [
      '572,2',
      '577,1',
      'shouldNotBeVar',
    ].join('\n');
    expect(toRestVariables(pro)).toEqual([]);
  });

  it('handles file without 572 header (scans entire file)', () => {
    const pro = ['577,1', 'X', '578,1', '2'].join('\n');
    const out = toRestVariables(pro);
    expect(out).toEqual([
      { Name: 'X', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 },
    ]);
  });

  it('handles Windows CRLF line endings', () => {
    const pro = '577,1\r\nVarA\r\n578,1\r\n1\r\n572,0\r\n';
    expect(toRestVariables(pro)).toEqual([
      { Name: 'VarA', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 0 },
    ]);
  });

  it('truncates types array shorter than names array → fallback to String', () => {
    const pro = [
      '577,3', 'A', 'B', 'C',
      '578,1', '1',
      '572,0',
    ].join('\n');
    const out = toRestVariables(pro);
    expect(out[0].Type).toBe('Numeric');
    expect(out[1].Type).toBe('String');
    expect(out[2].Type).toBe('String');
  });
});

// ─── toRestParameters ──────────────────────────────────────────────────────────
// Fixture: trimmed header from real Bedrock.Cube.Clone.pro (NULL datasource, 7 params)
const CLONE_PRO_HEADER = [
  '601,100',
  '602,"Bedrock.Cube.Clone"',
  '562,"NULL"',
  '559,1',
  '569,0',
  '560,7',
  'pSourceCube',
  'pTargetCube',
  'pIncludeRules',
  'pIncludeData',
  'pSourceView',
  'pRuleValues',
  'pDebug',
  '561,7',
  '2',
  '2',
  '1',
  '1',
  '2',
  '1',
  '1',
  '590,7',
  'pSourceCube,""',
  'pTargetCube,""',
  'pIncludeRules,1',
  'pIncludeData,0',
  'pSourceView,""',
  'pRuleValues,1',
  'pDebug,0',
  '637,7',
  'pSourceCube,"Source Cube"',
  'pTargetCube,"Target Cube to create/re-create"',
  'pIncludeRules,"Include cube rules? (Boolean Yes = 1)"',
  'pIncludeData,"Include cube data? (Boolean Yes = 1)"',
  'pSourceView,"Source View (blank = whole cube If pIncludeData=1)"',
  'pRuleValues,"Skip rule values? (1=skip)"',
  'pDebug,"Debug Mode"',
  '577,0',
  '572,82',
].join('\n');

describe('toRestParameters', () => {
  it('extracts 7 parameters from real Bedrock.Cube.Clone.pro header', () => {
    const params = toRestParameters(CLONE_PRO_HEADER);
    expect(params).toHaveLength(7);
  });

  it('maps type 2 to String and type 1 to Numeric', () => {
    const params = toRestParameters(CLONE_PRO_HEADER);
    expect(params[0]).toMatchObject({ Name: 'pSourceCube', Type: 'String' });
    expect(params[2]).toMatchObject({ Name: 'pIncludeRules', Type: 'Numeric' });
    expect(params[3]).toMatchObject({ Name: 'pIncludeData', Type: 'Numeric' });
  });

  it('extracts default values from 590 block', () => {
    const params = toRestParameters(CLONE_PRO_HEADER);
    expect(params[0].Value).toBe('');
    expect(params[2].Value).toBe(1);
    expect(params[3].Value).toBe(0);
    expect(params[6].Value).toBe(0);
  });

  it('unescapes doubled quotes in defaults and prompts', () => {
    const pro = ['560,1', 'pQuote', '561,1', '2', '590,1', 'pQuote,""""', '637,1', 'pQuote,"no ""+"" first"', '572,0'].join('\n');
    expect(toRestParameters(pro)[0]).toMatchObject({ Value: '"', Prompt: 'no "+" first' });
  });

  it('extracts prompts from 637 block', () => {
    const params = toRestParameters(CLONE_PRO_HEADER);
    expect(params[0].Prompt).toBe('Source Cube');
    expect(params[1].Prompt).toBe('Target Cube to create/re-create');
    expect(params[6].Prompt).toBe('Debug Mode');
  });

  it('returns empty array when no 560 block exists', () => {
    expect(toRestParameters('602,"NoParams"\n572,0\n')).toEqual([]);
  });

  it('handles VIEW datasource file (real Bedrock.Cube.Data.Copy.pro header)', () => {
    // Trimmed header from real Bedrock.Cube.Data.Copy.pro: 11 params, VIEW datasource
    const copy_header = [
      '601,100',
      '602,"Bedrock.Cube.Data.Copy"',
      '562,"VIEW"',
      '559,1',
      '560,11',
      'pCube',
      'pViewSource',
      'pViewTarget',
      'pDimension',
      'pSourceElement',
      'pTargetElement',
      'pSkipRules',
      'pZeroTarget',
      'pZeroSource',
      'pDestroyTempObj',
      'pDebug',
      '561,11',
      '2', '2', '2', '2', '2', '2', '1', '1', '1', '1', '1',
      '590,11',
      'pCube,""',
      'pViewSource,""',
      'pViewTarget,""',
      'pDimension,""',
      'pSourceElement,""',
      'pTargetElement,""',
      'pSkipRules,1',
      'pZeroTarget,1',
      'pZeroSource,0',
      'pDestroyTempObj,1',
      'pDebug,0',
      '637,11',
      'pCube,"Cube"',
      'pViewSource,"Temporary view name for source"',
      'pViewTarget,"Temporary view name for target"',
      'pDimension,"Dimension to Copy Data"',
      'pSourceElement,"Source Element"',
      'pTargetElement,"Target Element"',
      'pSkipRules,"Skip Rule Values? (1=Skip)"',
      'pZeroTarget,"Zero out Target Element PRIOR to Copy? (Boolean 1=True)"',
      'pZeroSource,"Zero out Source Element AFTER Copy? (Boolean 1=True)"',
      'pDestroyTempObj,"Delete temporary view and Subset ( 0 = Retain View and Subsets 1 = Delete View and Subsets 2 = Delete View only )"',
      'pDebug,"Debug Mode"',
      '577,51',
      '572,0',
    ].join('\n');
    const params = toRestParameters(copy_header);
    expect(params).toHaveLength(11);
    expect(params[0]).toMatchObject({ Name: 'pCube', Type: 'String', Value: '', Prompt: 'Cube' });
    expect(params[6]).toMatchObject({ Name: 'pSkipRules', Type: 'Numeric', Value: 1 });
  });

  it('only scans pre-prolog block (ignores 560 INSIDE 572 section)', () => {
    const pro = [
      '572,5',
      '560,1',
      'shouldNotBeParam',
    ].join('\n');
    expect(toRestParameters(pro)).toEqual([]);
  });

  it('returns params with empty Prompt when 637 block is absent', () => {
    const pro = [
      '560,2',
      'pA',
      'pB',
      '561,2',
      '1',
      '2',
      '590,2',
      'pA,42',
      'pB,""',
      '572,0',
    ].join('\n');
    const params = toRestParameters(pro);
    expect(params[0].Prompt).toBe('');
    expect(params[1].Prompt).toBe('');
  });

  it('returns params with default Value 0 when 590 block is absent', () => {
    const pro = ['560,1', 'pX', '561,1', '1', '572,0'].join('\n');
    const params = toRestParameters(pro);
    expect(params[0].Value).toBe(0);
  });
});

// ─── toRestDataSource ──────────────────────────────────────────────────────────
describe('toRestDataSource', () => {
  it('maps NULL datasource to Type None', () => {
    expect(toRestDataSource(CLONE_PRO_HEADER)).toMatchObject({ Type: 'None' });
  });

  it('maps VIEW datasource to Type TM1CubeView', () => {
    const pro = '602,"X"\n562,"VIEW"\n572,0\n';
    expect(toRestDataSource(pro)).toMatchObject({ Type: 'TM1CubeView' });
  });

  it('maps SUBSET datasource to Type TM1DimensionSubset', () => {
    const pro = '562,"SUBSET"\n572,0\n';
    expect(toRestDataSource(pro)).toMatchObject({ Type: 'TM1DimensionSubset' });
  });

  it('maps CHARACTERDELIMITED datasource to Type ASCII', () => {
    const pro = '562,"CHARACTERDELIMITED"\n572,0\n';
    expect(toRestDataSource(pro)).toMatchObject({ Type: 'ASCII' });
  });

  it('maps ODBC datasource to Type ODBC', () => {
    const pro = '562,"ODBC"\n572,0\n';
    expect(toRestDataSource(pro)).toMatchObject({ Type: 'ODBC' });
  });

  it('defaults to None when no 562 code present', () => {
    expect(toRestDataSource('602,"X"\n572,0\n')).toMatchObject({ Type: 'None' });
  });

  it('is case-insensitive for datasource type token', () => {
    const pro = '562,"view"\n572,0\n';
    expect(toRestDataSource(pro)).toMatchObject({ Type: 'TM1CubeView' });
  });
});

describe('toProHasSecurity', () => {
  it('reads footer line 1217, undefined when absent', () => {
    expect(toProHasSecurity(['575,0', '576,', '1217,1'].join('\r\n'))).toBe(true);
    expect(toProHasSecurity(['575,0', '576,', '1217,0'].join('\n'))).toBe(false);
    expect(toProHasSecurity(['575,0', '576,'].join('\n'))).toBeUndefined();
  });

  it('ignores a 1217 line inside a code section', () => {
    expect(toProHasSecurity(['575,1', '1217,1'].join('\n'))).toBeUndefined();
  });
});

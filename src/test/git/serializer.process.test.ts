import { describe, it, expect } from 'vitest';
import { serializeProcess, parseProcess, type TM1Process } from '../../git/serializer';
import type { DataSource, ProcessParameter, ProcessVariable } from '../../tm1Client';

function makeProcess(overrides: Partial<TM1Process> = {}): TM1Process {
  return {
    name: 'TestProcess',
    prolog: 'sP1();',
    metadata: 'sM1();',
    data: 'sD1();',
    epilog: 'sE1();',
    parameters: [],
    variables: [],
    dataSource: { Type: 'None' },
    hasSecurity: false,
    ...overrides,
  };
}

describe('serializer (process)', () => {
  describe('serializeProcess', () => {
    it('emits tiText byte-identical to the server Code blob (native markers, CRLF)', () => {
      const { tiText } = serializeProcess(makeProcess());
      expect(tiText).toBe([
        '#region Prolog', 'sP1();', '#endregion',
        '#region Metadata', 'sM1();', '#endregion',
        '#region Data', 'sD1();', '#endregion',
        '#region Epilog', 'sE1();', '#endregion',
      ].join('\r\n'));
    });

    it('refuses a code file with damaged markers instead of pushing empty tabs', () => {
      const { headerJson } = serializeProcess(makeProcess());
      expect(() => parseProcess('#region Prolog\nsP1();', headerJson)).toThrow(/damaged/);
    });

    it('emits headerJson as parseable JSON without a version field (pure TM1-OData shape)', () => {
      const p = makeProcess();
      const { headerJson } = serializeProcess(p);
      const obj = JSON.parse(headerJson);
      expect(obj.Name).toBe('TestProcess');
      expect(obj.version).toBeUndefined();
    });

    it('writes HasSecurityAccess top-level (not nested under uiState)', () => {
      const { headerJson } = serializeProcess(makeProcess({ hasSecurity: true }));
      const obj = JSON.parse(headerJson);
      expect(obj.HasSecurityAccess).toBe(true);
      expect(obj.uiState).toBeUndefined();
    });

    it('normalizes parameter and variable sub-object keys to the TM1-OData order', () => {
      // Input keys deliberately out of TM1 order; serializer must reorder them.
      const p = makeProcess({
        parameters: [{ Name: 'p1', Type: 'Numeric', Value: '1', Prompt: 'P' }],
        variables: [{ Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      });
      const obj = JSON.parse(serializeProcess(p).headerJson);
      expect(Object.keys(obj.Parameters[0])).toEqual(['Name', 'Prompt', 'Value', 'Type']);
      expect(Object.keys(obj.Variables[0])).toEqual(['Name', 'Type', 'Position', 'StartByte', 'EndByte']);
    });

    it('parses legacy v1 header (uiState.hasSecurity) as fallback', () => {
      const tiText = '#region prolog\n\n#endregion prolog';
      const legacy = JSON.stringify({
        version: 1, name: 'Old', parameters: [], datasource: { Type: 'None' },
        variables: [], uiState: { hasSecurity: true },
      });
      expect(parseProcess(tiText, legacy).hasSecurity).toBe(true);
    });

    it('includes parameters in headerJson', () => {
      const params: ProcessParameter[] = [
        { Name: 'pYear', Type: 'Numeric', Value: '2026', Prompt: 'Jahr' },
      ];
      const p = makeProcess({ parameters: params });
      const { headerJson } = serializeProcess(p);
      const obj = JSON.parse(headerJson);
      expect(obj.Parameters).toEqual(params);
    });

    it('includes variables in headerJson', () => {
      const vars: ProcessVariable[] = [
        { Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 },
      ];
      const p = makeProcess({ variables: vars });
      const { headerJson } = serializeProcess(p);
      const obj = JSON.parse(headerJson);
      expect(obj.Variables).toEqual(vars);
    });

    it('preserves dataSource shape (ASCII)', () => {
      const ds: DataSource = {
        Type: 'ASCII',
        dataSourceNameForServer: 'data.csv',
        Delimiter: ',',
        QuoteCharacter: '"',
      };
      const p = makeProcess({ dataSource: ds });
      const { headerJson } = serializeProcess(p);
      expect(JSON.parse(headerJson).DataSource).toEqual(ds);
    });

    it('preserves dataSource shape (ODBC)', () => {
      const ds: DataSource = {
        Type: 'ODBC',
        dataSourceNameForServer: 'MyDsn',
        UserName: 'user',
        Query: 'SELECT * FROM T',
      };
      const p = makeProcess({ dataSource: ds });
      const { headerJson } = serializeProcess(p);
      expect(JSON.parse(headerJson).DataSource).toEqual(ds);
    });

    it('preserves dataSource shape (TM1CubeView)', () => {
      const ds: DataSource = { Type: 'TM1CubeView', view: 'Sales' };
      const p = makeProcess({ dataSource: ds });
      const { headerJson } = serializeProcess(p);
      expect(JSON.parse(headerJson).DataSource).toEqual(ds);
    });

    it('handles parameter prompt with umlauts and quotes', () => {
      const params: ProcessParameter[] = [
        { Name: 'p1', Type: 'String', Value: '', Prompt: 'Größe "Maximal"' },
      ];
      const p = makeProcess({ parameters: params });
      const { headerJson } = serializeProcess(p);
      const obj = JSON.parse(headerJson);
      expect(obj.Parameters[0].Prompt).toBe('Größe "Maximal"');
    });
  });

  describe('parseProcess', () => {
    it('reconstructs process from serialized form', () => {
      // Tabs end in a break, as TM1 11.x stores what it reads from a Code blob.
      const original = makeProcess({
        prolog: 'sP1();\n', metadata: 'sM1();\n', data: 'sD1();\n', epilog: 'sE1();\n',
        parameters: [{ Name: 'p1', Type: 'String', Value: 'hi', Prompt: 'Test' }],
        variables: [{ Name: 'v1', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 0 }],
      });
      const { tiText, headerJson } = serializeProcess(original);
      const parsed = parseProcess(tiText, headerJson);
      expect(parsed).toEqual(original);
    });

    it('throws on a header without a Name', () => {
      const headerJson = JSON.stringify({ DataSource: { Type: 'None' } });
      expect(() => parseProcess('', headerJson)).toThrow(/Name/i);
    });

    it('throws on malformed json', () => {
      expect(() => parseProcess('', '{not-json')).toThrow();
    });
  });

  describe('round-trip', () => {
    it('preserves empty process (no parameters/variables, empty sections)', () => {
      const p = makeProcess({
        prolog: '', metadata: '', data: '', epilog: '',
      });
      const { tiText, headerJson } = serializeProcess(p);
      expect(parseProcess(tiText, headerJson)).toEqual(p);
    });

    it('preserves complex process with all features', () => {
      const p = makeProcess({
        name: 'Complex_Process_2026',
        prolog: 'sLogOutput("INFO", "start");\nsP();\n',
        metadata: '',
        data: 'CellPutN(1, "Sales", "Jan", "USD");\n',
        epilog: 'sLogOutput("INFO", "done");\n',
        parameters: [
          { Name: 'pYear', Type: 'Numeric', Value: '2026', Prompt: 'Jahr' },
          { Name: 'pMonth', Type: 'String', Value: 'Jan', Prompt: 'Monat' },
        ],
        variables: [
          { Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 },
          { Name: 'v2', Type: 'Numeric', Position: 2, StartByte: 0, EndByte: 0 },
        ],
        dataSource: { Type: 'ASCII', dataSourceNameForServer: 'in.csv', Delimiter: ';' },
        hasSecurity: true,
      });
      const { tiText, headerJson } = serializeProcess(p);
      expect(parseProcess(tiText, headerJson)).toEqual(p);
    });
  });
});

describe('serializeProcess — the two undeclared lists', () => {
  const base = {
    name: 'P', prolog: 'a', metadata: '', data: '', epilog: '',
    parameters: [], variables: [], dataSource: { Type: 'None' } as any, hasSecurity: false,
  };

  it('stores them once per process and in the TM1 REST key order, with a trailing newline', () => {
    // The order the server sends for every process (366 of 366 on 11.8,
    // independent of the `$select` order). Bedrock files put VariablesUIData
    // last; that is not the server's order.
    const { headerJson } = serializeProcess({
      ...base,
      variablesUiData: ['VarType=32\fColType=827\f'],
      uiData: 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f',
    });
    expect(Object.keys(JSON.parse(headerJson))).toEqual([
      'Name', 'HasSecurityAccess', 'UIData', 'VariablesUIData', 'DataSource', 'Parameters', 'Variables',
    ]);
    expect(headerJson.endsWith('}\n')).toBe(true);
  });

  it('puts them at the end for TM1 12, as 12.5.9 sends them (102 of 102)', () => {
    const { headerJson } = serializeProcess({
      ...base, v12: true, variablesUiData: ['VarType=32\fColType=827\f'], uiData: 'x',
    });
    expect(Object.keys(JSON.parse(headerJson))).toEqual([
      'Name', 'HasSecurityAccess', 'DataSource', 'Parameters', 'Variables', 'UIData', 'VariablesUIData',
    ]);
  });

  it('writes TM1 12\'s code layout: always a line break before #endregion', () => {
    const { tiText } = serializeProcess({ ...base, prolog: 'a;\r\n', v12: true });
    expect(tiText).toBe('#region Prolog\r\na;\r\n\r\n#endregion');
  });

  it('omits both when unknown instead of claiming an empty value', () => {
    // `undefined` means "do not touch"; a `[]` in the header would delete
    // the ignore marks on the server during push.
    const header = JSON.parse(serializeProcess(base).headerJson);
    expect('VariablesUIData' in header).toBe(false);
    expect('UIData' in header).toBe(false);
  });

  it('round-trips both through parseProcess', () => {
    const { tiText, headerJson } = serializeProcess({
      ...base,
      variablesUiData: ['VarType=32\fColType=827\f', 'IgnoredInputVarName=x\fVarType=32\fColType=1165\f'],
      uiData: 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f',
    });
    const back = parseProcess(tiText, headerJson);
    expect(back.variablesUiData).toHaveLength(2);
    expect(back.uiData).toBe('CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f');
  });

  it('carries an odd UIData through verbatim instead of parsing it', () => {
    // Values measured live (11.8, processUiDataProbe.js):
    // `CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f`, for 36 processes
    // additionally `_ParameterConstraints=e30=`. The separator is U+000C — except for exactly
    // one Bedrock process (`}bedrock.cube.data.copy.intercube`), which
    // uses a literal `?`. We never read the value, we pass it through;
    // this guard pins down that it stays that way.
    const odd = 'CubeAction=1511?DataAction=1503?CubeLogChanges=0?';
    const { tiText, headerJson } = serializeProcess({ ...base, uiData: odd });
    expect(parseProcess(tiText, headerJson).uiData).toBe(odd);
  });

  it('leaves both undefined for a header written before 2026-08-30', () => {
    const back = parseProcess('#region Prolog\n\n#endregion', JSON.stringify({ Name: 'P', Variables: [] }));
    expect(back.variablesUiData).toBeUndefined();
    expect(back.uiData).toBeUndefined();
  });
});

/**
 * The difference between "says nothing" and "none" must survive the header
 * file — on push it decides whether the server parameters stay or
 * get deleted.
 */
describe('parseProcess/serializeProcess — Parameters: undefined versus []', () => {
  const ti = '#region prolog\nsP();\n#endregion\n#region metadata\n#endregion\n#region data\n#endregion\n#region epilog\n#endregion\n';

  it('reads a header without the key as "says nothing"', () => {
    const p = parseProcess(ti, JSON.stringify({ Name: 'P', Variables: [] }));
    expect(p.parameters).toBeUndefined();
  });

  it('reads an explicitly empty list as "no parameters"', () => {
    const p = parseProcess(ti, JSON.stringify({ Name: 'P', Parameters: [], Variables: [] }));
    expect(p.parameters).toEqual([]);
  });

  it('writes no key for "says nothing" and an empty list for "none"', () => {
    const base = { name: 'P', prolog: '', metadata: '', data: '', epilog: '', variables: [], dataSource: { Type: 'None' }, hasSecurity: false };
    const silent = JSON.parse(serializeProcess({ ...base, parameters: undefined } as never).headerJson) as Record<string, unknown>;
    expect(silent).not.toHaveProperty('Parameters');
    const empty = JSON.parse(serializeProcess({ ...base, parameters: [] } as never).headerJson) as Record<string, unknown>;
    expect(empty.Parameters).toEqual([]);
  });

  it('round-trips both states unchanged', () => {
    const base = { name: 'P', prolog: '', metadata: '', data: '', epilog: '', variables: [], dataSource: { Type: 'None' }, hasSecurity: false };
    for (const parameters of [undefined, []] as const) {
      const out = serializeProcess({ ...base, parameters } as never);
      expect(parseProcess(out.tiText, out.headerJson).parameters).toEqual(parameters);
    }
  });
});

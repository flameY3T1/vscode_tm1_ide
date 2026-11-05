import { describe, it, expect } from 'vitest';
import { extractTiFuncRefs, lintTiServer } from '../tiLogicVisualizer/tiServerLinter';
import type { FetchNamesFn } from '../tiLogicVisualizer/tiServerLinter';
import type { ApiRequestFn } from '../tiLogicVisualizer/rulesLinter';

// Dummy api — lintTiServer uses fetchNames, not api directly
const dummyApi: ApiRequestFn = async () => ({ statusCode: 200, body: '{}' });

// ─── extractTiFuncRefs ────────────────────────────────────────────────────────

describe('extractTiFuncRefs — cube refs', () => {
  it('detects CellGetN cube name (arg 0)', () => {
    const refs = extractTiFuncRefs("CellGetN('SalesCube', 'Jan', 'North');");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'SalesCube', kind: 'cube', lineIndex: 0 });
  });

  it('detects CellPutN cube name (arg 1, after value)', () => {
    const refs = extractTiFuncRefs("CellPutN(100, 'SalesCube', 'Jan', 'North');");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'SalesCube', kind: 'cube' });
  });

  it('detects CellPutS cube name (arg 1)', () => {
    const refs = extractTiFuncRefs("CellPutS('hello', 'TextCube', 'Jan');");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'TextCube', kind: 'cube' });
  });

  it('detects CellGetS cube name (arg 0)', () => {
    const refs = extractTiFuncRefs("v = CellGetS('TextCube', 'Jan', 'North');");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'TextCube', kind: 'cube' });
  });

  it('detects CubeExists cube name', () => {
    const refs = extractTiFuncRefs("IF(CubeExists('SalesCube') = 1);");
    expect(refs.some(r => r.name === 'SalesCube' && r.kind === 'cube')).toBe(true);
  });

  it('skips variable as cube name when no varLiterals provided', () => {
    const refs = extractTiFuncRefs("CellGetN(sCubeName, 'Jan', 'North');");
    expect(refs.filter(r => r.kind === 'cube')).toHaveLength(0);
  });

  it('resolves variable as cube name when varLiterals map is provided', () => {
    const varLiterals = new Map([['scubename', 'SalesCube']]);
    const refs = extractTiFuncRefs("CellGetN(sCubeName, 'Jan', 'North');", varLiterals);
    expect(refs.filter(r => r.kind === 'cube')).toHaveLength(1);
    expect(refs[0].name).toBe('SalesCube');
  });

  it('skips concatenation as cube name', () => {
    const refs = extractTiFuncRefs("CellGetN('Sales' | sVar, 'Jan', 'North');");
    expect(refs.filter(r => r.kind === 'cube')).toHaveLength(0);
  });

  it('skips a variable that only resolves to an empty literal (dynamic cube)', () => {
    // csCube = ''; then rebuilt via concatenation → varLiterals has '' → not validatable
    const varLiterals = new Map([['cscube', '']]);
    const refs = extractTiFuncRefs("CellPutS(vsValue, csCube, vsElem, csAlias);", varLiterals);
    expect(refs.filter(r => r.kind === 'cube')).toHaveLength(0);
  });

  it('skips an empty string literal as cube name', () => {
    const refs = extractTiFuncRefs("CellPutS(vsValue, '', vsElem, csAlias);");
    expect(refs.filter(r => r.kind === 'cube')).toHaveLength(0);
  });

  it('skips cube name in comment', () => {
    const refs = extractTiFuncRefs("# CellGetN('SalesCube', 'Jan', 'North');");
    expect(refs.filter(r => r.kind === 'cube')).toHaveLength(0);
  });

  it('skips cube name inside a string', () => {
    // The outer quotes are single quotes in TI — but this line has no valid TI string wrapping the call
    // Test with an actual string context that's parsed away:
    const refs2 = extractTiFuncRefs("s = CellGetS('NotThis', 'Jan');");
    // 'NotThis' is arg 0 = cube for CellGetS
    expect(refs2[0].name).toBe('NotThis');
  });

  it('detects CubeAttrN cube name (arg 0, Task 3a)', () => {
    const refs = extractTiFuncRefs("v = CubeAttrN('SalesCube', 'Description');");
    expect(refs.some(r => r.name === 'SalesCube' && r.kind === 'cube')).toBe(true);
  });

  it('detects ViewAttrS cube name (arg 0, Task 3d)', () => {
    const refs = extractTiFuncRefs("v = ViewAttrS('SalesCube', 'DefaultView', 'Caption');");
    expect(refs.some(r => r.name === 'SalesCube' && r.kind === 'cube')).toBe(true);
  });
});

describe('extractTiFuncRefs — dimension refs', () => {
  it('skips DimensionCreate (creates a new dimension; name does not need to exist)', () => {
    const refs = extractTiFuncRefs("DimensionCreate('Month');");
    expect(refs.filter(r => r.kind === 'dimension')).toHaveLength(0);
  });

  it('detects DimensionElementInsert dimension name (arg 0)', () => {
    const refs = extractTiFuncRefs("DimensionElementInsert('Month', '', 'Jan', 'S');");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'Month', kind: 'dimension', lineIndex: 0 });
  });

  it('detects DimensionElementInsert dimension name', () => {
    const refs = extractTiFuncRefs("DimensionElementInsert('Region', '', 'North', 'S', 0);");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ name: 'Region', kind: 'dimension' });
  });

  it('skips variable as dimension name when no varLiterals provided', () => {
    const refs = extractTiFuncRefs("DimensionCreate(sDimName);");
    expect(refs.filter(r => r.kind === 'dimension')).toHaveLength(0);
  });

  it('resolves variable as dimension name from prior assignment', () => {
    const code = "c = 'Month';\nDimensionElementDelete(c, 'Jan');";
    const varLiterals = new Map([['c', 'Month']]);
    const refs = extractTiFuncRefs(code, varLiterals);
    expect(refs.filter(r => r.kind === 'dimension')).toHaveLength(1);
    expect(refs[0].name).toBe('Month');
  });

  it('detects HierarchyExists dimension name (arg 0, Task 1b)', () => {
    const refs = extractTiFuncRefs("x = HierarchyExists('Month', 'Default');");
    expect(refs.some(r => r.name === 'Month' && r.kind === 'dimension')).toBe(true);
  });

  it('detects HierarchyAttrS dimension name (arg 0, Task 1a)', () => {
    const refs = extractTiFuncRefs("v = HierarchyAttrS('Region', 'Default', 'Caption');");
    expect(refs.some(r => r.name === 'Region' && r.kind === 'dimension')).toBe(true);
  });

  it('detects HierarchySubsetCreate dimension name (arg 0, Task 1d)', () => {
    const refs = extractTiFuncRefs("HierarchySubsetCreate('Product', 'Default', 'NewSub');");
    expect(refs.some(r => r.name === 'Product' && r.kind === 'dimension')).toBe(true);
  });

  it('detects HierarchyElementExists dimension name (arg 0, Task 1c)', () => {
    const refs = extractTiFuncRefs("e = HierarchyElementExists('Month', 'Default', 'Jan');");
    expect(refs.some(r => r.name === 'Month' && r.kind === 'dimension')).toBe(true);
  });

  it('detects DimensionAttrS dimension name (arg 0, Task 3b)', () => {
    const refs = extractTiFuncRefs("v = DimensionAttrS('Month', 'Caption');");
    expect(refs.some(r => r.name === 'Month' && r.kind === 'dimension')).toBe(true);
  });

  it('detects SubsetAttrN dimension name (arg 0, Task 3e)', () => {
    const refs = extractTiFuncRefs("v = SubsetAttrN('Region', 'Top5', 'Weight');");
    expect(refs.some(r => r.name === 'Region' && r.kind === 'dimension')).toBe(true);
  });

  it('skips ambiguously re-assigned variable', () => {
    // c is assigned twice → cannot safely resolve
    const varLiterals = new Map<string, string>(); // multi-assigned → not in map
    const refs = extractTiFuncRefs("DimensionCreate(c);", varLiterals);
    expect(refs.filter(r => r.kind === 'dimension')).toHaveLength(0);
  });
});

describe('extractTiFuncRefs — multi-line and .pro files', () => {
  it('extracts refs from multiple lines', () => {
    const code = [
      'CellGetN(\'SalesCube\', \'Jan\', \'North\');',
      'DimensionElementInsert(\'Month\', \'\', \'Jan\', \'S\');',
    ].join('\n');
    const refs = extractTiFuncRefs(code);
    expect(refs.some(r => r.name === 'SalesCube' && r.lineIndex === 0)).toBe(true);
    expect(refs.some(r => r.name === 'Month' && r.lineIndex === 1)).toBe(true);
  });

  it('skips .pro section markers', () => {
    const code = '572,3\nCellGetN(\'SalesCube\', \'Jan\', \'North\');\n573,0\n';
    const refs = extractTiFuncRefs(code);
    // Section marker line (572,3) should be skipped; CellGetN on line 1 should be found
    expect(refs.some(r => r.name === 'SalesCube')).toBe(true);
    expect(refs.some(r => r.name === '3')).toBe(false); // '3' is not a cube name
  });

  it('case-insensitive function matching', () => {
    const refs = extractTiFuncRefs("cellgetn('SalesCube', 'Jan', 'North');");
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe('SalesCube');
  });

  it('extracts cube from CellGetN call spanning multiple lines', () => {
    const code = [
      "v = CellGetN(",
      "  'SalesCube',",
      "  'Jan',",
      "  'North'",
      ");",
    ].join('\n');
    const refs = extractTiFuncRefs(code);
    expect(refs.filter(r => r.kind === 'cube')).toMatchObject([
      { name: 'SalesCube', lineIndex: 0 },
    ]);
  });

  it('extracts dimension from multi-line DimensionElementInsert', () => {
    const code = [
      "DimensionElementInsert(",
      "  'Region',",
      "  '',",
      "  'South',",
      "  'N'",
      ");",
    ].join('\n');
    const refs = extractTiFuncRefs(code);
    expect(refs.filter(r => r.kind === 'dimension')).toMatchObject([
      { name: 'Region', lineIndex: 0 },
    ]);
  });
});

// ─── lintTiServer ─────────────────────────────────────────────────────────────

describe('lintTiServer — cube validation', () => {
  it('warning when cube not found on server', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['RealCube', 'OtherCube']; }
      return [];
    };
    const diags = await lintTiServer(
      "CellGetN('UnknownCube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe('ti-unknown-cube');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].messageKey).toContain('was not found on the server');
    expect(diags[0].messageArgs).toContain('UnknownCube');
  });

  it('no warning when cube exists on server', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['SalesCube']; }
      return [];
    };
    const diags = await lintTiServer(
      "CellGetN('SalesCube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-cube')).toHaveLength(0);
  });

  it('cube name check is case-insensitive', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['salescube']; }
      return [];
    };
    const diags = await lintTiServer(
      "CellGetN('SalesCube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-cube')).toHaveLength(0);
  });

  it('cube name check is whitespace-insensitive by default (TM1 ignores spaces)', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['SalesCube']; }
      return [];
    };
    const diags = await lintTiServer(
      "CellGetN('Sales Cube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-cube')).toHaveLength(0);
  });

  it('matches a spaced server name against a spaceless source reference', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['Sales Cube']; }
      return [];
    };
    const diags = await lintTiServer(
      "CellGetN('SalesCube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-cube')).toHaveLength(0);
  });

  it('treats whitespace as significant when nameWhitespaceInsensitive is false', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['SalesCube']; }
      return [];
    };
    const diags = await lintTiServer(
      "CellGetN('Sales Cube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
      { nameWhitespaceInsensitive: false },
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-cube')).toHaveLength(1);
  });

  it('returns empty when server returns no cubes (offline)', async () => {
    const fetchNames: FetchNamesFn = async () => [];
    const diags = await lintTiServer(
      "CellGetN('SalesCube', 'Jan', 'North');",
      dummyApi,
      fetchNames,
    );
    expect(diags).toHaveLength(0);
  });

  it('deduplicates same cube name on same line', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Cubes') { return ['RealCube']; }
      return [];
    };
    // Same unknown cube referenced twice on one line
    const diags = await lintTiServer(
      "IF(CellGetN('Ghost', 'Jan') > CellGetN('Ghost', 'Feb'));",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-cube')).toHaveLength(1);
  });
});

describe('lintTiServer — dimension validation', () => {
  it('warning when dimension not found on server', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Dimensions') { return ['Month', 'Region']; }
      return [];
    };
    const diags = await lintTiServer(
      "DimensionElementInsert('UnknownDim', '', 'Jan', 'S');",
      dummyApi,
      fetchNames,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe('ti-unknown-dimension');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].messageKey).toContain('was not found on the server');
    expect(diags[0].messageArgs).toContain('UnknownDim');
  });

  it('does not warn for DimensionCreate with unknown name (creation is skipped)', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Dimensions') { return ['Month', 'Region']; }
      return [];
    };
    const diags = await lintTiServer(
      "DimensionCreate('NewDim');",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-dimension')).toHaveLength(0);
  });

  it('no warning when dimension exists on server', async () => {
    const fetchNames: FetchNamesFn = async (endpoint) => {
      if (endpoint === 'Dimensions') { return ['Month']; }
      return [];
    };
    const diags = await lintTiServer(
      "DimensionElementInsert('Month', '', 'Jan', 'S');",
      dummyApi,
      fetchNames,
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-dimension')).toHaveLength(0);
  });
});

// ─── extractTiFuncRefs — process refs ────────────────────────────────────────

describe('extractTiFuncRefs — process refs', () => {
  it('detects ExecuteProcess process name (arg 0)', () => {
    const refs = extractTiFuncRefs("ExecuteProcess('LoadSales');");
    expect(refs.filter(r => r.kind === 'process')).toMatchObject([
      { name: 'LoadSales', funcName: 'ExecuteProcess', lineIndex: 0 },
    ]);
  });

  it('detects RunProcess process name (arg 0)', () => {
    const refs = extractTiFuncRefs("RunProcess('LoadSales', 'pYear', 2026);");
    expect(refs.filter(r => r.kind === 'process')).toMatchObject([
      { name: 'LoadSales', funcName: 'RunProcess' },
    ]);
  });

  it('collects literal param names at odd positions', () => {
    const refs = extractTiFuncRefs("ExecuteProcess('LoadSales', 'pYear', 2026, 'pRegion', 'North');");
    const proc = refs.find(r => r.kind === 'process');
    expect(proc?.paramNames).toEqual(['pYear', 'pRegion']);
  });

  it('skips variables at param-name positions but keeps literal ones', () => {
    const refs = extractTiFuncRefs("ExecuteProcess('LoadSales', sParam, 2026, 'pRegion', 'North');");
    const proc = refs.find(r => r.kind === 'process');
    expect(proc?.paramNames).toEqual(['pRegion']);
  });

  it('resolves process name via varLiterals', () => {
    const varLiterals = new Map([['sproc', 'LoadSales']]);
    const refs = extractTiFuncRefs("ExecuteProcess(sProc, 'pYear', 2026);", varLiterals);
    expect(refs.filter(r => r.kind === 'process')).toMatchObject([{ name: 'LoadSales' }]);
  });

  it('skips variable process name when not resolvable', () => {
    const refs = extractTiFuncRefs("ExecuteProcess(sProc, 'pYear', 2026);");
    expect(refs.filter(r => r.kind === 'process')).toHaveLength(0);
  });
});

// ─── lintTiServer — S1 ti-unknown-process ────────────────────────────────────

const procFetchNames = (procs: string[]): FetchNamesFn => async (endpoint) => {
  if (endpoint === 'Processes') { return procs; }
  return [];
};

describe('lintTiServer — process validation (ti-unknown-process)', () => {
  it('warning when process not found on server (ExecuteProcess)', async () => {
    const diags = await lintTiServer(
      "ExecuteProcess('GhostProc');",
      dummyApi,
      procFetchNames(['LoadSales', 'LoadCosts']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe('ti-unknown-process');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].messageArgs).toContain('GhostProc');
    expect(diags[0].messageArgs).toContain('ExecuteProcess');
  });

  it('warning when process not found on server (RunProcess)', async () => {
    const diags = await lintTiServer(
      "RunProcess('GhostProc', 'pYear', 2026);",
      dummyApi,
      procFetchNames(['LoadSales']),
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-process')).toHaveLength(1);
  });

  it('warning when unknown process is referenced via variable literal', async () => {
    const code = "sProc = 'GhostProc';\nExecuteProcess(sProc);";
    const diags = await lintTiServer(code, dummyApi, procFetchNames(['LoadSales']));
    expect(diags.filter(d => d.ruleId === 'ti-unknown-process')).toHaveLength(1);
    expect(diags[0].line).toBe(1);
  });

  it('no warning when process exists (case-insensitive)', async () => {
    const diags = await lintTiServer(
      "ExecuteProcess('loadsales');",
      dummyApi,
      procFetchNames(['LoadSales']),
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-process')).toHaveLength(0);
  });

  it('returns empty when server returns no processes (offline)', async () => {
    const diags = await lintTiServer(
      "ExecuteProcess('GhostProc');",
      dummyApi,
      async () => [],
    );
    expect(diags).toHaveLength(0);
  });

  it('returns empty when fetchNames throws (offline)', async () => {
    const fetchNames: FetchNamesFn = async () => { throw new Error('ECONNREFUSED'); };
    const diags = await lintTiServer("ExecuteProcess('GhostProc');", dummyApi, fetchNames);
    expect(diags).toHaveLength(0);
  });

  it('deduplicates same process name on same line', async () => {
    const diags = await lintTiServer(
      "ExecuteProcess('Ghost'); ExecuteProcess('Ghost');",
      dummyApi,
      procFetchNames(['LoadSales']),
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-process')).toHaveLength(1);
  });
});

// ─── lintTiServer — S2 ti-wrong-process-params ───────────────────────────────

/**
 * Mock api answering GET Processes?$select=Name,Parameters&$filter=Name eq '…' or …
 * Like TM1 (measured 11.8): `eq` matches the exact spelling only.
 */
function paramsApi(defs: Record<string, string[]>): ApiRequestFn & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (method: string, path: string) => {
    calls.push(`${method} ${path}`);
    const m = /^Processes\?\$select=Name,Parameters&\$filter=(.*)$/.exec(decodeURIComponent(path));
    if (!m) { return { statusCode: 400, body: '' }; }
    const wanted = [...m[1].matchAll(/Name eq '((?:[^']|'')*)'/g)].map(x => x[1].replace(/''/g, "'"));
    return {
      statusCode: 200,
      body: JSON.stringify({
        '@odata.context': '$metadata#Processes(Name,Parameters)',
        value: wanted.filter(n => defs[n]).map(n => ({
          Name: n,
          Parameters: defs[n].map(p => ({ Name: p, Prompt: '', Value: '', Type: 2 })),
        })),
      }),
    };
  }) as ApiRequestFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

describe('lintTiServer — process param validation (ti-wrong-process-params)', () => {
  it('warning when param name does not exist on the process', async () => {
    const api = paramsApi({ LoadSales: ['pYear', 'pRegion'] });
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', 'pYaer', 2026);",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe('ti-wrong-process-params');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].messageKey).toBe(`Process '{0}' has no parameter '{1}' (available: {2}).`);
    expect(diags[0].messageArgs).toEqual(['LoadSales', 'pYaer', 'pYear, pRegion']);
  });

  it('no warning when param names match (case-insensitive)', async () => {
    const api = paramsApi({ LoadSales: ['pYear', 'pRegion'] });
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', 'PYEAR', 2026, 'pregion', 'North');",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags).toHaveLength(0);
  });

  it('checks RunProcess like ExecuteProcess', async () => {
    const api = paramsApi({ LoadSales: ['pYear'] });
    const diags = await lintTiServer(
      "RunProcess('LoadSales', 'pBogus', 1);",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags.filter(d => d.ruleId === 'ti-wrong-process-params')).toHaveLength(1);
  });

  it('no param check when process is unknown (S1 already fires)', async () => {
    const api = paramsApi({});
    const diags = await lintTiServer(
      "ExecuteProcess('GhostProc', 'pBogus', 1);",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags.filter(d => d.ruleId === 'ti-unknown-process')).toHaveLength(1);
    expect(diags.filter(d => d.ruleId === 'ti-wrong-process-params')).toHaveLength(0);
    expect(api.calls).toHaveLength(0); // no definition fetch for unknown process
  });

  it('skips variables at param-name position', async () => {
    const api = paramsApi({ LoadSales: ['pYear'] });
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', sParamName, 1);",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags).toHaveLength(0);
    expect(api.calls).toHaveLength(0); // no literal param names → no fetch
  });

  it('fetches the process definition only once per process (dedup)', async () => {
    const api = paramsApi({ LoadSales: ['pYear'] });
    const code = [
      "ExecuteProcess('LoadSales', 'pYear', 1);",
      "ExecuteProcess('LoadSales', 'pBogus', 2);",
    ].join('\n');
    const diags = await lintTiServer(code, api, procFetchNames(['LoadSales']));
    expect(api.calls).toHaveLength(1);
    expect(diags.filter(d => d.ruleId === 'ti-wrong-process-params')).toHaveLength(1);
    expect(diags[0].line).toBe(1);
  });

  it('fetches several processes in ONE call, in the server spelling', async () => {
    const api = paramsApi({ LoadSales: ['pYear'], 'Load Costs': ['pMonth'] });
    const code = [
      "ExecuteProcess('loadsales', 'pBogus', 1);",
      "RunProcess('LoadCosts', 'pMonth', 2);",
    ].join('\n');
    const diags = await lintTiServer(code, api, procFetchNames(['LoadSales', 'Load Costs']));
    expect(api.calls).toHaveLength(1);
    expect(diags.filter(d => d.ruleId === 'ti-wrong-process-params').map(d => d.line)).toEqual([0]);
  });

  it('uses cachedProcParams and skips the network fetch on a cache hit', async () => {
    const api = paramsApi({ LoadSales: ['pYear', 'pRegion'] });
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', 'pYaer', 2026);",
      api,
      procFetchNames(['LoadSales']),
      undefined,
      (name) => (name.toLowerCase() === 'loadsales' ? ['pYear', 'pRegion'] : undefined),
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe('ti-wrong-process-params');
    expect(api.calls).toHaveLength(0); // served from the reference-index cache, no GET
  });

  it('falls back to the network fetch when cachedProcParams misses', async () => {
    const api = paramsApi({ LoadSales: ['pYear', 'pRegion'] });
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', 'pYaer', 2026);",
      api,
      procFetchNames(['LoadSales']),
      undefined,
      () => undefined, // cache cold → nothing cached
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe('ti-wrong-process-params');
    expect(api.calls).toHaveLength(1); // cache miss → one definition fetch
  });

  it('skips param check silently when the definition fetch throws', async () => {
    const api: ApiRequestFn = async () => { throw new Error('ECONNRESET'); };
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', 'pBogus', 1);",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags).toHaveLength(0);
  });

  it('skips param check when the definition fetch returns non-2xx', async () => {
    const api: ApiRequestFn = async () => ({ statusCode: 500, body: '' });
    const diags = await lintTiServer(
      "ExecuteProcess('LoadSales', 'pBogus', 1);",
      api,
      procFetchNames(['LoadSales']),
    );
    expect(diags).toHaveLength(0);
  });

  it("escapes apostrophes in the process name (OData '' doubling)", async () => {
    const api = paramsApi({ "flameY3T1's Proc": ['pYear'] });
    const diags = await lintTiServer(
      "ExecuteProcess('flameY3T1''s Proc', 'pBogus', 1);",
      api,
      procFetchNames(["flameY3T1's Proc"]),
    );
    // The literal contains an escaped quote — extractStringLiteral rejects it,
    // so no process ref is extracted at all (consistent with cube/dim behavior).
    expect(diags).toHaveLength(0);
  });
});

describe('lintTiServer — no refs', () => {
  it('returns empty for code with no tracked function calls', async () => {
    const fetchNames: FetchNamesFn = async () => ['SomeName'];
    const diags = await lintTiServer(
      "sVar = 'hello';\nnVar = 42;",
      dummyApi,
      fetchNames,
    );
    expect(diags).toHaveLength(0);
  });

  it('returns empty for empty string', async () => {
    const fetchNames: FetchNamesFn = async () => [];
    const diags = await lintTiServer('', dummyApi, fetchNames);
    expect(diags).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { buildReferenceIndex, lookupReferences } from '../references/referenceIndex';
import { extractTiReferences, extractRulesReferences } from '../references/refExtract';
import { buildProcessEnv } from '../references/variableEnv';

// ─── extractTiReferences ─────────────────────────────────────────────────────

describe('extractTiReferences — cube/dim args', () => {
  it('detects cube from CellGetN and dimension from DimensionElementInsert', () => {
    const text = [
      "v = CellGetN('SalesCube', 'Jan', 'North');",
      "DimensionElementInsert('Region', '', 'South', 'N');",
    ].join('\n');
    const refs = extractTiReferences(text);
    expect(refs.map(r => ({ k: r.targetKind, n: r.targetName, l: r.line })))
      .toEqual(expect.arrayContaining([
        { k: 'cube',      n: 'SalesCube', l: 0 },
        { k: 'dimension', n: 'Region',    l: 1 },
      ]));
  });

  it('detects process from ExecuteProcess', () => {
    const refs = extractTiReferences("ExecuteProcess('Load_Sales', 'pYear', 2026);");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ targetKind: 'process', targetName: 'Load_Sales', line: 0 });
  });

  it('detects process from RunProcess', () => {
    const refs = extractTiReferences("RunProcess('Sync_Cubes');");
    expect(refs[0]).toMatchObject({ targetKind: 'process', targetName: 'Sync_Cubes' });
  });

  it('ignores variables as cube/dim/process args when env is empty', () => {
    const refs = extractTiReferences("ExecuteProcess(sProc, 'p1', 1); CellGetN(sCube, 'x');");
    expect(refs).toHaveLength(0);
  });

  it('resolves bare variables to literals via env (process arg)', () => {
    const text = [
      "sProc = 'SBI_IMP_300_100_Sammler_Tagessoll';",
      "ExecuteProcess(sProc, 'pYear', 2026);",
    ].join('\n');
    const env = buildProcessEnv(text, []);
    const refs = extractTiReferences(text, env);
    const procRefs = refs.filter(r => r.targetKind === 'process');
    expect(procRefs).toHaveLength(1);
    expect(procRefs[0]).toMatchObject({
      targetKind: 'process',
      targetName: 'SBI_IMP_300_100_Sammler_Tagessoll',
      line: 1,
    });
    // Snippet keeps the original (variable) source line
    expect(procRefs[0].snippet).toContain('sProc');
  });

  it('resolves a static string-concatenation process name via a variable (call-graph edge)', () => {
    const text = [
      "sBase = 'GGG_';",
      "sProc = sBase | 'Load';",
      "ExecuteProcess(sProc, 'pYear', 2026);",
    ].join('\n');
    const env = buildProcessEnv(text, []);
    const procRefs = extractTiReferences(text, env).filter(r => r.targetKind === 'process');
    expect(procRefs).toHaveLength(1);
    expect(procRefs[0]).toMatchObject({ targetKind: 'process', targetName: 'GGG_Load' });
  });

  it('resolves an inline literal concatenation as the process target', () => {
    const refs = extractTiReferences("ExecuteProcess('GGG_' | 'Load');");
    expect(refs.filter(r => r.targetKind === 'process').map(r => r.targetName)).toEqual(['GGG_Load']);
  });

  it('leaves a concat with a param operand dynamic (no edge)', () => {
    const text = "ExecuteProcess('P_' | pRegion, 'p1', 1);";
    const env = buildProcessEnv(text, ['pRegion']);
    expect(extractTiReferences(text, env).filter(r => r.targetKind === 'process')).toHaveLength(0);
  });

  it('resolves bare variables to literals via env (cube/dim args)', () => {
    const text = [
      "sCube = 'SalesCube';",
      "sDim = 'Region';",
      "v = CellGetN(sCube, 'Jan');",
      "DimensionElementInsert(sDim, '', 'South', 'N');",
    ].join('\n');
    const env = buildProcessEnv(text, []);
    const refs = extractTiReferences(text, env);
    expect(refs.filter(r => r.targetKind === 'cube').map(r => r.targetName)).toEqual(['SalesCube']);
    expect(refs.filter(r => r.targetKind === 'dimension').map(r => r.targetName)).toEqual(['Region']);
  });

  it('does not resolve variables whose value is dynamic', () => {
    const text = [
      "sProc = SomeFunc();",                      // dynamic
      "ExecuteProcess(sProc, 'p1', 1);",
    ].join('\n');
    const env = buildProcessEnv(text, []);
    const refs = extractTiReferences(text, env);
    expect(refs).toHaveLength(0);
  });

  it('does not resolve variables that are only param passthroughs', () => {
    const text = "ExecuteProcess(pCallerParam, 'p1', 1);";
    const env = buildProcessEnv(text, ['pCallerParam']);
    const refs = extractTiReferences(text, env);
    // param kind is not a concrete process target → skip
    expect(refs.filter(r => r.targetKind === 'process')).toHaveLength(0);
  });

  it('ignores cube names inside comments and strings', () => {
    const refs = extractTiReferences("# CellGetN('Ignored', 'x');\nsX = 'CellGetN(\\'AlsoIgnored\\')';");
    expect(refs).toHaveLength(0);
  });

  it('skips DimensionCreate (creation, not reference)', () => {
    const refs = extractTiReferences("DimensionCreate('NewDim');");
    expect(refs).toHaveLength(0);
  });

  it('is case-insensitive for function names', () => {
    const refs = extractTiReferences("cellGETn('Sales', 'Jan');");
    expect(refs[0]).toMatchObject({ targetKind: 'cube', targetName: 'Sales' });
  });

  it('truncates long snippets', () => {
    const longLine = "CellGetN('C', " + "'x',".repeat(200) + " 'y');";
    const refs = extractTiReferences(longLine);
    expect(refs[0].snippet.length).toBeLessThanOrEqual(200);
    expect(refs[0].snippet.endsWith('…')).toBe(true);
  });

  it('detects multi-line ExecuteProcess call spanning many lines', () => {
    const text = [
      "ExecuteProcess('}bedrock.cube.data.export',",
      "   'pLogoutput', 0,",
      "   'pCube', 'Tagessoll',",
      "   'pFilter', ''",
      "  );",
    ].join('\n');
    const refs = extractTiReferences(text);
    const procRefs = refs.filter(r => r.targetKind === 'process');
    expect(procRefs).toHaveLength(1);
    expect(procRefs[0]).toMatchObject({
      targetKind: 'process',
      targetName: '}bedrock.cube.data.export',
      line: 0,
    });
    // Call-site params parsed from joined line
    const byName = new Map((procRefs[0].params ?? []).map(p => [p.name, p]));
    expect(byName.get('pCube')?.resolution).toEqual({ kind: 'literal', value: 'Tagessoll' });
    expect(byName.get('pLogoutput')?.resolution).toEqual({ kind: 'literal', value: '0' });
  });

  it('detects multi-line ExecuteProcess with blank and comment lines between args', () => {
    const text = [
      "ExecuteProcess('TargetProc',",
      "   # first block",
      "   'pA', 1,",
      "",
      "   'pB', 2",
      ");",
    ].join('\n');
    const refs = extractTiReferences(text);
    expect(refs.filter(r => r.targetKind === 'process').map(r => r.targetName))
      .toEqual(['TargetProc']);
  });

  it('detects multi-line CellGetN cube reference', () => {
    const text = [
      "v = CellGetN(",
      "  'SalesCube',",
      "  'Jan',",
      "  'North'",
      ");",
    ].join('\n');
    const refs = extractTiReferences(text);
    expect(refs.filter(r => r.targetKind === 'cube')).toMatchObject([
      { targetName: 'SalesCube', line: 0 },
    ]);
  });
});

// ─── extractRulesReferences ──────────────────────────────────────────────────

describe('extractRulesReferences', () => {
  it('extracts cube refs from DB() and dim refs from bracket refs', () => {
    const rules = [
      "['Revenue'] = N: DB('OtherCube', !Region, 'Jan');",
      "FEEDERS;",
      "['Revenue'] => DB('FeederCube', !Region, 'Jan');",
    ].join('\n');
    const refs = extractRulesReferences(rules);
    expect(refs.filter(r => r.targetKind === 'cube').map(r => r.targetName).sort())
      .toEqual(['FeederCube', 'OtherCube']);
    // At least one dimension ref from Revenue bracket — actually 'Revenue' is element, not dim
    // Bracket ref parsing requires 'Dim':'Elem' form; single 'X' is not valid → no dim refs
  });

  it('extracts dimension from multi-dim bracket refs', () => {
    const rules = "['Month':'Jan', 'Region':'North'] = N: 42;";
    const refs = extractRulesReferences(rules);
    const dims = refs.filter(r => r.targetKind === 'dimension').map(r => r.targetName);
    expect(dims).toEqual(expect.arrayContaining(['Month', 'Region']));
  });

  it('switches from rules to feeders section after FEEDERS; marker', () => {
    const rules = [
      "['Month':'Jan'] = N: 1;",
      "FEEDERS;",
      "['Month':'Feb'] => ['Month':'Mar'];",
    ].join('\n');
    const refs = extractRulesReferences(rules);
    expect(refs[0].section).toBe('rules');
    expect(refs[refs.length - 1].section).toBe('feeders');
  });
});

// ─── buildReferenceIndex ─────────────────────────────────────────────────────

describe('buildReferenceIndex', () => {
  const mkDeps = (
    processes: Array<{ name: string; prolog?: string; metadata?: string; data?: string; epilog?: string }>,
    cubes: Array<{ cubeName: string; rulesText: string }>,
  ) => ({
    fetchProcesses: async () => processes.map(p => ({
      name: p.name,
      prolog:   p.prolog   ?? '',
      metadata: p.metadata ?? '',
      data:     p.data     ?? '',
      epilog:   p.epilog   ?? '',
    })),
    fetchCubesWithRules: async () => cubes,
  });

  it('assembles references from processes and rules', async () => {
    const idx = await buildReferenceIndex(mkDeps(
      [
        { name: 'Load_Sales', prolog: "CellPutN(1, 'SalesCube', 'Jan');", epilog: "ExecuteProcess('Sync');" },
        { name: 'Sync',       data:   "DimensionElementInsert('Month', '', 'Q1', 'C');" },
      ],
      [
        { cubeName: 'Revenue', rulesText: "['Kpi':'X'] = N: DB('SalesCube', !Month, 'x');\nFEEDERS;\n['Kpi':'X'] => ['Kpi':'Y'];" },
      ],
    ));

    expect(lookupReferences(idx, 'cube', 'SalesCube')).toHaveLength(2);
    expect(lookupReferences(idx, 'process', 'Sync')).toHaveLength(1);
    expect(lookupReferences(idx, 'dimension', 'Month').length).toBeGreaterThanOrEqual(1);
  });

  it('case-insensitive lookup', async () => {
    const idx = await buildReferenceIndex(mkDeps(
      [{ name: 'P', prolog: "CellGetN('SalesCube', 'x');" }],
      [],
    ));
    expect(lookupReferences(idx, 'cube', 'salescube')).toHaveLength(1);
    expect(lookupReferences(idx, 'cube', 'SALESCUBE')).toHaveLength(1);
  });

  it('returns empty array for unknown targets', async () => {
    const idx = await buildReferenceIndex(mkDeps([], []));
    expect(lookupReferences(idx, 'cube', 'Nope')).toEqual([]);
  });

  it('tags references with correct section per process block', async () => {
    const idx = await buildReferenceIndex(mkDeps(
      [{
        name: 'P',
        prolog:   "CellGetN('C', 'x');",
        metadata: "CellGetN('C', 'y');",
        data:     "CellGetN('C', 'z');",
        epilog:   "CellGetN('C', 'w');",
      }],
      [],
    ));
    const refs = lookupReferences(idx, 'cube', 'C');
    const sections = refs.map(r => r.section).sort();
    expect(sections).toEqual(['data', 'epilog', 'metadata', 'prolog']);
    expect(refs.every(r => r.sourceKind === 'process' && r.sourceName === 'P')).toBe(true);
  });

  it('resolves process name from a variable assigned in an earlier section', async () => {
    const idx = await buildReferenceIndex(mkDeps(
      [
        {
          name: 'Caller',
          prolog: "sProc = 'Load_Sales';",
          epilog: "ExecuteProcess(sProc, 'pYear', 2026);",
        },
        { name: 'Load_Sales', prolog: "CellPutN(1, 'SalesCube', 'Jan');" },
      ],
      [],
    ));
    const refs = lookupReferences(idx, 'process', 'Load_Sales');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ sourceName: 'Caller', section: 'epilog' });
    expect(refs[0].snippet).toContain('sProc');
  });

  it('survives fetcher rejection', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses:      async () => { throw new Error('offline'); },
      fetchCubesWithRules: async () => { throw new Error('offline'); },
    });
    expect(idx.all).toEqual([]);
  });
});

// ─── Data source ────────────────────────────────────────────────────────────────

describe('data source — both paths', () => {
  const deps = (
    processes: Array<{
      name: string;
      prolog?: string;
      dataSource?: { type: string; nameForServer?: string; view?: string; subset?: string };
    }>,
    cubeNames: string[] = [],
    dimNames: string[] = [],
  ) => ({
    fetchProcesses: async () => processes.map(p => ({
      name: p.name,
      prolog: p.prolog ?? '', metadata: '', data: '', epilog: '',
      dataSource: p.dataSource,
    })),
    fetchCubesWithRules: async () => cubeNames.map(cubeName => ({ cubeName, rulesText: '' })),
    fetchDimNames: async () => dimNames,
  });

  it('the registered source is a use of the cube', async () => {
    const idx = await buildReferenceIndex(deps(
      [{ name: 'Load', dataSource: { type: 'TM1CubeView', nameForServer: 'Sales', view: 'Monthly' } }],
      ['Sales'],
    ));
    const refs = idx.byCube.get('sales') ?? [];
    expect(refs.map(r => ({ s: r.sourceName, sec: r.section })))
      .toEqual([{ s: 'Load', sec: 'datasource' }]);
    expect(idx.processDataSources.get('load')?.declared?.view).toBe('Monthly');
  });

  it('the source set in the Prolog likewise — and it is classified against the server inventory', async () => {
    const idx = await buildReferenceIndex(deps(
      [{
        name: 'Switcher',
        prolog: [
          "DatasourceNameForServer = 'Sales';",
          "DatasourceCubeview = 'Monthly';",
          "DatasourceDimensionSubset = 'AllRegions';",
        ].join('\n'),
      }],
      ['Sales'],
      ['Region'],
    ));
    // `Sales` exists on the server as a cube — that becomes a cube edge.
    expect((idx.byCube.get('sales') ?? []).map(r => r.section)).toEqual(['datasource']);
    // `Monthly` and `AllRegions` are a view and a subset respectively: no edge, but
    // in `assigned` — bulk delete matches them against their row.
    expect(idx.processDataSources.get('switcher')?.assigned)
      .toEqual(['Sales', 'Monthly', 'AllRegions']);
    expect(idx.byDim.has('monthly')).toBe(false);
  });

  it('an assignment through a variable counts too', async () => {
    const idx = await buildReferenceIndex(deps(
      [{ name: 'Indirekt', prolog: "sCube = 'Sales';\nDatasourceNameForServer = sCube;" }],
      ['Sales'],
    ));
    expect((idx.byCube.get('sales') ?? []).map(r => r.sourceName)).toEqual(['Indirekt']);
  });

  it('a process without a data source is not in the map', async () => {
    const idx = await buildReferenceIndex(deps([{ name: 'Rein', prolog: "x = 1;" }]));
    expect(idx.processDataSources.size).toBe(0);
  });
});

// ─── Findings of the daily review from 09-19 ─────────────────────────────────

describe('data source — the cube inventory does not depend on the rules', () => {
  it('a cube WITHOUT rules accepts a data source assignment', async () => {
    // The real fetcher (`fetchAllCubesWithRules`) returns rule-less cubes with
    // an empty `rulesText` — exactly this form here. As long as it filtered them out,
    // they were missing from the inventory, and `DatasourceNameForServer = 'Sales'` produced
    // no edge, even though the cube exists.
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [{
        name: 'Switcher',
        prolog: "DatasourceNameForServer = 'Sales';",
        metadata: '', data: '', epilog: '',
      }],
      fetchCubesWithRules: async () => [{ cubeName: 'Sales', rulesText: '' }],
    });
    expect((idx.byCube.get('sales') ?? []).map(r => r.sourceName)).toEqual(['Switcher']);
  });
});

describe('data source — whatever cannot be resolved is named', () => {
  const mit = (prolog: string) => buildReferenceIndex({
    fetchProcesses: async () => [{
      name: 'Dynamisch', prolog, metadata: '', data: '', epilog: '',
    }],
    fetchCubesWithRules: async () => [{ cubeName: 'Sales', rulesText: '' }],
  });

  it('an assignment from a parameter is listed in `dynamicDataSources`', async () => {
    const idx = await mit('DatasourceNameForServer = pCube;');
    // No guessed name …
    expect(idx.byCube.get('sales')).toBeUndefined();
    // … but no silent "nothing found" either.
    expect(idx.dynamicDataSources).toEqual([{ process: 'Dynamisch', scope: 'parent' }]);
  });

  it('a resolvable assignment reports NO analysis limit', async () => {
    const idx = await mit("sCube = 'Sales';\nDatasourceNameForServer = sCube;");
    expect((idx.byCube.get('sales') ?? []).map(r => r.sourceName)).toEqual(['Dynamisch']);
    expect(idx.dynamicDataSources).toEqual([]);
  });

  it('a process without a data source assignment is not listed', async () => {
    const idx = await mit('x = 1;');
    expect(idx.dynamicDataSources).toEqual([]);
  });

  /**
   * The case flameY3T1 found on the test instance on 09-19
   * (re-measured live on a process that builds itself a working view): the
   * cube resolves, the view name does not — because it is a temporary name from
   * `GetProcessName()`. The warning must therefore NOT attach to the cube.
   */
  it('resolved cube plus unresolvable view name: limit only at the view name', async () => {
    const idx = await mit([
      "csCube = 'Sales';",
      "csView = 'View_Source_'|GetProcessName();",
      'DataSourceNameForServer = csCube;',
      'DataSourceCubeView = csView;',
    ].join('\n'));
    expect((idx.byCube.get('sales') ?? []).map(r => r.sourceName)).toEqual(['Dynamisch']);
    expect(idx.dynamicDataSources).toEqual([{ process: 'Dynamisch', scope: 'view' }]);
  });

  /**
   * Second finding from 09-19 (re-measured live on an import process): the
   * source is a text file, `DatasourceNameForServer` carries a
   * FILE PATH. That it cannot be resolved is of no concern to cubes and
   * dimensions.
   */
  it('with a file source an unresolvable name is NOT a gap', async () => {
    const idx = await mit([
      "DataSourceType = 'CHARACTERDELIMITED';",
      'DatasourceNameForServer = sDatei;',
      "DatasourceASCIIDelimiter = '^';",
    ].join('\n'));
    expect(idx.dynamicDataSources).toEqual([]);
  });

  it('the registered type counts when the code does not set it', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [{
        name: 'Datei', prolog: 'DatasourceNameForServer = sDatei;',
        metadata: '', data: '', epilog: '',
        dataSource: { type: 'ASCII', nameForServer: 'C:\\x.txt' },
      }],
      fetchCubesWithRules: async () => [],
    });
    expect(idx.dynamicDataSources).toEqual([]);
  });

  it('with a view source the gap affects only cubes, not dimensions', async () => {
    const idx = await mit([
      "DataSourceType = 'VIEW';",
      'DatasourceNameForServer = pCube;',
    ].join('\n'));
    expect(idx.dynamicDataSources).toEqual([{ process: 'Dynamisch', scope: 'cube' }]);
  });

  it('without any information it stays at "cube or dimension"', async () => {
    const idx = await mit('DatasourceNameForServer = pIrgendwas;');
    expect(idx.dynamicDataSources).toEqual([{ process: 'Dynamisch', scope: 'parent' }]);
  });

  it('the same literal twice stays resolvable', async () => {
    // In the real process the assignment appeared TWICE, both times with the same
    // value — `buildProcessEnv` only downgrades on DIFFERING bindings.
    const idx = await mit([
      "csCube = 'Sales';",
      "csCube = 'Sales';",
      'DataSourceNameForServer = csCube;',
    ].join('\n'));
    expect((idx.byCube.get('sales') ?? []).map(r => r.sourceName)).toEqual(['Dynamisch']);
    expect(idx.dynamicDataSources).toEqual([]);
  });
});

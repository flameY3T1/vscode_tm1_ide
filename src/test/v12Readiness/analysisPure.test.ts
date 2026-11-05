import { describe, it, expect } from 'vitest';
import { analyse, pathCauseKey } from '../../v12Readiness/analysisPure';
import { measuredOnlyNames, functionEvidence } from '../../v12Readiness/catalogPure';
import type { ScanInput, SourceProcess, ProcSection } from '../../v12Readiness/types';

function proc(name: string, code: Partial<Record<ProcSection, string>>, dataSource: SourceProcess['dataSource'] = { type: 'None' }): SourceProcess {
  return { name, dataSource, code: { prolog: '', metadata: '', data: '', epilog: '', ...code } };
}

function input(processes: SourceProcess[], extra: Partial<ScanInput> = {}): ScanInput {
  return {
    serverAlias: 'srv', scannedAt: '2026-10-07T00:00:00Z', complete: true, processes,
    activeChoreProcessesLc: [], calls: [], runLog: { lines: 0, capped: false, processesLc: [] }, gaps: [], ...extra,
  };
}

describe('v12 readiness catalog', () => {
  it('keeps all measured-only names present in the signatures', () => {
    expect(measuredOnlyNames()).toHaveLength(26);
  });
  it('separates IBM-listed from measured names', () => {
    expect(functionEvidence('ExecuteCommand')).toBe('ibm');
    expect(functionEvidence('LockOn')).toBe('measured');
  });
});

describe('pathCauseKey', () => {
  it.each([
    ['C:\\TM1\\Data\\In\\x.csv', 'C:\\TM1\\Data'],
    ['C:\\TM1\\x.csv', 'C:\\TM1'],
    ['C:\\TM1\\', 'C:\\TM1'],
    ['C:\\TM1\\Out\\Daily\\', 'C:\\TM1\\Out'],
    ['c:/data/out/x.csv', 'C:\\data\\out'],
    ['D:\\x.csv', 'D:\\'],
    ['\\\\srv\\share\\out\\b.txt', '\\\\srv\\share\\out'],
    ['\\\\srv\\share\\b.txt', '\\\\srv\\share\\'],
    ['..\\x.csv', '..'],
    ['C:\\TM1\\..\\x.csv', '..'],
  ])('%s → %s', (path, key) => { expect(pathCauseKey(path)).toBe(key); });
});

describe('analyse — removed functions', () => {
  it('groups one function across processes and keeps the replacement', () => {
    const a = analyse(input([
      proc('A', { prolog: "ExecuteCommand('x.bat', 1);" }),
      proc('B', { epilog: "\nExecuteCommand('y.bat', 0);" }),
    ]));
    const g = a.groups.find(x => x.rule === 'removed-function' && x.key === 'ExecuteCommand')!;
    expect(g.occurrences.map(o => [o.process, o.section, o.line])).toEqual([['A', 'prolog', 0], ['B', 'epilog', 1]]);
    expect(g.replacement).toBeTruthy();
    expect(g.severity).toBe('blocker');
  });

  it('ignores comments and strings, finds call without parentheses', () => {
    const a = analyse(input([proc('A', { prolog: "# SaveDataAll;\nsMsg = 'SaveDataAll';\nSaveDataAll;" })]));
    const occ = a.groups.filter(g => g.rule === 'removed-function').flatMap(g => g.occurrences);
    expect(occ).toEqual([{ process: 'A', section: 'prolog', line: 2, detail: 'SaveDataAll' }]);
  });
});

describe('analyse — file paths', () => {
  it('flags drive, UNC and traversal, not relative or container paths', () => {
    const a = analyse(input([proc('A', {
      prolog: [
        "AsciiOutput('C:\\Export\\a.csv', 'x');",
        "TextOutput('\\\\srv\\share\\b.txt', 'x');",
        "AsciiOutput('..\\c.csv', 'x');",
        "AsciiOutput('d.csv', 'x');",
        "AsciiOutput('/tmp/e.csv', 'x');",
        "# AsciiOutput('C:\\Export\\f.csv', 'x');",
      ].join('\n'),
    })]));
    expect(a.groups.filter(g => g.rule === 'file-path').map(g => g.key).sort()).toEqual(['..', 'C:\\Export', '\\\\srv\\share\\']);
  });

  it('flags an ASCII data source with a drive path on the process object', () => {
    const a = analyse(input([proc('A', {}, { type: 'ASCII', nameForServer: 'E:\\In\\data.txt' })]));
    const g = a.groups.find(x => x.rule === 'file-path')!;
    expect(g.key).toBe('E:\\In');
    expect(g.occurrences[0].section).toBeUndefined();
  });
});

describe('analyse — ODBC and control cubes', () => {
  it('finds calls whose arguments start on the next line, on the line of the call', () => {
    const a = analyse(input([proc('M', { prolog: "nX = 1;\nAsciiOutput(\n  'C:\\out.csv',\n  'x'\n);\nODBCOpen(\n  'DWH', 'u', 'p');" })]));
    const at = (rule: string) => a.groups.filter(g => g.rule === rule).map(g => [g.key, g.occurrences.map(o => o.line)]);
    expect(at('file-path')).toEqual([['C:\\', [1]]]);
    expect(at('odbc')).toEqual([['DWH', [5]]]);
  });
  it('ODBC is an integration task grouped by DSN', () => {
    const a = analyse(input([
      proc('A', {}, { type: 'ODBC', nameForServer: 'DWH' }),
      proc('B', { prolog: "ODBCOpen('DWH', 'u', 'p');" }),
    ]));
    const g = a.groups.find(x => x.rule === 'odbc')!;
    expect(g.key).toBe('DWH');
    expect(g.severity).toBe('integration');
    expect(g.occurrences).toHaveLength(2);
  });

  it('flags access to an unsupported control cube, not a comment', () => {
    const a = analyse(input([proc('A', {
      prolog: "# CellGetS('}CubeProperties', 'c', 'LOGGING');\ns = CellGetS('}cubeproperties', sCube, 'LOGGING');",
    })]));
    const g = a.groups.find(x => x.rule === 'control-cube')!;
    expect(g.key).toBe('}CubeProperties');
    expect(g.occurrences).toEqual([{ process: 'A', section: 'prolog', line: 1, detail: '}CubeProperties' }]);
  });
});

describe('analyse — calls and usage', () => {
  const procs = [
    proc('Blocked', { prolog: "ExecuteCommand('x', 0);" }),
    proc('Caller', { prolog: "ExecuteProcess('Blocked');" }),
    proc('Dyn', { prolog: "ExecuteProcess(sName);\nExecuteProcess(sResolved);" }),
    proc('Ran', {}),
    proc('Chored', {}),
    proc('Orphan', {}),
    proc('}bedrock.x', {}),
  ];
  const calls = [
    { caller: 'Caller', callee: 'Blocked', section: 'prolog' as const, line: 0 },
    { caller: 'Dyn', callee: 'Ran', section: 'prolog' as const, line: 1 },
  ];
  const a = analyse(input(procs, {
    calls,
    activeChoreProcessesLc: ['chored'],
    runLog: { lines: 10, capped: false, processesLc: ['ran'] },
  }));

  it('marks callers of blocked processes', () => {
    expect(a.affectedViaCall).toEqual([{ process: 'Caller', callees: ['Blocked'] }]);
  });
  it('leaves out callers that have a blocker of their own', () => {
    const b = analyse(input([
      proc('Blocked', { prolog: "ExecuteCommand('x', 0);" }),
      proc('AlsoBlocked', { prolog: "SaveDataAll;\nExecuteProcess('Blocked');" }),
    ], { calls: [{ caller: 'AlsoBlocked', callee: 'Blocked', section: 'prolog', line: 1 }] }));
    expect(b.affectedViaCall).toEqual([]);
  });
  it('lists only unresolved non-literal call sites as dynamic', () => {
    expect(a.dynamicCallers).toEqual(['Dyn']);
  });
  it('treats a literal prefix as dynamic unless the index resolved the call', () => {
    const b = analyse(input([
      proc('Prefix', { prolog: "ExecuteProcess('Load_' | pRegion);" }),
      proc('Async', { data: "RunProcess('Load_' | pRegion);" }),
      proc('Static', { prolog: "ExecuteProcess('Load_EU');" }),
    ], { calls: [{ caller: 'Static', callee: 'Load_EU', section: 'prolog', line: 0 }] }));
    expect(b.dynamicCallers).toEqual(['Async', 'Prefix']);
  });
  it('usage not evidenced = no run, no active chore, no caller; control processes excluded', () => {
    expect(a.usageNotEvidenced.map(r => r.process)).toEqual(['Caller', 'Dyn', 'Orphan']);
    expect(a.controlProcessCount).toBe(1);
  });
});

describe('analyse — cube rules', () => {
  it('finds literal control-cube access in rules, not in comments, and keeps it out of process counts', () => {
    const a = analyse(input([proc('Sales', { prolog: "ExecuteCommand('x', 0);" })], {
      cubeRules: [{ cube: 'Sales', rules: "# DB('}CubeProperties', !Cube, 'LOGGING')\n['x'] = S: DB('}CubeProperties', 'Sales', 'LOGGING');" }],
    }));
    const g = a.groups.find(x => x.rule === 'control-cube')!;
    expect(g.occurrences).toEqual([{ process: 'Sales', rules: true, line: 1, detail: '}CubeProperties' }]);
    expect(a.rulesCubeCount).toBe(1);
    // The cube "Sales" must not make the process "Sales" a blocked callee.
    expect(a.affectedViaCall).toEqual([]);
  });
});

describe('analyse — removed names outside the signatures', () => {
  it('finds catalog-only names, keeps the replacement, and skips comments and strings', () => {
    const a = analyse(input([proc('A', { prolog: "# SAPOpen('x');\ns = 'SAPOpen';\nSAPOpen('x');\nRefreshSecurity;\nCubeSetSlicerMembers('c', 'a', 'b');" })]));
    const g = (k: string) => a.groups.find(x => x.rule === 'removed-function' && x.key === k);
    expect(g('SAPOpen')?.occurrences.map(o => o.line)).toEqual([2]);
    expect(g('SAPOpen')?.evidence).toBe('reported');
    expect(g('RefreshSecurity')?.replacement).toBe('SecurityRefresh');
    expect(g('CubeSetSlicerMembers')?.evidence).toBe('measured');
  });
});

describe('analyse — names the migration utility rejects', () => {
  it('groups by object kind, names the offending characters, skips }tp_ objects', () => {
    const a = analyse(input([], { objects: [
      { kind: 'cube', name: 'Plan, Ist' },
      { kind: 'cube', name: 'Sales' },
      { kind: 'view', name: "Mgr's view", parent: 'Sales' },
      { kind: 'subset', name: 'A/B', parent: 'Region' },
      { kind: 'subset', name: 'x;y', parent: '}tp_Region' },
      { kind: 'dimension', name: 'Ok_Name-1 (2)' },
    ] }));
    const keys = a.groups.filter(g => g.rule === 'invalid-name').map(g => [g.key, g.occurrences.map(o => [o.process, o.detail])]);
    expect(keys).toEqual(expect.arrayContaining([
      ['cube', [['Plan, Ist', ',']]],
      ['view', [["Sales / Mgr's view", "'"]]],
      ['subset', [['Region / A/B', '/']]],
    ]));
    expect(keys).toHaveLength(3);
  });
});

describe('analyse — TM1 Applications', () => {
  it('keeps }tp_ processes out of every count and reports them apart', () => {
    const a = analyse(input([
      proc('}tp_workflow', { prolog: "ExecuteCommand('x', 0);" }),
      proc('}tp_clean', {}),
      proc('A', { prolog: "ExecuteProcess('}tp_workflow');" }),
    ], {
      tpChores: 2,
      calls: [{ caller: 'A', callee: '}tp_workflow', section: 'prolog', line: 0 }],
    }));
    expect(a.groups).toEqual([]);
    expect(a.tm1Applications).toEqual({ processes: 2, chores: 2, withBlocker: ['}tp_workflow'] });
    expect(a.processCount).toBe(1);
    expect(a.affectedViaCall).toEqual([{ process: 'A', callees: ['}tp_workflow'] }]);
  });
});

describe('analyse — tm1s.cfg', () => {
  it('reports set parameters IBM lists, once each, as one configuration cause', () => {
    const a = analyse(input([], { configParams: [
      { name: 'ServerName', path: 'ServerName', value: 'x' },
      { name: 'ServerName', path: 'Administration.ServerName', value: 'x' },
      { name: 'HTTPPortNumber', path: 'Access.HTTP.Port', value: '12357' },
      { name: 'Language', path: 'Administration.Language', value: 'deu' },
    ] }));
    const g = a.groups.find(x => x.rule === 'cfg-param')!;
    expect(g.severity).toBe('config');
    expect(g.occurrences.map(o => o.process)).toEqual(['ServerName', 'HTTPPortNumber']);
  });

  it('masks credential and key values', () => {
    const a = analyse(input([], { configParams: [
      { name: 'ODBCPassword', path: 'ODBCPassword', value: 'hunter2' },
      { name: 'LDAPWellKnownUserName', path: 'LDAPWellKnownUserName', value: 'svc' },
      { name: 'SSLPrivateKeyPwdFile', path: 'SSLPrivateKeyPwdFile', value: 'k.dat' },
    ] }));
    const g = a.groups.find(x => x.rule === 'cfg-param')!;
    expect(g.occurrences.map(o => o.detail)).toEqual(['***', '***', '***']);
  });
});

describe('analyse — compile check', () => {
  it('keeps a compiler error that no static blocker in the same statement explains', () => {
    const a = analyse(input([
      proc('P', { prolog: "AsciiOutput('C:\\out.csv', 'x');", data: "\n\n\n\n\n\n\n\nx = missing;" }),
      proc('Q', { prolog: "nX = 1;\nSaveDataAll\n;" }),
    ], { compile: { server: 'v12', checked: 2, partial: false, notCheckable: [], failures: [
      { process: 'P', section: 'data', line: 8, message: "Variable 'missing' undefined." },
      { process: 'Q', section: 'prolog', line: 2, message: 'Syntax error on or before: \n;' },
    ] } }));
    expect(a.groups.filter(g => g.rule === 'compile-error').flatMap(g => g.occurrences.map(o => o.process))).toEqual(['P']);
    expect(a.groups.some(g => g.rule === 'file-path')).toBe(true);
    expect(a.compileSummary).toMatchObject({ rejected: 2, alsoStatic: 1 });
  });
  it('lists only rejections the rules did not explain, and counts both', () => {
    const a = analyse(input([
      proc('Saver', { prolog: 'SaveDataAll;' }),
      proc('Odd', { data: "\nx = SCAN('0H', v10);" }),
      proc('Fine', {}),
    ], { compile: { server: 'v12', version: '12.5.9', checked: 3, partial: false, notCheckable: ['}tp_x', 'Fine'], failures: [
      { process: 'Saver', section: 'prolog', line: 0, message: 'Syntax error on or before: \n;' },
      { process: 'Odd', section: 'data', line: 1, message: "Variable 'v10' is undefined.\nx = SCAN('0H', v10);" },
    ] } }));
    const g = a.groups.filter(x => x.rule === 'compile-error');
    expect(g.map(x => [x.key, x.occurrences.map(o => [o.process, o.section, o.line])]))
      .toEqual([["Variable '…' is undefined.", [['Odd', 'data', 1]]]]);
    expect(a.compileSummary).toEqual({ server: 'v12', version: '12.5.9', checked: 3, partial: false, rejected: 2, alsoStatic: 1, notCheckable: 1 });
  });
});

describe('analyse — MDX', () => {
  it('finds measured forms in TI strings, not in comments', () => {
    const a = analyse(input([proc('A', { prolog: [
      "# SubsetCreateByMDX('s', 'TM1ROLLUP({[d].[x]}, {[d].[y]})', 'd');",
      "SubsetCreateByMDX('s', 'GENERATE(S, {S.Current})', 'd');",
      "SubsetCreateByMDX('t', 'GENERATE(S, {[d].[d].CurrentMember})', 'd');",
      "SubsetCreateByMDX('u', 'TM1TupleSize([d].[x])', 'd');",
    ].join('\n') })]));
    const keys = a.groups.filter(g => g.rule === 'mdx').map(g => [g.key, g.occurrences.map(o => o.line)]);
    expect(keys.sort()).toEqual([['.Current', [1]], ['TM1TupleSize', [3]]]);
  });

  it('ignores an MDX name inside a plain string test', () => {
    const a = analyse(input([proc('A', { data: "If( Scan( 'TM1SUBSETBASIS()', Upper( sMDX ) ) = 0 );\nsMdx = '{TM1SubsetBasis()}';" })]));
    expect(a.groups.filter(g => g.rule === 'mdx').flatMap(g => g.occurrences.map(o => o.line))).toEqual([1]);
  });

  it('checks stored MDX for a trailing semicolon', () => {
    const a = analyse(input([], { mdxSources: [
      { kind: 'subset', owner: 'Region', name: 'A', mdx: '{TM1SUBSETALL([Region])};' },
      { kind: 'view', owner: 'Sales', name: 'V', mdx: 'SELECT {TM1ROLLUP({[r].[a]},{[r].[b]})} ON 0 FROM [Sales]' },
    ] }));
    const g = (k: string) => a.groups.find(x => x.rule === 'mdx' && x.key === k)?.occurrences.map(o => o.process);
    expect(g('trailing ;')).toEqual(['Region / A']);
    expect(g('TM1ROLLUP')).toEqual(['Sales / V']);
  });
});

describe('toSourceProcess — what the compile check needs', () => {
  it('keeps variable positions (12.5.9 refuses the call without) and drops parameter defaults', async () => {
    const { toSourceProcess } = await import('../../commands/v12Readiness/scan');
    const p = toSourceProcess({
      Name: 'P',
      Parameters: [{ Name: 'pYear', Type: 'String', Value: 'secret-default', Prompt: 'x' }],
      Variables: [{ Name: 'v1', Type: 'String' }, { Name: 'v2', Type: 'Numeric', Position: 7 } as never],
      DataSource: { Type: 'ODBC', dataSourceNameForServer: 'DWH', password: 'pw', userName: 'u' } as never,
    });
    expect(p.variables).toEqual([{ Name: 'v1', Type: 'String', Position: 1 }, { Name: 'v2', Type: 'Numeric', Position: 7 }]);
    expect(JSON.stringify(p)).not.toMatch(/secret-default|"pw"|userName/);
  });
});

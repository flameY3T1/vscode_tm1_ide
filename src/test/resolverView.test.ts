import { describe, it, expect } from 'vitest';
import { buildResolverView, lookupIdentifierInfo } from '../references/resolverView';

function empty() {
  return { prolog: '', metadata: '', data: '', epilog: '' };
}

describe('buildResolverView', () => {
  it('returns empty list for empty input', () => {
    expect(buildResolverView(empty(), [])).toEqual([]);
  });

  it('ignores unknown functions', () => {
    const input = { ...empty(), prolog: `MyCustomFunc('x', 'y');\n` };
    expect(buildResolverView(input, [])).toEqual([]);
  });

  it('detects a single CellPutN call and resolves literal args', () => {
    const input = {
      ...empty(),
      prolog: `CellPutN(100, 'SalesCube', 'Jan', 'North');\n`,
    };
    const rows = buildResolverView(input, []);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.section).toBe('prolog');
    expect(r.line).toBe(1);
    expect(r.funcName).toBe('CellPutN');
    expect(r.args).toHaveLength(4);
    expect(r.args[0]).toMatchObject({ name: 'Value',    kind: 'literal', display: '"100"' });
    expect(r.args[1]).toMatchObject({ name: 'CubeName', kind: 'literal', display: '"SalesCube"' });
    expect(r.args[2]).toMatchObject({ kind: 'literal', display: '"Jan"' });
    expect(r.args[3]).toMatchObject({ kind: 'literal', display: '"North"' });
  });

  it('resolves a variable bound to a literal', () => {
    const input = {
      ...empty(),
      prolog: `sYear = '2026';\nCellPutN(5, 'SalesCube', sYear);\n`,
    };
    const rows = buildResolverView(input, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].args[2]).toMatchObject({ raw: 'sYear', kind: 'literal', display: '"2026"' });
  });

  it('resolves a variable bound to a param as param-ref', () => {
    const input = {
      ...empty(),
      prolog: `sMonth = pMonth;\nCellPutN(5, 'SalesCube', sMonth);\n`,
    };
    const rows = buildResolverView(input, ['pMonth']);
    expect(rows).toHaveLength(1);
    expect(rows[0].args[2]).toMatchObject({ raw: 'sMonth', kind: 'param', display: '«pMonth»' });
  });

  it('uses the most recent assignment when a variable is re-assigned (last-wins)', () => {
    const input = {
      ...empty(),
      prolog: `sVar = '2026';\nsVar = 'later';\nCellPutN(5, 'SalesCube', sVar);\n`,
    };
    const rows = buildResolverView(input, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].args[2]).toMatchObject({ kind: 'literal', display: '"later"' });
  });

  it('marks unknown variables (no assignment) as dynamic', () => {
    const input = { ...empty(), prolog: `CellPutN(5, 'SalesCube', sUnknown);\n` };
    const rows = buildResolverView(input, []);
    expect(rows[0].args[2]).toMatchObject({ kind: 'dynamic', display: '«dynamic»' });
  });

  it('resolves cumulatively across sections (env from prolog visible in data)', () => {
    const input = {
      prolog: `sCube = 'SalesCube';\n`,
      metadata: '',
      data: `CellPutN(10, sCube, 'Jan');\n`,
      epilog: '',
    };
    const rows = buildResolverView(input, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe('data');
    expect(rows[0].args[1]).toMatchObject({ raw: 'sCube', kind: 'literal', display: '"SalesCube"' });
  });

  it('handles multiple calls per line independently (including IF-control-flow)', () => {
    const input = {
      ...empty(),
      prolog: `IF( CubeExists('A') = 1 & CubeExists('B') = 1 );\n`,
    };
    const rows = buildResolverView(input, []);
    // IF itself + 2× CubeExists = 3 rows
    expect(rows).toHaveLength(3);
    const funcNames = rows.map(r => r.funcName);
    expect(funcNames).toContain('IF');
    expect(funcNames.filter(n => n === 'CubeExists')).toHaveLength(2);
    const cubeRows = rows.filter(r => r.funcName === 'CubeExists');
    expect(cubeRows[0].args[0].display).toBe('"A"');
    expect(cubeRows[1].args[0].display).toBe('"B"');
  });

  it('recognizes IF as a control-flow pseudo-call with Condition arg', () => {
    const input = { ...empty(), prolog: `x = 'y';\nIF(x @= '1');\n` };
    const rows = buildResolverView(input, []);
    const ifRow = rows.find(r => r.funcName === 'IF');
    expect(ifRow).toBeDefined();
    expect(ifRow!.args[0].name).toBe('Condition');
    // The whole condition is not a simple identifier → dynamic (complex expression)
    expect(ifRow!.args[0].raw).toContain('@=');
  });

  it('reports correct local line number within each section', () => {
    const input = {
      prolog: `# comment\nCellPutN(1, 'A', 'x');\n`,
      metadata: '',
      data: `# other\n# other\nCellPutN(2, 'B', 'y');\n`,
      epilog: '',
    };
    const rows = buildResolverView(input, []);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ section: 'prolog', line: 2 });
    expect(rows[1]).toMatchObject({ section: 'data',   line: 3 });
  });

  it('resolves param with type in display', () => {
    const input = { ...empty(), prolog: `CellPutN(5, 'SalesCube', pMonth);\n` };
    const rows = buildResolverView(input, ['pMonth'], {
      params: [{ name: 'pMonth', type: 'String' }],
    });
    expect(rows[0].args[2]).toMatchObject({ kind: 'param', display: '«pMonth: String»' });
  });

  it('detects datasource variable usage and shows type', () => {
    const input = { ...empty(), prolog: `CellPutN(5, 'SalesCube', V2);\n` };
    const rows = buildResolverView(input, [], {
      datasourceVars: [{ name: 'V2', type: 'String' }],
    });
    expect(rows[0].args[2]).toMatchObject({ kind: 'datasource', display: '«V2: String»' });
  });

  it('propagates datasource kind through a local variable', () => {
    const input = { ...empty(), prolog: `sKey = V2;\nCellPutN(5, 'SalesCube', sKey);\n` };
    const rows = buildResolverView(input, [], {
      datasourceVars: [{ name: 'V2', type: 'String' }],
    });
    expect(rows[0].args[2]).toMatchObject({ kind: 'datasource', display: '«V2: String»' });
  });

  it('renders ExecuteProcess as ProcessName + name/value pairs', () => {
    const input = {
      ...empty(),
      prolog: `ExecuteProcess('SubProc', 'pYear', '2026', 'pMonth', pMonth);\n`,
    };
    const rows = buildResolverView(input, ['pMonth'], {
      params: [{ name: 'pMonth', type: 'String' }],
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.funcName).toBe('ExecuteProcess');
    expect(r.args).toHaveLength(3);
    expect(r.args[0]).toMatchObject({ name: 'ProcessName', kind: 'literal', display: '"SubProc"' });
    expect(r.args[1]).toMatchObject({ name: 'pYear',       kind: 'literal', display: '"2026"'    });
    expect(r.args[2]).toMatchObject({ name: 'pMonth',      kind: 'param',   display: '«pMonth: String»' });
  });

  it('renders RunProcess same as ExecuteProcess', () => {
    const input = { ...empty(), prolog: `RunProcess('X', 'p1', 42);\n` };
    const rows = buildResolverView(input, []);
    expect(rows[0].funcName).toBe('RunProcess');
    expect(rows[0].args).toHaveLength(2);
    expect(rows[0].args[0]).toMatchObject({ name: 'ProcessName', display: '"X"' });
    expect(rows[0].args[1]).toMatchObject({ name: 'p1', kind: 'literal', display: '"42"' });
  });

  it('falls back to raw expression when param-name is not a literal', () => {
    const input = { ...empty(), prolog: `ExecuteProcess('P', sParam, 'val');\n` };
    const rows = buildResolverView(input, []);
    expect(rows[0].args).toHaveLength(2);
    // sParam is not a literal → name stays "sParam" (raw)
    expect(rows[0].args[1]).toMatchObject({ name: 'sParam', kind: 'literal', display: '"val"' });
  });

  it('handles orphan last arg in ExecuteProcess (odd count)', () => {
    const input = { ...empty(), prolog: `ExecuteProcess('P', 'onlyName');\n` };
    const rows = buildResolverView(input, []);
    expect(rows[0].args).toHaveLength(2);
    expect(rows[0].args[0]).toMatchObject({ name: 'ProcessName', display: '"P"' });
    // 'onlyName' on its own → display shows the literal value
    expect(rows[0].args[1]).toMatchObject({ kind: 'literal', display: '"onlyName"' });
  });

  it('extracts identifier parts from a dynamic IF condition', () => {
    const input = {
      ...empty(),
      prolog: `x = 'd';\nIF(x @= 'd');\n`,
    };
    const rows = buildResolverView(input, []);
    const ifRow = rows.find(r => r.funcName === 'IF')!;
    expect(ifRow.args[0].kind).toBe('dynamic');
    expect(ifRow.args[0].parts).toBeDefined();
    expect(ifRow.args[0].parts!).toHaveLength(1);
    expect(ifRow.args[0].parts![0]).toMatchObject({ identifier: 'x', kind: 'literal', display: '"d"' });
  });

  it('extracts multiple identifiers with mixed kinds from a dynamic expression', () => {
    const input = {
      ...empty(),
      prolog: `sCube = 'SalesCube';\nCellPutN(sCube | pMonth | V2, 'X', 'y');\n`,
    };
    const rows = buildResolverView(input, ['pMonth'], {
      params: [{ name: 'pMonth', type: 'String' }],
      datasourceVars: [{ name: 'V2', type: 'String' }],
    });
    const row = rows.find(r => r.funcName === 'CellPutN')!;
    const firstArg = row.args[0];
    expect(firstArg.kind).toBe('dynamic');
    expect(firstArg.parts).toBeDefined();
    const idents = firstArg.parts!.map(p => p.identifier);
    expect(idents).toContain('sCube');
    expect(idents).toContain('pMonth');
    expect(idents).toContain('V2');
    const byId = Object.fromEntries(firstArg.parts!.map(p => [p.identifier, p]));
    expect(byId['sCube']).toMatchObject({ kind: 'literal',    display: '"SalesCube"' });
    expect(byId['pMonth']).toMatchObject({ kind: 'param',     display: '«pMonth: String»' });
    expect(byId['V2']).toMatchObject({     kind: 'datasource', display: '«V2: String»' });
  });

  it('skips unresolvable identifiers in dynamic parts', () => {
    const input = { ...empty(), prolog: `IF(unknownX @= '1');\n` };
    const rows = buildResolverView(input, []);
    const ifRow = rows.find(r => r.funcName === 'IF')!;
    expect(ifRow.args[0].kind).toBe('dynamic');
    // unknownX → dynamic binding → is not included in parts
    expect(ifRow.args[0].parts).toBeUndefined();
  });

  it('does not set parts when arg is already resolvable', () => {
    const input = { ...empty(), prolog: `CellPutN(5, 'SalesCube', 'x');\n` };
    const rows = buildResolverView(input, []);
    for (const a of rows[0].args) {
      expect(a.parts).toBeUndefined();
    }
  });

  it('dedups parts and skips reserved words and known function names', () => {
    const input = {
      ...empty(),
      prolog: `x = 'a';\nIF(x @= 'z' & x @= 'y' & CubeExists('C') = 1);\n`,
    };
    const rows = buildResolverView(input, []);
    const ifRow = rows.find(r => r.funcName === 'IF')!;
    const parts = ifRow.args[0].parts ?? [];
    // x is captured once (dedup); CubeExists (function) is ignored
    expect(parts.filter(p => p.identifier === 'x')).toHaveLength(1);
    expect(parts.some(p => p.identifier.toLowerCase() === 'cubeexists')).toBe(false);
  });
});

describe('lookupIdentifierInfo', () => {
  it('returns null for unknown identifier', () => {
    expect(lookupIdentifierInfo('foobar', '', 0, [])).toBeNull();
  });

  it('returns function info for known function', () => {
    const info = lookupIdentifierInfo('CellPutN', '', 0, []);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('function');
    expect(info!.title).toContain('CellPutN');
    expect(info!.title).toContain('→');
  });

  it('returns param info with type', () => {
    const info = lookupIdentifierInfo('pMonth', '', 0, ['pMonth'], {
      params: [{ name: 'pMonth', type: 'String' }],
    });
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('param');
    expect(info!.title).toBe('pMonth');
    expect(info!.details.some(d => d.includes('String'))).toBe(true);
  });

  it('returns datasource info', () => {
    const info = lookupIdentifierInfo('V2', '', 0, [], {
      datasourceVars: [{ name: 'V2', type: 'String' }],
    });
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('datasource');
    expect(info!.title).toBe('V2');
  });

  it('returns local-literal info for variable bound to literal', () => {
    const text = `sYear = '2026';\n`;
    const info = lookupIdentifierInfo('sYear', text, 1, []);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('local-literal');
    expect(info!.details.some(d => d.includes('2026'))).toBe(true);
  });

  it('returns the most recent assignment for a re-assigned variable (last-wins)', () => {
    const text = `sX = 'A';\nsX = 'B';\n`;
    const info = lookupIdentifierInfo('sX', text, 2, []);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('local-literal');
    expect(info!.details.some(d => d.includes('"B"'))).toBe(true);
  });

  it('returns local-dynamic info for variable whose latest assignment is a function call', () => {
    const text = `sX = 'A';\nsX = CellGetS('C', 'a', 'b');\n`;
    const info = lookupIdentifierInfo('sX', text, 2, []);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('local-dynamic');
  });
});

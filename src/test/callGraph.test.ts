import { describe, it, expect } from 'vitest';
import { buildReferenceIndex } from '../references/referenceIndex';
import { extractTiReferences } from '../references/refExtract';
import { buildProcessEnv } from '../references/variableEnv';
import { buildCallGraph, flattenCallGraph, resolveEdgeParam, EffectiveValue, buildCubeOrDimUsages, countDirectCalls } from '../references/callGraph';

const emptyEnv = buildProcessEnv('', []);

// ─── extractTiReferences — params on ExecuteProcess ──────────────────────────

describe('extractTiReferences — ExecuteProcess params', () => {
  it('captures literal string param values', () => {
    const refs = extractTiReferences("ExecuteProcess('Child', 'pRegion', 'UK', 'pYear', 2026);");
    expect(refs).toHaveLength(1);
    expect(refs[0].params).toEqual([
      { name: 'pRegion', resolution: { kind: 'literal', value: 'UK' },   valueRaw: "'UK'" },
      { name: 'pYear',   resolution: { kind: 'literal', value: '2026' }, valueRaw: '2026' },
    ]);
  });

  it('marks unknown variable values as dynamic', () => {
    const refs = extractTiReferences("ExecuteProcess('Child', 'pRegion', sRegion, 'pYear', nYear);");
    expect(refs[0].params?.[0].resolution).toEqual({ kind: 'dynamic' });
    expect(refs[0].params?.[1].resolution).toEqual({ kind: 'dynamic' });
  });

  it('resolves local var assigned to literal → literal', () => {
    const text = "sRegion = 'UK';\nExecuteProcess('Child', 'pRegion', sRegion);";
    const env = buildProcessEnv(text, []);
    const refs = extractTiReferences(text, env);
    const ep = refs.find(r => r.funcName === 'ExecuteProcess');
    expect(ep?.params?.[0].resolution).toEqual({ kind: 'literal', value: 'UK' });
  });

  it('resolves local var assigned to caller-param → passthrough', () => {
    const text = "sCopy = pRegion;\nExecuteProcess('Child', 'pRegion', sCopy);";
    const env = buildProcessEnv(text, ['pRegion']);
    const refs = extractTiReferences(text, env);
    const ep = refs.find(r => r.funcName === 'ExecuteProcess');
    expect(ep?.params?.[0].resolution).toEqual({ kind: 'passthrough', paramName: 'pRegion' });
  });

  it('direct param reference at call site → passthrough', () => {
    const text = "ExecuteProcess('Child', 'pRegion', pRegion);";
    const env = buildProcessEnv(text, ['pRegion']);
    const refs = extractTiReferences(text, env);
    expect(refs[0].params?.[0].resolution).toEqual({ kind: 'passthrough', paramName: 'pRegion' });
  });

  it('multi-assigned local var → last-assignment-wins at call site (flow-sensitive)', () => {
    const text = "sX = 'A';\nsX = 'B';\nExecuteProcess('Child', 'pX', sX);";
    const env = buildProcessEnv(text, []);
    const refs = extractTiReferences(text, env);
    const ep = refs.find(r => r.funcName === 'ExecuteProcess');
    expect(ep?.params?.[0].resolution).toEqual({ kind: 'literal', value: 'B' });
  });

  it('orchestrator pattern: reassigned var before each call → separate refs per call', () => {
    const text = [
      "sProc = 'Alpha';",
      "ExecuteProcess(sProc);",
      "sProc = 'Beta';",
      "ExecuteProcess(sProc);",
    ].join('\n');
    const env = buildProcessEnv(text, []);
    const refs = extractTiReferences(text, env);
    const processRefs = refs.filter(r => r.targetKind === 'process');
    expect(processRefs.map(r => r.targetName)).toEqual(['Alpha', 'Beta']);
  });

  it('string concatenation → dynamic', () => {
    const refs = extractTiReferences("ExecuteProcess('Child', 'pDate', '2026-' | sMonth);", emptyEnv);
    expect(refs[0].params?.[0].resolution).toEqual({ kind: 'dynamic' });
  });

  it('ExecuteProcess without params yields empty params array', () => {
    const refs = extractTiReferences("ExecuteProcess('Child');");
    expect(refs[0].params).toEqual([]);
  });

  it('odd number of param args skips the dangling single arg', () => {
    const refs = extractTiReferences("ExecuteProcess('Child', 'pRegion');");
    expect(refs[0].params).toEqual([]);
  });

  it('skips param pair with dynamic param name', () => {
    const refs = extractTiReferences("ExecuteProcess('Child', sParamName, 'val');");
    expect(refs[0].params).toEqual([]);
  });

  it('RunProcess gets the same param treatment', () => {
    const refs = extractTiReferences("RunProcess('Child', 'pX', 'v');");
    expect(refs[0].params).toEqual([
      { name: 'pX', resolution: { kind: 'literal', value: 'v' }, valueRaw: "'v'" },
    ]);
  });

  it('CellGetN does not get params field (not a process call)', () => {
    const refs = extractTiReferences("CellGetN('Cube', 'x');");
    expect(refs[0].params).toBeUndefined();
  });
});

// ─── resolveEdgeParam ────────────────────────────────────────────────────────

describe('resolveEdgeParam', () => {
  const literalEnv = new Map<string, EffectiveValue>([
    ['pregion', { kind: 'literal', value: 'DE' }],
    ['pyear',   { kind: 'unknown', viaParam: 'pYear' }],
  ]);

  it('literal resolves to literal', () => {
    expect(resolveEdgeParam({ kind: 'literal', value: 'X' }, literalEnv))
      .toEqual({ kind: 'literal', value: 'X' });
  });

  it('dynamic resolves to dynamic', () => {
    expect(resolveEdgeParam({ kind: 'dynamic' }, literalEnv))
      .toEqual({ kind: 'dynamic' });
  });

  it('passthrough to literal parent → literal', () => {
    expect(resolveEdgeParam({ kind: 'passthrough', paramName: 'pRegion' }, literalEnv))
      .toEqual({ kind: 'literal', value: 'DE' });
  });

  it('passthrough to unknown parent → unknown (propagates origin)', () => {
    expect(resolveEdgeParam({ kind: 'passthrough', paramName: 'pYear' }, literalEnv))
      .toEqual({ kind: 'unknown', viaParam: 'pYear' });
  });

  it('passthrough to missing parent → unknown', () => {
    expect(resolveEdgeParam({ kind: 'passthrough', paramName: 'pMissing' }, literalEnv))
      .toEqual({ kind: 'unknown', viaParam: 'pMissing' });
  });
});

// ─── buildCallGraph ──────────────────────────────────────────────────────────

const mkIndex = (processes: Array<{ name: string; calls?: Array<[string, string?]> }>) => {
  return buildReferenceIndex({
    fetchProcesses: async () => processes.map(p => ({
      name: p.name,
      prolog: (p.calls ?? [])
        .map(([callee, params]) => `ExecuteProcess('${callee}'${params ? `, ${params}` : ''});`)
        .join('\n'),
      metadata: '', data: '', epilog: '',
    })),
    fetchCubesWithRules: async () => [],
  });
};

describe('buildCallGraph — downstream', () => {
  it('builds single-level downstream tree', async () => {
    const idx = await mkIndex([
      { name: 'Root', calls: [['A', "'pX', 1"], ['B']] },
      { name: 'A' },
      { name: 'B' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.process).toBe('Root');
    expect(tree.children.map(c => c.process)).toEqual(['A', 'B']);
    expect(tree.children[0].incomingEdge?.params).toEqual([
      { name: 'pX', resolution: { kind: 'literal', value: '1' }, valueRaw: '1' },
    ]);
  });

  it('builds multi-level downstream tree', async () => {
    const idx = await mkIndex([
      { name: 'Root',  calls: [['Mid']] },
      { name: 'Mid',   calls: [['Leaf']] },
      { name: 'Leaf' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.children[0].process).toBe('Mid');
    expect(tree.children[0].children[0].process).toBe('Leaf');
  });

  it('detects cycles without infinite recursion', async () => {
    const idx = await mkIndex([
      { name: 'A', calls: [['B']] },
      { name: 'B', calls: [['A']] },  // cycle
    ]);
    const tree = buildCallGraph(idx, 'A', { direction: 'downstream' });
    const nodeB = tree.children[0];
    expect(nodeB.process).toBe('B');
    expect(nodeB.cycle).toBe(false);            // B is not yet an ancestor when we visit it
    const nodeAAgain = nodeB.children[0];
    expect(nodeAAgain.process).toBe('A');
    expect(nodeAAgain.cycle).toBe(true);        // A is already on the path — marked as cycle
    expect(nodeAAgain.children).toEqual([]);    // no further expansion
  });

  it('self-recursion is detected', async () => {
    const idx = await mkIndex([
      { name: 'Self', calls: [['Self']] },
    ]);
    const tree = buildCallGraph(idx, 'Self', { direction: 'downstream' });
    expect(tree.children[0].process).toBe('Self');
    expect(tree.children[0].cycle).toBe(true);
  });

  it('respects maxDepth', async () => {
    const idx = await mkIndex([
      { name: 'A', calls: [['B']] },
      { name: 'B', calls: [['C']] },
      { name: 'C', calls: [['D']] },
      { name: 'D' },
    ]);
    const tree = buildCallGraph(idx, 'A', { direction: 'downstream', maxDepth: 2 });
    // Depth 0 = root A, Depth 1 = B, Depth 2 should not expand B's children
    const nodeB = tree.children[0];
    expect(nodeB.process).toBe('B');
    // When depth === maxDepth, children are not expanded.
    // B is visited at depth=1, C would be depth=2 which is allowed; D would be at depth=3 → truncated.
    // Actually visit() checks depth >= maxDepth before expanding, so at depth=2 we stop before C expands.
    // Since C is a child at depth 2, C gets added; its children are truncated.
    expect(nodeB.children[0].process).toBe('C');
    expect(nodeB.children[0].children).toEqual([]);
    expect(nodeB.children[0].depthLimitReached).toBe(true);
  });

  it('includeSystem=false filters system processes ({…}) from children', async () => {
    const idx = await mkIndex([
      { name: 'Root', calls: [['}bedrock.proc'], ['UserProc']] },
      { name: '}bedrock.proc' },
      { name: 'UserProc' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream', includeSystem: false });
    expect(tree.children.map(c => c.process)).toEqual(['UserProc']);
  });

  it('includeSystem=true (default) keeps system processes as children', async () => {
    const idx = await mkIndex([
      { name: 'Root', calls: [['}bedrock.proc'], ['UserProc']] },
      { name: '}bedrock.proc' },
      { name: 'UserProc' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.children.map(c => c.process).sort()).toEqual(['UserProc', '}bedrock.proc']);
  });

  it('includeSystem=false keeps root even when root starts with }', async () => {
    const idx = await mkIndex([
      { name: '}myRoot', calls: [['UserProc']] },
      { name: 'UserProc' },
    ]);
    const tree = buildCallGraph(idx, '}myRoot', { direction: 'downstream', includeSystem: false });
    expect(tree.process).toBe('}myRoot');
    expect(tree.children.map(c => c.process)).toEqual(['UserProc']);
  });

  it('includeSystem=false filters system callers in upstream direction', async () => {
    const idx = await mkIndex([
      { name: '}sysCaller', calls: [['Target']] },
      { name: 'UserCaller', calls: [['Target']] },
      { name: 'Target' },
    ]);
    const tree = buildCallGraph(idx, 'Target', { direction: 'upstream', includeSystem: false });
    expect(tree.children.map(c => c.process)).toEqual(['UserCaller']);
  });

  it('same caller→callee twice = two separate edges', async () => {
    // Both calls on different lines in same section
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [{
        name: 'P',
        prolog: "ExecuteProcess('Q', 'pX', 'A');\nExecuteProcess('Q', 'pX', 'B');",
        metadata: '', data: '', epilog: '',
      }, { name: 'Q', prolog: '', metadata: '', data: '', epilog: '' }],
      fetchCubesWithRules: async () => [],
    });
    const tree = buildCallGraph(idx, 'P', { direction: 'downstream' });
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].incomingEdge?.params?.[0].resolution).toEqual({ kind: 'literal', value: 'A' });
    expect(tree.children[1].incomingEdge?.params?.[0].resolution).toEqual({ kind: 'literal', value: 'B' });
  });
});

describe('buildCallGraph — env propagation through chain', () => {
  it('propagates root default through ExecuteProcess chain', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [
        {
          name: 'Root',
          parameters: ['pRegion'],
          parameterDefaults: new Map([['pRegion', 'DE']]),
          prolog: "ExecuteProcess('Mid', 'pRegion', pRegion);",
          metadata: '', data: '', epilog: '',
        },
        {
          name: 'Mid',
          parameters: ['pRegion'],
          prolog: "ExecuteProcess('Leaf', 'pRegion', pRegion);",
          metadata: '', data: '', epilog: '',
        },
        { name: 'Leaf', parameters: ['pRegion'], prolog: '', metadata: '', data: '', epilog: '' },
      ],
      fetchCubesWithRules: async () => [],
    });
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    // Root env has pRegion='DE' from default
    expect(tree.env?.get('pregion')).toEqual({ kind: 'literal', value: 'DE' });
    // Mid inherits literal via passthrough
    const mid = tree.children[0];
    expect(mid.env?.get('pregion')).toEqual({ kind: 'literal', value: 'DE' });
    // Leaf inherits too
    const leaf = mid.children[0];
    expect(leaf.env?.get('pregion')).toEqual({ kind: 'literal', value: 'DE' });
  });

  it('passes local literal explicitly overriding root default', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [
        {
          name: 'Root',
          parameters: ['pRegion'],
          parameterDefaults: new Map([['pRegion', 'DE']]),
          prolog: "ExecuteProcess('Child', 'pRegion', 'UK');",
          metadata: '', data: '', epilog: '',
        },
        { name: 'Child', parameters: ['pRegion'], prolog: '', metadata: '', data: '', epilog: '' },
      ],
      fetchCubesWithRules: async () => [],
    });
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.children[0].env?.get('pregion')).toEqual({ kind: 'literal', value: 'UK' });
  });

  it('unknown root param (no default) → unknown; passthrough propagates origin', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [
        {
          name: 'Root',
          parameters: ['pRegion'],
          // no default
          prolog: "ExecuteProcess('Child', 'pRegion', pRegion);",
          metadata: '', data: '', epilog: '',
        },
        { name: 'Child', parameters: ['pRegion'], prolog: '', metadata: '', data: '', epilog: '' },
      ],
      fetchCubesWithRules: async () => [],
    });
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.env?.get('pregion')).toEqual({ kind: 'unknown', viaParam: 'pRegion' });
    expect(tree.children[0].env?.get('pregion')).toEqual({ kind: 'unknown', viaParam: 'pRegion' });
  });

  it('passthrough through intermediate local var', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [
        {
          name: 'Root',
          parameters: ['pRegion'],
          parameterDefaults: new Map([['pRegion', 'FR']]),
          prolog: "sCopy = pRegion;\nExecuteProcess('Child', 'pRegion', sCopy);",
          metadata: '', data: '', epilog: '',
        },
        { name: 'Child', parameters: ['pRegion'], prolog: '', metadata: '', data: '', epilog: '' },
      ],
      fetchCubesWithRules: async () => [],
    });
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.children[0].env?.get('pregion')).toEqual({ kind: 'literal', value: 'FR' });
  });

  it('dynamic value stays dynamic through chain', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [
        {
          name: 'Root',
          parameters: ['pRegion'],
          parameterDefaults: new Map([['pRegion', 'DE']]),
          prolog: "sX = CellGetS('Config', 'Region');\nExecuteProcess('Child', 'pRegion', sX);",
          metadata: '', data: '', epilog: '',
        },
        { name: 'Child', parameters: ['pRegion'], prolog: '', metadata: '', data: '', epilog: '' },
      ],
      fetchCubesWithRules: async () => [],
    });
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    expect(tree.children[0].env?.get('pregion')).toEqual({ kind: 'dynamic' });
  });

  it('upstream tree does not populate env', async () => {
    const idx = await mkIndex([
      { name: 'Caller', calls: [['Leaf']] },
      { name: 'Leaf' },
    ]);
    const tree = buildCallGraph(idx, 'Leaf', { direction: 'upstream' });
    expect(tree.env).toBeUndefined();
    expect(tree.children[0].env).toBeUndefined();
  });
});

describe('buildCallGraph — upstream', () => {
  it('lists callers of a leaf process', async () => {
    const idx = await mkIndex([
      { name: 'CallerA', calls: [['Leaf']] },
      { name: 'CallerB', calls: [['Leaf']] },
      { name: 'Leaf' },
    ]);
    const tree = buildCallGraph(idx, 'Leaf', { direction: 'upstream' });
    expect(tree.process).toBe('Leaf');
    expect(tree.children.map(c => c.process).sort()).toEqual(['CallerA', 'CallerB']);
  });

  it('walks up multi-level chain', async () => {
    const idx = await mkIndex([
      { name: 'Top',  calls: [['Mid']] },
      { name: 'Mid',  calls: [['Bottom']] },
      { name: 'Bottom' },
    ]);
    const tree = buildCallGraph(idx, 'Bottom', { direction: 'upstream' });
    expect(tree.children[0].process).toBe('Mid');
    expect(tree.children[0].children[0].process).toBe('Top');
  });
});

// ─── flattenCallGraph ────────────────────────────────────────────────────────

describe('flattenCallGraph', () => {
  it('depth-first order with correct depth', async () => {
    const idx = await mkIndex([
      { name: 'A', calls: [['B'], ['D']] },
      { name: 'B', calls: [['C']] },
      { name: 'C' },
      { name: 'D' },
    ]);
    const tree = buildCallGraph(idx, 'A', { direction: 'downstream' });
    const flat = flattenCallGraph(tree);
    expect(flat.map(x => `${x.depth}:${x.node.process}`)).toEqual([
      '0:A', '1:B', '2:C', '1:D',
    ]);
  });
});

// ─── buildCubeOrDimUsages ────────────────────────────────────────────────────

const mkIndexWithRules = (processes: Array<{ name: string; prolog?: string }> = [],
                         cubes: Array<{ cubeName: string; rulesText: string }> = []) => {
  return buildReferenceIndex({
    fetchProcesses: async () => processes.map(p => ({
      name: p.name,
      prolog: p.prolog ?? '',
      metadata: '', data: '', epilog: '',
    })),
    fetchCubesWithRules: async () => cubes,
  });
};

describe('buildCubeOrDimUsages', () => {
  it('returns process references that read from a cube', async () => {
    const idx = await mkIndexWithRules([
      { name: 'ReaderA', prolog: "x = CellGetN('Sales', 'Jan', 'UK');" },
      { name: 'ReaderB', prolog: "y = CellPutN(1, 'Sales', 'Feb', 'DE');" },
      { name: 'Other',   prolog: "z = CellGetN('Finance', 'Q1', 'FR');" },
    ]);
    const refs = buildCubeOrDimUsages(idx, 'cube', 'Sales');
    expect(refs.map(r => r.sourceName).sort()).toEqual(['ReaderA', 'ReaderB']);
    expect(refs.every(r => r.sourceKind === 'process')).toBe(true);
  });

  it('returns rule references (DB and cell-ref brackets)', async () => {
    const idx = await mkIndexWithRules([], [
      {
        cubeName: 'Finance',
        rulesText:
          "['Revenue'] = N: DB('Sales', !Month, !Region);\n" +
          "['Cost']    = N: DB('Expenses', !Month, !Region);\n",
      },
    ]);
    const refs = buildCubeOrDimUsages(idx, 'cube', 'Sales');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ sourceKind: 'rule', sourceName: 'Finance' });
  });

  it('filters out self-references (cube rules referencing own cube)', async () => {
    const idx = await mkIndexWithRules([], [
      {
        cubeName: 'Sales',
        rulesText:
          "['Revenue'] = N: DB('Sales', 'Jan', 'UK');\n" + // self-ref
          "['Cost']    = N: DB('Expenses', 'Jan', 'UK');\n",
      },
      {
        cubeName: 'Dashboard',
        rulesText: "['Total'] = N: DB('Sales', !Month, !Region);\n",
      },
    ]);
    const refs = buildCubeOrDimUsages(idx, 'cube', 'Sales');
    // Only Dashboard (not Sales' own rules) should appear
    expect(refs).toHaveLength(1);
    expect(refs[0].sourceName).toBe('Dashboard');
  });

  it('returns dimension references from processes and rules', async () => {
    const idx = await mkIndexWithRules(
      [{ name: 'Loader', prolog: "DimensionElementInsert('Month', '', 'Jan', 'N');" }],
      [{ cubeName: 'Sales', rulesText: "['Revenue'] = N: ['Month':'Total'] + 1;\n" }],
    );
    const refs = buildCubeOrDimUsages(idx, 'dimension', 'Month');
    expect(refs.some(r => r.sourceKind === 'process' && r.sourceName === 'Loader')).toBe(true);
    expect(refs.some(r => r.sourceKind === 'rule'    && r.sourceName === 'Sales')).toBe(true);
  });

  it('sorts by source name, then by line', async () => {
    const idx = await mkIndexWithRules([
      { name: 'Zeta',  prolog: "x = CellGetN('X', 'a');\ny = CellGetN('X', 'b');" },
      { name: 'Alpha', prolog: "x = CellGetN('X', 'a');" },
    ]);
    const refs = buildCubeOrDimUsages(idx, 'cube', 'X');
    expect(refs.map(r => `${r.sourceName}:${r.line}`)).toEqual(['Alpha:0', 'Zeta:0', 'Zeta:1']);
  });

  it('returns empty array when target not referenced', async () => {
    const idx = await mkIndexWithRules([]);
    expect(buildCubeOrDimUsages(idx, 'cube', 'Nonexistent')).toEqual([]);
    expect(buildCubeOrDimUsages(idx, 'dimension', 'Nonexistent')).toEqual([]);
  });

  it('includeSystem=false filters system-process sources', async () => {
    const idx = await mkIndexWithRules([
      { name: '}sysReader', prolog: "x = CellGetN('Sales', 'Jan', 'UK');" },
      { name: 'UserReader', prolog: "y = CellGetN('Sales', 'Feb', 'DE');" },
    ]);
    const refs = buildCubeOrDimUsages(idx, 'cube', 'Sales', { includeSystem: false });
    expect(refs.map(r => r.sourceName)).toEqual(['UserReader']);
  });

  it('includeSystem=false also filters system-cube rule sources', async () => {
    const idx = await mkIndexWithRules([], [
      { cubeName: '}StatsByCube', rulesText: "['X'] = N: DB('Sales', !Month);\n" },
      { cubeName: 'Dashboard',    rulesText: "['Y'] = N: DB('Sales', !Month);\n" },
    ]);
    const refs = buildCubeOrDimUsages(idx, 'cube', 'Sales', { includeSystem: false });
    expect(refs.map(r => r.sourceName)).toEqual(['Dashboard']);
  });
});

// ─── Chores as callers ─────────────────────────────────────────────────────

describe('buildCallGraph — the chore is a caller', () => {
  const mkChoreIndex = () => buildReferenceIndex({
    fetchProcesses: async () => [
      { name: 'Nightly.Load', prolog: '', metadata: '', data: '', epilog: '' },
      { name: 'Caller', prolog: "ExecuteProcess('Nightly.Load');", metadata: '', data: '', epilog: '' },
    ],
    fetchCubesWithRules: async () => [],
    fetchChores: async () => [
      {
        name: 'NightlyRun',
        tasks: [{
          step: 2,
          processName: 'Nightly.Load',
          params: [{ name: 'pDatum', value: '2026-09-19', type: 'string' as const }],
        }],
      },
      { name: '}SystemChore', tasks: [{ step: 0, processName: 'Nightly.Load', params: [] }] },
    ],
  });

  it('"called by" names the chore — it stands in NO source text', async () => {
    const idx = await mkChoreIndex();
    const tree = buildCallGraph(idx, 'Nightly.Load', { direction: 'upstream' });
    expect(tree.children.map(c => c.process).sort())
      .toEqual(['Caller', 'NightlyRun', '}SystemChore']);
    const chore = tree.children.find(c => c.process === 'NightlyRun');
    expect(chore?.kind).toBe('chore');
    expect(chore?.incomingEdge?.funcName).toBe('Chore');
    // `line` is the STEP in the chore, not a source line.
    expect(chore?.incomingEdge?.line).toBe(2);
    // The fixed task parameters come through as literals.
    expect(chore?.incomingEdge?.params).toEqual([
      { name: 'pDatum', resolution: { kind: 'literal', value: '2026-09-19' }, valueRaw: '2026-09-19' },
    ]);
    expect(tree.children.find(c => c.process === 'Caller')?.kind).toBe('process');
  });

  it('the chore name stands there in ITS spelling', async () => {
    const idx = await mkChoreIndex();
    const tree = buildCallGraph(idx, 'Nightly.Load', { direction: 'upstream' });
    // `choreTasks` is keyed in lower case; `nightlyrun` would be the key.
    expect(tree.children.some(c => c.process === 'NightlyRun')).toBe(true);
  });

  it('a chore is not followed further — nothing calls it', async () => {
    const idx = await mkChoreIndex();
    const tree = buildCallGraph(idx, 'Nightly.Load', { direction: 'upstream' });
    expect(tree.children.find(c => c.process === 'NightlyRun')?.children).toEqual([]);
  });

  it('includeSystem=false leaves out the control chore', async () => {
    const idx = await mkChoreIndex();
    const tree = buildCallGraph(idx, 'Nightly.Load',
      { direction: 'upstream', includeSystem: false });
    expect(tree.children.map(c => c.process).sort()).toEqual(['Caller', 'NightlyRun']);
  });

  it('downward, the chore does NOT show up', async () => {
    const idx = await mkChoreIndex();
    const tree = buildCallGraph(idx, 'Nightly.Load', { direction: 'downstream' });
    expect(tree.children).toEqual([]);
  });

  it('the number on the tab counts the chore too', async () => {
    const idx = await mkChoreIndex();
    expect(countDirectCalls(idx, 'Nightly.Load', { direction: 'upstream' })).toBe(3);
    expect(countDirectCalls(idx, 'Nightly.Load',
      { direction: 'upstream', includeSystem: false })).toBe(2);
  });
});

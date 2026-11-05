import { describe, it, expect } from 'vitest';
import { buildDependencyGraph, buildCubeFlow, flowChain, focusGraph, layoutGraph } from '../../references/lineagePure';
import type { ReferenceIndex, TmReference } from '../../references/referenceTypes';

const ref = (sourceName: string, funcName: string, targetKind: 'cube' | 'process', targetName: string): TmReference =>
  ({ sourceKind: 'process', sourceName, section: 'data', line: 0, snippet: '', funcName, targetKind, targetName });

const idx = {
  all: [
    ref('Load', 'ExecuteProcess', 'process', 'Load.Sub'),
    ref('Load.Sub', 'CellPutN', 'cube', 'Sales'),
    ref('Load.Sub', 'CellGetN', 'cube', 'Rates'),
    ref('Report', 'CellGetN', 'cube', 'Sales'),
    ref('Other', 'CellPutS', 'cube', 'Notes'),
    ref('Helper', 'ViewSubsetAssign', 'cube', 'Sales'),
    { ...ref('Load.Sub', 'DimensionElementInsert', 'cube', 'Region'), targetKind: 'dimension' },
    { ...ref('Report', 'DIMIX', 'cube', 'Region'), targetKind: 'dimension' },
    ref('}sys', 'ExecuteProcess', 'process', 'Load'),
    { sourceKind: 'rule', sourceName: 'Sales', section: 'rules', line: 0, snippet: '', funcName: 'DB', targetKind: 'cube', targetName: 'Rates' },
  ],
  processDataSources: new Map([
    ['load.sub', { processName: 'Load.Sub', declared: { type: 'ASCII', nameForServer: 'C:\\data\\sales.csv' }, assigned: [], fileDir: { key: 'dir:c:\\data\\', path: 'C:\\data\\' } }],
    ['report', { processName: 'Report', declared: { type: 'TM1CubeView', nameForServer: 'Sales' }, assigned: [] }],
  ]),
  choreTasks: new Map([['nightly', [{ step: 0, processName: 'Load', params: [] }]]]),
  choreCasing: new Map([['nightly', 'Nightly']]),
} as unknown as ReferenceIndex;

describe('buildDependencyGraph', () => {
  const g = buildDependencyGraph(idx, false);
  const has = (from: string, to: string, kind: string) => g.edges.some(e => e.from === from && e.to === to && e.kind === kind);

  it('turns chores, calls and cube access into edges in flow direction', () => {
    expect(has('chore:nightly', 'process:load', 'calls')).toBe(true);
    expect(has('process:load', 'process:load.sub', 'calls')).toBe(true);
    expect(has('process:load.sub', 'cube:sales', 'writes')).toBe(true);
    expect(has('cube:rates', 'process:load.sub', 'reads')).toBe(true);
  });

  it('leaves out non-data cube calls, rule references and hidden control objects', () => {
    expect(g.nodes.some(n => n.id === 'process:helper')).toBe(false);
    expect(g.nodes.some(n => n.id === 'process:}sys')).toBe(false);
    expect(has('cube:sales', 'cube:rates', 'reads')).toBe(false);
    expect(buildDependencyGraph(idx, true).nodes.some(n => n.id === 'process:}sys')).toBe(true);
  });
});

describe('focusGraph', () => {
  const g = buildDependencyGraph(idx, false);
  const names = (id: string) => focusGraph(g, id).nodes.sort();

  it('a process: its callers, its callees, and their cubes — not other readers of those cubes', () => {
    expect(names('process:load')).toEqual(['chore:nightly', 'cube:rates', 'cube:sales', 'process:load', 'process:load.sub', 'source:dir:c:\\data\\', 'source:dir:c:\\data\\|*']);
  });

  it('a cube: everything that reads or writes it, plus their callers — not their other cubes', () => {
    expect(names('cube:sales')).toEqual(['chore:nightly', 'cube:sales', 'process:load', 'process:load.sub', 'process:report']);
  });

  it('an unknown id gives nothing', () => {
    expect(focusGraph(g, 'process:nope')).toEqual({ nodes: [], edges: [] });
  });
});

describe('dimensions', () => {
  const g = buildDependencyGraph(idx, false);
  it('structure changes are writes, lookups are reads', () => {
    expect(g.edges).toContainEqual({ from: 'process:load.sub', to: 'dimension:region', kind: 'writes' });
    expect(g.edges).toContainEqual({ from: 'dimension:region', to: 'process:report', kind: 'reads' });
  });
  it('stay out of a process chain, but a focused dimension brings its users and their callers', () => {
    expect(focusGraph(g, 'process:load').nodes).not.toContain('dimension:region');
    expect(focusGraph(g, 'dimension:region').nodes.sort())
      .toEqual(['chore:nightly', 'dimension:region', 'process:load', 'process:load.sub', 'process:report']);
  });
});

describe('layoutGraph', () => {
  it('chores first, processes by call depth, cubes last — and survives a cycle', () => {
    const nodes = [
      { id: 'chore:c', kind: 'chore', name: 'c' },
      { id: 'process:a', kind: 'process', name: 'a' },
      { id: 'process:b', kind: 'process', name: 'b' },
      { id: 'cube:x', kind: 'cube', name: 'x' },
    ];
    const edges = [
      { from: 'chore:c', to: 'process:a', kind: 'calls' },
      { from: 'process:a', to: 'process:b', kind: 'calls' },
      { from: 'process:b', to: 'process:a', kind: 'calls' },
      { from: 'process:b', to: 'cube:x', kind: 'writes' },
    ];
    const pos = layoutGraph(nodes, edges);
    expect(['chore:c', 'process:a', 'process:b', 'cube:x'].map(id => pos.get(id)!.col)).toEqual([0, 1, 2, 3]);
  });
});

describe('cube flow', () => {
  const flow = buildCubeFlow(idx, false);
  const find = (from: string, to: string) => flow.edges.find(e => e.from === from && e.to === to);

  it('a process reading A and writing B links A → B', () => {
    expect(find('cube:rates', 'cube:sales')?.processes).toEqual(['Load.Sub']);
  });

  it('a rule pulling DB(B) in cube A links B → A; a feeder links the other way round', () => {
    expect(find('cube:rates', 'cube:sales')?.rule).toBe(true);   // rule in Sales pulls Rates
    const fed = buildCubeFlow({ ...idx, all: [
      { sourceKind: 'rule', sourceName: 'Rates', section: 'feeders', line: 0, snippet: '', funcName: 'DB', targetKind: 'cube', targetName: 'Sales' },
    ] } as unknown as ReferenceIndex, false);
    expect(fed.edges).toEqual([{ from: 'cube:rates', to: 'cube:sales', processes: [], rule: true }]);
  });

  it('the chain follows edges in their direction only, not across to siblings', () => {
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'a', to: 'x' }, { from: 'y', to: 'b' }];
    const c = flowChain(edges, ['b']);
    expect(c.nodes.sort()).toEqual(['a', 'b', 'c', 'y']);
    expect(c.edges.sort()).toEqual([0, 1, 3]);
  });
});

describe('external sources', () => {
  it('a file source becomes its folder, feeding the cube the process writes', () => {
    const g = buildDependencyGraph(idx, false);
    expect(g.nodes).toContainEqual({ id: 'source:dir:c:\\data\\', kind: 'source', name: 'C:\\data', title: 'C:\\data\\' });
    expect(g.nodes.some(n => n.id.startsWith('source:') && n.name === 'Sales')).toBe(false);   // cube view source stays a cube read
    const flow = buildCubeFlow(idx, false);
    expect(flow.edges.find(e => e.from === 'source:dir:c:\\data\\' && e.to === 'cube:sales')?.processes).toEqual(['Load.Sub']);
  });
});

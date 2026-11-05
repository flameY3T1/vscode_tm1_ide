import { describe, it, expect } from 'vitest';
import { buildReferenceIndex } from '../references/referenceIndex';
import { buildChoreGraph } from '../references/choreGraph';

async function mkIdx() {
  return buildReferenceIndex({
    fetchProcesses: async () => [
      {
        name: 'p.root',
        prolog: "ExecuteProcess('p.child', 'pX', pX);",
        metadata: '', data: '', epilog: '',
        parameters: ['pX'],
      },
      {
        name: 'p.child',
        prolog: '', metadata: '', data: '', epilog: '',
        parameters: ['pX'],
      },
      {
        name: 'p.standalone',
        prolog: '', metadata: '', data: '', epilog: '',
        parameters: [],
      },
    ],
    fetchCubesWithRules: async () => [],
    fetchChores: async () => [{
      name: 'DailyLoad',
      tasks: [
        { step: 0, processName: 'p.root',       params: [{ name: 'pX', value: 'A', type: 'string' as const }] },
        { step: 1, processName: 'p.standalone', params: [] },
      ],
    }],
  });
}

describe('buildChoreGraph', () => {
  it('returns null for unknown chore', async () => {
    const idx = await mkIdx();
    expect(buildChoreGraph(idx, 'nope')).toBeNull();
  });

  it('creates one ChoreTaskTree per task in order', async () => {
    const idx = await mkIdx();
    const g = buildChoreGraph(idx, 'DailyLoad');
    expect(g).not.toBeNull();
    expect(g!.choreName).toBe('DailyLoad');
    expect(g!.tasks).toHaveLength(2);
    expect(g!.tasks[0].step).toBe(0);
    expect(g!.tasks[0].processName).toBe('p.root');
    expect(g!.tasks[1].processName).toBe('p.standalone');
  });

  it('seeds the root env with chore params (literal)', async () => {
    const idx = await mkIdx();
    const g = buildChoreGraph(idx, 'DailyLoad')!;
    const rootEnv = g.tasks[0].tree.env!;
    expect(rootEnv.get('px')).toEqual({ kind: 'literal', value: 'A' });
  });

  it('propagates chore param into ExecuteProcess child', async () => {
    const idx = await mkIdx();
    const g = buildChoreGraph(idx, 'DailyLoad')!;
    const child = g.tasks[0].tree.children[0];
    expect(child.process).toBe('p.child');
    const ep = child.incomingEdge!.effectiveParams!.find(e => e.name.toLowerCase() === 'px')!;
    expect(ep.effective).toEqual({ kind: 'literal', value: 'A' });
  });

  it('is case-insensitive for chore name lookup', async () => {
    const idx = await mkIdx();
    expect(buildChoreGraph(idx, 'dailyload')).not.toBeNull();
    expect(buildChoreGraph(idx, 'DAILYLOAD')).not.toBeNull();
  });

  it('empty chore (no tasks) returns empty tasks list', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [],
      fetchCubesWithRules: async () => [],
      fetchChores: async () => [{ name: 'Empty', tasks: [] }],
    });
    const g = buildChoreGraph(idx, 'Empty')!;
    expect(g.tasks).toEqual([]);
  });

  it('includeSystem=false filters system sub-processes below chore tasks', async () => {
    const idx = await buildReferenceIndex({
      fetchProcesses: async () => [
        { name: 'p.root', prolog: "ExecuteProcess('}bedrock.x');\nExecuteProcess('user.proc');",
          metadata: '', data: '', epilog: '', parameters: [] },
        { name: '}bedrock.x', prolog: '', metadata: '', data: '', epilog: '', parameters: [] },
        { name: 'user.proc',  prolog: '', metadata: '', data: '', epilog: '', parameters: [] },
      ],
      fetchCubesWithRules: async () => [],
      fetchChores: async () => [{
        name: 'C',
        tasks: [{ step: 0, processName: 'p.root', params: [] }],
      }],
    });
    const g = buildChoreGraph(idx, 'C', { includeSystem: false })!;
    const rootChildren = g.tasks[0].tree.children.map(c => c.process);
    expect(rootChildren).toEqual(['user.proc']);
  });
});

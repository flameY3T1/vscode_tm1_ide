import { describe, it, expect } from 'vitest';
import { buildReferenceIndex } from '../../references/referenceIndex';
import { buildCallGraph, countDirectCalls, BuildCallGraphOptions } from '../../references/callGraph';

// M14: the direction tabs label the INACTIVE direction with its size. That used
// to mean building the whole opposite tree (depth 20, no memoization) and
// discarding everything but `root.children.length`. `countDirectCalls` returns
// the same integer without recursing — these tests pin the equivalence.

const mkIndex = (processes: Array<{ name: string; calls?: string[] }>) =>
  buildReferenceIndex({
    fetchProcesses: async () => processes.map(p => ({
      name: p.name,
      prolog: (p.calls ?? []).map(callee => `ExecuteProcess('${callee}');`).join('\n'),
      metadata: '', data: '', epilog: '',
    })),
    fetchCubesWithRules: async () => [],
  });

/** Both count paths must agree — that is the whole contract of the optimisation. */
async function expectSameCount(
  processes: Array<{ name: string; calls?: string[] }>,
  start: string,
  opts: BuildCallGraphOptions,
  expected: number,
): Promise<void> {
  const idx = await mkIndex(processes);
  const viaTree = buildCallGraph(idx, start, opts).children.length;
  const viaCount = countDirectCalls(idx, start, opts);
  expect(viaCount).toBe(viaTree);
  expect(viaCount).toBe(expected);
}

describe('countDirectCalls — matches buildCallGraph().children.length', () => {
  it('downstream: counts each callee', async () => {
    await expectSameCount(
      [{ name: 'Root', calls: ['A', 'B'] }, { name: 'A' }, { name: 'B' }],
      'Root', { direction: 'downstream' }, 2,
    );
  });

  it('upstream: counts each caller', async () => {
    await expectSameCount(
      [{ name: 'A', calls: ['Leaf'] }, { name: 'B', calls: ['Leaf'] }, { name: 'Leaf' }],
      'Leaf', { direction: 'upstream' }, 2,
    );
  });

  it('no calls at all → 0', async () => {
    await expectSameCount([{ name: 'Lonely' }], 'Lonely', { direction: 'downstream' }, 0);
  });

  it('unknown process → 0', async () => {
    await expectSameCount([{ name: 'Root' }], 'Nope', { direction: 'upstream' }, 0);
  });

  // Edge case 1: duplicate call sites are DISTINCT nodes in the tree, so they
  // must count twice, not collapse to one callee.
  it('duplicate call sites count once per site', async () => {
    await expectSameCount(
      [{ name: 'P', calls: ['Q', 'Q', 'Q'] }, { name: 'Q' }],
      'P', { direction: 'downstream' }, 3,
    );
  });

  // Edge case 2: a self-call is pushed as a child with cycle:true (it is only
  // NOT recursed into), so it counts.
  it('self-recursion counts (node pushed with cycle:true)', async () => {
    const idx = await mkIndex([{ name: 'Loop', calls: ['Loop'] }]);
    const tree = buildCallGraph(idx, 'Loop', { direction: 'downstream' });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].cycle).toBe(true);
    expect(countDirectCalls(idx, 'Loop', { direction: 'downstream' })).toBe(1);
  });

  // Edge case 3: includeSystem:false skips `}`-prefixed children in BOTH
  // directions — and only children; the root is never filtered.
  it('includeSystem:false skips }-processes downstream', async () => {
    await expectSameCount(
      [{ name: 'Root', calls: ['}Sys', 'Plain'] }, { name: '}Sys' }, { name: 'Plain' }],
      'Root', { direction: 'downstream', includeSystem: false }, 1,
    );
  });

  it('includeSystem:false skips }-callers upstream', async () => {
    await expectSameCount(
      [{ name: '}Sys', calls: ['Leaf'] }, { name: 'Plain', calls: ['Leaf'] }, { name: 'Leaf' }],
      'Leaf', { direction: 'upstream', includeSystem: false }, 1,
    );
  });

  it('includeSystem:true (default) keeps }-processes', async () => {
    await expectSameCount(
      [{ name: 'Root', calls: ['}Sys', 'Plain'] }, { name: '}Sys' }, { name: 'Plain' }],
      'Root', { direction: 'downstream' }, 2,
    );
  });

  it('a }-rooted process is counted from itself (root never filtered)', async () => {
    await expectSameCount(
      [{ name: '}Sys', calls: ['Plain'] }, { name: 'Plain' }],
      '}Sys', { direction: 'downstream', includeSystem: false }, 1,
    );
  });

  // Edge case 4: maxDepth <= 0 aborts before any child is pushed.
  it('maxDepth 0 → 0 (tree has no children either)', async () => {
    await expectSameCount(
      [{ name: 'Root', calls: ['A'] }, { name: 'A' }],
      'Root', { direction: 'downstream', maxDepth: 0 }, 0,
    );
  });

  it('deep chain: only DIRECT children are counted', async () => {
    await expectSameCount(
      [
        { name: 'Root', calls: ['Mid'] },
        { name: 'Mid', calls: ['Leaf1', 'Leaf2'] },
        { name: 'Leaf1' }, { name: 'Leaf2' },
      ],
      'Root', { direction: 'downstream' }, 1,
    );
  });

  it('name lookup is case-insensitive, like buildCallGraph', async () => {
    await expectSameCount(
      [{ name: 'Root', calls: ['A'] }, { name: 'A' }],
      'rOOt', { direction: 'downstream' }, 1,
    );
  });
});

// The ancestor set inside buildCallGraph is now mutated + restored instead of
// copied per child. It must still detect cycles PER PATH (a process reachable
// twice via disjoint branches is not a cycle) and restore cleanly for siblings.
describe('buildCallGraph — backtracking ancestor set keeps per-path cycle semantics', () => {
  it('diamond: shared node expanded on both branches, neither marked cycle', async () => {
    const idx = await mkIndex([
      { name: 'Root', calls: ['L', 'R'] },
      { name: 'L', calls: ['Shared'] },
      { name: 'R', calls: ['Shared'] },
      { name: 'Shared', calls: ['Deep'] },
      { name: 'Deep' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    const [l, r] = tree.children;
    expect(l.children[0].process).toBe('Shared');
    expect(r.children[0].process).toBe('Shared');
    expect(l.children[0].cycle).toBe(false);
    expect(r.children[0].cycle).toBe(false);
    // Both copies fully expanded — the second branch must not inherit the
    // first branch's ancestors.
    expect(l.children[0].children.map(c => c.process)).toEqual(['Deep']);
    expect(r.children[0].children.map(c => c.process)).toEqual(['Deep']);
  });

  it('true cycle on one path is still flagged, sibling path unaffected', async () => {
    const idx = await mkIndex([
      { name: 'Root', calls: ['A', 'B'] },
      { name: 'A', calls: ['Root'] },   // back-edge → cycle
      { name: 'B', calls: ['C'] },
      { name: 'C' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    const [a, b] = tree.children;
    expect(a.children[0].process).toBe('Root');
    expect(a.children[0].cycle).toBe(true);
    expect(a.children[0].children).toEqual([]);
    // Sibling branch after the cycle-terminated one is still expanded.
    expect(b.children.map(c => c.process)).toEqual(['C']);
    expect(b.children[0].cycle).toBe(false);
  });

  it('re-entering a process after backtracking is not a cycle', async () => {
    // Root → A → X, then Root → X. X appears on two disjoint paths.
    const idx = await mkIndex([
      { name: 'Root', calls: ['A', 'X'] },
      { name: 'A', calls: ['X'] },
      { name: 'X', calls: ['Y'] },
      { name: 'Y' },
    ]);
    const tree = buildCallGraph(idx, 'Root', { direction: 'downstream' });
    const viaA = tree.children[0].children[0];
    const direct = tree.children[1];
    expect(viaA.process).toBe('X');
    expect(direct.process).toBe('X');
    expect(viaA.cycle).toBe(false);
    expect(direct.cycle).toBe(false);
    expect(direct.children.map(c => c.process)).toEqual(['Y']);
  });
});

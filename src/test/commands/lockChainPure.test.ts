import { describe, it, expect } from 'vitest';
import {
  parseBlockedId,
  buildWaitGraph,
  buildBlockerGroups,
  detectCycles,
  pickBlockerTargets,
  type WaitNode,
  type WaitEdge,
  type WaitId,
} from '../../commands/lockChainPure';
import type { Tm1ThreadWithWait } from '../../tm1Rest/threadApi';

describe('parseBlockedId', () => {
  it('returns undefined for empty strings', () => {
    expect(parseBlockedId()).toBeUndefined();
    expect(parseBlockedId('', '')).toBeUndefined();
  });

  it('returns undefined for unrelated text', () => {
    expect(parseBlockedId('ExecuteProcess', 'Bedrock.Dim.Build')).toBeUndefined();
  });

  it('parses "Waiting for thread 42"', () => {
    expect(parseBlockedId('Waiting for thread 42')).toBe(42);
  });

  it('parses "WaitOnLock thread 17"', () => {
    expect(parseBlockedId('WaitOnLock thread 17')).toBe(17);
  });

  it('parses "Blocked by 99"', () => {
    expect(parseBlockedId('Blocked by 99')).toBe(99);
  });

  it('parses from info field when context is empty', () => {
    expect(parseBlockedId('', 'blocked thread 5')).toBe(5);
  });

  it('prefers context over info', () => {
    expect(parseBlockedId('Waiting for thread 10', 'Blocked by 20')).toBe(10);
  });

  it('returns undefined if no number follows pattern', () => {
    expect(parseBlockedId('Waiting for resource')).toBeUndefined();
  });
});

describe('detectCycles', () => {
  function makeNode(id: number): WaitNode {
    return { id, name: `T${id}`, state: 'WaitOnLock', waitTimeSec: 0 };
  }

  it('returns empty set when no edges', () => {
    const nodes = [makeNode(1), makeNode(2)];
    expect(detectCycles(nodes, [])).toEqual(new Set());
  });

  it('returns empty set for simple linear chain', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 2, to: 3 }];
    expect(detectCycles(nodes, edges)).toEqual(new Set());
  });

  it('detects 2-node deadlock (A->B->A)', () => {
    const nodes = [makeNode(1), makeNode(2)];
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 2, to: 1 }];
    const cycles = detectCycles(nodes, edges);
    expect(cycles).toEqual(new Set([1, 2]));
  });

  it('detects 3-node deadlock (A->B->C->A)', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3)];
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 1 }];
    const cycles = detectCycles(nodes, edges);
    expect(cycles).toEqual(new Set([1, 2, 3]));
  });

  it('marks only cycle nodes in rho-shaped chain (4->1->2->3->1)', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3), makeNode(4)];
    const edges: WaitEdge[] = [
      { from: 4, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 1 },
    ];
    const cycles = detectCycles(nodes, edges);
    expect(cycles.has(1)).toBe(true);
    expect(cycles.has(2)).toBe(true);
    expect(cycles.has(3)).toBe(true);
    expect(cycles.has(4)).toBe(false);
  });

  it('handles two independent chains with no cycle', () => {
    const nodes = [makeNode(1), makeNode(2), makeNode(3), makeNode(4)];
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 3, to: 4 }];
    expect(detectCycles(nodes, edges)).toEqual(new Set());
  });

  it('handles empty node list', () => {
    expect(detectCycles([], [])).toEqual(new Set());
  });
});

describe('buildWaitGraph', () => {
  function thread(id: number, state: string, opts: Partial<Tm1ThreadWithWait> = {}): Tm1ThreadWithWait {
    return { ID: id, Name: `user${id}`, State: state, ...opts };
  }

  it('builds empty graph from idle threads', () => {
    const g = buildWaitGraph([thread(1, 'Run'), thread(2, 'Idle')]);
    expect(g.edges).toHaveLength(0);
    expect(g.cycles.size).toBe(0);
    expect(g.nodes).toHaveLength(2);
  });

  it('picks up WaitingOn.ID when present', () => {
    const g = buildWaitGraph([
      thread(1, 'WaitOnLock', { WaitingOn: { ID: 2 } }),
      thread(2, 'Run'),
    ]);
    expect(g.edges).toEqual([{ from: 1, to: 2 }]);
    expect(g.cycles.size).toBe(0);
  });

  it('picks up BlockedBy when WaitingOn absent', () => {
    const g = buildWaitGraph([
      thread(1, 'WaitOnLock', { BlockedBy: 2 }),
      thread(2, 'Run'),
    ]);
    expect(g.edges).toEqual([{ from: 1, to: 2 }]);
  });

  it('falls back to Context parsing', () => {
    const g = buildWaitGraph([
      thread(1, 'WaitOnLock', { Context: 'Waiting for thread 2' }),
      thread(2, 'Run'),
    ]);
    expect(g.edges).toEqual([{ from: 1, to: 2 }]);
  });

  it('builds a v12 job wait-chain from WaitingOnJobs (string GUID ids)', () => {
    const job = (jobId: string, opts: Partial<Tm1ThreadWithWait> = {}): Tm1ThreadWithWait =>
      ({ ID: undefined as unknown as number, JobId: jobId, Name: 'Admin', State: 'Wait', ...opts });
    const g = buildWaitGraph([
      job('jobA', { WaitingOnJobs: ['jobB'] }),
      job('jobB', { State: 'Run' }),
    ]);
    expect(g.edges).toEqual([{ from: 'jobA', to: 'jobB' }]);
    expect(g.nodes.map(n => n.id)).toEqual(['jobA', 'jobB']);
  });

  it('detects a v12 job deadlock cycle across string ids', () => {
    const g = buildWaitGraph([
      { ID: undefined as unknown as number, JobId: 'A', Name: 'u', State: 'Wait', WaitingOnJobs: ['B'] },
      { ID: undefined as unknown as number, JobId: 'B', Name: 'u', State: 'Wait', WaitingOnJobs: ['A'] },
    ]);
    expect(g.cycles.has('A')).toBe(true);
    expect(g.cycles.has('B')).toBe(true);
  });

  it('skips idle-session rows that have neither thread ID nor JobId', () => {
    const g = buildWaitGraph([
      { ID: undefined as unknown as number, Name: 'idleUser', State: 'Idle', Session: 5 },
      thread(2, 'Run'),
    ]);
    expect(g.nodes.map(n => n.id)).toEqual([2]);   // idle row skipped, no undefined-id node
  });

  it('does not add edge for non-Wait state without explicit block field', () => {
    const g = buildWaitGraph([thread(1, 'Run', { Context: 'Waiting for thread 2' })]);
    expect(g.edges).toHaveLength(0);
  });

  it('detects deadlock in output', () => {
    const g = buildWaitGraph([
      thread(1, 'WaitOnLock', { WaitingOn: { ID: 2 } }),
      thread(2, 'WaitOnLock', { WaitingOn: { ID: 1 } }),
    ]);
    expect(g.cycles.has(1)).toBe(true);
    expect(g.cycles.has(2)).toBe(true);
  });

  it('parses WaitTime into waitTimeSec via ISO duration', () => {
    const g = buildWaitGraph([thread(1, 'WaitOnLock', { WaitingOn: { ID: 2 }, WaitTime: 'P0DT0H1M30S' })]);
    expect(g.nodes[0].waitTimeSec).toBe(90);
  });

  it('defaults state to Idle for missing State field', () => {
    const g = buildWaitGraph([{ ID: 1, Name: 'x' }]);
    expect(g.nodes[0].state).toBe('Idle');
  });
});

describe('buildBlockerGroups', () => {
  function node(id: number, opts: Partial<WaitNode> = {}): WaitNode {
    return { id, name: `T${id}`, state: 'WaitOnLock', waitTimeSec: 0, ...opts };
  }

  it('returns empty array when no edges', () => {
    expect(buildBlockerGroups([node(1), node(2)], [])).toEqual([]);
  });

  it('groups waiters by their blocker (X blockiert Y, X blockiert Z)', () => {
    const nodes = [node(1), node(2), node(3)];
    const edges: WaitEdge[] = [{ from: 2, to: 1 }, { from: 3, to: 1 }];
    const groups = buildBlockerGroups(nodes, edges);
    expect(groups).toHaveLength(1);
    expect(groups[0].blockerId).toBe(1);
    expect(groups[0].blocked.map(n => n.id).sort()).toEqual([2, 3]);
    expect(groups[0].blocker?.id).toBe(1);
    expect(groups[0].hasCycle).toBe(false);
  });

  it('sorts blocked threads by wait time desc', () => {
    const nodes = [node(1), node(2, { waitTimeSec: 5 }), node(3, { waitTimeSec: 30 })];
    const edges: WaitEdge[] = [{ from: 2, to: 1 }, { from: 3, to: 1 }];
    const groups = buildBlockerGroups(nodes, edges);
    expect(groups[0].blocked.map(n => n.id)).toEqual([3, 2]);
  });

  it('marks group as cycle when blocker or blocked is in cycle set', () => {
    const nodes = [node(1), node(2)];
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 2, to: 1 }];
    const groups = buildBlockerGroups(nodes, edges, new Set([1, 2]));
    expect(groups.every(g => g.hasCycle)).toBe(true);
  });

  it('sorts deadlock groups before non-deadlock groups', () => {
    const nodes = [node(1), node(2), node(10), node(11)];
    // 1<->2 deadlock; 11 waits on 10 (no cycle)
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 2, to: 1 }, { from: 11, to: 10 }];
    const groups = buildBlockerGroups(nodes, edges, new Set([1, 2]));
    expect(groups[0].hasCycle).toBe(true);
    expect(groups[groups.length - 1].hasCycle).toBe(false);
  });

  it('leaves blocker undefined when blocker thread not in node list', () => {
    const nodes = [node(2)];
    const edges: WaitEdge[] = [{ from: 2, to: 99 }];
    const groups = buildBlockerGroups(nodes, edges);
    expect(groups[0].blockerId).toBe(99);
    expect(groups[0].blocker).toBeUndefined();
    expect(groups[0].blocked.map(n => n.id)).toEqual([2]);
  });

  it('accepts iterable cycleIds (array)', () => {
    const nodes = [node(1), node(2)];
    const edges: WaitEdge[] = [{ from: 1, to: 2 }, { from: 2, to: 1 }];
    const groups = buildBlockerGroups(nodes, edges, [1, 2]);
    expect(groups.every(g => g.hasCycle)).toBe(true);
  });
});

describe('pickBlockerTargets', () => {
  function n(id: WaitId, blockedById?: WaitId, extra: Partial<WaitNode> = {}): WaitNode {
    return {
      id,
      name: `user${id}`,
      state: blockedById == null ? 'Run' : 'Wait',
      waitTimeSec: 0,
      blockedById,
      ...extra,
    };
  }
  /** Edges mirror `buildWaitGraph`: one per node that names a blocker. */
  function graphOf(nodes: WaitNode[]): { nodes: WaitNode[]; edges: WaitEdge[]; cycles: ReadonlySet<WaitId> } {
    const edges: WaitEdge[] = nodes
      .filter(x => x.blockedById != null)
      .map(x => ({ from: x.id, to: x.blockedById as WaitId }));
    return { nodes, edges, cycles: detectCycles(nodes, edges) };
  }

  it('returns nothing when nobody waits', () => {
    expect(pickBlockerTargets(graphOf([n(1), n(2)]))).toEqual([]);
  });

  it('picks the ROOT of a chain, not the middle link', () => {
    // A → B → C: killing B leaves A blocked; only C actually holds the lock.
    const g = graphOf([n('A', 'B'), n('B', 'C'), n('C')]);
    const picked = pickBlockerTargets(g);
    expect(picked.map(p => p.id)).toEqual(['C']);
    expect(picked[0].waiterCount).toBe(2);   // A and B, transitively
    expect(picked[0].fromCycle).toBe(false);
  });

  it('returns every independent root, most waiters first', () => {
    const g = graphOf([
      n(10, 99), n(11, 99), n(99),   // 99 blocks two
      n(20, 88), n(88),              // 88 blocks one
    ]);
    expect(pickBlockerTargets(g).map(p => [p.id, p.waiterCount])).toEqual([[99, 2], [88, 1]]);
  });

  it('treats a blocker the server no longer lists as the root', () => {
    // The thread we wait on is gone from the list — the deepest VISIBLE holder
    // is the only lever left, so it must not be silently dropped.
    const g = graphOf([n(1, 2), n(2, 777)]);
    const picked = pickBlockerTargets(g);
    expect(picked.map(p => p.id)).toEqual([2]);
    expect(picked[0].waiterCount).toBe(1);
  });

  it('breaks a deadlock by the member with the most waiters', () => {
    // 7 ↔ 9 cycle, plus 30 and 31 hanging off 7 → 7 carries more waiters.
    const g = graphOf([n(7, 9), n(9, 7), n(30, 7), n(31, 7)]);
    const picked = pickBlockerTargets(g);
    expect(picked).toHaveLength(1);
    expect(picked[0].id).toBe(7);
    expect(picked[0].fromCycle).toBe(true);
  });

  it('breaks a tie inside the cycle by wait time, then by id', () => {
    const byTime = graphOf([n(7, 9, { waitTimeSec: 10 }), n(9, 7, { waitTimeSec: 90 })]);
    expect(pickBlockerTargets(byTime)[0].id).toBe(9);
    const byId = graphOf([n(7, 9, { waitTimeSec: 5 }), n(9, 7, { waitTimeSec: 5 })]);
    expect(pickBlockerTargets(byId)[0].id).toBe(7);
  });

  it('picks one victim PER cycle when there are several', () => {
    const g = graphOf([n(1, 2), n(2, 1), n(3, 4), n(4, 3)]);
    expect(pickBlockerTargets(g)).toHaveLength(2);
    expect(pickBlockerTargets(g).every(p => p.fromCycle)).toBe(true);
  });

  it('sorts deadlock victims before plain roots', () => {
    // The root blocks more, but a deadlock never resolves on its own.
    const g = graphOf([n(1, 2), n(2, 1), n(10, 50), n(11, 50), n(12, 50), n(50)]);
    const picked = pickBlockerTargets(g);
    expect(picked[0].fromCycle).toBe(true);
    expect(picked[1].id).toBe(50);
  });

  it('carries the node through so the caller can name it', () => {
    const g = graphOf([n(1, 2), n(2, undefined, { name: 'admin', function: 'CubeLock' })]);
    expect(pickBlockerTargets(g)[0].node?.name).toBe('admin');
  });

  it('does not report a blocker that no one waits on', () => {
    const g = graphOf([n(1), n(2)]);
    expect(pickBlockerTargets(g).map(p => p.id)).toEqual([]);
  });
});

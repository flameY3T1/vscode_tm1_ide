/** Pure helpers for lock-wait-chain — no vscode dependencies. */

import type { Tm1ThreadWithWait } from '../tm1Rest/threadApi';
import { parseIsoDuration } from './threadsPure';

/** Node key: a numeric v11 thread ID or a v12 Job GUID string. */
export type WaitId = string | number;

export interface WaitNode {
  id: WaitId;
  name: string;
  function?: string;
  objectName?: string;
  state: string;
  waitTimeSec: number;
  blockedById?: WaitId;
}

export interface WaitEdge {
  from: WaitId;
  to: WaitId;
}

export interface WaitGraph {
  nodes: WaitNode[];
  edges: WaitEdge[];
  cycles: ReadonlySet<WaitId>;
}

/**
 * Extract blocked-by thread ID from Context or Info text.
 * Matches patterns like "Waiting for thread 42" or "Blocked by 17".
 */
export function parseBlockedId(context?: string, info?: string): number | undefined {
  const text = `${context ?? ''} ${info ?? ''}`;
  const m = text.match(/[Ww]ait(?:ing)?[^0-9]*(\d+)|[Bb]locked[^0-9]*(\d+)/);
  if (!m) { return undefined; }
  const raw = m[1] ?? m[2];
  if (raw == null) { return undefined; }
  const n = parseInt(raw, 10);
  return isNaN(n) ? undefined : n;
}

/** Build wait graph from thread list (with optional WaitingOn expand). */
export function buildWaitGraph(threads: Tm1ThreadWithWait[]): WaitGraph {
  const nodes: WaitNode[] = [];
  const edges: WaitEdge[] = [];

  for (const t of threads) {
    // Node key: v11 numeric thread ID, else v12 Job GUID. Idle-session rows have
    // neither → they're not part of any wait chain, so skip them.
    const id: WaitId | undefined = t.ID ?? t.JobId;
    if (id == null) { continue; }

    let blockedById: WaitId | undefined;
    if (t.WaitingOnJobs && t.WaitingOnJobs.length) {
      blockedById = t.WaitingOnJobs[0];          // v12: Job.WaitingOn (Collection of Jobs)
    } else if (t.WaitingOn?.ID != null) {
      blockedById = t.WaitingOn.ID;              // v11: Thread.WaitingOn
    } else if (typeof t.BlockedBy === 'number') {
      blockedById = t.BlockedBy;
    } else if ((t.State ?? '').includes('Wait')) {
      blockedById = parseBlockedId(t.Context, t.Info);
    }

    nodes.push({
      id,
      name: t.Name ?? '',
      function: t.Function,
      objectName: t.ObjectName,
      state: t.State ?? 'Idle',
      waitTimeSec: parseIsoDuration(t.WaitTime ?? ''),
      blockedById,
    });

    if (blockedById != null) {
      edges.push({ from: id, to: blockedById });
    }
  }

  return { nodes, edges, cycles: detectCycles(nodes, edges) };
}

/** One blocker thread plus everyone waiting on it. */
export interface BlockerGroup {
  blockerId: WaitId;
  /** Blocker node, if present in the thread list. */
  blocker?: WaitNode;
  /** Threads waiting on this blocker, sorted by wait time desc. */
  blocked: WaitNode[];
  /** True if blocker or any blocked thread is part of a deadlock cycle. */
  hasCycle: boolean;
}

/**
 * Group the wait graph by blocker: "X blockiert Y, X blockiert Z".
 * Each group is one thread that at least one other thread is waiting on.
 * Sorted: deadlock groups first, then by number of blocked threads desc.
 */
export function buildBlockerGroups(
  nodes: WaitNode[],
  edges: WaitEdge[],
  cycleIds: ReadonlySet<WaitId> | Iterable<WaitId> = [],
): BlockerGroup[] {
  const cycleSet = cycleIds instanceof Set ? cycleIds : new Set(cycleIds);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const byBlocker = new Map<WaitId, WaitNode[]>();

  for (const e of edges) {
    const waiter = nodeMap.get(e.from);
    if (!waiter) { continue; }
    const list = byBlocker.get(e.to) ?? [];
    list.push(waiter);
    byBlocker.set(e.to, list);
  }

  const groups: BlockerGroup[] = [];
  for (const [blockerId, blocked] of byBlocker) {
    blocked.sort((a, b) => b.waitTimeSec - a.waitTimeSec);
    const hasCycle = cycleSet.has(blockerId) || blocked.some((w) => cycleSet.has(w.id));
    groups.push({ blockerId, blocker: nodeMap.get(blockerId), blocked, hasCycle });
  }

  groups.sort((a, b) => {
    if (a.hasCycle !== b.hasCycle) { return a.hasCycle ? -1 : 1; }
    return b.blocked.length - a.blocked.length;
  });
  return groups;
}

/**
 * Detect thread IDs involved in wait cycles (deadlocks).
 * Uses path-tracking DFS — each node has at most one outgoing edge (functional graph).
 */
export function detectCycles(nodes: WaitNode[], edges: WaitEdge[]): ReadonlySet<WaitId> {
  const next = new Map<WaitId, WaitId>();
  for (const e of edges) { next.set(e.from, e.to); }

  const inCycle = new Set<WaitId>();
  const globalVisited = new Set<WaitId>();

  for (const n of nodes) {
    const startId = n.id;
    if (globalVisited.has(startId) || !next.has(startId)) { continue; }

    const path: WaitId[] = [];
    const pathIdx = new Map<WaitId, number>();
    let cur: WaitId | undefined = startId;

    while (cur != null && !globalVisited.has(cur)) {
      if (pathIdx.has(cur)) {
        const cycleStart = pathIdx.get(cur)!;
        for (let i = cycleStart; i < path.length; i++) { inCycle.add(path[i]); }
        inCycle.add(cur);
        break;
      }
      pathIdx.set(cur, path.length);
      path.push(cur);
      cur = next.get(cur);
    }

    for (const id of path) { globalVisited.add(id); }
  }

  return inCycle;
}

/** One thread the "kill the blocker" button would cancel. */
export interface BlockerTarget {
  id: WaitId;
  /** The blocker's node, when the server still lists it. */
  node?: WaitNode;
  /** How many threads wait on it — directly OR through a chain. */
  waiterCount: number;
  /** Picked to break a deadlock: inside a cycle nobody is a root. */
  fromCycle: boolean;
}

/**
 * Pick the threads actually worth killing: the ROOT of every wait chain.
 *
 * `buildBlockerGroups` answers "who is blocking whom" one hop at a time, which
 * is what the panel renders. It is the wrong target list for a kill: in
 * `A → B → C` it reports B (blocks A) and C (blocks B), and killing B leaves A
 * blocked, because only C holds a lock while B is itself waiting. So follow
 * every chain to its end and rank by TRANSITIVE waiters.
 *
 * Root = has at least one waiter and does not wait itself. A thread whose
 * blocker is no longer in the list counts as a root too: it is the deepest
 * visible holder, so it is the only lever left.
 *
 * A cycle has no root — everyone in it waits. Killing exactly one member is
 * what breaks it, so each cycle contributes its member with the most waiters
 * (ties: longest wait, then lowest id, so repeated clicks stay predictable).
 *
 * Sorted deadlock-first, then by waiter count desc: a deadlock never resolves
 * on its own, a slow chain might.
 */
export function pickBlockerTargets(graph: WaitGraph): BlockerTarget[] {
  const { nodes, edges, cycles } = graph;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const next = new Map<WaitId, WaitId>();
  for (const e of edges) { next.set(e.from, e.to); }

  // Transitive waiters: walk each waiter's chain and credit every thread on it.
  // `nodes.length` hops cap the walk — a cycle would otherwise never end.
  const waiters = new Map<WaitId, number>();
  for (const n of nodes) {
    let cur = next.get(n.id);
    const seen = new Set<WaitId>([n.id]);
    let hops = 0;
    while (cur != null && !seen.has(cur) && hops++ <= nodes.length) {
      waiters.set(cur, (waiters.get(cur) ?? 0) + 1);
      seen.add(cur);
      cur = next.get(cur);
    }
  }

  const targets: BlockerTarget[] = [];

  for (const n of nodes) {
    const count = waiters.get(n.id) ?? 0;
    if (count === 0 || cycles.has(n.id)) { continue; }
    // Waits on a thread the server still lists → not the root, keep walking.
    if (n.blockedById != null && nodeMap.has(n.blockedById)) { continue; }
    targets.push({ id: n.id, node: n, waiterCount: count, fromCycle: false });
  }

  for (const member of cycleMembersByCycle(nodes, next, cycles)) {
    const victim = [...member].sort((a, b) => {
      const wa = waiters.get(a) ?? 0, wb = waiters.get(b) ?? 0;
      if (wa !== wb) { return wb - wa; }
      const ta = nodeMap.get(a)?.waitTimeSec ?? 0, tb = nodeMap.get(b)?.waitTimeSec ?? 0;
      if (ta !== tb) { return tb - ta; }
      return String(a) < String(b) ? -1 : 1;
    })[0];
    if (victim == null) { continue; }
    targets.push({
      id: victim,
      node: nodeMap.get(victim),
      waiterCount: waiters.get(victim) ?? 0,
      fromCycle: true,
    });
  }

  targets.sort((a, b) => {
    if (a.fromCycle !== b.fromCycle) { return a.fromCycle ? -1 : 1; }
    if (a.waiterCount !== b.waiterCount) { return b.waiterCount - a.waiterCount; }
    return String(a.id) < String(b.id) ? -1 : 1;
  });
  return targets;
}

/**
 * Split the cycle members into the individual cycles they belong to. Two
 * independent deadlocks each need their own victim; one shared list would kill
 * only one of them.
 */
function cycleMembersByCycle(
  nodes: WaitNode[],
  next: Map<WaitId, WaitId>,
  cycles: ReadonlySet<WaitId>,
): WaitId[][] {
  const done = new Set<WaitId>();
  const out: WaitId[][] = [];
  for (const n of nodes) {
    if (!cycles.has(n.id) || done.has(n.id)) { continue; }
    const ring: WaitId[] = [];
    let cur: WaitId | undefined = n.id;
    // Each node has at most one outgoing edge, so following `next` from a cycle
    // member walks that cycle and nothing else.
    while (cur != null && cycles.has(cur) && !done.has(cur)) {
      done.add(cur);
      ring.push(cur);
      cur = next.get(cur);
    }
    if (ring.length) { out.push(ring); }
  }
  return out;
}

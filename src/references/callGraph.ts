import type { ReferenceIndex, TmReference, CallParam, CallParamResolution } from './referenceTypes';
import { lookupReferences } from './referenceIndex';

/**
 * Effective parameter value in the context of a specific graph node.
 * - literal: fully resolved value (from explicit literal, propagated literal, or process default)
 * - unknown: value would need to flow in from an upstream param we cannot see (root input)
 *            `viaParam` is the name of the originating root-level param (for display: pX=«pX»)
 * - dynamic: resolution is known to be impossible (CellGet, concat, IF, loops, …)
 */
export type EffectiveValue =
  | { kind: 'literal'; value: string }
  | { kind: 'unknown'; viaParam: string }
  | { kind: 'dynamic' };

/**
 * One edge in the call graph = one ExecuteProcess/RunProcess call site.
 * Each call site has its own params (same caller→callee pair can appear
 * multiple times with different params).
 */
export interface CallEdge {
  caller: string;
  callee: string;
  section: string;                      // prolog/metadata/data/epilog
  line: number;                         // 0-based within section
  funcName: string;                     // ExecuteProcess / RunProcess
  snippet: string;
  params: CallParam[];
  /**
   * Effective value per call-param at THIS edge (parent env applied).
   * Only populated for downstream direction. Index matches `params`.
   */
  effectiveParams?: Array<{ name: string; effective: EffectiveValue; valueRaw: string }>;
}

/**
 * A node in the call graph tree. Parent→child edge is described by `incomingEdge`
 * (the call that reached this node). The root node has incomingEdge = null.
 */
export interface CallGraphNode {
  process: string;
  /**
   * What the node IS. A chore calls a process without naming it in any source
   * text — without this distinction it would stand there as a process and the
   * click would open a process editor on a name that does not exist as a
   * process.
   */
  kind?: 'process' | 'chore';
  incomingEdge: CallEdge | null;
  /**
   * Effective parameter environment AT this node (after call-site resolution).
   * Keys are lowercased param names. Only populated for downstream direction.
   */
  env?: Map<string, EffectiveValue>;
  children: CallGraphNode[];
  cycle: boolean;
  depthLimitReached?: boolean;
}

export type Direction = 'downstream' | 'upstream';

export interface BuildCallGraphOptions {
  direction: Direction;
  maxDepth?: number;                    // default 20, hard safety cap
  /**
   * Include system objects (names starting with `}`) as children/ancestors.
   * The root node is always shown regardless of this flag.
   * Default: true.
   */
  includeSystem?: boolean;
}

function lc(s: string): string { return s.toLowerCase(); }

const SECTION_ORDER: Record<string, number> = { prolog: 0, metadata: 1, data: 2, epilog: 3 };
function sectionRank(s: string): number {
  return SECTION_ORDER[s.toLowerCase()] ?? 99;
}

/** Build outgoing call edges for a given process (what it calls). */
function outgoingCalls(index: ReferenceIndex, process: string): CallEdge[] {
  const refs = index.bySourceProcess.get(lc(process)) ?? [];
  const edges: CallEdge[] = [];
  for (const r of refs) {
    if (r.targetKind !== 'process') { continue; }
    if (!r.funcName) { continue; }
    edges.push(refToEdge(r));
  }
  return edges;
}

/** Build incoming call edges (callers of this process). */
function incomingCalls(index: ReferenceIndex, process: string): CallEdge[] {
  const refs = index.byProcess.get(lc(process)) ?? [];
  const edges: CallEdge[] = [];
  for (const r of refs) {
    if (r.sourceKind !== 'process') { continue; }
    if (!r.funcName) { continue; }
    edges.push(refToEdge(r));
  }
  return [...edges, ...choreCalls(index, process)];
}

/** Marker of a chore edge — the section that `refToEdge` never returns. */
export const CHORE_SECTION = 'chore';

/**
 * Chores that schedule this process.
 *
 * The blind spot this closes: a chore does not name its process in ANY source
 * text — it attaches it as a task, and the reference index records that in
 * `choreTasks`, not in `byProcess`. "Called by" therefore showed nothing for a
 * process that runs every night.
 *
 * The parameters of the task are fixed — they live on the chore, not at a call
 * site — and therefore come through as `literal`.
 */
function choreCalls(index: ReferenceIndex, process: string): CallEdge[] {
  const target = lc(process);
  const edges: CallEdge[] = [];
  for (const [choreLc, tasks] of index.choreTasks) {
    for (const task of tasks) {
      if (lc(task.processName) !== target) { continue; }
      edges.push({
        caller: index.choreCasing.get(choreLc) ?? choreLc,
        callee: task.processName,
        section: CHORE_SECTION,
        // The step in the chore instead of a line number: that is where the
        // task lives, and that is what someone who wants to change it looks for.
        line: task.step,
        funcName: 'Chore',
        snippet: '',
        params: task.params.map(p => ({
          name: p.name,
          resolution: { kind: 'literal' as const, value: p.value },
          valueRaw: p.value,
        })),
      });
    }
  }
  return edges;
}

function refToEdge(r: TmReference): CallEdge {
  return {
    caller:   r.sourceName,
    callee:   r.targetName,
    section:  r.section,
    line:     r.line,
    funcName: r.funcName ?? 'ExecuteProcess',
    snippet:  r.snippet,
    params:   r.params ?? [],
  };
}

// ─── Env resolution ──────────────────────────────────────────────────────────

/**
 * Resolve one call-site CallParamResolution against the parent node's env.
 * - literal stays literal
 * - passthrough → look up the named caller-param in parent env:
 *     known literal → propagate; unknown → mark unknown; dynamic → dynamic
 * - dynamic stays dynamic
 */
export function resolveEdgeParam(
  res: CallParamResolution,
  parentEnv: Map<string, EffectiveValue>,
): EffectiveValue {
  switch (res.kind) {
    case 'literal': return { kind: 'literal', value: res.value };
    case 'dynamic': return { kind: 'dynamic' };
    case 'passthrough': {
      const up = parentEnv.get(res.paramName.toLowerCase());
      if (!up)                        { return { kind: 'unknown', viaParam: res.paramName }; }
      if (up.kind === 'literal')      { return up; }
      if (up.kind === 'unknown')      { return { kind: 'unknown', viaParam: up.viaParam }; }
      return { kind: 'dynamic' };
    }
  }
}

/** Initial env for a process: its declared params, filled with defaults if known, else unknown. */
function buildInitialEnv(procName: string, index: ReferenceIndex): Map<string, EffectiveValue> {
  const env = new Map<string, EffectiveValue>();
  const params = index.processParams.get(lc(procName)) ?? [];
  const defaults = index.processDefaults.get(lc(procName));
  for (const p of params) {
    const def = defaults?.get(p);
    env.set(lc(p), def !== undefined ? { kind: 'literal', value: def } : { kind: 'unknown', viaParam: p });
  }
  return env;
}

/**
 * Derive child's env from parent's env + edge params.
 * Start from child's initial env (its own params + defaults), then overwrite
 * anything the caller passed explicitly at this call site.
 */
function deriveChildEnv(
  childProc: string,
  edge: CallEdge,
  parentEnv: Map<string, EffectiveValue>,
  index: ReferenceIndex,
): Map<string, EffectiveValue> {
  const env = buildInitialEnv(childProc, index);
  const effectiveParams: NonNullable<CallEdge['effectiveParams']> = [];
  for (const cp of edge.params) {
    const eff = resolveEdgeParam(cp.resolution, parentEnv);
    env.set(lc(cp.name), eff);
    effectiveParams.push({ name: cp.name, effective: eff, valueRaw: cp.valueRaw });
  }
  edge.effectiveParams = effectiveParams;
  return env;
}

// ─── Graph construction ─────────────────────────────────────────────────────

/**
 * Recursively build the call graph starting from `start`.
 *
 * downstream: children = processes that THIS process calls (with env-propagation)
 * upstream:   children = processes that CALL this process (no env-propagation)
 *
 * Cycle detection uses the ancestor chain: if a candidate child is already
 * on the path from the root, `cycle = true` and children are empty.
 *
 * Duplicate edges (same caller→callee, different lines/sections) are kept
 * as separate nodes — each represents a distinct call site.
 */
export function buildCallGraph(
  index: ReferenceIndex,
  start: string,
  opts: BuildCallGraphOptions,
): CallGraphNode {
  const maxDepth = opts.maxDepth ?? 20;
  const includeSystem = opts.includeSystem ?? true;
  const rootEnv = opts.direction === 'downstream' ? buildInitialEnv(start, index) : undefined;
  const root: CallGraphNode = {
    process: start,
    kind: 'process',
    incomingEdge: null,
    env: rootEnv,
    children: [],
    cycle: false,
  };

  const visit = (node: CallGraphNode, ancestors: Set<string>, depth: number) => {
    if (depth >= maxDepth) {
      node.depthLimitReached = true;
      return;
    }
    const edges = opts.direction === 'downstream'
      ? outgoingCalls(index, node.process)
      : incomingCalls(index, node.process);

    // Downstream: code order within the single caller (section, then line).
    // Upstream: caller name first (cross-process), then section + line within caller.
    edges.sort((a, b) => {
      if (opts.direction === 'upstream') {
        const cmp = a.caller.localeCompare(b.caller);
        if (cmp !== 0) { return cmp; }
      }
      return sectionRank(a.section) - sectionRank(b.section) || a.line - b.line;
    });

    for (const edge of edges) {
      const nextProc = opts.direction === 'downstream' ? edge.callee : edge.caller;
      if (!includeSystem && nextProc.startsWith('}')) { continue; }
      const childEnv = opts.direction === 'downstream' && node.env
        ? deriveChildEnv(nextProc, edge, node.env, index)
        : undefined;
      // A chore is the end of the chain: nothing calls it, and a process of
      // the same name must not be followed further here.
      const isChore = edge.section === CHORE_SECTION && opts.direction === 'upstream';
      const childNode: CallGraphNode = {
        process: nextProc,
        kind: isChore ? 'chore' : 'process',
        incomingEdge: edge,
        env: childEnv,
        children: [],
        cycle: !isChore && ancestors.has(lc(nextProc)),
      };
      node.children.push(childNode);
      if (!childNode.cycle && !isChore) {
        // One mutable ancestor set with backtracking instead of a copy per child:
        // `ancestors` must stay "root + current path", and `cycle === false`
        // guarantees nextProc was NOT already in the set, so deleting it after
        // the recursion restores it exactly. Identical tree, one Set instead of
        // one per visited node.
        ancestors.add(lc(nextProc));
        visit(childNode, ancestors, depth + 1);
        ancestors.delete(lc(nextProc));
      }
    }
  };

  const initialAncestors = new Set<string>([lc(start)]);
  visit(root, initialAncestors, 0);
  return root;
}

/**
 * Number of direct children `buildCallGraph(index, start, opts)` would produce —
 * computed WITHOUT recursing.
 *
 * Used to label the inactive direction tab: building the full opposite tree
 * (depth 20, no memoization, subtrees re-expanded per path) only to read
 * `root.children.length` is the most expensive thing a panel open does on a
 * widely-called utility process.
 *
 * Mirrors the root-level filter of `buildCallGraph` exactly — same edge source,
 * same `includeSystem` skip, same treatment of self-recursion (counted; the node
 * is pushed with `cycle: true`) and of duplicate call sites (counted per site).
 */
export function countDirectCalls(
  index: ReferenceIndex,
  start: string,
  opts: BuildCallGraphOptions,
): number {
  // maxDepth <= 0 bails out before any child is pushed (`depth >= maxDepth` at 0).
  if ((opts.maxDepth ?? 20) <= 0) { return 0; }
  const includeSystem = opts.includeSystem ?? true;
  const edges = opts.direction === 'downstream'
    ? outgoingCalls(index, start)
    : incomingCalls(index, start);
  if (includeSystem) { return edges.length; }
  return edges.filter(
    e => !(opts.direction === 'downstream' ? e.callee : e.caller).startsWith('}'),
  ).length;
}

// ─── Cube / Dimension usage ─────────────────────────────────────────────────

/** Flat usage reference — one occurrence where a cube/dimension is referenced. */
export interface UsageRef {
  sourceKind: 'process' | 'rule' | 'subset' | 'view';
  sourceName: string;
  section: string;
  line: number;
  funcName?: string;
  snippet: string;
}

/**
 * Collect all references to a cube or dimension as a flat list, sorted by
 * source name and line. Self-references (a cube's own rules reading from the
 * cube itself via DB()/`[...]`) are filtered out to avoid noise — the rule
 * editor already shows them inline.
 */
export function buildCubeOrDimUsages(
  index: ReferenceIndex,
  kind: 'cube' | 'dimension',
  name: string,
  opts: { includeSystem?: boolean } = {},
): UsageRef[] {
  const includeSystem = opts.includeSystem ?? true;
  const refs = lookupReferences(index, kind, name);
  const result: UsageRef[] = [];
  const nameLc = name.toLowerCase();
  for (const r of refs) {
    // Skip self-refs: a cube's own rules referencing itself via DB()/`[...]`
    if (kind === 'cube' && r.sourceKind === 'rule' && r.sourceName.toLowerCase() === nameLc) {
      continue;
    }
    if (!includeSystem && r.sourceName.startsWith('}')) { continue; }
    result.push({
      sourceKind: r.sourceKind,
      sourceName: r.sourceName,
      section: r.section,
      line: r.line,
      funcName: r.funcName,
      snippet: r.snippet,
    });
  }
  result.sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.line - b.line);
  return result;
}

/** Flattens the tree depth-first for simple list rendering. */
export function flattenCallGraph(root: CallGraphNode): Array<{ node: CallGraphNode; depth: number }> {
  const out: Array<{ node: CallGraphNode; depth: number }> = [];
  const walk = (n: CallGraphNode, depth: number) => {
    out.push({ node: n, depth });
    for (const c of n.children) { walk(c, depth + 1); }
  };
  walk(root, 0);
  return out;
}

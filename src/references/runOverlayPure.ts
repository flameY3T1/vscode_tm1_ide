/**
 * Map measured calls from the message log onto the static call sites of the
 * call graph.
 *
 * The log line of a child process carries NO source location — two calls to
 * the same target are character-identical. The mapping therefore comes from
 * the ORDER: `ExecuteProcess` runs synchronously on the thread of the parent
 * process, so the children appear strictly in execution order, and
 * `buildCallGraph` returns the edges in code order
 * (`callGraph.ts:210-215`). The k-th call belongs to the k-th call site.
 *
 * `RunProcess` falls out of this rule, and completely: it writes no
 * `run from process` line at all. The call appears as its own ROOT RUN on a
 * thread of its own (shown live on a 29581-line log: 3580 starts as top level
 * against 12 as a child). `attachAsync` serves such edges via the time window.
 *
 * Pure: no `vscode`, no network (depcruise rule `pure-no-vscode`).
 */
import type { CallGraphNode } from './callGraph';
import type { CallNode } from '../messageLog/messageLogAnalysisPure';

function lc(s: string): string { return s.toLowerCase(); }

export type Certainty = 'exact' | 'loop' | 'ambiguous' | 'async';

export interface EdgeTiming {
  /** Sum over all mapped calls; `null` if none reports a time. */
  elapsedSec: number | null;
  /** Filled only at the root: time in the process itself. */
  selfSec: number | null;
  /** Share of the root's runtime, 0..100. `null` for asynchronous edges. */
  pctOfRoot: number | null;
  count: number;
  occurrences: number[];
  certainty: Certainty;
  status: CallNode['status'];
}

/**
 * A root run of the loaded window with its originator.
 *
 * The originator is `user ?? chore`: a top-level run can have been started by
 * a CHORE, not only by a user (in the measurement log 3607 times
 * `executed by user`, 8 times `executed by chore`).
 */
export interface RootRun extends CallNode { originator?: string }

export interface AsyncWindow {
  /** Startzeitpunkt des Elternlaufs, ISO. */
  from: string;
  /** End of the parent run, ISO. If it is still running, a value in the far future. */
  to: string;
  /** Originator of the parent run, if known. */
  originator?: string;
}

/** `RunProcess` runs asynchronously and writes no child line. */
function isAsync(n: CallGraphNode): boolean {
  return lc(n.incomingEdge?.funcName ?? 'ExecuteProcess') !== 'executeprocess';
}

/** Alle gemessenen Aufrufe eines Ziels, in Ausfuehrungsreihenfolge. */
function measuredByTarget(measured: readonly CallNode[]): Map<string, CallNode[]> {
  const m = new Map<string, CallNode[]>();
  for (const c of measured) {
    const k = lc(c.name);
    const existing = m.get(k);
    if (existing) { existing.push(c); } else { m.set(k, [c]); }
  }
  return m;
}

/**
 * Per static call site, the measured calls mapped to it.
 * Same length and same order as `staticChildren`.
 */
export function alignChildren(
  staticChildren: readonly CallGraphNode[],
  measuredChildren: readonly CallNode[],
): CallNode[][] {
  const byTarget = measuredByTarget(measuredChildren);
  const out: CallNode[][] = staticChildren.map(() => []);

  const idxByTarget = new Map<string, number[]>();
  staticChildren.forEach((s, i) => {
    const k = lc(s.process);
    const existing = idxByTarget.get(k);
    if (existing) { existing.push(i); } else { idxByTarget.set(k, [i]); }
  });

  for (const [target, idxs] of idxByTarget) {
    const measured = byTarget.get(target) ?? [];
    if (measured.length === 0) { continue; }

    // Asynchronous edges stay EMPTY: `RunProcess` writes no
    // `run from process` line, so there is nothing about it in the child tree. Its time
    // is fetched by `attachAsync` from the root runs of the window.
    const sync = idxs.filter(i => !isAsync(staticChildren[i]));
    if (sync.length === 0) { continue; }

    if (measured.length < sync.length) {
      // One site was skipped; the log does not say which. The sum
      // is then deliberately shown at every candidate site and must not be
      // added up — the display marks that.
      for (const i of sync) { out[i] = measured.slice(); }
      continue;
    }

    // Equal number or more: pairwise, the rest onto the last site.
    sync.forEach((posInStatic, k) => {
      out[posInStatic] = k === sync.length - 1 ? measured.slice(k) : [measured[k]];
    });
  }
  return out;
}

/** Measured calls for which there is no target in the static tree. */
export function extraCalls(
  staticChildren: readonly CallGraphNode[],
  measuredChildren: readonly CallNode[],
): CallNode[] {
  const known = new Set(staticChildren.map(s => lc(s.process)));
  return measuredChildren.filter(c => !known.has(lc(c.name)));
}

/**
 * The time of a `RunProcess` edge — via the TIME WINDOW, not via a log
 * reference, because there is none.
 *
 * What is counted is what was started DURING the parent run. That is
 * provable: start time and window are in the log. Peak concurrency would not
 * be provable — the log writes only start and end, a thread waiting on a lock
 * stands in it just as open as a computing one (objection by flameY3T1,
 * 2026-08-26: at the peak moment 31 runs were open, 13 of them ended in a
 * rollback on a lock conflict).
 *
 * Deliberately WITHOUT a percentage share: the runtime of the parent process
 * does not include the asynchronous work, a share would be far above 100 %.
 */
export function attachAsync(
  callee: string, roots: readonly RootRun[], window: AsyncWindow,
): EdgeTiming {
  const matching = roots.filter(r =>
    lc(r.name) === lc(callee)
    && r.startTs >= window.from && r.startTs <= window.to
    // The originator narrows only if BOTH sides carry one — otherwise a
    // server without originator information would filter everything away.
    && (!window.originator || !r.originator || r.originator === window.originator));

  const times = matching.map(r => r.elapsedSec).filter((n): n is number => n !== null);
  return {
    elapsedSec: times.length ? times.reduce((a, b) => a + b, 0) : null,
    selfSec: null,
    pctOfRoot: null,
    count: matching.length,
    occurrences: times,
    certainty: 'async',
    status: matching.find(r => r.status === 'error')?.status
      ?? matching.find(r => r.status === 'running')?.status
      ?? matching[0]?.status ?? 'ok',
  };
}

export interface ExtraCall { name: string; timing: EdgeTiming }

export interface OverlayNode {
  /** `null` = this edge did not run in this run. */
  timing: EdgeTiming | null;
  /** Index-aligned with `CallGraphNode.children` — the renderer reads both via the same index. */
  children: OverlayNode[];
  extra: ExtraCall[];
}

export interface OverlayContext {
  /** All root runs of the loaded window — base set for `attachAsync`. */
  roots: readonly RootRun[];
  /** Originator of the run under consideration (`user ?? chore`), if known. */
  originator?: string;
}

/**
 * How certain is the mapping for a target?
 *
 * The number of call sites is compared with the number of ALL measured
 * calls of this target — not with those attached to a single edge.
 * Two sites with one call each are the EXACT case; the mix-up wrongly made
 * that "ambiguous" (found by the run against the real log).
 */
function certaintyOf(sitesToTarget: number, callsTotal: number): Certainty {
  if (callsTotal > sitesToTarget) { return 'loop'; }
  if (callsTotal < sitesToTarget) { return 'ambiguous'; }
  return 'exact';
}

function timingFrom(
  calls: readonly CallNode[], certainty: Certainty, rootSec: number | null,
): EdgeTiming {
  const times = calls.map(c => c.elapsedSec).filter((n): n is number => n !== null);
  const total = times.length ? times.reduce((a, b) => a + b, 0) : null;
  return {
    elapsedSec: total,
    selfSec: null,
    pctOfRoot: total !== null && rootSec ? (total / rootSec) * 100 : null,
    count: calls.length,
    occurrences: times,
    certainty,
    // An error in any of the mapped calls colours the row.
    status: calls.find(c => c.status === 'error')?.status
      ?? calls.find(c => c.status === 'running')?.status
      ?? calls[0]?.status ?? 'ok',
  };
}

/** Time window of a measured run in which its RunProcess children start. */
function windowOf(n: CallNode, originator?: string): AsyncWindow {
  const from = n.startTs || '';
  const to = n.elapsedSec !== null && from
    ? new Date(new Date(from).getTime() + n.elapsedSec * 1000).toISOString()
    // Still running (or reports no time): window open at the top. A window that is too narrow
    // would conceal runs, an open one at worst counts too much — and
    // the row flags that as a time-window mapping.
    : '9999-12-31T23:59:59Z';
  return { from, to, originator };
}

/**
 * Overlay the static tree with the times of ONE run.
 *
 * The child list stays index-aligned with the static tree so that the
 * renderer can walk through both together.
 */
export function buildRunOverlay(
  staticRoot: CallGraphNode, measured: CallNode, ctx: OverlayContext,
): OverlayNode {
  const rootSec = measured.elapsedSec;

  const visit = (stat: CallGraphNode, measured: CallNode | null): OverlayNode => {
    if (!measured) {
      return { timing: null, children: stat.children.map(c => visit(c, null)), extra: [] };
    }
    // The static tree stops at the cycle node; there are no children there
    // to descend into.
    if (stat.cycle) { return { timing: null, children: [], extra: [] }; }

    const alignment = alignChildren(stat.children, measured.children);
    const window = windowOf(measured, ctx.originator);
    const sitesByTarget = new Map<string, number>();
    for (const s of stat.children) {
      if (isAsync(s)) { continue; }
      const k = lc(s.process);
      sitesByTarget.set(k, (sitesByTarget.get(k) ?? 0) + 1);
    }
    const callsByTarget = new Map<string, number>();
    for (const c of measured.children) {
      const k = lc(c.name);
      callsByTarget.set(k, (callsByTarget.get(k) ?? 0) + 1);
    }

    const children = stat.children.map((s, i) => {
      // Asynchronous edges are not in the child tree — their time comes from the
      // root runs of the window (shown live, see the specification).
      if (isAsync(s)) {
        const t = attachAsync(s.process, ctx.roots, window);
        return {
          timing: t.count > 0 ? t : null,
          children: s.children.map(c => visit(c, null)),
          extra: [],
        };
      }
      const calls = alignment[i];
      if (calls.length === 0) {
        return { timing: null, children: s.children.map(c => visit(c, null)), extra: [] };
      }
      const cert = certaintyOf(
        sitesByTarget.get(lc(s.process)) ?? 1,
        callsByTarget.get(lc(s.process)) ?? calls.length,
      );
      // Deliberate limit: for the GRANDCHILDREN only the FIRST mapped call is
      // expanded. For a loop the row shows the sum over all
      // iterations, but the children below it only the first. Anything else
      // would mean drawing one row per iteration — then the static
      // tree would no longer be the scaffold. The row flags it via `×N`.
      const kind = visit(s, calls[0]);
      return { ...kind, timing: timingFrom(calls, cert, rootSec) };
    });

    return {
      timing: null,          // set by the caller; at the root below
      children,
      extra: extraCalls(stat.children, measured.children)
        .map(c => ({ name: c.name, timing: timingFrom([c], 'exact', rootSec) })),
    };
  };

  const tree = visit(staticRoot, measured);

  // Self time of the root: the time of the SYNCHRONOUS children is subtracted, that of the
  // asynchronous ones is not — a RunProcess runs on the side and can outlive the
  // parent process, otherwise a negative number would come out.
  const syncSec = tree.children
    .filter((_, i) => !isAsync(staticRoot.children[i]))
    .reduce((a, c) => a + (c.timing?.elapsedSec ?? 0), 0);
  const self = rootSec !== null && rootSec !== undefined
    ? Math.max(0, rootSec - syncSec)
    : null;

  return {
    ...tree,
    timing: {
      elapsedSec: rootSec, selfSec: self,
      pctOfRoot: rootSec !== null ? 100 : null,
      count: 1, occurrences: rootSec !== null ? [rootSec] : [],
      certainty: 'exact', status: measured.status,
    },
  };
}

/**
 * The overlay for the CALLER tree ("Called by").
 *
 * The tree shows there all processes that CAN call the root process.
 * A single run, however, had exactly ONE caller, and that is in the start
 * line of the run (`run from process "X"`) — the log knows nothing more about
 * it. Therefore:
 *
 * - The root carries its own runtime; that is the number one is looking for
 *   when opening the call graph of a subprocess.
 * - The caller this run came from is marked.
 * - All other callers stay empty ("not in this run") — they demonstrably did
 *   not trigger this run.
 *
 * Deliberately NO runtimes for the callers: the loaded window begins at the
 * start of this run, the caller began earlier and its time is not in it.
 * Showing a number would mean inventing it.
 */
export function buildUpstreamOverlay(
  staticRoot: CallGraphNode, measured: CallNode, parentName?: string,
): OverlayNode {
  const mark = (n: CallGraphNode, isCaller: boolean): OverlayNode => ({
    timing: isCaller
      ? {
        elapsedSec: null, selfSec: null, pctOfRoot: null,
        count: 1, occurrences: [], certainty: 'exact', status: measured.status,
      }
      : null,
    // Nothing is provable deeper than one level: the log names only the direct
    // caller, not its caller.
    children: n.children.map(k => mark(k, false)),
    extra: [],
  });

  return {
    timing: {
      elapsedSec: measured.elapsedSec,
      selfSec: measured.selfSec,
      pctOfRoot: measured.elapsedSec !== null ? 100 : null,
      count: 1,
      occurrences: measured.elapsedSec !== null ? [measured.elapsedSec] : [],
      certainty: 'exact',
      status: measured.status,
    },
    children: staticRoot.children.map(k =>
      mark(k, !!parentName && lc(k.process) === lc(parentName))),
    extra: [],
  };
}

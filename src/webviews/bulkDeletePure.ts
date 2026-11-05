// src/webviews/bulkDeletePure.ts
// Pure logic of the bulk delete: pattern matching, delete order,
// control object detection, block decision. No vscode, no REST — the host and the
// webview bundle import the same file so that filter and order mean
// the same on both sides.

import { rowKey } from './bulkObjectsPure';
import { isControlName, type ObjKind } from '../utils/objectKinds';

/**
 * Order of deletion within ONE selection.
 *
 * TM1 rejects a dimension as long as a cube holds it — if both are in
 * the same selection, the cube has to go first, otherwise the dimension fails
 * on a cube that the same run would have removed right afterwards. Chores go
 * before their processes for the opposite reason: a chore whose process
 * is missing only fails on the next run, i.e. at night and without anyone watching.
 *
 * Views and subsets come first of all: they hang on a cube or a
 * dimension, and whoever marks both does not want the parent object to have
 * taken the children along already before their turn — a delete into the
 * void would otherwise count as a failure.
 */
export const DELETE_ORDER: readonly ObjKind[] =
  ['view', 'subset', 'chore', 'process', 'cube', 'dimension'];

export function sortForDelete<T extends { kind: ObjKind }>(items: readonly T[]): T[] {
  return items.slice().sort(
    (a, b) => DELETE_ORDER.indexOf(a.kind) - DELETE_ORDER.indexOf(b.kind),
  );
}

/**
 * An object that HARD-prevents the delete — with its kind, not just
 * its name. "Held by: Standard" does not answer the question that
 * precedes it: a view `Standard` and a cube `Standard` are two
 * different things, and only one of them needs to be touched.
 */
export interface Holder {
  kind: ObjKind;
  name: string;
  /** Cube of a view; not set for cubes. */
  parent?: string;
}

/** What hangs on an object. `hard` prevents the delete, `soft` points into the void afterwards. */
export interface UsageInfo {
  /**
   * What HARD-prevents the delete: cubes that hold a dimension, and
   * views that use a subset on an axis.
   */
  hard: Holder[];
  /**
   * Soft references, BY NAME: which processes, rule sets and chores name the
   * object. A number does not answer the question that precedes it —
   * "three processes" tells nobody whether they may delete them; the names do.
   */
  soft: {
    processes: string[];
    rules: string[];
    chores: string[];
    /**
     * Views and subsets that NAME the object in their MDX — not its
     * own. The views of a cube and the subsets of a dimension
     * go away with the object; listing them here would mean warning against the
     * delete's own effect. What remains is the cross reference: an
     * MDX view on another cube, a dynamic subset whose
     * expression filters cell values of this cube.
     */
    views: string[];
    subsets: string[];
  };
}

export function emptyUsage(): UsageInfo {
  return { hard: [], soft: { processes: [], rules: [], chores: [], views: [], subsets: [] } };
}

/**
 * Which chores stand still if these processes break?
 *
 * The question is not "which chore names this object" — none does.
 * A chore runs processes as tasks, and it fails as soon as one of
 * them is gone. That is why the column goes over the process list of the row:
 * if a process that is in a schedule breaks, the schedule stands still.
 *
 * Keyed in lower case on both sides, because TM1 does not distinguish upper and
 * lower case; the spelling comes back from the index.
 */
export function choresOf(
  choresByProcess: ReadonlyMap<string, readonly string[]>,
  processes: readonly string[],
): string[] {
  const out = new Map<string, string>();
  for (const p of processes) {
    for (const c of choresByProcess.get(p.toLowerCase()) ?? []) {
      out.set(c.toLowerCase(), c);
    }
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Control cubes do not count as holders.
 *
 * Measured 2026-09-18 on the test instance: of 186 bound dimensions, a
 * large part hangs only on its own `}ElementAttributes_<Dim>` — that goes
 * away with the dimension and is not a block anyone could resolve. Showing
 * it would mean warning before deleting dimensions that can be deleted
 * without any problem.
 */
export function blockingHolders(hard: readonly Holder[]): Holder[] {
  return hard.filter(h => !isControlName(h.name, h.parent));
}

/**
 * An object is blocked only as long as a holder stands OUTSIDE the selection.
 *
 * Whoever marks cube and dimension together deletes both successfully — the
 * cube is gone beforehand (see `DELETE_ORDER`). A warning would simply be
 * wrong here and would deter exactly the path that works.
 */
export function isBlocked(
  usage: UsageInfo | undefined,
  selectedKeys: ReadonlySet<string>,
): boolean {
  if (!usage) { return false; }
  const holders = blockingHolders(usage.hard);
  if (holders.length === 0) { return false; }
  // The same key the selection uses: a holder is marked along exactly when
  // its row is ticked. A name comparison used to hit every row of the same name,
  // of every kind.
  return holders.some(h => !selectedKeys.has(rowKey(h)));
}

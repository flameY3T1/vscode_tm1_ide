// src/webviews/bulkDeployPure.ts
// Pure logic of the bulk migration: which kinds it carries, in which
// order it writes, and what "missing over there" means. No vscode, no
// REST — the host and the webview bundle import the same file.

import { rowKey, type RowRef } from './bulkObjectsPure';
import type { CompareResult } from './bulkComparePure';

/**
 * The five kinds this page transfers.
 *
 * Cubes and dimensions are deliberately NOT included: creating a cube means
 * deciding about dimension order and storage, and transferring a
 * dimension would mean transferring its elements. Both are a
 * process of their own, not a by-product of a bulk migration. They must already exist
 * over there — exactly that is what the second step checks.
 */
export type DeployKind = 'process' | 'rule' | 'chore' | 'view' | 'subset';

/**
 * Order of writing within ONE run.
 *
 * Processes first: a chore whose process is still missing over there cannot
 * be created. Subsets before views: a view carries named subsets
 * on its axes and is written as a REFERENCE — if the subset is missing,
 * the POST fails. Chores last, because they build on everything before them.
 *
 * Rules come after the processes without any dependency
 * forcing it: a rule text that names a freshly transferred process (feeder
 * from `}Drill…`) otherwise compiles against a server on which it does
 * not exist yet.
 */
export const DEPLOY_ORDER: readonly DeployKind[] =
  ['process', 'rule', 'subset', 'view', 'chore'];

export function sortForDeploy<T extends { kind: DeployKind }>(items: readonly T[]): T[] {
  return items.slice().sort(
    (a, b) => DEPLOY_ORDER.indexOf(a.kind) - DEPLOY_ORDER.indexOf(b.kind),
  );
}

/** An object that is missing on the TARGET SERVER, with its kind. */
export interface MissingRef {
  /** `cube`, `dimension`, `hierarchy`, `process` or `subset`. */
  kind: string;
  name: string;
  /** Cube of a view, dimension of a subset. */
  parent?: string;
  hierarchy?: string;
}

/** What the second step finds out about a row. */
export interface DeployCheck {
  /** Is there already something of this name over there? Then the run overwrites it. */
  exists: boolean;
  /** What the object needs and does not find over there. */
  missing: MissingRef[];
  /**
   * References that cannot be resolved in the source text (cube or
   * process name from a variable). "Nothing is missing" would be a statement here
   * that the index cannot make.
   */
  unresolved: number;
  /**
   * Content compared with the object over there — only for rows that exist
   * there. Absent: not compared (new object, or the check predates it).
   */
  content?: CompareResult;
}

export function emptyCheck(): DeployCheck {
  return { exists: false, missing: [], unresolved: 0 };
}

/**
 * What an object needs can come along in the SAME run.
 *
 * Whoever marks process and chore together migrates both successfully — the
 * process is over there beforehand (see `DEPLOY_ORDER`). A warning would be
 * simply wrong here and would deter exactly the path that works. A
 * missing CUBE, on the other hand, always remains a finding: this page does not
 * carry cubes.
 */
export function openMissing(
  check: DeployCheck | undefined,
  selectedKeys: ReadonlySet<string>,
): MissingRef[] {
  if (!check) { return []; }
  return check.missing.filter(m => !selectedKeys.has(rowKey(m as RowRef)));
}

/**
 * What makes the WRITE fail — a subset of `missing`.
 *
 * Not every shortfall blocks: a process whose cube is missing over there
 * can be created and only fails at run time; a rule text that names a
 * foreign cube is written and reports its error on
 * compile. Only the carriers that the call itself points to are hard:
 *
 * - Rule: ITS cube (`PATCH Cubes('x')` → HTTP 404)
 * - Chore: every process of its task list (`POST Chores` → HTTP 404)
 * - View: its cube and every named subset of its axes
 * - Subset: its dimension and its hierarchy
 * - Process: nothing
 *
 * Whoever transfers single objects from the tree does not go through here — this
 * applies only to the bulk run, where eleven 404s in a row tell nobody
 * what to do.
 */
export function hardBlockers(
  item: { kind: DeployKind; name: string; parent?: string },
  missing: readonly MissingRef[],
): MissingRef[] {
  switch (item.kind) {
    case 'process': return [];
    case 'rule':
      return missing.filter(m => m.kind === 'cube' && m.name.toLowerCase() === item.name.toLowerCase());
    case 'chore':
      return missing.filter(m => m.kind === 'process');
    case 'view':
      return missing.filter(m =>
        (m.kind === 'cube' && m.name.toLowerCase() === (item.parent ?? '').toLowerCase())
        || m.kind === 'subset');
    case 'subset':
      return missing.filter(m => m.kind === 'dimension' || m.kind === 'hierarchy');
  }
}

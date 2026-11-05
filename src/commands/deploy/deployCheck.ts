// src/commands/deploy/deployCheck.ts
//
// The question BEFORE writing: what does this object need over there, and
// does it exist there? Read the inventory and derive set logic from it — no
// side effects, nothing gets written, nothing gets asked. The write path is
// in `deployWrite.ts`, the individual copy chains in `copyOne.ts`.
//
// Why the check is a thing of its own in the first place: TM1 never says by
// itself what an object needs. A process whose cube is missing over there
// can be created and only fails when it runs; a view with a named subset
// fails on the POST with a bare 404 on a path nobody has read.

import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { DeployKind, DeployCheck, MissingRef } from '../../webviews/bulkDeployPure';
import { emptyCheck } from '../../webviews/bulkDeployPure';
import { rowKey } from '../../webviews/bulkObjectsPure';
import { listObjectRows } from '../../tm1Rest/objectListingApi';
import { readViewForCopy } from '../../tm1Rest/viewCopyApi';
import { listDimensionsWithHierarchies } from '../../tm1Rest/dimensionApi';
import type { ReferenceIndex } from '../../references/referenceTypes';

export interface DeployItem {
  kind: DeployKind;
  name: string;
  /** Cube of a view or rule, dimension of a subset. */
  parent?: string;
  hierarchy?: string;
}

const lc = (s: string): string => s.toLowerCase();

// ── Target server's inventory ──────────────────────────────────────────────────

/**
 * What exists on the target server — as sets, not as individual queries.
 *
 * One question per object would be 300 calls at 300 rows; the lists cost
 * four to six. Everything keyed lowercase: TM1 does not distinguish upper
 * and lower case in object names.
 */
export interface TargetInventory {
  cubes: Set<string>;
  dims: Set<string>;
  /** `dim|hier` */
  hiers: Set<string>;
  processes: Set<string>;
  chores: Set<string>;
  /** Cubes that already carry a rule text over there. */
  rules: Set<string>;
  /** `cube|view` */
  views: Set<string>;
  /** `dim|hier|subset` */
  subsets: Set<string>;
  /** Lists that could not be read — "missing over there" is then a guess. */
  failed: string[];
}

function emptyInventory(): TargetInventory {
  return {
    cubes: new Set(), dims: new Set(), hiers: new Set(), processes: new Set(),
    chores: new Set(), rules: new Set(), views: new Set(), subsets: new Set(), failed: [],
  };
}

/**
 * Read the target's inventory — only the lists that the chosen kinds
 * actually concern.
 *
 * Cubes, dimensions and processes are always included: they are the
 * prerequisites of the other kinds (rule and view need their cube, subset
 * needs its dimension, chore needs its processes).
 */
export async function readTargetInventory(
  cfg: Tm1Config,
  kinds: readonly DeployKind[],
): Promise<TargetInventory> {
  const inv = emptyInventory();
  const want = new Set(kinds);
  const listKinds: Array<'cube' | 'dimension' | 'process' | 'chore' | 'rule' | 'view' | 'subset'> =
    ['cube', 'dimension', 'process'];
  if (want.has('chore')) { listKinds.push('chore'); }
  // Which cubes already carry rules over there: that decides whether a rule
  // text overwrites or is new. The rule text rides along in the same cube
  // list, one call.
  if (want.has('rule')) { listKinds.push('rule'); }
  // Also for processes: `checkProcess` checks the declared data source
  // (`TM1CubeView` / `TM1DimensionSubset`) against these two inventories.
  // Without them the lists would be empty and every existing view would
  // stand as "missing over there" — an inventory that was not read is not an
  // empty inventory.
  if (want.has('view') || want.has('process')) { listKinds.push('view'); }
  // Also for views: a native view carries named subsets on its axes and gets
  // written as a REFERENCE.
  if (want.has('subset') || want.has('view') || want.has('process')) { listKinds.push('subset'); }

  const { rows, failed } = await listObjectRows(cfg, listKinds);
  inv.failed = failed.slice();
  for (const r of rows) {
    switch (r.kind) {
      case 'cube':      inv.cubes.add(lc(r.name)); break;
      case 'dimension': inv.dims.add(lc(r.name)); break;
      case 'process':   inv.processes.add(lc(r.name)); break;
      case 'chore':     inv.chores.add(lc(r.name)); break;
      case 'rule':      inv.rules.add(lc(r.name)); break;
      case 'view':      inv.views.add(`${lc(r.parent ?? '')}|${lc(r.name)}`); break;
      case 'subset':
        inv.subsets.add(`${lc(r.parent ?? '')}|${lc(r.hierarchy ?? '')}|${lc(r.name)}`);
        break;
      default: break;
    }
  }

  // Hierarchies separate: the subset list only knows hierarchies that HAVE
  // subsets. An empty alternate hierarchy would be missing from it and would
  // wrongly stand as "missing over there".
  if (want.has('subset')) {
    try {
      for (const d of await listDimensionsWithHierarchies(cfg)) {
        for (const h of d.Hierarchies ?? []) {
          inv.hiers.add(`${lc(d.Name)}|${lc(h.Name)}`);
        }
      }
    } catch {
      inv.failed.push('hierarchies');
    }
  }
  return inv;
}

// ── Check ─────────────────────────────────────────────────────────────────

function missing(kind: string, name: string, parent?: string, hierarchy?: string): MissingRef {
  return { kind, name, parent, hierarchy };
}

/** Merge duplicate findings — the same missing cube three times is ONE finding. */
function dedupe(list: MissingRef[]): MissingRef[] {
  const seen = new Set<string>();
  const out: MissingRef[] = [];
  for (const m of list) {
    const key = rowKey(m);
    if (seen.has(key)) { continue; }
    seen.add(key);
    out.push(m);
  }
  return out;
}

/**
 * What a PROCESS needs over there: every cube, every dimension and every
 * process its code names, plus its declared data source.
 *
 * The SOURCE server's reference index supplies the names (`bySourceProcess`),
 * the TARGET's inventory decides. What the index could not resolve (a cube
 * or view name coming from a variable) counts as `unresolved` — "nothing is
 * missing" would be a claim nobody can make there.
 */
function checkProcess(name: string, idx: ReferenceIndex, inv: TargetInventory): DeployCheck {
  const out = emptyCheck();
  out.exists = inv.processes.has(lc(name));
  for (const ref of idx.bySourceProcess.get(lc(name)) ?? []) {
    if (ref.targetKind === 'cube' && !inv.cubes.has(lc(ref.targetName))) {
      out.missing.push(missing('cube', ref.targetName));
    } else if (ref.targetKind === 'dimension' && !inv.dims.has(lc(ref.targetName))) {
      out.missing.push(missing('dimension', ref.targetName));
    } else if (ref.targetKind === 'process' && !inv.processes.has(lc(ref.targetName))) {
      out.missing.push(missing('process', ref.targetName));
    }
  }
  // The declared data source sits on the process object, not in the code —
  // it does not show up in any reference.
  const ds = idx.processDataSources.get(lc(name))?.declared;
  if (ds?.type === 'TM1CubeView' && ds.nameForServer) {
    if (!inv.cubes.has(lc(ds.nameForServer))) {
      out.missing.push(missing('cube', ds.nameForServer));
    } else if (ds.view && !inv.views.has(`${lc(ds.nameForServer)}|${lc(ds.view)}`)) {
      out.missing.push(missing('view', ds.view, ds.nameForServer));
    }
  }
  if (ds?.type === 'TM1DimensionSubset' && ds.nameForServer) {
    if (!inv.dims.has(lc(ds.nameForServer))) {
      out.missing.push(missing('dimension', ds.nameForServer));
    } else if (ds.subset
      && !inv.subsets.has(`${lc(ds.nameForServer)}|${lc(ds.nameForServer)}|${lc(ds.subset)}`)) {
      out.missing.push(missing('subset', ds.subset, ds.nameForServer, ds.nameForServer));
    }
  }
  if (idx.dynamicDataSources.some(d => lc(d.process) === lc(name))) { out.unresolved++; }
  out.missing = dedupe(out.missing);
  return out;
}

/** What a RULE TEXT needs over there: its own cube and every one it touches. */
function checkRule(cube: string, idx: ReferenceIndex, inv: TargetInventory): DeployCheck {
  const out = emptyCheck();
  // "Exists" for a rule means: the cube over there already carries rules.
  // That decides the overwrite confirmation — a cube without rules loses nothing.
  out.exists = inv.rules.has(lc(cube));
  if (!inv.cubes.has(lc(cube))) {
    out.missing.push(missing('cube', cube));
  }
  for (const ref of idx.all) {
    if (ref.sourceKind !== 'rule' || lc(ref.sourceName) !== lc(cube)) { continue; }
    if (ref.targetKind === 'cube' && !inv.cubes.has(lc(ref.targetName))) {
      out.missing.push(missing('cube', ref.targetName));
    } else if (ref.targetKind === 'dimension' && !inv.dims.has(lc(ref.targetName))) {
      out.missing.push(missing('dimension', ref.targetName));
    }
  }
  out.missing = dedupe(out.missing);
  return out;
}

/** What a CHORE needs over there: every process on its task list. */
function checkChore(name: string, idx: ReferenceIndex, inv: TargetInventory): DeployCheck {
  const out = emptyCheck();
  out.exists = inv.chores.has(lc(name));
  for (const task of idx.choreTasks.get(lc(name)) ?? []) {
    if (!inv.processes.has(lc(task.processName))) {
      out.missing.push(missing('process', task.processName));
    }
  }
  out.missing = dedupe(out.missing);
  return out;
}

/**
 * What a VIEW needs over there: its cube and every named subset on its axes.
 *
 * The subsets are in no index — for that the view has to be read, one call
 * per view. That is the reason the check is its own button rather than
 * running along with every search.
 */
async function checkView(
  srcCfg: Tm1Config, cube: string, view: string, inv: TargetInventory,
): Promise<DeployCheck> {
  const out = emptyCheck();
  out.exists = inv.views.has(`${lc(cube)}|${lc(view)}`);
  if (!inv.cubes.has(lc(cube))) {
    out.missing.push(missing('cube', cube));
    // Without the cube, the axis list no longer says anything that anyone
    // could resolve.
    return out;
  }
  const src = await readViewForCopy(srcCfg, cube, view, false, view).catch(() => null);
  if (!src) { out.unresolved++; return out; }
  if (src.kind === 'other') { out.unresolved++; return out; }
  for (const ref of src.plan?.namedSubsets ?? []) {
    if (!inv.subsets.has(`${lc(ref.dim)}|${lc(ref.hier)}|${lc(ref.name)}`)) {
      out.missing.push(missing('subset', ref.name, ref.dim, ref.hier));
    }
  }
  // An axis that cannot be read is not "nothing is missing".
  out.unresolved += (src.plan?.oversized.length ?? 0) + (src.plan?.unreadable ?? 0);
  out.missing = dedupe(out.missing);
  return out;
}

/** What a SUBSET needs over there: its dimension and its hierarchy. */
function checkSubset(dim: string, hier: string, name: string, inv: TargetInventory): DeployCheck {
  const out = emptyCheck();
  out.exists = inv.subsets.has(`${lc(dim)}|${lc(hier)}|${lc(name)}`);
  if (!inv.dims.has(lc(dim))) {
    out.missing.push(missing('dimension', dim));
  } else if (!inv.hiers.has(`${lc(dim)}|${lc(hier)}`)) {
    out.missing.push(missing('hierarchy', hier, dim));
  }
  return out;
}

/**
 * The check for a whole table.
 *
 * The elements of a static subset are NOT checked: that would be an element
 * query per subset, and the write run names a missing element by name
 * right away anyway.
 */
export async function checkDeployItems(
  srcCfg: Tm1Config,
  items: readonly DeployItem[],
  inv: TargetInventory,
  idx: ReferenceIndex,
): Promise<Array<DeployItem & { check: DeployCheck }>> {
  const out: Array<DeployItem & { check: DeployCheck }> = [];
  for (const item of items) {
    let check: DeployCheck;
    switch (item.kind) {
      case 'process': check = checkProcess(item.name, idx, inv); break;
      case 'rule':    check = checkRule(item.name, idx, inv); break;
      case 'chore':   check = checkChore(item.name, idx, inv); break;
      case 'view':    check = await checkView(srcCfg, item.parent ?? '', item.name, inv); break;
      case 'subset':
        check = checkSubset(item.parent ?? '', item.hierarchy ?? item.parent ?? '', item.name, inv);
        break;
    }
    out.push({ ...item, check });
  }
  return out;
}


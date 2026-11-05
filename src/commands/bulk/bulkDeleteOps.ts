// src/commands/bulk/bulkDeleteOps.ts
// Domain logic of the bulk delete: what depends on the objects (`loadUsage`)
// and the delete call per kind (`deleteOne`). Used to live in
// `webviews/bulkDeleteWebview.ts` until 09-24; the panel, HTML and texts stay
// there. The `*Pure` modules stay in `webviews/`, because the bundle
// (`webviewClient/bulkDelete`) needs them and is not allowed to reach into
// `commands/` (depcruise `webview-no-commands`).
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { emptyUsage, choresOf } from '../../webviews/bulkDeletePure';
import { rowLabel, qualifiedLabel } from '../../webviews/bulkObjectsPure';
import type { ObjKind } from '../../utils/objectKinds';
import type { BulkRow, DeleteItem, UsageResult } from '../../webviewClient/bulkDelete/protocol';
import { deleteCube, deleteView } from '../../tm1Rest/cubeApi';
import { deleteDimension, fetchDimensionCubeNames } from '../../tm1Rest/dimensionApi';
import { deleteProcess } from '../../tm1Rest/processApi';
import { deleteChore } from '../../tm1Rest/choreApi';
import { deleteSubset } from '../../tm1Rest/subsetApi';
import { getOrBuildIndex } from '../../references/referenceIndexService';
import { subsetKey } from '../../references/referenceIndex';
import type { DataSourceScope, ProcessDataSourceInfo, ViewRef } from '../../references/referenceTypes';

/** Which row kinds an unresolvable assignment can even affect. */
const SCOPE_KINDS: Record<DataSourceScope, readonly ObjKind[]> = {
  // `parent` remains for the case where the kind of the source itself is not
  // established — then it can be either one.
  parent: ['cube', 'dimension'],
  cube: ['cube'],
  dimension: ['dimension'],
  view: ['view'],
  subset: ['subset'],
};

/**
 * The analysis limits that belong to THIS table.
 *
 * The index knows them server-wide; the page shows them only when they can
 * affect the kinds being searched for. A process whose view name cannot be
 * resolved does not belong in a cube list — its cube is already listed there,
 * resolved and by name.
 */
function dynamicFor(
  idx: { dynamicDataSources: ReadonlyArray<{ process: string; scope: DataSourceScope }> },
  rows: readonly BulkRow[],
): string[] {
  const shown = new Set<ObjKind>(rows.map(r => r.kind));
  const names = new Set<string>();
  for (const d of idx.dynamicDataSources) {
    if (SCOPE_KINDS[d.scope].some(k => shown.has(k))) { names.add(d.process); }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Processes whose DATA SOURCE points to this view or subset.
 *
 * Two names have to match, never just one: the parent object (cube or
 * dimension) AND the child (view or subset). Either one may come from the
 * declared source or from an assignment in the code — TM1 allows both paths,
 * and a Prolog that sets `DatasourceNameForServer` and `DatasourceCubeview`
 * overwrites the declared source completely.
 *
 * Two deliberate imprecisions, both erring on the side of "better to report
 * too much": the assignments carry no kind (a value can be a cube OR a view),
 * and TM1's subset data source has no concept of hierarchy. A subset that
 * exists under the same name in two hierarchies therefore appears under both.
 * In a delete form, one reference too many is harmless, a missing one is not.
 */
function dataSourceUsers(
  idx: { processDataSources: Map<string, ProcessDataSourceInfo> },
  row: BulkRow,
): Map<string, string> {
  const out = new Map<string, string>();
  const parentLc = (row.parent ?? '').toLowerCase();
  const nameLc = row.name.toLowerCase();
  if (!parentLc) { return out; }
  const wantType = row.kind === 'view' ? 'TM1CubeView' : 'TM1DimensionSubset';

  for (const [procLc, info] of idx.processDataSources) {
    const assignedLc = info.assigned.map(a => a.toLowerCase());
    const d = info.declared;
    const parentHit = (d?.type === wantType
        && (d.nameForServer ?? '').toLowerCase() === parentLc)
      || assignedLc.includes(parentLc);
    if (!parentHit) { continue; }
    const child = row.kind === 'view' ? d?.view : d?.subset;
    const childHit = (d?.type === wantType && (child ?? '').toLowerCase() === nameLc)
      || assignedLc.includes(nameLc);
    if (!childHit) { continue; }
    out.set(procLc, info.processName);
  }
  return out;
}

/**
 * What depends on the loaded objects.
 *
 * Two sources, because one is not enough: the reference index knows what
 * processes, rule texts and chores NAME — the structural binding of a
 * dimension to a cube is not there, and that is exactly what prevents the
 * delete.
 */
export async function loadUsage(
  cfg: Tm1Config,
  rows: readonly BulkRow[],
): Promise<{ usage: UsageResult[]; incomplete: string[]; dynamicDataSources: string[] }> {
  // If the structural query fails, EVERY dimension gets `hard: []` — meaning
  // "nothing depends on it", and that is exactly what someone would delete on
  // the strength of. The failure must therefore go into `incomplete`,
  // otherwise it disappears without a trace.
  let dimCubesFailed = false;
  const [idx, dimCubes] = await Promise.all([
    getOrBuildIndex(cfg),
    fetchDimensionCubeNames(cfg).catch(() => {
      dimCubesFailed = true;
      return new Map<string, string[]>();
    }),
  ]);
  // `idx.choreTasks` is keyed with LOWERCASED chore names; the column should
  // show the name the way it appears in the tree. The index itself carries
  // the spelling — a separate name lookup for this would be one query too
  // many.
  const choreCasing = idx.choreCasing;

  // Index names lowercased: the two lists come from different queries, and
  // TM1 does not distinguish between uppercase and lowercase.
  const dimCubesLc = new Map<string, string[]>();
  for (const [dim, cubes] of dimCubes) { dimCubesLc.set(dim.toLowerCase(), cubes); }

  // Chore tasks inverted: process name (lowercase) → NAMES of the chores that
  // call it. `choreTasks` is keyed by chore, and what is needed is the
  // opposite direction.
  const choresByProcess = new Map<string, string[]>();
  for (const [choreName, tasks] of idx.choreTasks) {
    const seen = new Set<string>();
    for (const t of tasks) {
      const lc = t.processName.toLowerCase();
      if (seen.has(lc)) { continue; }
      seen.add(lc);
      const shown = choreCasing.get(choreName) ?? choreName;
      const list = choresByProcess.get(lc);
      if (list) { list.push(shown); } else { choresByProcess.set(lc, [shown]); }
    }
  }

  const byName = (a: string, b: string): number => a.localeCompare(b);

  // The FULL identity of the row is returned, not just kind and name: the
  // renderer orders via `rowKey`, and that also covers the parent object and
  // the hierarchy.
  const ident = (row: BulkRow): DeleteItem =>
    ({ kind: row.kind, name: row.name, parent: row.parent, hierarchy: row.hierarchy });
  const out: UsageResult[] = [];
  for (const row of rows) {
    const lc = row.name.toLowerCase();
    const u = emptyUsage();

    // View and subset: the reference index knows no call that names them by
    // name — but a process's data source points exactly at them. That is why
    // this used to say "nothing depends on it" for EVERY view.
    if (row.kind === 'view' || row.kind === 'subset') {
      u.soft.processes = [...dataSourceUsers(idx, row).values()].sort(byName);
      u.soft.chores = choresOf(choresByProcess, u.soft.processes);
      // A view that carries the subset on an axis PREVENTS the delete —
      // hence `hard` and not the soft list. This is exactly what also makes
      // overwriting via DELETE+POST fail.
      if (row.kind === 'subset') {
        const views: ViewRef[] = idx.subsetViews.get(
          subsetKey(row.parent ?? '', row.hierarchy ?? row.parent ?? '', row.name)) ?? [];
        u.hard = views
          .map(v => ({ kind: 'view' as const, name: v.view, parent: v.cube }))
          .sort((a, b) => byName(rowLabel(a), rowLabel(b)));
      }
      out.push({ ...ident(row), usage: u });
      continue;
    }

    if (row.kind === 'dimension') {
      u.hard = (dimCubesLc.get(lc) ?? [])
        .map(name => ({ kind: 'cube' as const, name }));
    }
    // A chore is named by nothing — querying `byProcess` with its name yields
    // nothing in the best case and, in the worst, the references to a process
    // of the same name.
    const refs = row.kind === 'cube' ? idx.byCube.get(lc)
      : row.kind === 'dimension' ? idx.byDim.get(lc)
        : row.kind === 'process' ? idx.byProcess.get(lc)
          : undefined;
    // Sources, not occurrences: `CellGetN` three times in the same process is
    // one process that depends on the cube, not three. Whether it pulls the
    // cube as a data source or touches it in the code is deliberately NOT
    // included — both mean "this process breaks", and exactly where is shown
    // by the usage view.
    const srcProcesses = new Map<string, string>();
    const srcRules = new Map<string, string>();
    // Views and subsets have long been in the index with `sourceKind` and
    // were being discarded here until now. The names are qualified
    // (`Cube:View`, `Dim:Hierarchy:Subset`) — `qualifiedLabel` does the
    // formatting for the row.
    const srcViews = new Map<string, string>();
    const srcSubsets = new Map<string, string>();
    for (const r of refs ?? []) {
      if (r.sourceKind === 'process') { srcProcesses.set(r.sourceName.toLowerCase(), r.sourceName); }
      else if (r.sourceKind === 'rule') { srcRules.set(r.sourceName.toLowerCase(), r.sourceName); }
      else if (r.sourceKind === 'view') { srcViews.set(r.sourceName.toLowerCase(), r.sourceName); }
      else if (r.sourceKind === 'subset') { srcSubsets.set(r.sourceName.toLowerCase(), r.sourceName); }
    }
    u.soft.processes = [...srcProcesses.values()].sort(byName);
    u.soft.rules = [...srcRules.values()].sort(byName);
    u.soft.views = [...srcViews.values()].map(n => qualifiedLabel(n, 'view')).sort(byName);
    u.soft.subsets = [...srcSubsets.values()].map(n => qualifiedLabel(n, 'subset')).sort(byName);
    // Also INDIRECTLY: if a process that touches this cube is in a schedule,
    // the schedule fails along with the cube. This column used to appear only
    // on process rows — the chain cube → process → chore broke off at
    // exactly the last link.
    u.soft.chores = choresOf(
      choresByProcess,
      row.kind === 'process' ? [row.name, ...u.soft.processes] : u.soft.processes,
    );
    out.push({ ...ident(row), usage: u });
  }
  const incomplete = dimCubesFailed
    ? [...idx.incomplete, 'cube dimensions'] : idx.incomplete;
  return { usage: out, incomplete, dynamicDataSources: dynamicFor(idx, rows) };
}

/** The actual delete call per kind. */
export async function deleteOne(item: DeleteItem, cfg: Tm1Config): Promise<void> {
  switch (item.kind) {
    case 'cube':      return deleteCube(cfg, item.name);
    // No custom `errorMsg`: `assertOk` appends the OData message, and that
    // names the blocking cube.
    case 'dimension': return deleteDimension(cfg, item.name);
    case 'process':   return deleteProcess(cfg, item.name);
    case 'chore':     return deleteChore(cfg, item.name);
    // Public only: the page does not list `PrivateViews`/`PrivateSubsets`.
    case 'view':
      return deleteView(cfg, item.parent ?? '', item.name, false,
        undefined, vscode.l10n.t('Could not delete View'));
    case 'subset':
      await deleteSubset(cfg, item.parent ?? '', item.hierarchy ?? item.parent ?? '',
        item.name, false, vscode.l10n.t('Subset could not be deleted'));
      return;
  }
}

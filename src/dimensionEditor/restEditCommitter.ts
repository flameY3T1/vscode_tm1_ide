import type { Change } from './model';
import type { CommitPlan } from './commitPlanner';
import type { DimensionApi } from '../tm1Rest/dimensionApi';
import type { CommitResult } from './restCreateCommitter';
import { errMsg } from '../utils/errMsg';

/**
 * Groups changes by their hierarchy, in the order of the first
 * occurrence. `Map` preserves insertion order — so the batch of a
 * hierarchy stays where its first change stood.
 */
function groupByHier<T extends { hier: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const g = out.get(it.hier);
    if (g) { g.push(it); } else { out.set(it.hier, [it]); }
  }
  return out;
}

export async function commitChanges(
  plan: CommitPlan,
  dimName: string,
  hierName: string,
  api: DimensionApi,
): Promise<CommitResult> {
  const errors: Array<{ message: string }> = [];
  let serverMayHaveChanged = false;

  const changes = plan.orderedChanges;
  const addEls = changes.filter((c): c is Extract<Change, { kind: 'addElement' }> => c.kind === 'addElement');
  const addEdgesC = changes.filter((c): c is Extract<Change, { kind: 'addEdge' }> => c.kind === 'addEdge');
  const attrVals = changes.filter(
    (c): c is Extract<Change, { kind: 'setAttr' | 'clearAttr' }> => c.kind === 'setAttr' || c.kind === 'clearAttr');
  const doneKinds = new Set(['addElement', 'addEdge', 'setAttr', 'clearAttr']);

  // TM1 has no transactions, so a failed step leaves the dimension half-changed.
  // Continuing past it used to pile further edits onto that unknown state; every
  // later failure then read as its own problem. The first error stops the run and
  // the remaining changes are reported as not applied.
  let aborted = false;
  let skipped = 0;

  const run = async (label: string, fn: () => Promise<void>): Promise<void> => {
    if (aborted) { skipped++; return; }
    try { await fn(); serverMayHaveChanged = true; }
    catch (err) {
      errors.push({ message: `${label}: ${errMsg(err)}` });
      aborted = true;
    }
  };

  /** Runs even after an abort — for steps that REPAIR a half-done change. */
  const runRecovery = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn(); serverMayHaveChanged = true; }
    catch (err) { errors.push({ message: `${label}: ${errMsg(err)}` }); }
  };

  // 1. batched element adds (addElement rank precedes edges in ordering)
  //
  // Batching is PER HIERARCHY. A draft can carry changes in several
  // hierarchies — the editor loads alternate hierarchies on demand and keeps them in
  // the draft until saving. Previously `addEls[0].hier` stood here for the whole
  // batch: that created the elements of an alternate hierarchy in the main hierarchy,
  // and they were missing in the alternate hierarchy. TM1 acknowledges that with 201, so the
  // error only shows up the next time the editor is opened.
  for (const [hier, group] of groupByHier(addEls)) {
    await run('addElements', () => api.createElements(hier, group.map((c) => ({ name: c.name, type: c.type }))));
  }
  // 2. batched edge adds (must run before the ordered loop: reorderComponents
  // deletes+re-adds ALL of a parent's children, including brand-new ones added
  // in this same Save — the new edge must already exist or the delete errors
  // and the later re-add would otherwise collide with this batch's add)
  //
  // Likewise per hierarchy — and ALL element batches run before ALL
  // edge batches, so that an edge in `ab` does not hit an element that
  // would only be created afterwards.
  for (const [hier, group] of groupByHier(addEdgesC)) {
    await run('addEdges', () => api.addEdges(hier, group.map((c) => ({ parent: c.parent, child: c.child, weight: c.weight }))));
  }
  // 3. remaining ordered changes, skipping batched kinds
  for (const c of changes) {
    if (doneKinds.has(c.kind)) continue;
    switch (c.kind) {
      case 'addHierarchy':    await run('addHierarchy', () => api.createHierarchy(dimName, c.name)); break;
      case 'deleteHierarchy': await run('deleteHierarchy', () => api.deleteHierarchy(dimName, c.name)); break;
      // Attribute definitions belong to the dimension, but the REST route runs
      // through a hierarchy. Use the one being edited: a dimension whose
      // same-name hierarchy was removed has no `Hierarchies('<dim>')` at all.
      case 'addAttrDef':      await run('addAttrDef', () => api.createAttrDef(dimName, c.name, c.type, hierName)); break;
      case 'deleteAttrDef':   await run('deleteAttrDef', () => api.deleteAttrDef(dimName, c.name, hierName)); break;
      case 'changeType':      await run('changeType', () => api.changeElementType(c.hier, c.name, c.newType)); break;
      case 'reorderComponents': {
        const reorderStarted = !aborted;
        for (const child of c.children) await run('reorder.delete', () => api.deleteEdge(c.hier, c.parent, child.name));
        // The re-add runs even after a failed delete: reorder removes ALL of the
        // parent's children first, so skipping it would leave the parent stripped.
        if (reorderStarted) {
          await runRecovery('reorder.add', () => api.addEdges(c.hier, c.children.map((k) => ({ parent: c.parent, child: k.name, weight: k.weight }))));
        }
        break;
      }
      case 'deleteEdge':      await run('deleteEdge', () => api.deleteEdge(c.hier, c.parent, c.child)); break;
      case 'setEdgeWeight':   await run('setEdgeWeight', () => api.setEdgeWeight(c.hier, c.parent, c.child, c.weight)); break;
      case 'deleteElement':   await run('deleteElement', () => api.deleteElement(c.hier, c.name)); break;
      case 'reorderElements': await run('reorderElements', () => api.reorderElements(c.hier, c.elements, c.edges)); break;
      default: break; // the `doneKinds` ran batched above
    }
  }
  // 4. batched attr values
  if (attrVals.length) {
    const vals = attrVals.map((c) => ({ hier: c.hier, element: c.element, attr: c.attr, value: c.kind === 'setAttr' ? c.value : '' }));
    await run('writeAttrValues', () => api.writeAttrValues(vals));
  }

  if (skipped > 0) {
    errors.push({ message: `${skipped} further change(s) were not applied after the error above.` });
  }

  return { ok: errors.length === 0, errors, serverMayHaveChanged };
}

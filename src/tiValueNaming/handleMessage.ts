import type { Tm1Config } from '../tm1Rest/transport/types';
import type { HandlerReply, WebviewToHost } from './protocol';
import type { UnitKey } from '../tiConsistency/types';
import type { ConsistencyApplyReport } from '../tiConsistency/apply';
import { fetchConsistencyCorpus } from '../tiConsistency/corpus';
import { filterProcessNames } from '../tiConsistency/filter';
import { applyConsistencyEdits } from '../tiConsistency/apply';
import { scanValueGroups } from './scan';
import { planNameUnify } from './plan';
import { multiValueVars } from '../tiLiveRange/candidates';
import { planSplit } from '../tiLiveRange/plan';
import { compileExcludes, applyExclusions } from './excludeFilter';

export type RouteOpen = { route: 'open'; objectName: string; unit: UnitKey; line: number };
export interface MsgCtx { fetch?: typeof fetchConsistencyCorpus; excludes?: string[]; }

export async function handleValueNamingMessage(
  msg: WebviewToHost, cfg: Tm1Config, ctx: MsgCtx = {},
): Promise<HandlerReply | RouteOpen | null> {
  const fetch = ctx.fetch ?? fetchConsistencyCorpus;
  if (msg.type === 'open') { return { route: 'open', objectName: msg.objectName, unit: msg.unit, line: msg.line }; }
  if (msg.type === 'listProcesses') {
    const { processes } = await fetch(cfg);
    return { type: 'processList', names: filterProcessNames(processes.map(p => p.name), msg.filter) };
  }
  if (msg.type === 'scan') {
    const { processes, unreadable } = await fetch(cfg);
    const scoped = processes.filter(p => msg.selected.includes(p.name));
    const isExcluded = compileExcludes(ctx.excludes ?? []);
    const filtered = applyExclusions(scanValueGroups(scoped), scoped.flatMap(multiValueVars), isExcluded);
    return { type: 'groups', groups: filtered.groups, unreadable, multiValue: filtered.multiValue };
  }
  if (msg.type === 'preview' || msg.type === 'applyGroup') {
    const { processes } = await fetch(cfg);
    const scoped = processes.filter(p => msg.selected.includes(p.name));
    const plan = planNameUnify(msg.valueKey, msg.canonical, scoped, msg.names);
    if (msg.type === 'preview') {
      return { type: 'previewResult', valueKey: msg.valueKey, plan: { edits: plan.edits.map(e => ({ process: e.process })), skipped: plan.skipped } };
    }
    const report = await applyConsistencyEdits(cfg, plan.edits, scoped, plan.skipped);
    return { type: 'report', report };
  }
  if (msg.type === 'applyAll') {
    const agg: ConsistencyApplyReport = { applied: [], notAttempted: [], skipped: [] };
    for (let i = 0; i < msg.targets.length; i++) {
      const { valueKey, canonical, names } = msg.targets[i];
      const { processes } = await fetch(cfg);
      const scoped = processes.filter(p => msg.selected.includes(p.name));
      const plan = planNameUnify(valueKey, canonical, scoped, names);
      const rep = await applyConsistencyEdits(cfg, plan.edits, scoped, plan.skipped);
      agg.applied.push(...rep.applied);
      if (rep.skipped) { agg.skipped.push(...rep.skipped); }
      if (rep.failed) { agg.failed = rep.failed; agg.notAttempted = [...rep.notAttempted, ...msg.targets.slice(i + 1).map(t => `value ${t.valueKey}`)]; break; }
    }
    return { type: 'report', report: agg };
  }
  if (msg.type === 'previewSplit' || msg.type === 'applySplit') {
    const { processes } = await fetch(cfg);
    const proc = processes.find(p => p.name === msg.process);
    if (!proc) {
      const plan = { edits: [], skipped: [{ process: msg.process, reason: 'notfound' }] };
      if (msg.type === 'previewSplit') {
        return { type: 'splitPreview', process: msg.process, varLc: msg.varLc, defId: msg.defId, plan };
      }
      const report = await applyConsistencyEdits(cfg, [], [], plan.skipped);
      return { type: 'report', report };
    }
    const plan = planSplit(proc, msg.varLc, msg.defId, msg.newName);
    if (msg.type === 'previewSplit') {
      return {
        type: 'splitPreview',
        process: msg.process,
        varLc: msg.varLc,
        defId: msg.defId,
        plan: { edits: plan.edits.map(e => ({ process: e.process })), skipped: plan.skipped },
      };
    }
    const report = await applyConsistencyEdits(cfg, plan.edits, [proc], plan.skipped);
    return { type: 'report', report };
  }
  return null;
}

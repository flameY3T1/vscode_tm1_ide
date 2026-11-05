import type { Tm1Config } from '../tm1Rest/transport/types';
import type { HandlerReply, WebviewToHost } from './protocol';
import type { UnitKey, ScanOpts, NamingPrefixes } from './types';
import type { ConsistencyApplyReport } from './apply';
import { fetchConsistencyCorpus } from './corpus';
import { filterProcessNames } from './filter';
import { runRule, planRename } from './engine';
import { applyConsistencyEdits } from './apply';

export type RouteOpen = { route: 'open'; objectName: string; unit: UnitKey; line: number };

export interface MsgCtx {
  fetch?: typeof fetchConsistencyCorpus;
  /** Naming-convention prefixes, injected by the vscode layer from the shared lint config. */
  namingPrefixes?: NamingPrefixes;
}

export async function handleConsistencyMessage(
  msg: WebviewToHost, cfg: Tm1Config, ctx: MsgCtx = {},
): Promise<HandlerReply | RouteOpen | null> {
  const fetch = ctx.fetch ?? fetchConsistencyCorpus;
  const scanOpts: ScanOpts = { namingPrefixes: ctx.namingPrefixes };
  if (msg.type === 'open') {
    return { route: 'open', objectName: msg.objectName, unit: msg.unit, line: msg.line };
  }
  if (msg.type === 'listProcesses') {
    const { processes } = await fetch(cfg);
    return { type: 'processList', names: filterProcessNames(processes.map(p => p.name), msg.filter) };
  }
  if (msg.type === 'scan') {
    const { processes, unreadable } = await fetch(cfg);
    const scoped = processes.filter(p => msg.selected.includes(p.name));
    return { type: 'groups', ruleKind: msg.ruleKind, groups: runRule(msg.ruleKind, scoped, scanOpts), unreadable };
  }
  if (msg.type === 'preview' || msg.type === 'applyGroup') {
    const { processes } = await fetch(cfg);
    const scoped = processes.filter(p => msg.selected.includes(p.name));
    const groups = runRule(msg.ruleKind, scoped, scanOpts);
    const group = groups.find(g => g.key === msg.groupKey);
    if (!group) {
      return { type: 'report', report: { applied: [], notAttempted: [], skipped: [{ process: '*', reason: 'group no longer present' }] } };
    }
    const plan = planRename(msg.ruleKind, group, msg.target, scoped);
    if (msg.type === 'preview') { return { type: 'previewResult', groupKey: msg.groupKey, plan }; }
    const report = await applyConsistencyEdits(cfg, plan.edits, scoped, plan.skipped);
    return { type: 'report', report };
  }
  if (msg.type === 'applyAll') {
    // Apply each group in turn, RE-FETCHING the corpus before every group so a
    // later group's plan is built against the prior groups' committed writes.
    // This avoids two groups that touch the same process overwriting each
    // other (each PATCH carries a full section text). Slower (one fetch per
    // group) but correct for a manual, on-demand tool.
    const agg: ConsistencyApplyReport = { applied: [], notAttempted: [], skipped: [] };
    for (let i = 0; i < msg.targets.length; i++) {
      const { groupKey, target } = msg.targets[i];
      const { processes } = await fetch(cfg);
      const scoped = processes.filter(p => msg.selected.includes(p.name));
      const group = runRule(msg.ruleKind, scoped, scanOpts).find(g => g.key === groupKey);
      if (!group) { agg.skipped.push({ process: '*', reason: `group '${groupKey}' no longer present` }); continue; }
      const plan = planRename(msg.ruleKind, group, target, scoped);
      const rep = await applyConsistencyEdits(cfg, plan.edits, scoped, plan.skipped);
      agg.applied.push(...rep.applied);
      if (rep.skipped) { agg.skipped.push(...rep.skipped); }
      if (rep.failed) {
        agg.failed = rep.failed;
        agg.notAttempted = [
          ...rep.notAttempted,
          ...msg.targets.slice(i + 1).map(t => `group ${t.groupKey}`),
        ];
        break;
      }
    }
    return { type: 'report', report: agg };
  }
  return null;
}

import type { Tm1Config } from '../tm1Rest/transport/types';
import type { ConsistencyApplyReport, ConsistencyEdit, ConsistencyProcess, UnitKey } from './types';
import { updateProcess } from '../tm1Rest/processApi';
import { invalidateReferenceIndex } from '../references/referenceIndexService';

const SECTION_FIELD: Record<UnitKey, string> = {
  prolog: 'PrologProcedure', metadata: 'MetadataProcedure', data: 'DataProcedure', epilog: 'EpilogProcedure',
};

export type { ConsistencyApplyReport } from './types';

export async function applyConsistencyEdits(
  cfg: Tm1Config,
  edits: ConsistencyEdit[],
  processes: ConsistencyProcess[],
  skipped: { process: string; reason: string }[],
): Promise<ConsistencyApplyReport> {
  const applied: string[] = [];
  const byName = new Map(processes.map(p => [p.name, p]));
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    try {
      const body: Record<string, unknown> = {};
      for (const [key, text] of Object.entries(e.changedSections)) {
        body[SECTION_FIELD[key as UnitKey]] = text;
      }
      const proc = byName.get(e.process);
      if (e.declPatch && proc) {
        if (e.declPatch.params) {
          body.Parameters = proc.rawParams.map(p => {
            const r = e.declPatch!.params!.find(x => x.from === p.Name);
            return r ? { ...p, Name: r.to } : p;
          });
        }
        if (e.declPatch.datasourceVars) {
          body.Variables = proc.rawVariables.map(v => {
            const r = e.declPatch!.datasourceVars!.find(x => x.from === v.Name);
            return r ? { ...v, Name: r.to } : v;
          });
        }
      }
      await updateProcess(cfg, e.process, body);            // no top-level Name
      applied.push(e.process);
    } catch (err) {
      invalidateReferenceIndex(cfg);
      return { applied, failed: { process: e.process, error: (err as Error).message },
        notAttempted: edits.slice(i + 1).map(x => x.process), skipped };
    }
  }
  invalidateReferenceIndex(cfg);
  return { applied, notAttempted: [], skipped };
}

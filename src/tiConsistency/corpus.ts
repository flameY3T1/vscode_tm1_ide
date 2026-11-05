import type { Tm1Config } from '../tm1Rest/transport/types';
import type { ProcessParameter, ProcessVariable } from '../tm1Rest/processApi';
import type { ConsistencyProcess, UnitKey } from './types';
import { apiRequest } from '../tm1Rest/client';
import { parseBodySafe } from '../tm1Rest/parseRest';

const SECTIONS: Array<[UnitKey, string]> = [
  ['prolog', 'PrologProcedure'], ['metadata', 'MetadataProcedure'],
  ['data', 'DataProcedure'], ['epilog', 'EpilogProcedure'],
];

interface Row {
  Name?: string;
  PrologProcedure?: string; MetadataProcedure?: string; DataProcedure?: string; EpilogProcedure?: string;
  Parameters?: ProcessParameter[]; Variables?: ProcessVariable[];
}

export async function fetchConsistencyCorpus(cfg: Tm1Config): Promise<{ processes: ConsistencyProcess[]; unreadable: string[] }> {
  const url = 'Processes?$select=Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,Parameters,Variables';
  let res;
  try { res = await apiRequest('GET', url, undefined, 60_000, cfg); }
  catch { return { processes: [], unreadable: ['Processes'] }; }
  // `apiRequest` resolves on non-2xx — an error body must not read as "no processes".
  if (res.statusCode !== 200) { return { processes: [], unreadable: ['Processes'] }; }
  const parsed = parseBodySafe<{ value?: Row[] }>(res, { value: [] });
  const rows = parsed.value ?? [];
  const processes: ConsistencyProcess[] = rows.map(r => {
    const units = SECTIONS
      .map(([key, field]) => ({ key, text: String((r as any)[field] ?? '') }))
      .filter(u => u.text !== '');
    const rawParams = r.Parameters ?? [];
    const rawVariables = r.Variables ?? [];
    return {
      name: String(r.Name ?? ''),
      units,
      params: rawParams.map(p => ({ name: p.Name, type: p.Type })),
      datasourceVars: rawVariables.map(v => ({ name: v.Name, type: v.Type })),
      rawParams, rawVariables,
    };
  }).filter(p => p.name !== '');
  return { processes, unreadable: [] };
}

// src/security/api/processSecurityApi.ts
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { ProcessPermLevel } from '../types/permission';
import type { PermChange, SaveResult } from './cubeSecurityApi';
import { elementRef } from './_odata';
import { executeMdxCellset } from './mdxCellset';

/** Control cube holding process permissions; `}Processes` × `}Groups`. */
const SECURITY_CUBE = '}ProcessSecurity';

export async function fetchAllProcessPerms(cfg: Tm1Config): Promise<Record<string, Record<string, ProcessPermLevel>>> {
  const mdx = `SELECT {TM1FILTERBYLEVEL(TM1SUBSETALL([}Groups]),0)} ON COLUMNS, {TM1FILTERBYLEVEL(TM1SUBSETALL([}Processes]),0)} ON ROWS FROM [}ProcessSecurity]`;
  const body = await executeMdxCellset(cfg, mdx, 'fetchAllProcessPerms', undefined, SECURITY_CUBE);

  const colAxis = body.Axes.find(a => a.Ordinal === 0);
  const rowAxis = body.Axes.find(a => a.Ordinal === 1);
  const groupNames = (colAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const processNames = (rowAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const numCols = groupNames.length || 1;

  const out: Record<string, Record<string, ProcessPermLevel>> = {};
  for (const p of processNames) if (p) out[p] = {};
  for (const cell of body.Cells) {
    const row = Math.floor(cell.Ordinal / numCols);
    const col = cell.Ordinal % numCols;
    const proc = processNames[row];
    const group = groupNames[col];
    if (!proc || !group) continue;
    const value = cell.Value;
    out[proc][group] = (typeof value === 'string' && value.length > 0 ? value : 'NONE') as ProcessPermLevel;
  }
  return out;
}

export async function updateProcessPerms(
  cfg: Tm1Config,
  processName: string,
  changes: PermChange[],
): Promise<SaveResult> {
  if (changes.length === 0) return { ok: [], errors: [] };
  const results = await Promise.allSettled(changes.map(async ch => {
    const body = JSON.stringify({
      Cells: [{ 'Tuple@odata.bind': [elementRef('}Processes', processName), elementRef('}Groups', ch.group)] }],
      Value: ch.level,
    });
    const res = await apiRequest('POST', "Cubes('%7DProcessSecurity')/tm1.Update", body, undefined, cfg);
    assertOk(res, `updateProcessPerms[${ch.group}]`);
    return ch.group;
  }));
  const ok: Array<{ group: string }> = [];
  const errors: Array<{ group: string; reason: string }> = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push({ group: r.value });
    else errors.push({ group: changes[i].group, reason: String((r.reason as Error).message ?? r.reason) });
  });
  return { ok, errors };
}

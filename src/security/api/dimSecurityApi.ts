// src/security/api/dimSecurityApi.ts
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { DimPermLevel } from '../types/permission';
import type { PermChange, SaveResult } from './cubeSecurityApi';
import { elementRef } from './_odata';
import { executeMdxCellset } from './mdxCellset';

/** Control cube holding dimension permissions; `}Dimensions` × `}Groups`. */
const SECURITY_CUBE = '}DimensionSecurity';

export async function fetchAllDimPerms(cfg: Tm1Config): Promise<Record<string, Record<string, DimPermLevel>>> {
  const mdx = `SELECT {TM1FILTERBYLEVEL(TM1SUBSETALL([}Groups]),0)} ON COLUMNS, {TM1FILTERBYLEVEL(TM1SUBSETALL([}Dimensions]),0)} ON ROWS FROM [}DimensionSecurity]`;
  const body = await executeMdxCellset(cfg, mdx, 'fetchAllDimPerms', undefined, SECURITY_CUBE);

  const colAxis = body.Axes.find(a => a.Ordinal === 0);
  const rowAxis = body.Axes.find(a => a.Ordinal === 1);
  const groupNames = (colAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const dimNames = (rowAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const numCols = groupNames.length || 1;

  const out: Record<string, Record<string, DimPermLevel>> = {};
  for (const d of dimNames) if (d) out[d] = {};
  for (const cell of body.Cells) {
    const row = Math.floor(cell.Ordinal / numCols);
    const col = cell.Ordinal % numCols;
    const dim = dimNames[row];
    const group = groupNames[col];
    if (!dim || !group) continue;
    const value = cell.Value;
    out[dim][group] = (typeof value === 'string' && value.length > 0 ? value : 'NONE') as DimPermLevel;
  }
  return out;
}

export async function updateDimPerms(
  cfg: Tm1Config,
  dimName: string,
  changes: PermChange[],
): Promise<SaveResult> {
  if (changes.length === 0) return { ok: [], errors: [] };
  const results = await Promise.allSettled(changes.map(async ch => {
    const body = JSON.stringify({
      Cells: [{ 'Tuple@odata.bind': [elementRef('}Dimensions', dimName), elementRef('}Groups', ch.group)] }],
      Value: ch.level,
    });
    const res = await apiRequest('POST', "Cubes('%7DDimensionSecurity')/tm1.Update", body, undefined, cfg);
    assertOk(res, `updateDimPerms[${ch.group}]`);
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

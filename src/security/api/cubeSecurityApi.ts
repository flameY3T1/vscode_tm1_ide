// src/security/api/cubeSecurityApi.ts
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { CubePermLevel, PermLevel } from '../types/permission';
import { elementRef } from './_odata';
import { executeMdxCellset } from './mdxCellset';

/** Control cube holding cube permissions; `}Cubes` × `}Groups`. */
const SECURITY_CUBE = '}CubeSecurity';

export interface PermChange { group: string; level: PermLevel; }
export interface SaveResult {
  ok: Array<{ group: string }>;
  errors: Array<{ group: string; reason: string }>;
}

export async function fetchAllCubePerms(cfg: Tm1Config): Promise<Record<string, Record<string, CubePermLevel>>> {
  const mdx = `SELECT {TM1FILTERBYLEVEL(TM1SUBSETALL([}Groups]),0)} ON COLUMNS, {TM1FILTERBYLEVEL(TM1SUBSETALL([}Cubes]),0)} ON ROWS FROM [}CubeSecurity]`;
  const body = await executeMdxCellset(cfg, mdx, 'fetchAllCubePerms', undefined, SECURITY_CUBE);

  const colAxis = body.Axes.find(a => a.Ordinal === 0);
  const rowAxis = body.Axes.find(a => a.Ordinal === 1);
  const groupNames = (colAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const cubeNames = (rowAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const numCols = groupNames.length || 1;

  const out: Record<string, Record<string, CubePermLevel>> = {};
  for (const c of cubeNames) if (c) out[c] = {};
  for (const cell of body.Cells) {
    const row = Math.floor(cell.Ordinal / numCols);
    const col = cell.Ordinal % numCols;
    const cube = cubeNames[row];
    const group = groupNames[col];
    if (!cube || !group) continue;
    const value = cell.Value;
    out[cube][group] = (typeof value === 'string' && value.length > 0 ? value : 'NONE') as CubePermLevel;
  }
  return out;
}

export async function updateCubePerms(
  cfg: Tm1Config,
  cubeName: string,
  changes: PermChange[],
): Promise<SaveResult> {
  if (changes.length === 0) return { ok: [], errors: [] };
  const results = await Promise.allSettled(changes.map(async ch => {
    const body = JSON.stringify({
      Cells: [{ 'Tuple@odata.bind': [elementRef('}Cubes', cubeName), elementRef('}Groups', ch.group)] }],
      Value: ch.level,
    });
    const res = await apiRequest('POST', "Cubes('%7DCubeSecurity')/tm1.Update", body, undefined, cfg);
    assertOk(res, `updateCubePerms[${ch.group}]`);
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

// src/security/api/elementSecurityApi.ts
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import { odataErrorMessage } from '../../tm1Rest/parseRest';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { ODataError } from '../../tm1Rest/odataTypes';
import type { ElementPermLevel } from '../types/permission';
import { encodeODataKey, escapeMdx } from '../../utils/odataKey';
import { elementRef } from './_odata';
import { executeMdxCellset } from './mdxCellset';

function encodeCubePath(name: string): string { return encodeODataKey(name); }

// `cubeExists` now lives in `mdxCellset` so the cellset helper can probe for a
// missing security cube without importing this module back (that would be a
// dependency cycle). Re-exported unchanged for the existing importers
// (`commands/security/elementSecurity.ts`, `activation/registerSecurityCommands.ts`).
export { cubeExists } from './mdxCellset';

export async function createElementSecurityCube(cfg: Tm1Config, dimName: string): Promise<void> {
  // `Dimensions@odata.bind` values are RESOURCE PATHS (URI references), not OData
  // literals — the dim name needs quote-doubling AND URL-encoding (`encodeODataKey`).
  // `%7DGroups` is already pre-encoded and stays a raw literal (no double-encoding).
  // `Name` is a plain property value and stays unencoded.
  const body = JSON.stringify({
    Name: `}ElementSecurity_${dimName}`,
    'Dimensions@odata.bind': [
      `Dimensions('${encodeODataKey(dimName)}')`,
      `Dimensions('%7DGroups')`,
    ],
  });
  const res = await apiRequest('POST', 'Cubes', body, undefined, cfg);
  if (res.statusCode !== 201) {
    let msg = res.body || `HTTP ${res.statusCode}`;
    try {
      const j = JSON.parse(res.body) as ODataError;
      const m = odataErrorMessage(j);
      if (m) msg = m;
    } catch { /* ignore */ }
    throw new Error(`createElementSecurityCube: ${msg}`);
  }
}

export interface ElementPermChange { element: string; group: string; level: ElementPermLevel; }
export interface ElementSaveResult {
  ok: Array<{ element: string; group: string }>;
  errors: Array<{ element: string; group: string; reason: string }>;
}

/**
 * Fetch all element permissions for a dimension.
 * Returns nested map: { elementName: { groupName: level } }.
 * Big dims (100k elements × 30 groups) produce 3M cells — call with caution.
 */
export async function fetchElementPerms(cfg: Tm1Config, dimName: string): Promise<Record<string, Record<string, ElementPermLevel>>> {
  const escDim = escapeMdx(dimName);
  const cubeName = `}ElementSecurity_${escDim}`;
  const mdx = `SELECT {TM1FILTERBYLEVEL(TM1SUBSETALL([}Groups]),0)} ON COLUMNS, {TM1FILTERBYLEVEL(TM1SUBSETALL([${escDim}]),0)} ON ROWS FROM [${cubeName}]`;
  // Probe with the RAW name — `cubeName` above is MDX-escaped (`]` → `]]`).
  const body = await executeMdxCellset(cfg, mdx, 'fetchElementPerms', undefined, `}ElementSecurity_${dimName}`);

  const colAxis = body.Axes.find(a => a.Ordinal === 0);
  const rowAxis = body.Axes.find(a => a.Ordinal === 1);
  const groupNames = (colAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const elementNames = (rowAxis?.Tuples ?? []).map(t => t.Members[0]?.Name ?? '');
  const numCols = groupNames.length || 1;

  const out: Record<string, Record<string, ElementPermLevel>> = {};
  for (const elem of elementNames) {
    if (elem) out[elem] = {};
  }
  for (const cell of body.Cells) {
    const row = Math.floor(cell.Ordinal / numCols);
    const col = cell.Ordinal % numCols;
    const elem = elementNames[row];
    const group = groupNames[col];
    if (!elem || !group) continue;
    const value = cell.Value;
    out[elem][group] = (typeof value === 'string' && value.length > 0 ? value : 'NONE') as ElementPermLevel;
  }
  return out;
}

/**
 * Batch update element permissions. One POST per change.
 * Uses Promise.allSettled for partial-fail tolerance.
 *
 * P2: capped at UPDATE_CONCURRENCY parallel POSTs. On a 100k-element dim an
 * uncapped fan-out bursts thousands of concurrent sockets (Agent.maxSockets is
 * Infinity by default) and can overwhelm TM1. Chunking preserves change order
 * so the index-based error mapping below stays correct.
 */
const UPDATE_CONCURRENCY = 25;

export async function updateElementPerms(
  cfg: Tm1Config,
  dimName: string,
  changes: ElementPermChange[],
): Promise<ElementSaveResult> {
  if (changes.length === 0) return { ok: [], errors: [] };
  const cubePath = `Cubes('%7DElementSecurity_${encodeCubePath(dimName)}')/tm1.Update`;
  const results: PromiseSettledResult<{ element: string; group: string }>[] = [];
  for (let i = 0; i < changes.length; i += UPDATE_CONCURRENCY) {
    const slice = changes.slice(i, i + UPDATE_CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(async ch => {
      const body = JSON.stringify({
        Cells: [{ 'Tuple@odata.bind': [elementRef(dimName, ch.element), elementRef('}Groups', ch.group)] }],
        Value: ch.level,
      });
      const res = await apiRequest('POST', cubePath, body, undefined, cfg);
      assertOk(res, `updateElementPerms[${ch.element}/${ch.group}]`);
      return { element: ch.element, group: ch.group };
    }));
    results.push(...settled);
  }
  const ok: Array<{ element: string; group: string }> = [];
  const errors: Array<{ element: string; group: string; reason: string }> = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push(r.value);
    else errors.push({
      element: changes[i].element,
      group: changes[i].group,
      reason: String((r.reason as Error).message ?? r.reason),
    });
  });
  return { ok, errors };
}

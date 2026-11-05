import { CubeStat, STATS_MEASURES } from './cubeStatsTypes';
import type { CellsetTable } from '../mdx/cellsetParser';
import { escapeMdx, encodeODataKey } from '../utils/odataKey';
import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { executeMdx, type ApiFetcher } from '../mdx/executeMdx';
import { parseODataValueBody } from '../tm1Rest/parseRest';
import { isOk, Tm1HttpError } from '../tm1Rest/httpError';

/**
 * Builds MDX against `}StatsByCube`.
 *  - COLUMNS = all level-0 elements of the Measures dim
 *  - ROWS    = all level-0 elements of the Cubes dim (`}PerfCubes`)
 *  - WHERE   = optional slicer (Interval dim, e.g. on `Latest`)
 *
 * All dim names are discovered by the caller via REST.
 */
const _escBr = (s: string): string => escapeMdx(s);

export function buildCubeStatsMdx(
  measuresDim: string,
  cubesDim: string,
  slicer?: { dim: string; element: string },
): string {
  const cols = `TM1FILTERBYLEVEL( {TM1SUBSETALL([${_escBr(measuresDim)}])}, 0 ) ON 0`;
  const rows = `TM1FILTERBYLEVEL( {TM1SUBSETALL([${_escBr(cubesDim)}])}, 0 ) ON 1`;
  const where = slicer
    ? ` WHERE ([${_escBr(slicer.dim)}].[${_escBr(slicer.element)}])`
    : '';
  return `SELECT ${cols}, ${rows} FROM [}StatsByCube]${where}`;
}

/**
 * Maps the cellset onto structured `CubeStat` records.
 *
 * Column header (col-headers[c][0]) = element names of the Measures dim
 * (matched case-insensitively against `STATS_MEASURES[i].tm1`).
 *
 * Row header = cube name (1st member tuple).
 */
export function parseCubeStats(table: CellsetTable): CubeStat[] {
  if (table.rowHeaders.length === 0 || table.cells.length === 0) { return []; }

  const colMeasureNames = table.colHeaders.map(t => String(t[0] ?? '').toLowerCase());
  /** measureKey → column index, or -1 if not present. */
  const colIdx: Record<string, number> = {};
  for (const m of STATS_MEASURES) {
    colIdx[m.key] = colMeasureNames.findIndex(n => n === m.tm1.toLowerCase());
  }

  const out: CubeStat[] = [];
  for (let r = 0; r < table.rowHeaders.length; r++) {
    const name = String(table.rowHeaders[r]?.[0] ?? '');
    if (!name) { continue; }
    const row = table.cells[r] ?? [];
    const values: Record<string, number> = {};
    for (const m of STATS_MEASURES) {
      const idx = colIdx[m.key];
      if (idx < 0) { values[m.key] = 0; continue; }
      const v = row[idx]?.value;
      const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : 0);
      values[m.key] = Number.isFinite(n) ? n : 0;
    }
    out.push({ name, isSystem: name.startsWith('}'), values });
  }
  return out;
}

/** Bytes → human-readable ("842 MB", "2.8 GB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) { return '0 B'; }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * End-to-end RAM/cell stats for ALL cubes: discovers `}StatsByCube`'s dims
 * (measures/interval/cubes — same classification as the RAM dashboard),
 * builds + runs the MDX, and returns a `Map<cubeName, CubeStat>` for O(1)
 * per-row lookups. Used by the Cube Overview page (Object Overview, Task 3.3).
 * Throws if `}StatsByCube` doesn't exist or dims can't be classified — callers
 * should wrap in try/catch and degrade gracefully.
 */
export async function fetchAllCubeStats(cfg: Tm1Config): Promise<Map<string, CubeStat>> {
  const cubeRes = await apiRequest(
    'GET',
    `Cubes('%7DStatsByCube')?$select=Name&$expand=Dimensions($select=Name)`,
    undefined, undefined, cfg,
  );
  if (!isOk(cubeRes)) {
    throw new Tm1HttpError(`}StatsByCube not available (HTTP ${cubeRes.statusCode})`, cubeRes.statusCode);
  }
  const cubeJson = JSON.parse(cubeRes.body) as { Dimensions?: { Name: string }[] };
  const dims = (cubeJson.Dimensions ?? []).map(d => d.Name);

  let measuresDim: string | undefined;
  let intervalDim: string | undefined;
  let cubesDim: string | undefined;
  let latestElement: string | undefined;
  for (const d of dims) {
    const elemRes = await apiRequest(
      'GET',
      `Dimensions('${encodeODataKey(d)}')/Hierarchies('${encodeODataKey(d)}')/Elements?$select=Name&$top=200`,
      undefined, undefined, cfg,
    );
    if (!isOk(elemRes)) { continue; }
    const names = parseODataValueBody<{ Name: string }>(elemRes).map(e => String(e.Name));
    const hasTotalMem = names.some(n => n.toLowerCase() === 'total memory used');
    const latest = names.find(n => n.toLowerCase() === 'latest');
    if (!measuresDim && hasTotalMem) { measuresDim = d; continue; }
    if (!intervalDim && latest) { intervalDim = d; latestElement = latest; continue; }
    if (!cubesDim) { cubesDim = d; }
  }
  if (!measuresDim) { throw new Error('}StatsByCube: measures dim not found (no "Total Memory Used" element).'); }
  if (!cubesDim) { cubesDim = dims.find(n => n !== measuresDim && n !== intervalDim); }
  if (!cubesDim) { throw new Error('}StatsByCube: cubes dim not found.'); }

  const api: ApiFetcher = (method, path, body) => apiRequest(method, path, body, undefined, cfg);
  const mdx = buildCubeStatsMdx(
    measuresDim,
    cubesDim,
    intervalDim && latestElement ? { dim: intervalDim, element: latestElement } : undefined,
  );
  const result = await executeMdx(mdx, api);
  if (!result.ok) {
    throw new Error(result.needsConfirm ? `Cellset too large (${result.cellCount} cells)` : result.error.message);
  }
  const stats = parseCubeStats(result.table);
  return new Map(stats.map(s => [s.name, s]));
}

/** CSV-Zeilen: Header + Records, Trennzeichen `;`. */
export function statsToCsv(stats: CubeStat[]): string {
  const head = ['Name', 'System', ...STATS_MEASURES.map(m => m.tm1)];
  const rows = stats.map(s => [
    s.name.replace(/"/g, '""'),
    s.isSystem ? 'true' : 'false',
    ...STATS_MEASURES.map(m => String(s.values[m.key] ?? 0)),
  ]);
  return [head.join(';'), ...rows.map(r => r.map(c => /[;"\n]/.test(c) ? `"${c}"` : c).join(';'))].join('\n');
}

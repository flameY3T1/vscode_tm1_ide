/**
 * Read-only inventory for the readiness check: processes (one bulk call), active chores,
 * the message log window and the static process calls. Every source that fails becomes a
 * gap in the report — never an empty list that reads as "no findings".
 */
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { listProcessesFull, type RawProcess } from '../../tm1Rest/processApi';
import { apiRequest } from '../../tm1Rest/client';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import { isOk } from '../../tm1Rest/httpError';
import { fetchProcessRunLog } from '../../tm1Rest/runStatsApi';
import { flatNameForPath, flatten } from '../../serverConfig/configApi';
import { fetchAllMdxViews } from '../../references/referenceIndexService';
import { buildReferenceIndex, type ProcessFetchResult } from '../../references/referenceIndex';
import { PROC_SECTIONS, type CubeRules, type MdxSource, type ModelObject, type ScanInput, type SourceProcess, type StaticCall, type ProcSection } from '../../v12Readiness/types';

export class ScanCancelled extends Error {}

/**
 * Reduces a process to what the analysis needs. The data source keeps type and name only:
 * TM1 returns `password` and `userName` for ODBC, and nothing after this line may see them.
 */
export function toSourceProcess(p: RawProcess): SourceProcess {
  const ds = (p.DataSource ?? {}) as { Type?: string; dataSourceNameForServer?: string };
  return {
    name: p.Name,
    dataSource: { type: ds.Type ?? 'None', ...(ds.dataSourceNameForServer ? { nameForServer: ds.dataSourceNameForServer } : {}) },
    parameters: (p.Parameters ?? []).map(x => ({ Name: x.Name, ...(x.Type ? { Type: x.Type } : {}) })),
    variables: (p.Variables ?? []).map((x, i) => ({ Name: x.Name, ...(x.Type ? { Type: x.Type } : {}), Position: (x as { Position?: number }).Position ?? i + 1 })),
    code: {
      prolog: p.PrologProcedure ?? '',
      metadata: p.MetadataProcedure ?? '',
      data: p.DataProcedure ?? '',
      epilog: p.EpilogProcedure ?? '',
    },
  };
}

async function fetchActiveChoreProcesses(cfg: Tm1Config): Promise<{ activeLc: string[]; tpChores: number }> {
  const res = await apiRequest('GET', 'Chores?$select=Name,Active&$expand=Tasks($expand=Process($select=Name))', undefined, undefined, cfg);
  if (!isOk(res)) { throw new Error(`chores HTTP ${res.statusCode}`); }
  type Chore = { Name?: string; Active?: boolean; Tasks?: Array<{ Process?: { Name?: string } }> };
  const chores = parseBodySafe<{ value?: Chore[] }>(res, {}).value ?? [];
  const out = new Set<string>();
  for (const c of chores) {
    if (!c.Active) { continue; }
    for (const t of c.Tasks ?? []) { if (t.Process?.Name) { out.add(t.Process.Name.toLowerCase()); } }
  }
  return { activeLc: [...out], tpChores: chores.filter(c => c.Name?.toLowerCase().startsWith('}tp_')).length };
}

/**
 * Public cube, view, dimension and subset names — two calls (measured on 11.8: 142 cubes with
 * 151 views 36 KB, 388 dimensions with 463 subsets 134 KB, ~15 ms each). Private views and
 * subsets belong to their owners and are not visible here.
 */
async function fetchObjectNames(cfg: Tm1Config): Promise<{ objects: ModelObject[]; subsetMdx: MdxSource[] }> {
  const cubes = await apiRequest('GET', 'Cubes?$select=Name&$expand=Views($select=Name)', undefined, 60_000, cfg);
  if (!isOk(cubes)) { throw new Error(`cubes HTTP ${cubes.statusCode}`); }
  const dims = await apiRequest('GET', 'Dimensions?$select=Name&$expand=Hierarchies($select=Name;$expand=Subsets($select=Name,Expression))', undefined, 60_000, cfg);
  if (!isOk(dims)) { throw new Error(`dimensions HTTP ${dims.statusCode}`); }
  const out: ModelObject[] = [];
  const subsetMdx: MdxSource[] = [];
  type Named = { Name?: string };
  for (const c of parseBodySafe<{ value?: Array<Named & { Views?: Named[] }> }>(cubes, {}).value ?? []) {
    if (!c.Name) { continue; }
    out.push({ kind: 'cube', name: c.Name });
    for (const v of c.Views ?? []) { if (v.Name) { out.push({ kind: 'view', name: v.Name, parent: c.Name }); } }
  }
  type Sub = Named & { Expression?: string | null };
  for (const d of parseBodySafe<{ value?: Array<Named & { Hierarchies?: Array<Named & { Subsets?: Sub[] }> }> }>(dims, {}).value ?? []) {
    if (!d.Name) { continue; }
    out.push({ kind: 'dimension', name: d.Name });
    for (const h of d.Hierarchies ?? []) {
      const parent = h.Name && h.Name !== d.Name ? `${d.Name}:${h.Name}` : d.Name;
      for (const sub of h.Subsets ?? []) {
        if (!sub.Name) { continue; }
        out.push({ kind: 'subset', name: sub.Name, parent });
        if (sub.Expression?.trim()) { subsetMdx.push({ kind: 'subset', owner: parent, name: sub.Name, mdx: sub.Expression }); }
      }
    }
  }
  return { objects: out, subsetMdx };
}

/** Static process calls, resolved by the reference index from the processes already loaded. */
async function staticCalls(processes: SourceProcess[]): Promise<StaticCall[]> {
  const input: ProcessFetchResult[] = processes.map(p => ({ name: p.name, ...p.code }));
  const idx = await buildReferenceIndex({ fetchProcesses: async () => input, fetchCubesWithRules: async () => [] });
  const sections = new Set<string>(PROC_SECTIONS);
  return idx.all
    .filter(r => r.sourceKind === 'process' && r.targetKind === 'process' && sections.has(r.section))
    .map(r => ({ caller: r.sourceName, callee: r.targetName, section: r.section as ProcSection, line: r.line }));
}

/** Rule texts of all cubes that have one — one call, the same select the reference index uses. */
async function fetchCubeRules(cfg: Tm1Config): Promise<CubeRules[]> {
  const res = await apiRequest('GET', 'Cubes?$select=Name,Rules', undefined, 60_000, cfg);
  if (!isOk(res)) { throw new Error(`cube rules HTTP ${res.statusCode}`); }
  const cubes = parseBodySafe<{ value?: Array<{ Name?: string; Rules?: string | null }> }>(res, {}).value ?? [];
  return cubes.filter(c => c.Name && c.Rules && c.Rules.trim()).map(c => ({ cube: c.Name as string, rules: c.Rules as string }));
}

/**
 * REST leaves whose tm1s.cfg name differs and that the editor's path table does not carry
 * (that table holds only paths a PATCH was verified against). Checked on 11.8, 2026-10-07.
 */
const CFG_NAME_BY_PATH: Record<string, string> = {
  'Access.HTTP.SessionTimeout': 'HTTPSessionTimeoutMinutes',
  'Access.HTTP.OriginAllowList': 'HTTPOriginAllowList',
  'Access.Network.IdleConnectionTimeOut': 'IdleConnectionTimeOutSeconds',
  'Administration.ServerLog.Enable': 'ServerLogging',
};

/**
 * Parameters actually set in tm1s.cfg: the non-null leaves of `/StaticConfiguration`
 * (11.8: 158 leaves, 29 set). Needs admin rights — a 401/403 becomes a coverage gap.
 */
async function fetchConfigParams(cfg: Tm1Config): Promise<Array<{ name: string; path: string; value: string }>> {
  const res = await apiRequest('GET', 'StaticConfiguration', undefined, 60_000, cfg);
  if (!isOk(res)) { throw new Error(`StaticConfiguration HTTP ${res.statusCode}`); }
  const body = parseBodySafe<Record<string, unknown>>(res, {});
  const leaves = flatten(Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith('@'))));
  return Object.entries(leaves).map(([path, v]) => ({
    path,
    name: flatNameForPath(path) ?? CFG_NAME_BY_PATH[path] ?? path.split('.').pop() ?? path,
    value: Array.isArray(v) ? v.join(', ') : String(v),
  }));
}

export async function scanSource(
  cfg: Tm1Config,
  serverAlias: string,
  token: vscode.CancellationToken,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<ScanInput> {
  const gaps: string[] = [];
  const check = () => { if (token.isCancellationRequested) { throw new ScanCancelled(); } };

  progress.report({ message: vscode.l10n.t('Reading processes…'), increment: 10 });
  // Without the processes there is nothing to report — this one may throw.
  const processes = (await listProcessesFull(cfg)).map(toSourceProcess);
  const scan: ScanInput = {
    serverAlias, scannedAt: new Date().toISOString(), complete: false,
    processes, activeChoreProcessesLc: [], calls: [], gaps,
  };

  try {
    check();
    progress.report({ message: vscode.l10n.t('Reading chores…'), increment: 20 });
    try {
      const ch = await fetchActiveChoreProcesses(cfg);
      scan.activeChoreProcessesLc = ch.activeLc;
      scan.tpChores = ch.tpChores;
    } catch { gaps.push('chores'); }

    check();
    progress.report({ message: vscode.l10n.t('Reading object names…'), increment: 5 });
    try {
      const r = await fetchObjectNames(cfg);
      scan.objects = r.objects;
      scan.mdxSources = r.subsetMdx;
    } catch { gaps.push('object names'); }

    check();
    progress.report({ message: vscode.l10n.t('Reading MDX views…'), increment: 5 });
    try {
      const partial: string[] = [];
      const views = await fetchAllMdxViews(cfg, partial);
      gaps.push(...partial);
      scan.mdxSources = [...(scan.mdxSources ?? []), ...views.map(v => ({ kind: 'view' as const, owner: v.cube, name: v.view, mdx: v.mdx }))];
    } catch { gaps.push('MDX views'); }

    check();
    progress.report({ message: vscode.l10n.t('Reading the message log…'), increment: 20 });
    try { scan.runLog = await fetchProcessRunLog(cfg); } catch { gaps.push('message log'); }

    check();
    progress.report({ message: vscode.l10n.t('Reading tm1s.cfg…'), increment: 5 });
    try { scan.configParams = await fetchConfigParams(cfg); } catch { gaps.push('tm1s.cfg (needs admin rights)'); }

    check();
    progress.report({ message: vscode.l10n.t('Reading cube rules…'), increment: 10 });
    try { scan.cubeRules = await fetchCubeRules(cfg); } catch { gaps.push('cube rules'); }

    check();
    progress.report({ message: vscode.l10n.t('Resolving process calls…'), increment: 20 });
    try { scan.calls = await staticCalls(processes); } catch { gaps.push('process calls'); }

    check();
    try {
      const v = await apiRequest('GET', 'Configuration?$select=ProductVersion', undefined, undefined, cfg);
      if (isOk(v)) { scan.productVersion = parseBodySafe<{ ProductVersion?: string }>(v, {}).ProductVersion; }
    } catch { /* version is cosmetic — the report shows "?" */ }
    scan.complete = true;
  } catch (e) {
    if (!(e instanceof ScanCancelled)) { throw e; }
  }
  return scan;
}

import * as vscode from 'vscode';
import { apiRequest } from '../tm1Rest/client';
import { encodeODataKey } from '../utils/odataKey';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { getParametersOrEmpty } from '../tm1Rest/processApi';
import { MDXVIEW_ODATA_TYPE } from '../tm1Rest/cubeApi';
import { mapWithConcurrency } from '../utils/mapWithConcurrency';
import { normalizeReadDataSource } from '../utils/dataSourceWire';
import { parseBodySafe, type ODataValueEnvelope } from '../tm1Rest/parseRest';
import {
  buildReferenceIndex,
  ProcessFetchResult, CubeRulesFetchResult,
  ChoreFetchResult,
  type SubsetFetchResult, type MdxViewFetchResult, type ViewSubsetUse,
} from './referenceIndex';
import type { ReferenceIndex } from './referenceTypes';
import { refLog, refWarn, refError } from './refLog';
import { errMsg } from '../utils/errMsg';
import { Tm1HttpError } from '../tm1Rest/httpError';
import { currentAbortSignal, runWithAbortSignal } from '../tm1Rest/transport/abortScope';

// ─── Per-server cache (30s TTL) ─────────────────────────────────────────────

interface CacheEntry { idx: ReferenceIndex; ts: number; }
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(cfg?: Tm1Config): string {
  return cfg?.serverUrl ?? '__default__';
}

export function invalidateReferenceIndex(cfg?: Tm1Config): void {
  if (cfg === undefined) { cache.clear(); return; }
  cache.delete(cacheKey(cfg));
}

/**
 * Cache-only peek — returns the fresh (within-TTL) index if one is already
 * built for this server, else undefined. Never fetches and never shows the
 * "Analyzing…" progress toast, so it is safe to call on a hot path like the
 * per-keystroke TI linter: it opportunistically reuses the shared param index
 * (populated by call-graph / findReferences) and falls back gracefully when
 * cold. Use `getOrBuildIndex` when you actually need the index built.
 */
export function peekReferenceIndex(cfg?: Tm1Config): ReferenceIndex | undefined {
  const cached = cache.get(cacheKey(cfg));
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) { return cached.idx; }
  return undefined;
}

// ─── Server fetchers ─────────────────────────────────────────────────────────

interface ApiProcess {
  Name?: string;
  PrologProcedure?: string;
  MetadataProcedure?: string;
  DataProcedure?: string;
  EpilogProcedure?: string;
  Parameters?: Array<{ Name?: string; Value?: string | number; Type?: string }>;
  DataSource?: unknown;
}

async function fetchAllProcesses(cfg: Tm1Config): Promise<ProcessFetchResult[]> {
  // In OData v4, Parameters is a complex-type property (not an entity set).
  // Strict servers (e.g. Planning Analytics) therefore reject $expand=Parameters with
  // HTTP 400 ("Expecting '/' after property of complex type in expand path.").
  // Correct way: list Parameters in $select — includes the complex type
  // completely in the response. Older TM1 versions additionally accept $expand.
  //
  // `DataSource` is in the same query: a process that pulls a cube only
  // as a data source names it in none of its four sections. Without
  // this field the index reports "is used nowhere" for a cube that has a
  // process attached every night. It is a complex type, so it belongs in
  // $select and NOT in $expand (same rule as for Parameters).
  const urls = [
    // 1) Primary — $select incl. Parameters + DataSource (OData-v4-compliant, universal)
    'Processes?$select=Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,Parameters,DataSource',
    // 2) Legacy — $expand for TM1 versions that treat Parameters as a navigation property
    'Processes?$select=Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,Parameters,DataSource'
      + '&$expand=Parameters($select=Name,Value,Type)',
    // 3) Legacy variadisch
    'Processes?$expand=Parameters',
    // 4) Last fallback — no parameters, no data source (env propagation
    //    falls back to "unknown", data source edges are missing)
    'Processes?$select=Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure',
  ];
  let res;
  let successUrl = '';
  let lastStatus = 0;
  let lastBody = '';
  for (const url of urls) {
    res = await apiRequest('GET', url, undefined, 60_000, cfg);
    if (res.statusCode === 200) { successUrl = url; break; }
    refWarn(`Processes-Fetch ${url.slice(0, 80)}… → HTTP ${res.statusCode}`);
    lastStatus = res.statusCode;
    lastBody = res.body?.slice(0, 200) ?? '';
    res = undefined;
  }
  if (!res) {
    refError(`Processes fetch failed (HTTP ${lastStatus}): ${lastBody}`);
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: Failed to load Processes (HTTP {0}).', lastStatus));
    // Throw, not `[]`: `buildReferenceIndex` records the source in `incomplete`.
    throw new Error(`processes HTTP ${lastStatus}`);
  }
  const processes = parseBodySafe<ODataValueEnvelope<ApiProcess>>(res, {}).value ?? [];
  const totalWithParams = processes.filter(p => (p.Parameters ?? []).length > 0).length;
  refLog(`fetched ${processes.length} processes (${totalWithParams} with params) via "${successUrl.slice(0, 80)}…"`);
  const mapped = processes.map(p => {
    const parameters = (p.Parameters ?? [])
      .map(x => String(x.Name ?? ''))
      .filter(n => n !== '');
    const parameterDefaults = new Map<string, string>();
    for (const x of p.Parameters ?? []) {
      if (x.Name && x.Value !== undefined && x.Value !== null && x.Value !== '') {
        parameterDefaults.set(String(x.Name), String(x.Value));
      }
    }
    // `normalizeReadDataSource` reads the lowercase wire fields
    // (`dataSourceNameForServer`, `view`, `subset`) — the same parser the
    // process editor uses, no second one next to it.
    const wire = p.DataSource === undefined ? undefined : normalizeReadDataSource(p.DataSource);
    return {
      name: String(p.Name ?? ''),
      prolog:   String(p.PrologProcedure   ?? ''),
      metadata: String(p.MetadataProcedure ?? ''),
      data:     String(p.DataProcedure     ?? ''),
      epilog:   String(p.EpilogProcedure   ?? ''),
      parameters,
      parameterDefaults,
      dataSource: wire && wire.Type !== 'None'
        ? {
          type: wire.Type,
          nameForServer: wire.dataSourceNameForServer,
          view: wire.view,
          subset: wire.subset,
          query: wire.Query,
        }
        : undefined,
    };
  }).filter(p => p.name !== '');

  // Per-process fallback: if the collection URL returned no Parameters
  // (e.g. because only variant 4 was accepted), we fetch Parameters per
  // process individually. The endpoint `Processes('Name')/Parameters` is also
  // accepted by strict servers — but is considerably slower than a collection.
  if (totalWithParams === 0 && mapped.length > 0) {
    refLog(`Fallback: individual Parameters fetches for ${mapped.length} processes…`);
    await enrichProcessesPerProcessFetch(mapped, cfg);
  }

  return mapped;
}

async function enrichProcessesPerProcessFetch(
  processes: ProcessFetchResult[],
  cfg: Tm1Config,
): Promise<void> {
  const CONCURRENCY = 8;
  let idx = 0;
  let enrichedCount = 0;
  let failedCount = 0;

  const worker = async (): Promise<void> => {
    while (idx < processes.length) {
      const p = processes[idx++];
      try {
        let arr: Array<{ Name?: string; Value?: string | number; Type?: string }> = [];
        try {
          arr = (await getParametersOrEmpty(cfg, p.name, 30_000)) as Array<{ Name?: string; Value?: string | number; Type?: string }>;
        } catch {
          failedCount++;
          continue;
        }
        p.parameters = arr.map(x => String(x.Name ?? '')).filter(n => n !== '');
        const defaults = new Map<string, string>();
        for (const x of arr) {
          if (x.Name && x.Value !== undefined && x.Value !== null && x.Value !== '') {
            defaults.set(String(x.Name), String(x.Value));
          }
        }
        p.parameterDefaults = defaults;
        if (arr.length > 0) { enrichedCount++; }
      } catch { failedCount++; }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  refLog(`per-process fallback: ${enrichedCount} processes enriched with params, ${failedCount} failed`);
}

interface ApiChoreTaskParam {
  Name?: string;
  Value?: string | number;
  Type?: string;
}

interface ApiChoreTask {
  Step?: number;
  Process?: { Name?: string };
  Parameters?: ApiChoreTaskParam[];
}

interface ApiChore {
  Name?: string;
  Tasks?: ApiChoreTask[];
}

export function mapChoresResponse(body: any): ChoreFetchResult[] {
  const arr = Array.isArray(body?.value) ? (body.value as ApiChore[]) : [];
  const out: ChoreFetchResult[] = [];
  for (const c of arr) {
    if (!c.Name) { continue; }
    const tasks = (c.Tasks ?? []).map((t, idx) => ({
      step: typeof t.Step === 'number' ? t.Step : idx,
      processName: String(t.Process?.Name ?? ''),
      params: (t.Parameters ?? [])
        .filter(p => !!p.Name)
        .map(p => ({
          name: String(p.Name),
          value: p.Value === undefined || p.Value === null ? '' : String(p.Value),
          type: (String(p.Type ?? 'String').toLowerCase() === 'numeric' ? 'numeric' : 'string') as 'numeric' | 'string',
        })),
    })).filter(t => t.processName !== '');
    out.push({ name: c.Name, tasks });
  }
  return out;
}

async function fetchAllChores(cfg: Tm1Config): Promise<ChoreFetchResult[]> {
  // Some TM1 versions reject specific $select/$expand combinations (HTTP 400).
  // Order: complete → minimal. OData v4 allows ',' between parallel expands
  // as well as ';' as a separator within an expand option — TM1 is picky here.
  const urls = [
    // 1) kompakt mit nested $selects
    'Chores?$select=Name'
      + '&$expand=Tasks($select=Step;$expand=Process($select=Name),Parameters($select=Name,Value,Type))',
    // 2) ohne nested $select, Komma-Separator
    'Chores?$select=Name&$expand=Tasks($expand=Process,Parameters)',
    // 3) ohne $select am Root, volles Tasks mit Komma
    'Chores?$expand=Tasks($expand=Process,Parameters)',
    // 4) Semikolon-Separator in Expand-Options (OData v4 strict)
    'Chores?$expand=Tasks($expand=Process;$expand=Parameters)',
    // 5) Process only — in case Parameters is the cause
    'Chores?$expand=Tasks($expand=Process)',
    // 6) Pfad-basierter Expand (OData v4)
    'Chores?$expand=Tasks,Tasks/Process,Tasks/Parameters',
    // 7) Minimal — only Tasks, no nested expand
    'Chores?$expand=Tasks',
  ];
  let res;
  let successUrl = '';
  let lastStatus = 0;
  for (const url of urls) {
    res = await apiRequest('GET', url, undefined, 60_000, cfg);
    if (res.statusCode === 200) { successUrl = url; break; }
    refWarn(`Chores-Fetch ${url.slice(0, 80)}… → HTTP ${res.statusCode}`);
    lastStatus = res.statusCode;
    res = undefined;
  }
  if (!res) {
    refError(`Chores fetch failed (HTTP ${lastStatus}) — chore graph stays empty.`);
    throw new Error(`chores HTTP ${lastStatus}`);
  }
  try {
    const body = parseBodySafe<unknown>(res, {});
    const result = mapChoresResponse(body);
    const totalTasks = result.reduce((s, c) => s + c.tasks.length, 0);
    refLog(`fetched ${result.length} chores with ${totalTasks} tasks via "${successUrl}"`);

    // If the list returned chores but NO task got a process name
    // (happens with a minimal $expand=Tasks — Process is only an @odata.bind link):
    // do a second single fetch per chore, which often works on a strict server too.
    if (result.length > 0 && totalTasks === 0) {
      refLog(`Fallback: individual chore fetches for task details…`);
      const enriched = await enrichChoresPerChoreFetch(result.map(c => c.name), cfg);
      if (enriched !== null) { return enriched; }
      // Diagnostics: dump the body shape so we know how Process is transmitted
      const sample = JSON.stringify(body).slice(0, 800);
      refWarn(`Chores-Response-Shape (erste 800 Zeichen): ${sample}`);
    }
    return result;
  } catch (e) {
    refError(`Chores-Response parse failed: ${errMsg(e)}`);
    throw e;
  }
}

/**
 * Per-chore fallback: one GET per chore with an explicit Process/Parameters expand.
 * Returns null if NONE of the single queries returns task data → the caller
 * keeps the original (empty) result.
 */
async function enrichChoresPerChoreFetch(
  choreNames: string[],
  cfg: Tm1Config,
): Promise<ChoreFetchResult[] | null> {
  const perChoreUrls = (name: string) => {
    const encoded = encodeURIComponent(name).replace(/'/g, '%27%27');
    return [
      `Chores('${encoded}')?$expand=Tasks($expand=Process;$expand=Parameters)`,
      `Chores('${encoded}')?$expand=Tasks($expand=Process,Parameters)`,
      `Chores('${encoded}')?$expand=Tasks,Tasks/Process,Tasks/Parameters`,
      `Chores('${encoded}')?$expand=Tasks($expand=Process)`,
    ];
  };
  const out: ChoreFetchResult[] = [];
  let anyTasks = false;
  for (const name of choreNames) {
    let parsed: ChoreFetchResult | null = null;
    for (const url of perChoreUrls(name)) {
      const res = await apiRequest('GET', url, undefined, 60_000, cfg);
      if (res.statusCode !== 200) { continue; }
      const body = parseBodySafe<unknown>(res, null);
      if (body === null) { continue; }
      // Single chore is not an array — bring it into {value:[…]} form
      const wrapped = { value: [body] };
      const [one] = mapChoresResponse(wrapped);
      if (one && one.tasks.length > 0) { parsed = one; break; }
      if (one && !parsed) { parsed = one; } // merken, aber weiterprobieren
    }
    if (parsed) {
      if (parsed.tasks.length > 0) { anyTasks = true; }
      out.push(parsed);
    } else {
      out.push({ name, tasks: [] });
    }
  }
  if (!anyTasks) { return null; }
  const total = out.reduce((s, c) => s + c.tasks.length, 0);
  refLog(`per-chore fallback: ${out.length} chores with ${total} tasks`);
  return out;
}

export function parseSubsetsResponse(json: unknown): SubsetFetchResult[] {
  const dims = (json as { value?: Array<{ Name?: string; Hierarchies?: Array<{ Name?: string; Subsets?: Array<{ Name?: string; Expression?: string | null }> }> }> })?.value ?? [];
  const out: SubsetFetchResult[] = [];
  for (const d of dims) {
    const dim = String(d.Name ?? '');
    if (!dim) { continue; }
    for (const h of d.Hierarchies ?? []) {
      const hier = String(h.Name ?? '');
      for (const s of h.Subsets ?? []) {
        const subset = String(s.Name ?? '');
        if (!subset) { continue; }
        out.push({ dim, hier, subset, expression: s.Expression ?? null });
      }
    }
  }
  return out;
}

/** Names of the views in a `/Views` list response that are MDX views (derived
 *  type `MDXView`, surfaced via `@odata.type`). Native views are excluded. */
export function parseMdxViewNames(json: unknown): string[] {
  const views = (json as { value?: Array<{ Name?: string; '@odata.type'?: string }> })?.value ?? [];
  return views
    .filter(v => v['@odata.type'] === MDXVIEW_ODATA_TYPE)
    .map(v => String(v.Name ?? ''))
    .filter(Boolean);
}

async function fetchAllDimNames(cfg: Tm1Config): Promise<string[]> {
  const res = await apiRequest('GET', 'Dimensions?$select=Name', undefined, 60_000, cfg);
  if (res.statusCode !== 200) { throw new Tm1HttpError(`dimension names HTTP ${res.statusCode}`, res.statusCode); }
  const dims = parseBodySafe<ODataValueEnvelope<{ Name?: string }>>(res, {}).value ?? [];
  return dims.map(d => String(d.Name ?? '')).filter(Boolean);
}

const SUBSET_FALLBACK_CONCURRENCY = 8;

/**
 * `partial` collects sources that were read only in part. A per-item failure
 * still degrades to an empty slice (one bad dimension must not sink the
 * index), but it is NOT silent any more: the caller adds the entry to
 * `incomplete`, which warns and blocks caching (review 2026-10-03, A5).
 */
async function fetchAllSubsets(cfg: Tm1Config, partial: string[]): Promise<SubsetFetchResult[]> {
  // Expression is a plain string prop → deep $expand usually works; some strict
  // servers 400 on nested expand (complex-type quirk, docs/architecture/tm1-rest-quirks.md) → per-dim fallback.
  const deep = 'Dimensions?$select=Name&$expand=Hierarchies($select=Name;$expand=Subsets($select=Name,Expression))';
  const res = await apiRequest('GET', deep, undefined, 60_000, cfg);
  if (res.statusCode === 200) {
    const subs = parseSubsetsResponse(parseBodySafe<unknown>(res, {}));
    refLog(`fetched ${subs.length} subsets (deep expand)`);
    return subs;
  }
  refWarn(`subset deep-expand → HTTP ${res.statusCode}; per-dim fallback`);
  const dimNames = await fetchAllDimNames(cfg);
  // Bounded worker-pool + per-dim isolation: mirror the MDX-view path (65931199)
  // so hundreds of dims can't burst thousands of concurrent GETs, and one
  // failing dim degrades to an empty list instead of nuking the whole index.
  let failed = 0;
  const perDim = await mapWithConcurrency(dimNames, SUBSET_FALLBACK_CONCURRENCY, async dim => {
    try {
      const r = await apiRequest('GET',
        `Dimensions('${encodeODataKey(dim)}')?$select=Name&$expand=Hierarchies($select=Name;$expand=Subsets($select=Name,Expression))`,
        undefined, 60_000, cfg);
      if (r.statusCode !== 200) { failed++; return [] as SubsetFetchResult[]; }
      return parseSubsetsResponse({ value: [parseBodySafe<unknown>(r, {})] });
    } catch { failed++; return [] as SubsetFetchResult[]; }
  });
  if (failed) { partial.push(`subsets (${failed} dimensions)`); }
  const flat = perDim.flat();
  refLog(`fetched ${flat.length} subsets (per-dim fallback)`);
  return flat;
}

const MDX_VIEW_CONCURRENCY = 8;

export async function fetchAllMdxViews(cfg: Tm1Config, partial: string[]): Promise<MdxViewFetchResult[]> {
  const cubesRes = await apiRequest('GET', 'Cubes?$select=Name', undefined, 60_000, cfg);
  if (cubesRes.statusCode !== 200) { throw new Tm1HttpError(`MDX views: cube list HTTP ${cubesRes.statusCode}`, cubesRes.statusCode); }
  const cubeNames = (parseBodySafe<ODataValueEnvelope<{ Name?: string }>>(cubesRes, {}).value ?? [])
    .map(c => String(c.Name ?? '')).filter(Boolean);

  // `MDX` is a derived-type (MDXView) property: a collection-level
  // `Views?$select=MDX` returns `undefined` for it (live-verified). Reliable
  // path = list views (keeps `@odata.type`) → classify → fetch MDX per view.
  // Both phases run through a bounded worker-pool so a large server (hundreds of
  // cubes × several MDX views) can't burst thousands of concurrent requests, and
  // each item is isolated in try/catch so one thrown error can't wipe the batch.

  // Phase 1: per cube, list + classify → (cube, view) pairs.
  let failedCubes = 0;
  const pairsPerCube = await mapWithConcurrency(cubeNames, MDX_VIEW_CONCURRENCY, async (cube) => {
    try {
      const listRes = await apiRequest('GET',
        `Cubes('${encodeODataKey(cube)}')/Views?$select=Name`, undefined, 60_000, cfg);
      if (listRes.statusCode !== 200) { failedCubes++; return [] as Array<{ cube: string; view: string }>; }
      return parseMdxViewNames(parseBodySafe<unknown>(listRes, {})).map(view => ({ cube, view }));
    } catch { failedCubes++; return [] as Array<{ cube: string; view: string }>; }
  });
  if (failedCubes) { partial.push(`MDX views (${failedCubes} cubes)`); }
  const pairs = pairsPerCube.flat();

  // Phase 2: fetch the MDX text per view.
  let failedViews = 0;
  const results = await mapWithConcurrency(pairs, MDX_VIEW_CONCURRENCY, async ({ cube, view }) => {
    try {
      const r = await apiRequest('GET',
        `Cubes('${encodeODataKey(cube)}')/Views('${encodeODataKey(view)}')?$select=MDX`,
        undefined, 60_000, cfg);
      if (r.statusCode !== 200) { failedViews++; return null; }
      const mdx = String(parseBodySafe<{ MDX?: string }>(r, {}).MDX ?? '');
      return mdx ? { cube, view, mdx } : null;
    } catch { failedViews++; return null; }
  });
  if (failedViews) { partial.push(`MDX views (${failedViews} views)`); }

  const flat = results.filter((v): v is MdxViewFetchResult => v !== null);
  refLog(`fetched ${flat.length} MDX views (${pairs.length} candidates across ${cubeNames.length} cubes)`);
  return flat;
}

/**
 * Which named subset lies on which axis of which native view —
 * ONE query for the whole server.
 *
 * `Rows` belongs to the derived type `NativeView`, not `View`: without the
 * type cast in the path TM1 answers with `400 Code 278` ("'Rows' is not a
 * property of 'View'"). Measured 2026-09-19 against 11.8.02900.8: 132 cubes,
 * 145 views, 222 KB in 49 ms — one call, not one call per view.
 *
 * Axes without a named subset (the normal case: 516 of 653 on the
 * test instance) carry an anonymous expression and drop out — there is no
 * object that anyone could delete.
 */
async function fetchAllViewSubsetUses(cfg: Tm1Config): Promise<ViewSubsetUse[]> {
  const NATIVE_VIEW = 'ibm.tm1.api.v1.NativeView';
  const axis = (name: string): string =>
    `${NATIVE_VIEW}/${name}/Subset($select=Name;$expand=Hierarchy($select=Name;$expand=Dimension($select=Name)))`;
  const url = 'Cubes?$select=Name&$expand=Views($select=Name;$expand='
    + [axis('Rows'), axis('Columns'), axis('Titles')].join(',') + ')';

  const res = await apiRequest('GET', url, undefined, 60_000, cfg);
  if (res.statusCode !== 200) {
    refWarn(`view axes → HTTP ${res.statusCode}: ${res.body?.slice(0, 160) ?? ''}`);
    // Throw, do not return empty: `buildReferenceIndex` then records the
    // failure in `incomplete`. An empty list would mean "no view
    // holds this subset" — exactly the information on which someone deletes.
    throw new Tm1HttpError(`view axes HTTP ${res.statusCode}`, res.statusCode);
  }
  const body = parseBodySafe<ODataValueEnvelope<RawAxisCube>>(res, {});
  return parseViewSubsetUses(body);
}

interface RawAxisSubset {
  Name?: string;
  Hierarchy?: { Name?: string; Dimension?: { Name?: string } };
}
interface RawAxisEntry { Subset?: RawAxisSubset }
interface RawAxisView {
  Name?: string;
  Rows?: RawAxisEntry[];
  Columns?: RawAxisEntry[];
  Titles?: RawAxisEntry[];
}
interface RawAxisCube { Name?: string; Views?: RawAxisView[] }

/** Exported for the guard — the evaluation is the place that tips over. */
export function parseViewSubsetUses(body: ODataValueEnvelope<RawAxisCube>): ViewSubsetUse[] {
  const out: ViewSubsetUse[] = [];
  for (const cube of body.value ?? []) {
    const cubeName = String(cube.Name ?? '');
    if (!cubeName) { continue; }
    for (const view of cube.Views ?? []) {
      const viewName = String(view.Name ?? '');
      if (!viewName) { continue; }
      for (const entry of [...(view.Rows ?? []), ...(view.Columns ?? []), ...(view.Titles ?? [])]) {
        const sub = entry?.Subset;
        const subset = String(sub?.Name ?? '');
        const dim = String(sub?.Hierarchy?.Dimension?.Name ?? '');
        if (!subset || !dim) { continue; }
        out.push({
          cube: cubeName, view: viewName, dim,
          hier: String(sub?.Hierarchy?.Name ?? dim),
          subset,
        });
      }
    }
  }
  return out;
}

async function fetchAllCubesWithRules(cfg: Tm1Config): Promise<CubeRulesFetchResult[]> {
  const res = await apiRequest(
    'GET',
    'Cubes?$select=Name,Rules',
    undefined,
    60_000,
    cfg,
  );
  // Throw, not `[]`: an empty rule list would read as "no rule uses this".
  if (res.statusCode !== 200) { throw new Tm1HttpError(`cube rules HTTP ${res.statusCode}`, res.statusCode); }
  return (parseBodySafe<ODataValueEnvelope<{ Name?: string; Rules?: string }>>(res, {}).value ?? []).map(c => ({
    cubeName:  String(c.Name  ?? ''),
    rulesText: String(c.Rules ?? ''),
  // Discard ONLY nameless entries, NOT the ruleless cubes: this list
  // is at the same time the cube inventory against which `buildReferenceIndex`
  // classifies the data source names set in TI code. With the old filter every
  // cube without rule text was missing from it — that is, the majority — and
  // `DatasourceNameForServer = 'Sales';` produced no edge. The
  // rule evaluation skips empty texts by itself anyway.
  })).filter(c => c.cubeName !== '');
}

// ─── Index builder with progress + cache ─────────────────────────────────────

export async function getOrBuildIndex(cfg: Tm1Config): Promise<ReferenceIndex> {
  const key = cacheKey(cfg);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) { return cached.idx; }

  const partial: string[] = [];
  const idx = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Analyzing Processes and Rules…'),
      cancellable: true,
    },
    // Cancel aborts the pending GETs; each aborted source lands in
    // `incomplete`, so the index warns and stays out of the cache like any
    // other partial read. The caller's own signal (a closing panel) still counts.
    (_progress, token) => {
      const abort = new AbortController();
      currentAbortSignal()?.addEventListener('abort', () => abort.abort());
      token.onCancellationRequested(() => abort.abort());
      return runWithAbortSignal(abort.signal, () => buildReferenceIndex({
      fetchProcesses:      () => fetchAllProcesses(cfg),
      fetchCubesWithRules: () => fetchAllCubesWithRules(cfg),
      fetchChores:         () => fetchAllChores(cfg),
      fetchSubsets:        () => fetchAllSubsets(cfg, partial),
      fetchMdxViews:       () => fetchAllMdxViews(cfg, partial),
      fetchDimNames:       () => fetchAllDimNames(cfg),
      fetchViewSubsetUses: () => fetchAllViewSubsetUses(cfg),
    }));
    },
  );
  const procCallRefs = idx.all.filter(r => r.sourceKind === 'process' && r.targetKind === 'process').length;
  refLog(
    `built index: ${idx.bySourceProcess.size} caller-processes, `
    + `${idx.byProcess.size} target-processes, ${procCallRefs} process→process refs, `
    + `${idx.processParams.size} processes with params`,
  );
  idx.incomplete.push(...partial);
  if (idx.incomplete.length > 0) {
    refLog(`index INCOMPLETE — failed sources: ${idx.incomplete.join(', ')}`);
    vscode.window.showWarningMessage(
      vscode.l10n.t(
        'TM1: The reference index is incomplete ({0} could not be read). "Not referenced" may be wrong — do not rely on it before deleting.',
        idx.incomplete.join(', '),
      ),
    );
  }
  // Cache only non-empty AND complete indexes: a partial outage must not pass
  // itself off as a full answer for 30 s.
  if (idx.all.length > 0 && idx.incomplete.length === 0) {
    cache.set(key, { idx, ts: Date.now() });
  }
  return idx;
}

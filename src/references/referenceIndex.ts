// Building of the reference index from the loaded server objects and the query
// on it. Detection per section: refExtract.ts and dataSourceRefs.ts; types:
// referenceTypes.ts.
import { buildProcessEnv, type ProcessEnv, type VarBinding } from './variableEnv';
import { extractTiReferences, extractRulesReferences, truncateSnippet } from './refExtract';
import { effectiveDataSourceKind, extractDatasourceAssignments, fileSourceDir, odbcTables } from './dataSourceRefs';
import type {
  ChoreTaskRef, DataSourceScope, ProcessDataSource, ProcessDataSourceInfo, RefSection,
  RefTargetKind, ReferenceIndex, TmReference, UnresolvedDataSource, ViewRef,
} from './referenceTypes';

// ─── Index assembly ──────────────────────────────────────────────────────────

export interface ProcessFetchResult {
  name: string;
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
  /** Parameter names declared on this process (used for pass-through resolution). */
  parameters?: string[];
  /** Default values (string form) by param name, if known. Used as root-env when graph starts here. */
  parameterDefaults?: Map<string, string>;
  /** Am Prozessobjekt angemeldete Datenquelle (Reiter „Datenquelle"). */
  dataSource?: ProcessDataSource;
}

/**
 * ALL cubes of the server, with their rule text — `rulesText` may be empty.
 *
 * The list has two jobs, and the second is easy to overlook: it is also the
 * **cube inventory** against which the data source names set in TI code are
 * classified. Whoever restricts it to cubes WITH rules takes the majority of
 * cubes away from the classification.
 */
export interface CubeRulesFetchResult {
  cubeName: string;
  rulesText: string;   // full rules incl. FEEDERS section, darf leer sein
}

export interface ChoreFetchResult {
  name: string;
  tasks: ChoreTaskRef[];
}

export interface BuildIndexDeps {
  fetchProcesses: () => Promise<ProcessFetchResult[]>;
  fetchCubesWithRules: () => Promise<CubeRulesFetchResult[]>;
  fetchChores?: () => Promise<ChoreFetchResult[]>;
  fetchSubsets?: () => Promise<SubsetFetchResult[]>;
  fetchMdxViews?: () => Promise<MdxViewFetchResult[]>;
  fetchDimNames?: () => Promise<string[]>;
  fetchViewSubsetUses?: () => Promise<ViewSubsetUse[]>;
}

export interface SubsetFetchResult { dim: string; hier: string; subset: string; expression: string | null }

/** A named subset on an axis of a native view. */
export interface ViewSubsetUse extends ViewRef {
  dim: string;
  hier: string;
  subset: string;
}

/** Key of the `subsetViews` map. */
export function subsetKey(dim: string, hier: string, subset: string): string {
  return `${dim.toLowerCase()}|${hier.toLowerCase()}|${subset.toLowerCase()}`;
}
export interface MdxViewFetchResult { cube: string; view: string; mdx: string }

/** Distinct names referenced by an MDX/Expression text: every `[…]`
 *  bracket token that matches `known` (case-insensitive), original casing
 *  preserved, deduped. The caller decides WHICH stock it matches against —
 *  see `dimsFromMdx` and `cubesFromMdx`. Deliberately broader than `extractElementRefs` — it also
 *  catches set-function refs like `[Product].Members` where the dim is not
 *  element-qualified. A literal `]` inside a bracketed name is TM1-escaped as
 *  `]]`; the scan handles that (matches `]]` as one literal `]` and unescapes
 *  it) so names containing `]` parse correctly. Note the broader set-function
 *  matching is a deliberate, documented over-match — unchanged here. */
function bracketedNames(text: string, known: Set<string>): string[] {
  if (!text) { return []; }
  const seen = new Set<string>();
  const out: string[] = [];
  // Inside `[…]`, a literal `]` is doubled (`]]`); consume it as a pair so the
  // token only closes on a single, unescaped `]`.
  const re = /\[((?:[^\]\n]|\]\])+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].replace(/\]\]/g, ']');
    const lc = name.toLowerCase();
    if (!known.has(lc) || seen.has(lc)) { continue; }
    seen.add(lc);
    out.push(name);
  }
  return out;
}

/** Die Dimensionen eines Ausdrucks. */
export function dimsFromMdx(text: string, knownDims: Set<string>): string[] {
  return bracketedNames(text, knownDims);
}

/**
 * The same bracket search, only against the cube inventory.
 *
 * An MDX expression names a foreign cube in the same `[…]` form as a
 * dimension — which kind a name denotes is decided solely by the match against
 * what is on the server. Without this second match, every cube reference of a
 * view or a dynamic subset fell through: `dimsFromMdx` discards whatever is
 * not in `knownDims`.
 */
export function cubesFromMdx(text: string, knownCubes: Set<string>): string[] {
  return bracketedNames(text, knownCubes);
}

/** Edges of a subset to THE OTHER dimensions of its expression.
 *  The own dimension is deliberately NOT a target: by definition a subset
 *  hangs on exactly one dimension, so "is used in its own subsets" is no
 *  information but clogs the usage view of every dimension with its complete
 *  subset list.
 *  Only the cross reference remains interesting: a dynamic subset on Region
 *  whose MDX filters Product is a real use of Product. */
export function subsetToRefs(
  s: SubsetFetchResult,
  knownDims: Set<string>,
  knownCubes: Set<string> = new Set(),
): TmReference[] {
  const sourceName = `${s.dim}:${s.hier}:${s.subset}`;
  const snippet = s.expression ? truncateSnippet(s.expression) : '<static>';
  const seen = new Set<string>([s.dim.toLowerCase()]);
  const targets: string[] = [];
  for (const d of dimsFromMdx(s.expression ?? '', knownDims)) {
    if (!seen.has(d.toLowerCase())) { seen.add(d.toLowerCase()); targets.push(d); }
  }
  const base: Omit<TmReference, 'targetKind' | 'targetName'> = {
    sourceKind: 'subset' as const, sourceName, section: 'subset' as const,
    line: 0, snippet,
  };
  return [
    ...targets.map(targetName => ({ ...base, targetKind: 'dimension' as const, targetName })),
    // A dynamic subset whose expression filters cell values of a cube hangs on
    // that cube — if the cube goes, the subset yields nothing any more.
    // There is no need to exclude an own cube: a subset has none.
    ...cubesFromMdx(s.expression ?? '', knownCubes)
      .map(targetName => ({ ...base, targetKind: 'cube' as const, targetName })),
  ];
}

export function mdxViewToRefs(
  v: MdxViewFetchResult,
  knownDims: Set<string>,
  knownCubes: Set<string> = new Set(),
): TmReference[] {
  const sourceName = `${v.cube}:${v.view}`;
  const snippet = truncateSnippet(v.mdx);
  const base: Omit<TmReference, 'targetKind' | 'targetName'> = {
    sourceKind: 'view' as const, sourceName, section: 'view' as const,
    line: 0, snippet,
  };
  // The OWN cube is not a target — same rule as for the own dimension of a
  // subset. Every `SELECT … FROM [Sales]` names Sales; counting that as a use
  // would mean holding up every cube's own view list as a dependency, and
  // that goes along with it when it is deleted anyway.
  // A cross reference to a FOREIGN cube, by contrast, is a real binding.
  const own = v.cube.toLowerCase();
  return [
    ...dimsFromMdx(v.mdx, knownDims)
      .map(targetName => ({ ...base, targetKind: 'dimension' as const, targetName })),
    ...cubesFromMdx(v.mdx, knownCubes).filter(c => c.toLowerCase() !== own)
      .map(targetName => ({ ...base, targetKind: 'cube' as const, targetName })),
  ];
}

/**
 * Builds a complete reference index from processes + cube rules.
 * Pure function — dependencies are injected to allow testing without network.
 */
export async function buildReferenceIndex(deps: BuildIndexDeps): Promise<ReferenceIndex> {
  // A source that fails still yields an empty list so the rest of the index can be
  // built — but the failure is recorded. Without it, "no references found" was
  // indistinguishable from "the fetch died", and that answer is what a user acts
  // on before deleting an object.
  const incomplete: string[] = [];
  const guard = <T>(source: string, p: Promise<T[]> | undefined, fallback: T[]): Promise<T[]> =>
    p ? p.catch(() => { incomplete.push(source); return fallback; }) : Promise.resolve(fallback);

  const [processes, cubes, chores, subsets, mdxViews, dimNames, viewSubsetUses] = await Promise.all([
    guard('processes', deps.fetchProcesses(), [] as ProcessFetchResult[]),
    guard('cube rules', deps.fetchCubesWithRules(), [] as CubeRulesFetchResult[]),
    guard('chores', deps.fetchChores?.(), [] as ChoreFetchResult[]),
    guard('subsets', deps.fetchSubsets?.(), [] as SubsetFetchResult[]),
    guard('MDX views', deps.fetchMdxViews?.(), [] as MdxViewFetchResult[]),
    guard('dimension names', deps.fetchDimNames?.(), [] as string[]),
    guard('view axes', deps.fetchViewSubsetUses?.(), [] as ViewSubsetUse[]),
  ]);

  const all: TmReference[] = [];

  const pushTi = (
    sourceName: string,
    section: RefSection,
    text: string,
    env: ProcessEnv,
    sharedLiveVars: Map<string, VarBinding>,
  ) => {
    if (!text) { return; }
    for (const r of extractTiReferences(text, env, sharedLiveVars)) {
      all.push({
        sourceKind: 'process',
        sourceName,
        section,
        line: r.line,
        snippet: r.snippet,
        funcName: r.funcName,
        targetKind: r.targetKind,
        targetName: r.targetName,
        params: r.params,
      });
    }
  };

  // Both name lists BEFORE the process loop: they classify the values that the
  // TI code assigns to the data source globals. `DatasourceNameForServer`
  // carries a cube, dimension, DSN or file name depending on the kind of
  // source — which one it is is decided solely by the match against what is
  // on the server.
  const knownDims = new Set<string>(dimNames.map(d => d.toLowerCase()));
  for (const s of subsets) { knownDims.add(s.dim.toLowerCase()); }
  const knownCubes = new Set<string>(cubes.map(c => c.cubeName.toLowerCase()));

  const processDataSources = new Map<string, ProcessDataSourceInfo>();
  const dynamicDataSources: UnresolvedDataSource[] = [];

  /** A data source edge. `line`/`snippet` point at the assignment if there was
   *  one; the logged-in source has no line in the source text. */
  const pushDs = (
    sourceName: string,
    targetKind: 'cube' | 'dimension',
    targetName: string,
    snippet: string,
    line: number,
    funcName?: string,
  ) => {
    all.push({
      sourceKind: 'process', sourceName, section: 'datasource',
      line, snippet, funcName, targetKind, targetName,
    });
  };

  for (const p of processes) {
    // Build env once from *all* sections concatenated so var assignments made in
    // Prolog are visible to ExecuteProcess calls in Data/Epilog (mirrors TI runtime behavior).
    const combinedText = [p.prolog, p.metadata, p.data, p.epilog].join('\n');
    const env = buildProcessEnv(combinedText, p.parameters ?? []);
    // Shared liveVars across all 4 sections — prolog assignments stay visible in data/epilog
    // and the flow-sensitive evaluation also works across section boundaries.
    const sharedLiveVars = new Map(env.vars);

    pushTi(p.name, 'prolog',   p.prolog,   env, sharedLiveVars);
    pushTi(p.name, 'metadata', p.metadata, env, sharedLiveVars);
    pushTi(p.name, 'data',     p.data,     env, sharedLiveVars);
    pushTi(p.name, 'epilog',   p.epilog,   env, sharedLiveVars);

    // The logged-in source: its kind says what `nameForServer` means —
    // nothing is guessed here.
    const ds = p.dataSource;
    if (ds?.nameForServer) {
      if (ds.type === 'TM1CubeView') {
        pushDs(p.name, 'cube', ds.nameForServer,
          `DataSource: ${ds.nameForServer}:${ds.view ?? ''}`, 0);
      } else if (ds.type === 'TM1DimensionSubset') {
        pushDs(p.name, 'dimension', ds.nameForServer,
          `DataSource: ${ds.nameForServer}:${ds.subset ?? ''}`, 0);
      }
    }

    // The source set in code. A name that both the server list AND the
    // dimension list carry produces both edges — TM1 allows a cube and a
    // dimension to have the same name, and which one is meant is not in the
    // assignment.
    const assigned: string[] = [];
    const seenAssigned = new Set<string>();
    const dynamicScopes = new Set<DataSourceScope>();
    const sections = [p.prolog, p.metadata, p.data, p.epilog];
    const dsKind = effectiveDataSourceKind(sections, env, ds?.type);
    for (const section of sections) {
      for (const a of extractDatasourceAssignments(section, env, dsKind)) {
        if (a.value === null) { dynamicScopes.add(a.scope); continue; }
        const lc = a.value.toLowerCase();
        if (!seenAssigned.has(lc)) { seenAssigned.add(lc); assigned.push(a.value); }
        if (knownCubes.has(lc)) { pushDs(p.name, 'cube', a.value, a.snippet, a.line, a.global); }
        if (knownDims.has(lc))  { pushDs(p.name, 'dimension', a.value, a.snippet, a.line, a.global); }
      }
    }
    for (const scope of dynamicScopes) {
      dynamicDataSources.push({ process: p.name, scope });
    }
    const fileDir = ds?.type === 'ASCII' ? fileSourceDir(sections, ds.nameForServer) : undefined;
    const tables = ds?.type === 'ODBC' ? odbcTables(sections, ds.query) : [];
    if (ds || assigned.length > 0) {
      processDataSources.set(p.name.toLowerCase(), {
        processName: p.name, declared: ds, assigned,
        ...(fileDir ? { fileDir } : {}),
        ...(tables.length ? { odbcTables: tables } : {}),
      });
    }
  }

  for (const c of cubes) {
    if (!c.rulesText) { continue; }
    for (const r of extractRulesReferences(c.rulesText)) {
      all.push({
        sourceKind: 'rule',
        sourceName: c.cubeName,
        section: r.section,
        line: r.line,
        snippet: r.snippet,
        funcName: r.funcName,
        targetKind: r.targetKind,
        targetName: r.targetName,
      });
    }
  }

  for (const s of subsets)  { all.push(...subsetToRefs(s, knownDims, knownCubes)); }
  for (const v of mdxViews) { all.push(...mdxViewToRefs(v, knownDims, knownCubes)); }

  const byCube          = new Map<string, TmReference[]>();
  const byDim           = new Map<string, TmReference[]>();
  const byProcess       = new Map<string, TmReference[]>();
  const bySourceProcess = new Map<string, TmReference[]>();

  const bucket = (m: Map<string, TmReference[]>, key: string, ref: TmReference) => {
    const lc = key.toLowerCase();
    const arr = m.get(lc) ?? [];
    arr.push(ref);
    m.set(lc, arr);
  };

  for (const ref of all) {
    switch (ref.targetKind) {
      case 'cube':      bucket(byCube,    ref.targetName, ref); break;
      case 'dimension': bucket(byDim,     ref.targetName, ref); break;
      case 'process':   bucket(byProcess, ref.targetName, ref); break;
    }
    if (ref.sourceKind === 'process') {
      bucket(bySourceProcess, ref.sourceName, ref);
    }
  }

  const processParams = new Map<string, string[]>();
  const processDefaults = new Map<string, Map<string, string>>();
  for (const p of processes) {
    if (p.parameters && p.parameters.length > 0) {
      processParams.set(p.name.toLowerCase(), p.parameters);
    }
    if (p.parameterDefaults && p.parameterDefaults.size > 0) {
      processDefaults.set(p.name.toLowerCase(), p.parameterDefaults);
    }
  }

  const subsetViews = new Map<string, ViewRef[]>();
  for (const u of viewSubsetUses) {
    // A view can carry the same subset on two axes — as a holder it is
    // still just one.
    const key = subsetKey(u.dim, u.hier, u.subset);
    const list = subsetViews.get(key);
    if (!list) { subsetViews.set(key, [{ cube: u.cube, view: u.view }]); continue; }
    if (!list.some(v => v.cube === u.cube && v.view === u.view)) {
      list.push({ cube: u.cube, view: u.view });
    }
  }

  const choreTasks = new Map<string, ChoreTaskRef[]>();
  const choreCasing = new Map<string, string>();
  for (const c of chores) {
    if (!c.name) { continue; }
    choreTasks.set(c.name.toLowerCase(), c.tasks);
    choreCasing.set(c.name.toLowerCase(), c.name);
  }

  return {
    all, byCube, byDim, byProcess, bySourceProcess,
    processParams, processDefaults, choreTasks, choreCasing,
    processDataSources, subsetViews, incomplete,
    dynamicDataSources: dynamicDataSources.sort(
      (a, b) => a.process.localeCompare(b.process) || a.scope.localeCompare(b.scope)),
  };
}

/** Convenience lookup — returns [] if target is not indexed. */
export function lookupReferences(
  idx: ReferenceIndex,
  targetKind: RefTargetKind,
  targetName: string,
): TmReference[] {
  const lc = targetName.toLowerCase();
  switch (targetKind) {
    case 'cube':      return idx.byCube.get(lc)    ?? [];
    case 'dimension': return idx.byDim.get(lc)     ?? [];
    case 'process':   return idx.byProcess.get(lc) ?? [];
  }
}

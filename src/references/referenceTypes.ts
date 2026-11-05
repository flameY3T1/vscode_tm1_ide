// Types of the reference index — shared by detection (refExtract, dataSourceRefs),
// building (referenceIndex) and the views (callGraph, choreGraph, …).

// ─── Types ───────────────────────────────────────────────────────────────────

export type RefTargetKind = 'cube' | 'dimension' | 'process';
export type RefSourceKind = 'process' | 'rule' | 'subset' | 'view';
export type RefSection    = 'prolog' | 'metadata' | 'data' | 'epilog' | 'rules' | 'feeders' | 'subset' | 'view'
  /** Datenquelle des Prozesses — am Objekt angemeldet ODER im Code gesetzt. */
  | 'datasource';

/**
 * How a value argument in an ExecuteProcess/RunProcess call-site resolves
 * based on the caller's code (literals + local var tracking, no chain resolution).
 */
export type CallParamResolution =
  | { kind: 'literal'; value: string }                 // literal or local var whose single assignment is a literal
  | { kind: 'passthrough'; paramName: string }         // value comes from a caller-process parameter
  | { kind: 'dynamic' };                               // cannot resolve (function call, concat, loop, CellGet, …)

/**
 * One param pair (name + value) in an ExecuteProcess/RunProcess call.
 * `valueRaw` is the original argument text for display/debugging.
 */
export interface CallParam {
  name: string;
  resolution: CallParamResolution;
  valueRaw: string;
}

export interface TmReference {
  sourceKind: RefSourceKind;           // Where the reference was found
  sourceName: string;                   // Process name or cube name (owner of rules)
  section: RefSection;
  line: number;                         // 0-based within section text
  snippet: string;                      // Trimmed source line (≤200 chars)
  funcName?: string;                    // e.g. CellGetN, DB, ExecuteProcess
  targetKind: RefTargetKind;
  targetName: string;
  /** Only set for ExecuteProcess/RunProcess references (targetKind = 'process'). */
  params?: CallParam[];
}

/** One task inside a chore: the scheduled process plus its fixed call-site params. */
export interface ChoreTaskRef {
  step: number;                        // 0-based order
  processName: string;                 // original casing
  params: Array<{ name: string; value: string; type: 'string' | 'numeric' }>;
}

export interface ReferenceIndex {
  all: TmReference[];
  byCube:    Map<string, TmReference[]>;
  byDim:     Map<string, TmReference[]>;
  byProcess: Map<string, TmReference[]>;
  /** Process name (lowercased) → refs originating FROM that process (for call-graph downstream traversal). */
  bySourceProcess: Map<string, TmReference[]>;
  /** Process name (lowercased) → declared param names (original casing). */
  processParams: Map<string, string[]>;
  /** Process name (lowercased) → param-name → default value (string form), for root-env seeding. */
  processDefaults: Map<string, Map<string, string>>;
  /** Chore name (lowercased) → ordered task list. */
  choreTasks: Map<string, ChoreTaskRef[]>;
  /** Chore name (lowercased) → spelling in which it appears in the tree. */
  choreCasing: Map<string, string>;
  /** Process name (lowercased) → its data source, both ways (see `ProcessDataSourceInfo`). */
  processDataSources: Map<string, ProcessDataSourceInfo>;
  /**
   * `dim|hier|subset` (lowercase) → the views that carry this subset on an
   * axis. Such a view prevents deleting the subset, unlike any reference from
   * code — hence a map of its own and not the reference list.
   */
  subsetViews: Map<string, ViewRef[]>;
  /**
   * Processes that set their data source in code from something that cannot be
   * resolved statically — each entry WITH the information what the assignment
   * pointed at. No edge can arise for them, and "no edge" must not be read as
   * "is not used". The `scope` decides whom the gap concerns: an unresolvable
   * view name says nothing about cubes.
   */
  dynamicDataSources: UnresolvedDataSource[];
  /**
   * Sources whose fetch failed ('processes', 'cube rules', …). Non-empty means the
   * index is a subset of reality — "not referenced anywhere" must not be trusted.
   */
  incomplete: string[];
}

// ─── Datenquelle ─────────────────────────────────────────────────────────────

/** Datenquelle, wie sie AM PROZESSOBJEKT steht (Reiter „Datenquelle"). */
export interface ProcessDataSource {
  /** `TM1CubeView`, `TM1DimensionSubset`, `ODBC`, `ASCII`, `None`, … */
  type: string;
  /** Depending on `type`: cube, dimension, DSN or file name. */
  nameForServer?: string;
  view?: string;
  subset?: string;
  /** ODBC only: the SQL query stored on the process. */
  query?: string;
}

/** Where a file-source process reads from, as a folder. */
export interface FileSourceDir {
  /** Grouping key — two processes with the same key read the same folder. */
  key: string;
  /** The folder path when known (literal in code or from the declared source). */
  path?: string;
  /** How the folder is set in code when it is not a literal, e.g. `CellGetS(zzz_Settings, 'IMP_Data')`. */
  setBy?: string;
  /** The file name inside the folder, dynamic parts as `{variable}`: `SAP{psJahr}{psMonat}_213_B87.txt`. */
  file?: string;
}

/**
 * What a process uses as its data source — TWO paths that know nothing about
 * each other.
 *
 * `declared` is on the process object. `assigned` are values that the TI code
 * assigns to the globals `DatasourceNameForServer`, `DatasourceNameForClient`,
 * `DatasourceCubeview` and `DatasourceDimensionSubset` — usually in the
 * prolog, and then the process does NOT run on the logged-in source. Anyone
 * who reads only one of the two takes a cube for unused that has a process
 * attached every night.
 */
export interface ProcessDataSourceInfo {
  /** Process name in ITS spelling — the key of the map is lowercase. */
  processName: string;
  declared?: ProcessDataSource;
  /** File sources only: the folder the file comes from (see `fileSourceDir`). */
  fileDir?: FileSourceDir;
  /** ODBC sources only: tables named in FROM/JOIN of the stored or assigned query. */
  odbcTables?: string[];
  /**
   * Assigned values, WITHOUT kind: `DatasourceNameForServer = 'X'` does not say
   * whether X is a cube, a dimension, a DSN or a file name. The index does not
   * guess — it lays the value out, and the caller matches it against its own
   * row, which knows its kind.
   */
  assigned: string[];
}

/**
 * What a data source global points at.
 *
 * The distinction carries weight when a value can NOT be resolved: that a
 * process assembles its view name at runtime says nothing about the cube it
 * touches in doing so. Measured live (11.8, 2026-09-19) on a process that
 * builds itself a working view:
 * `DataSourceNameForServer = csCube;` resolves, while
 * `DataSourceCubeView = csView;` with
 * `csView = 'View_Source_'|GetProcessName();` is not resolvable — a throwaway
 * name that does not exist permanently as an object at all. A warning about
 * both together would stand in every cube list without meaning anything there.
 */
export type DataSourceScope = 'cube' | 'dimension' | 'parent' | 'view' | 'subset';

/** A data source assignment that could not be resolved statically. */
export interface UnresolvedDataSource {
  /** Prozessname in seiner Schreibweise. */
  process: string;
  scope: DataSourceScope;
}

/** A view in its spelling. */
export interface ViewRef { cube: string; view: string }

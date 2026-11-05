/**
 * Shared types across the TI simulator. Kept tiny + dependency-free so any
 * sub-module (ast, eval, source, output) can import without cycles.
 */

export type Value = number | string;

export type Section = 'prolog' | 'metadata' | 'data' | 'epilog';
export const SECTIONS: readonly Section[] = ['prolog', 'metadata', 'data', 'epilog'];

export type SimWarning = {
  section?: Section;
  statementIndex?: number;
  message: string;
};

export type DimElement = {
  name: string;
  /** 0 = leaf, >0 = consolidation level. */
  level: number;
  /** Direct components (immediate children) for consolidations. Populated
   *  from `$expand=Components` when fixtures are refreshed. */
  children?: string[];
};

/** Properties tracked for each subset (Phase D — for *MDXGet / *AliasGet /
 *  *IsAllN reads + diff parity with capture). */
export type SubsetProps = {
  mdx?: string;
  alias?: string;
  isAll?: boolean;
};

/** View-instance state. Layout-related fields are tracked as
 *  position→dimension/element maps so multiple `ViewRowDimensionSet` /
 *  `ViewColumnDimensionSet` / `ViewTitleDimensionSet` calls record
 *  independent positions. */
export type ViewState = {
  cube: string;
  view: string;
  mdx?: string;
  suppressZeroes?: boolean;
  /** Position (1-based) → dim name. */
  rowDims?: Map<number, string>;
  columnDims?: Map<number, string>;
  titleDims?: Map<number, string>;
  /** dim → element pinned in title axis. */
  titleElems?: Map<string, string>;
  extractSkipCalcs?: boolean;
  extractSkipConsolidatedValues?: boolean;
  extractSkipRuleValues?: boolean;
  extractSkipZeroes?: boolean;
};

export type RunSections = {
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
};

/** Fixtures available to builtins like DIMIX / CellGetN at evaluation time. */
export type Fixtures = {
  dimensions: Map<string, DimElement[]>;
  /** Pre-keyed cube-cell map: `<cube>\t<coord1>\t…` → numeric or string value. */
  cubeCells: Map<string, Value>;
  /** In-memory subset registry, key = `<dim>\t<hier>\t<subset>`. Hier is `''`
   *  for default-hierarchy subsets. Filled during sim. */
  subsets: Map<string, string[]>;
  /** Subset properties (mdx / alias / isAll) keyed identically to `subsets`. */
  subsetProps: Map<string, SubsetProps>;
  /** View registry, key = `<cube>\t<view>`. */
  views: Map<string, ViewState>;
  /** Element-attribute store: `<dim>\t<elem>\t<attr>` → value. */
  attributes: Map<string, Value>;
  /** Cube → ordered dimension list. Populated from `cube-dims.json`. */
  cubeDims: Map<string, string[]>;
  /** Process name returned by the `GetProcessName()` builtin. Set to the ORIGINAL
   *  process name (from the manifest) so simulated output matches the live capture,
   *  whose helper rewrites `GetProcessName()` to the same literal (the clone's
   *  `_TI` suffix is never leaked into view/subset names). */
  processName?: string;
  /** Wall-clock the time built-ins (`Now`/`Today`/`TimSt`) resolve to. Set from the
   *  manifest's capture time so a replay is deterministic and reproduces the same
   *  `TIMST(NOW())` timestamp the capture recorded — otherwise a date baked into a
   *  filename/value diffs on any day after capture. Falls back to real time. */
  now?: Date;
  /** Optional diagnostics sink (FINDING #5). Cube cell-reads (`CellGetN/S` &
   *  aliases) that MISS the captured `cubeCells` (uncaptured coord, casing or
   *  coordinate mismatch) record their `cubeCellKey` here before returning the
   *  0/'' fallback — so the runner can surface ONE aggregated warning instead of
   *  silently masking an incomplete/corrupt capture. Left `undefined` on inline
   *  fixtures that don't opt in (no recording, unchanged behavior). */
  cellReadMisses?: Set<string>;
  /** Object-level attribute reads (CubeAttrS, HierarchyAttrN, ProcessAttrSL, …).
   *  Key = `<fn.toLowerCase()>\t<arg1>\t…\t<argN>` (lowercased function name, then
   *  all runtime args TAB-joined). Populated from `data/attr-reads.jsonl`. Optional
   *  so inline test fixtures that don't opt in keep compiling. */
  objectAttributes?: Map<string, Value>;
  /** Captured on a v12 server: picks the v12 ProcessExit* values. */
  v12?: boolean;
  /** Per-run NewDateFormatter list; the index is the formatter handle. */
  dateFormatters?: DateFormatter[];
};

/** One NewDateFormatter result (see eval/builtins/dateFormat.ts). */
export type DateFormatter = {
  /** IANA zone, or null for an ID ICU does not know (prints as GMT). */
  zone: string | null;
  unix: boolean;
  style: 'full' | 'long' | 'medium' | 'short';
  type: 'date' | 'time' | 'datetime';
};

export function emptyFixtures(): Fixtures {
  return {
    dimensions: new Map(),
    cubeCells: new Map(),
    subsets: new Map(),
    subsetProps: new Map(),
    views: new Map(),
    attributes: new Map(),
    cubeDims: new Map(),
    cellReadMisses: new Set(),
    objectAttributes: new Map(),
  };
}

export function cubeCellKey(cube: string, coord: string[]): string {
  return `${cube}\t${coord.join('\t')}`;
}

/**
 * Subset identity. Hier defaults to `''` for default-hierarchy subsets so
 * that `SubsetCreate(dim, sub)` and `HierarchySubsetCreate(dim, '', sub)`
 * collide on the same key (matches TM1 semantics).
 */
export function subsetKey(dim: string, hierOrSub: string, sub?: string): string {
  if (sub === undefined) {
    // Legacy 2-arg form (dim, sub) — implicit empty hier.
    return `${dim}\t\t${hierOrSub}`;
  }
  return `${dim}\t${hierOrSub}\t${sub}`;
}

export function viewKey(cube: string, view: string): string {
  return `${cube}\t${view}`;
}

export function attrKey(dim: string, elem: string, attr: string): string {
  return `${dim.toLowerCase()}\t${elem.toLowerCase()}\t${attr.toLowerCase()}`;
}

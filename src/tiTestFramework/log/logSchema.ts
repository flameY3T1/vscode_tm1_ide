/**
 * JSONL row schema for the virtual write-log produced by a rewritten TI
 * clone-process. Discriminated by `op`.
 */

export type CellPutNRow = { op: 'CellPutN'; cube: string; coord: string[]; value: number };
export type CellPutSRow = { op: 'CellPutS'; cube: string; coord: string[]; value: string };
export type CellIncrementNRow = { op: 'CellIncrementN'; cube: string; coord: string[]; value: number };

export type DimElementInsertRow = {
  op: 'DimElementInsert';
  dim: string;
  hier: string;
  name: string;
  type: string;
  insertAfter: string;
};
export type DimElementDeleteRow = { op: 'DimElementDelete'; dim: string; hier: string; name: string };
export type DimElementComponentAddRow = {
  op: 'DimElementComponentAdd';
  dim: string;
  hier: string;
  parent: string;
  child: string;
  weight: number;
};

export type AttrPutSRow = {
  op: 'AttrPutS';
  dim: string;
  hier: string;
  element: string;
  attribute: string;
  value: string;
};
export type AttrPutNRow = {
  op: 'AttrPutN';
  dim: string;
  hier: string;
  element: string;
  attribute: string;
  value: number;
};

export type AttrInsertRow = {
  op: 'AttrInsert';
  dim: string;
  hier: string;
  element: string;
  attribute: string;
  type: string;
  prevAttr: string;
};

export type AttrDeleteRow = {
  op: 'AttrDelete';
  dim: string;
  hier: string;
  element: string;
  attribute: string;
};

// ── Object-type attribute schema mutations (no instance — applies to control
//    cubes }CubeAttributes / }DimensionAttributes / }ChoreAttributes etc.) ──
export type CubeAttrInsertRow = {
  op: 'CubeAttrInsert';
  prevAttr: string;
  attribute: string;
  type: string;
};
export type CubeAttrDeleteRow = { op: 'CubeAttrDelete'; attribute: string };
export type DimensionAttrInsertRow = {
  op: 'DimensionAttrInsert';
  prevAttr: string;
  attribute: string;
  type: string;
};
export type DimensionAttrDeleteRow = { op: 'DimensionAttrDelete'; attribute: string };
export type ChoreAttrInsertRow = {
  op: 'ChoreAttrInsert';
  prevAttr: string;
  attribute: string;
  type: string;
};
export type ChoreAttrDeleteRow = { op: 'ChoreAttrDelete'; attribute: string };
export type ViewAttrInsertRow = {
  op: 'ViewAttrInsert';
  prevAttr: string;
  attribute: string;
  type: string;
};
export type ViewAttrDeleteRow = { op: 'ViewAttrDelete'; attribute: string };
export type SubsetAttrInsertRow = {
  op: 'SubsetAttrInsert';
  prevAttr: string;
  attribute: string;
  type: string;
};
export type SubsetAttrDeleteRow = { op: 'SubsetAttrDelete'; attribute: string };

// ── HierarchySubset-instance attribute schema (specific subset context) ──
export type HierarchySubsetAttrInsertRow = {
  op: 'HierarchySubsetAttrInsert';
  dim: string;
  hier: string;
  subset: string;
  attribute: string;
  type: string;
};
export type HierarchySubsetAttrDeleteRow = {
  op: 'HierarchySubsetAttrDelete';
  dim: string;
  hier: string;
  subset: string;
  attribute: string;
};

// ── Dim element extras ──────────────────────────────────────────────────
export type DimElementComponentDeleteRow = {
  op: 'DimElementComponentDelete';
  dim: string;
  hier: string;
  parent: string;
  child: string;
};

export type SubsetCreateRow = { op: 'SubsetCreate'; dim: string; hier: string; subset: string };
export type SubsetCreateByMDXRow = {
  op: 'SubsetCreateByMDX';
  dim: string;
  hier: string;
  mdx: string;
};
export type SubsetElementInsertRow = {
  op: 'SubsetElementInsert';
  dim: string;
  hier: string;
  subset: string;
  element: string;
  position: number;
};
export type SubsetDeleteAllElementsRow = {
  op: 'SubsetDeleteAllElements';
  dim: string;
  hier: string;
  subset: string;
};
export type SubsetElementDeleteRow = {
  op: 'SubsetElementDelete';
  dim: string;
  hier: string;
  subset: string;
  element: string;
};

export type ViewCreateRow = { op: 'ViewCreate'; cube: string; view: string };
export type ViewZeroOutRow = { op: 'ViewZeroOut'; cube: string; view: string };
export type ViewDeleteRow = { op: 'ViewDelete'; cube: string; view: string };
export type ViewDestroyRow = { op: 'ViewDestroy'; cube: string; view: string };
export type ViewMDXSetRow = { op: 'ViewMDXSet'; cube: string; view: string; mdx: string };
export type CubeCreateRow = { op: 'CubeCreate'; name: string; dimensions: string[] };
export type CubeDestroyRow = { op: 'CubeDestroy'; name: string };
export type CubeDeleteRow = { op: 'CubeDelete'; name: string };
export type CubeRuleDestroyRow = { op: 'CubeRuleDestroy'; name: string };
export type RuleDestroyRow = { op: 'RuleDestroy'; name: string };
export type DimensionCreateRow = { op: 'DimensionCreate'; name: string };
export type DimensionDestroyRow = { op: 'DimensionDestroy'; name: string };
export type HierarchyCreateRow = { op: 'HierarchyCreate'; dim: string; hier: string };
export type HierarchyDestroyRow = { op: 'HierarchyDestroy'; dim: string; hier: string };

// ── View configuration setters ─────────────────────────────────────────
export type ViewSuppressZeroesSetRow = {
  op: 'ViewSuppressZeroesSet';
  cube: string;
  view: string;
  flag: number;
};
export type ViewZeroSuppressionSetRow = {
  op: 'ViewZeroSuppressionSet';
  cube: string;
  view: string;
  flag: number;
};
export type ViewRowDimensionSetRow = {
  op: 'ViewRowDimensionSet';
  cube: string;
  view: string;
  dim: string;
  position: number;
};
export type ViewColumnDimensionSetRow = {
  op: 'ViewColumnDimensionSet';
  cube: string;
  view: string;
  dim: string;
  position: number;
};
export type ViewTitleDimensionSetRow = {
  op: 'ViewTitleDimensionSet';
  cube: string;
  view: string;
  dim: string;
  position: number;
};
export type ViewTitleElementSetRow = {
  op: 'ViewTitleElementSet';
  cube: string;
  view: string;
  dim: string;
  element: string;
};
export type ViewExtractSkipCalcsSetRow = {
  op: 'ViewExtractSkipCalcsSet';
  cube: string;
  view: string;
  skip: number;
};
export type ViewExtractSkipConsolidatedValuesSetRow = {
  op: 'ViewExtractSkipConsolidatedValuesSet';
  cube: string;
  view: string;
  skip: number;
};
export type ViewExtractSkipRuleValuesSetRow = {
  op: 'ViewExtractSkipRuleValuesSet';
  cube: string;
  view: string;
  skip: number;
};
export type ViewExtractSkipZeroesSetRow = {
  op: 'ViewExtractSkipZeroesSet';
  cube: string;
  view: string;
  skip: number;
};
export type ViewStructUpdateRow = {
  op: 'ViewStructUpdate';
  cube: string;
  view: string;
};
export type ViewSubsetAssignRow = {
  op: 'ViewSubsetAssign';
  cube: string;
  view: string;
  dim: string;
  subset: string;
};
export type ViewExtractSkipConsolidatedStringsSetRow = {
  op: 'ViewExtractSkipConsolidatedStringsSet';
  cube: string;
  view: string;
  skip: number;
};

// ── Security / Data-Reservation / Tran ──────────────────────────────────
export type CellSecurityCubeCreateRow = { op: 'CellSecurityCubeCreate'; name: string };
export type CellSecurityCubeDestroyRow = { op: 'CellSecurityCubeDestroy'; name: string };
export type CubeDataReservationReleaseRow = {
  op: 'CubeDataReservationRelease';
  name: string;
  elements: string[];
};
export type CubeDRReleaseRow = {
  op: 'CubeDRRelease';
  name: string;
  elementList: string;
};
export type HierarchyElementSecurityPutRow = {
  op: 'HierarchyElementSecurityPut';
  dim: string;
  hier: string;
  element: string;
  group: string;
  level: string;
};
export type TranSaveRow = { op: 'TranSave'; transactionId: string };
export type TranDeleteRow = { op: 'TranDelete'; transactionId: string };

// ── Subset extras (Phase A typed) ─────────────────────────────────────────
export type SubsetDestroyRow = {
  op: 'SubsetDestroy';
  dim: string;
  hier: string;
  subset: string;
};
export type SubsetMDXSetRow = {
  op: 'SubsetMDXSet';
  dim: string;
  hier: string;
  subset: string;
  mdx: string;
};
export type SubsetIsAllSetRow = {
  op: 'SubsetIsAllSet';
  dim: string;
  hier: string;
  subset: string;
  flag: number;
};
export type SubsetAliasSetRow = {
  op: 'SubsetAliasSet';
  dim: string;
  hier: string;
  subset: string;
  alias: string;
};

/**
 * Catch-all row type for meta-ops added in Schicht 2 (cube/dim/view/subset
 * lifecycle, attribute metadata, MDX setters, security, transactions).
 * These are logged for safety (server is not mutated) but not yet covered by
 * a typed schema — they pass through verbatim. Diff treats them as opaque
 * tuples keyed by op + args.
 */
export type GenericMetaRow = {
  op: string;
  args: string[];
};

// ── Sub-process call tracing (Phase 2) ────────────────────────────────────
export type SubCallOp = {
  op: '__CALL__';
  callee: string;
  callIndex: number;
  params: Array<[string, string]>;
};

export type SubParamOp =
  | { op: '__PARAM__'; name: string; type: 'S'; value: string }
  | { op: '__PARAM__'; name: string; type: 'N'; value: number };

export type SubLiveFallbackOp = {
  op: '__SUB_LIVE_FALLBACK__';
  line: number;
  reason: string;
};

export type CellOp = CellPutNRow | CellPutSRow | CellIncrementNRow;
export type DimOp =
  | DimElementInsertRow
  | DimElementDeleteRow
  | DimElementComponentAddRow
  | DimElementComponentDeleteRow
  | DimensionCreateRow
  | DimensionDestroyRow
  | HierarchyCreateRow
  | HierarchyDestroyRow
  | HierarchyElementSecurityPutRow;
export type AttrOp =
  | AttrPutSRow
  | AttrPutNRow
  | AttrInsertRow
  | AttrDeleteRow
  | CubeAttrInsertRow
  | CubeAttrDeleteRow
  | DimensionAttrInsertRow
  | DimensionAttrDeleteRow
  | ChoreAttrInsertRow
  | ChoreAttrDeleteRow
  | ViewAttrInsertRow
  | ViewAttrDeleteRow
  | SubsetAttrInsertRow
  | SubsetAttrDeleteRow
  | HierarchySubsetAttrInsertRow
  | HierarchySubsetAttrDeleteRow;
export type SubsetOp =
  | SubsetCreateRow
  | SubsetCreateByMDXRow
  | SubsetElementInsertRow
  | SubsetElementDeleteRow
  | SubsetDeleteAllElementsRow
  | SubsetDestroyRow
  | SubsetMDXSetRow
  | SubsetIsAllSetRow
  | SubsetAliasSetRow;
export type ViewOp =
  | ViewCreateRow
  | ViewZeroOutRow
  | ViewDeleteRow
  | ViewDestroyRow
  | ViewMDXSetRow
  | ViewSuppressZeroesSetRow
  | ViewZeroSuppressionSetRow
  | ViewRowDimensionSetRow
  | ViewColumnDimensionSetRow
  | ViewTitleDimensionSetRow
  | ViewTitleElementSetRow
  | ViewExtractSkipCalcsSetRow
  | ViewExtractSkipConsolidatedValuesSetRow
  | ViewExtractSkipRuleValuesSetRow
  | ViewExtractSkipZeroesSetRow
  | ViewExtractSkipConsolidatedStringsSetRow
  | ViewSubsetAssignRow
  | ViewStructUpdateRow;
export type CubeOp =
  | CubeCreateRow
  | CubeDestroyRow
  | CubeDeleteRow
  | CubeRuleDestroyRow
  | RuleDestroyRow
  | CellSecurityCubeCreateRow
  | CellSecurityCubeDestroyRow
  | CubeDataReservationReleaseRow
  | CubeDRReleaseRow;
export type TranOp = TranSaveRow | TranDeleteRow;

export type LogRow =
  | CellOp
  | DimOp
  | AttrOp
  | SubsetOp
  | ViewOp
  | CubeOp
  | TranOp
  | GenericMetaRow
  | SubCallOp
  | SubParamOp
  | SubLiveFallbackOp;

const TYPED_OPS = [
  'CellPutN',
  'CellPutS',
  'CellIncrementN',
  'DimElementInsert',
  'DimElementDelete',
  'DimElementComponentAdd',
  'DimElementComponentDelete',
  'DimensionCreate',
  'DimensionDestroy',
  'HierarchyCreate',
  'HierarchyDestroy',
  'HierarchyElementSecurityPut',
  'AttrPutS',
  'AttrPutN',
  'AttrInsert',
  'AttrDelete',
  'CubeAttrInsert',
  'CubeAttrDelete',
  'DimensionAttrInsert',
  'DimensionAttrDelete',
  'ChoreAttrInsert',
  'ChoreAttrDelete',
  'ViewAttrInsert',
  'ViewAttrDelete',
  'SubsetAttrInsert',
  'SubsetAttrDelete',
  'HierarchySubsetAttrInsert',
  'HierarchySubsetAttrDelete',
  'SubsetCreate',
  'SubsetCreateByMDX',
  'SubsetElementInsert',
  'SubsetElementDelete',
  'SubsetDeleteAllElements',
  'SubsetDestroy',
  'SubsetMDXSet',
  'SubsetIsAllSet',
  'SubsetAliasSet',
  'ViewCreate',
  'ViewZeroOut',
  'ViewDelete',
  'ViewDestroy',
  'ViewMDXSet',
  'ViewSuppressZeroesSet',
  'ViewZeroSuppressionSet',
  'ViewRowDimensionSet',
  'ViewColumnDimensionSet',
  'ViewTitleDimensionSet',
  'ViewTitleElementSet',
  'ViewExtractSkipCalcsSet',
  'ViewExtractSkipConsolidatedValuesSet',
  'ViewExtractSkipRuleValuesSet',
  'ViewExtractSkipZeroesSet',
  'ViewExtractSkipConsolidatedStringsSet',
  'ViewSubsetAssign',
  'ViewStructUpdate',
  'CubeCreate',
  'CubeDestroy',
  'CubeDelete',
  'CubeRuleDestroy',
  'RuleDestroy',
  'CellSecurityCubeCreate',
  'CellSecurityCubeDestroy',
  'CubeDataReservationRelease',
  'CubeDRRelease',
  'TranSave',
  'TranDelete',
  '__CALL__',
  '__PARAM__',
  '__SUB_LIVE_FALLBACK__',
] as const;

/**
 * Op-names emitted by Schicht-2 mappings. They share a generic shape — see
 * `GenericMetaRow`. Listed here so the parser can accept them without
 * warnings; diff treats them as opaque tuples.
 */
/**
 * File-output redirect markers — these are not cube/dim mutations but writes
 * the original process would have done to disk; the rewriter captures them
 * so the test can verify what the process would have exported.
 */
/**
 * Writes logged as opaque tuples under their own name. Capture and simulator
 * both build the tuple from this table, so the two sides cannot drift.
 * `keep`: argument indexes to log (default all; drops passwords and rule
 * text, which can span lines). `numeric`: indexes the rewriter wraps in
 * NumberToString, because ASCIIOutput takes strings only.
 */
export type TupleOpSpec = { keep?: readonly number[]; numeric?: readonly number[] };

/**
 * Writes that keep running live during capture (capture is a full live run);
 * the rewriter only puts a log marker in front of them.
 */
export const LIVE_TUPLE_OPS: Readonly<Record<string, TupleOpSpec>> = {
  CubeClearData: {},
  DimensionDeleteAllElements: {},
  HierarchyDeleteAllElements: {},
  HierarchySubsetDeleteAllElements: {},
  ElementSecurityPut: {},
  CubeRuleSet: { keep: [0] },
  RuleLoadFromFile: {},
  PublishSubset: { numeric: [2] },
  PublishView: { numeric: [2, 3] },
  ViewCreateByMDX: { numeric: [3] },
  SwapAliasWithPrincipalName: { numeric: [2] },
  AddClient: { keep: [0] },
  AddGroup: {},
  AssignClientToGroup: {},
  AssignClientPassword: { keep: [0] },
  DeleteClient: {},
  DeleteGroup: {},
  RemoveClientFromGroup: {},
};

export const TUPLE_OPS: Readonly<Record<string, TupleOpSpec>> = {
  // Object-level attribute writes; the rewriter replaces them.
  ...Object.fromEntries(
    ['Cube', 'Dimension', 'Hierarchy', 'Process', 'Chore', 'Subset', 'View', 'HierarchySubset'].flatMap(
      (o) => [[`${o}AttrPutS`, {}], [`${o}AttrPutN`, { numeric: [0] }]],
    ),
  ),
  ...LIVE_TUPLE_OPS,
};

/**
 * Element writes with a `*Direct` variant. The variant changes the same
 * structure as its buffered sibling and logs the same row; capture runs it live.
 */
export const DIRECT_VARIANT_BASES: readonly string[] = [
  'DimensionElementInsert',
  'DimensionElementDelete',
  'DimensionElementComponentAdd',
  'DimensionElementComponentDelete',
  'DimensionTopElementInsert',
  'HierarchyElementInsert',
  'HierarchyElementDelete',
  'HierarchyElementComponentAdd',
  'HierarchyElementComponentDelete',
  'HierarchyTopElementInsert',
];

/** The logged argument list for `spec`, in call order. */
export function tupleArgs<T>(spec: TupleOpSpec, args: readonly T[]): T[] {
  return spec.keep ? spec.keep.filter((i) => i < args.length).map((i) => args[i]) : [...args];
}

export const META_OPS: ReadonlySet<string> = new Set<string>([
  '__TEXTOUTPUT__',
  '__ASCIIOUTPUT__',
  '__ASCIIOUTPUTOPEN__',
  '__ASCIIOUTPUTCLOSE__',
  '__SETOUTPUTCHARSET__',
  ...Object.keys(TUPLE_OPS),
]);

export const KNOWN_OPS: ReadonlySet<string> = new Set<string>([...TYPED_OPS, ...META_OPS]);

export function isCellOp(row: LogRow): row is CellOp {
  return row.op === 'CellPutN' || row.op === 'CellPutS' || row.op === 'CellIncrementN';
}
export function isDimOp(row: LogRow): row is DimOp {
  return (
    row.op === 'DimElementInsert' ||
    row.op === 'DimElementDelete' ||
    row.op === 'DimElementComponentAdd' ||
    row.op === 'DimElementComponentDelete' ||
    row.op === 'DimensionCreate' ||
    row.op === 'DimensionDestroy' ||
    row.op === 'HierarchyCreate' ||
    row.op === 'HierarchyDestroy' ||
    row.op === 'HierarchyElementSecurityPut'
  );
}
export function isTranOp(row: LogRow): row is TranOp {
  return row.op === 'TranSave' || row.op === 'TranDelete';
}
export function isAttrOp(row: LogRow): row is AttrOp {
  return (
    row.op === 'AttrPutS' ||
    row.op === 'AttrPutN' ||
    row.op === 'AttrInsert' ||
    row.op === 'AttrDelete' ||
    row.op === 'CubeAttrInsert' ||
    row.op === 'CubeAttrDelete' ||
    row.op === 'DimensionAttrInsert' ||
    row.op === 'DimensionAttrDelete' ||
    row.op === 'ChoreAttrInsert' ||
    row.op === 'ChoreAttrDelete' ||
    row.op === 'ViewAttrInsert' ||
    row.op === 'ViewAttrDelete' ||
    row.op === 'SubsetAttrInsert' ||
    row.op === 'SubsetAttrDelete' ||
    row.op === 'HierarchySubsetAttrInsert' ||
    row.op === 'HierarchySubsetAttrDelete'
  );
}

/** Stable cell-coordinate key for diff lookups. */
export function cellKey(cube: string, coord: string[]): string {
  return `${cube}\t${coord.join('\t')}`;
}

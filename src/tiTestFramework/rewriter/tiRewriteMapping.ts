/**
 * Whitelist + arg-transformation rules for TI write-calls that the rewriter
 * logs with a TextOutput marker in front of the call. Keep the schema declarative: each mapping
 * names the source TI function, the op-name written into the log, and how to
 * project the raw args into the TextOutput arg list.
 */

import { DIRECT_VARIANT_BASES, TUPLE_OPS, tupleArgs } from '../log/logSchema';

export type WriteCallMapping = {
  /** TI source function name (case-insensitive when matching). */
  name: string;
  /** Op name written into the log row. May differ from `name` (e.g. Hierarchy* → DimElement*). */
  opName: string;
  /** Build the TextOutput args (excluding logfile + op-name) from the raw call args. */
  buildArgs: (rawArgs: string[]) => string[];
};

const numToStr = (s: string) => `NumberToString(${s})`;
const empty = `''`;

export const WRITE_CALL_MAPPINGS: WriteCallMapping[] = [
  // ── Cell ops ────────────────────────────────────────────────────────────
  {
    name: 'CellPutN',
    opName: 'CellPutN',
    buildArgs: (a) => [...a.slice(1), numToStr(a[0])],
  },
  {
    name: 'CellPutS',
    opName: 'CellPutS',
    buildArgs: (a) => [...a.slice(1), a[0]],
  },
  {
    name: 'CellIncrementN',
    opName: 'CellIncrementN',
    buildArgs: (a) => [...a.slice(1), numToStr(a[0])],
  },

  // ── Dim ops (default hierarchy) ─────────────────────────────────────────
  {
    name: 'DimensionElementInsert',
    opName: 'DimElementInsert',
    buildArgs: (a) => [a[0], empty, a[2], a[3], a[1] ?? empty],
  },
  {
    name: 'DimensionElementDelete',
    opName: 'DimElementDelete',
    buildArgs: (a) => [a[0], empty, a[1]],
  },
  {
    name: 'DimensionElementComponentAdd',
    opName: 'DimElementComponentAdd',
    buildArgs: (a) => [a[0], empty, a[1], a[2], numToStr(a[3])],
  },

  // ── Hierarchy ops (named hierarchy) ─────────────────────────────────────
  {
    name: 'HierarchyElementInsert',
    opName: 'DimElementInsert',
    buildArgs: (a) => [a[0], a[1], a[3], a[4], a[2] ?? empty],
  },
  {
    name: 'HierarchyElementDelete',
    opName: 'DimElementDelete',
    buildArgs: (a) => [a[0], a[1], a[2]],
  },
  {
    name: 'HierarchyElementComponentAdd',
    opName: 'DimElementComponentAdd',
    buildArgs: (a) => [a[0], a[1], a[2], a[3], numToStr(a[4])],
  },

  // ── Attr ops ────────────────────────────────────────────────────────────
  {
    name: 'AttrPutS',
    opName: 'AttrPutS',
    buildArgs: (a) => [a[1], empty, a[2], a[3], a[0]],
  },
  {
    name: 'AttrPutN',
    opName: 'AttrPutN',
    buildArgs: (a) => [a[1], empty, a[2], a[3], numToStr(a[0])],
  },
  {
    name: 'ElementAttrPutS',
    opName: 'AttrPutS',
    buildArgs: (a) => [a[1], a[2], a[3], a[4], a[0]],
  },
  {
    name: 'ElementAttrPutN',
    opName: 'AttrPutN',
    buildArgs: (a) => [a[1], a[2], a[3], a[4], numToStr(a[0])],
  },

  // ── Attr definition (insert / delete) ──────────────────────────────────
  // AttrInsert(Dim, PrevAttr, AttrName, Type) → log: dim, hier='', element='', attr, type, prev
  {
    name: 'AttrInsert',
    opName: 'AttrInsert',
    buildArgs: (a) => [a[0], empty, empty, a[2], a[3], a[1] ?? empty],
  },
  {
    name: 'ElementAttrInsert',
    opName: 'AttrInsert',
    buildArgs: (a) => [a[0], empty, empty, a[2], a[3], a[1] ?? empty],
  },
  // AttrDelete(Dim, AttrName) → log: dim, hier='', element='', attr
  {
    name: 'AttrDelete',
    opName: 'AttrDelete',
    buildArgs: (a) => [a[0], empty, empty, a[1]],
  },
  {
    name: 'ElementAttrDelete',
    opName: 'AttrDelete',
    buildArgs: (a) => [a[0], empty, empty, a[1]],
  },

  // ── Subset ops ──────────────────────────────────────────────────────────
  {
    name: 'SubsetCreate',
    opName: 'SubsetCreate',
    buildArgs: (a) => [a[0], empty, a[1]],
  },
  {
    name: 'SubsetCreateByMDX',
    opName: 'SubsetCreateByMDX',
    buildArgs: (a) => [a[0], empty, a[1]],
  },
  {
    name: 'SubsetElementInsert',
    opName: 'SubsetElementInsert',
    buildArgs: (a) => [a[0], empty, a[1], a[2], numToStr(a[3])],
  },
  {
    name: 'SubsetDeleteAllElements',
    opName: 'SubsetDeleteAllElements',
    buildArgs: (a) => [a[0], empty, a[1]],
  },

  // ── View ops ────────────────────────────────────────────────────────────
  {
    name: 'ViewCreate',
    opName: 'ViewCreate',
    buildArgs: (a) => [a[0], a[1]],
  },
  {
    name: 'ViewZeroOut',
    opName: 'ViewZeroOut',
    buildArgs: (a) => [a[0], a[1]],
  },

  // ── Cube/Dim creation ───────────────────────────────────────────────────
  {
    name: 'CubeCreate',
    opName: 'CubeCreate',
    buildArgs: (a) => [...a],
  },
  {
    name: 'DimensionCreate',
    opName: 'DimensionCreate',
    buildArgs: (a) => [...a],
  },

  // ── Cube lifecycle / destroy ────────────────────────────────────────────
  // All accept a single cube name; logged op-name preserves the original verb.
  { name: 'CubeDestroy', opName: 'CubeDestroy', buildArgs: (a) => [a[0] ?? empty] },
  { name: 'CubeDelete', opName: 'CubeDelete', buildArgs: (a) => [a[0] ?? empty] },
  { name: 'CubeRuleDestroy', opName: 'CubeRuleDestroy', buildArgs: (a) => [a[0] ?? empty] },
  {
    name: 'CellSecurityCubeCreate',
    opName: 'CellSecurityCubeCreate',
    buildArgs: (a) => [a[0] ?? empty],
  },
  {
    name: 'CellSecurityCubeDestroy',
    opName: 'CellSecurityCubeDestroy',
    buildArgs: (a) => [a[0] ?? empty],
  },

  // ── Cube data-reservation ───────────────────────────────────────────────
  // Variadic: cube + N element coords. Pass through verbatim.
  {
    name: 'CubeDataReservationRelease',
    opName: 'CubeDataReservationRelease',
    buildArgs: (a) => [...a],
  },
  {
    name: 'CubeDRRelease',
    opName: 'CubeDRRelease',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },

  // ── Cube attribute metadata (operates on }CubeAttributes) ──────────────
  {
    name: 'CubeAttrInsert',
    opName: 'CubeAttrInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  { name: 'CubeAttrDelete', opName: 'CubeAttrDelete', buildArgs: (a) => [a[0] ?? empty] },

  // ── Dimension lifecycle / extras ────────────────────────────────────────
  { name: 'DimensionDestroy', opName: 'DimensionDestroy', buildArgs: (a) => [a[0] ?? empty] },
  // DimensionHierarchyCreate is a TM1 alias for HierarchyCreate (same shape).
  {
    name: 'DimensionHierarchyCreate',
    opName: 'HierarchyCreate',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },
  // DimensionTopElementInsert(dim, elem, type) inserts at root → log as
  // DimElementInsert with no parent / no insertAfter.
  {
    name: 'DimensionTopElementInsert',
    opName: 'DimElementInsert',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty, a[2] ?? empty, empty],
  },

  // ── Dim element extras ──────────────────────────────────────────────────
  // DimensionElementComponentDelete(dim, parent, child) → log: dim, '', parent, child
  {
    name: 'DimensionElementComponentDelete',
    opName: 'DimElementComponentDelete',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty, a[2] ?? empty],
  },
  {
    name: 'HierarchyElementComponentDelete',
    opName: 'DimElementComponentDelete',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },
  // HierarchyTopElementInsert(dim, hier, pos[num], elem) → root insertion in
  // a named hierarchy. Mapped to DimElementInsert; pos is dropped (TM1
  // returns it on read but it's not stable identity).
  {
    name: 'HierarchyTopElementInsert',
    opName: 'DimElementInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[3] ?? empty, empty, empty],
  },
  // ElementInsert legacy alias: (dim, hier, parent, elem, weight)
  {
    name: 'ElementInsert',
    opName: 'DimElementInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[3] ?? empty, empty, empty],
  },
  // ElementDelete legacy: 2 args (dim, elem) OR 3 args (dim, hier, elem)
  {
    name: 'ElementDelete',
    opName: 'DimElementDelete',
    buildArgs: (a) =>
      a.length >= 3 ? [a[0] ?? empty, a[1] ?? empty, a[2]] : [a[0] ?? empty, empty, a[1] ?? empty],
  },

  // ── Hierarchy lifecycle ─────────────────────────────────────────────────
  {
    name: 'HierarchyCreate',
    opName: 'HierarchyCreate',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },
  {
    name: 'HierarchyDestroy',
    opName: 'HierarchyDestroy',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },
  // HierarchyElementSecurityPut(level, dim, hier, elem, group)
  {
    name: 'HierarchyElementSecurityPut',
    opName: 'HierarchyElementSecurityPut',
    buildArgs: (a) => [a[1] ?? empty, a[2] ?? empty, a[3] ?? empty, a[4] ?? empty, a[0] ?? empty],
  },

  // ── Dim attribute metadata + legacy alias chain ────────────────────────
  {
    name: 'DimensionAttrInsert',
    opName: 'DimensionAttrInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  {
    name: 'DimensionAttrDelete',
    opName: 'DimensionAttrDelete',
    buildArgs: (a) => [a[0] ?? empty],
  },
  // AttributeCreate(dim, name, type) — legacy
  {
    name: 'AttributeCreate',
    opName: 'AttrInsert',
    buildArgs: (a) => [a[0] ?? empty, empty, empty, a[1] ?? empty, a[2] ?? empty, empty],
  },
  {
    name: 'AttributeDelete',
    opName: 'AttrDelete',
    buildArgs: (a) => [a[0] ?? empty, empty, empty, a[1] ?? empty],
  },
  // AttributePut(value, dim, elem, attr) — legacy alias of AttrPutS/N
  {
    name: 'AttributePut',
    opName: 'AttrPutS',
    buildArgs: (a) => [a[1] ?? empty, empty, a[2] ?? empty, a[3] ?? empty, a[0] ?? empty],
  },

  // ── Subset extras (delete / destroy / element / mdx / alias / isAllSet) ─
  // SubsetDelete(subset, dim) is NOT an official TM1 TI function (the real one
  // is SubsetDestroy); it is a non-standard spelling with reversed arg order.
  // Map it defensively to opName 'SubsetDestroy' so a capture still neutralises
  // the write instead of mutating the cube.
  {
    name: 'SubsetDelete',
    opName: 'SubsetDestroy',
    buildArgs: (a) => [a[1] ?? empty, empty, a[0] ?? empty],
  },
  {
    name: 'SubsetDestroy',
    opName: 'SubsetDestroy',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty],
  },
  // SubsetElementAdd(subset, dim, elem) is NOT an official TM1 TI function (the
  // real one is SubsetElementInsert); it is a non-standard spelling without a
  // position arg. Map it defensively to opName 'SubsetElementInsert'.
  {
    name: 'SubsetElementAdd',
    opName: 'SubsetElementInsert',
    buildArgs: (a) => [a[1] ?? empty, empty, a[0] ?? empty, a[2] ?? empty, "'0'"],
  },
  // SubsetElementDelete(dim, subset, index) — dim-first (IBM)
  {
    name: 'SubsetElementDelete',
    opName: 'SubsetElementDelete',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty, a[2] ?? empty],
  },
  // SubsetMDXSet(dim, subset, mdx)
  {
    name: 'SubsetMDXSet',
    opName: 'SubsetMDXSet',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty, a[2] ?? empty],
  },
  // SubsetIsAllSet(dim, subset, flag[num])
  {
    name: 'SubsetIsAllSet',
    opName: 'SubsetIsAllSet',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  // SubsetAliasSet(dim, subset, alias)
  {
    name: 'SubsetAliasSet',
    opName: 'SubsetAliasSet',
    buildArgs: (a) => [a[0] ?? empty, empty, a[1] ?? empty, a[2] ?? empty],
  },
  // Subset attribute metadata
  {
    name: 'SubsetAttrInsert',
    opName: 'SubsetAttrInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  {
    name: 'SubsetAttrDelete',
    opName: 'SubsetAttrDelete',
    buildArgs: (a) => [a[0] ?? empty],
  },

  // ── Hierarchy-Subset ────────────────────────────────────────────────────
  // HierarchySubsetCreate(dim, hier, subset, [tmp])
  {
    name: 'HierarchySubsetCreate',
    opName: 'SubsetCreate',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  {
    name: 'HierarchySubsetDestroy',
    opName: 'SubsetDestroy',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  // HierarchySubsetElementInsert(dim, hier, subset, elem, pos[num])
  {
    name: 'HierarchySubsetElementInsert',
    opName: 'SubsetElementInsert',
    buildArgs: (a) => [
      a[0] ?? empty,
      a[1] ?? empty,
      a[2] ?? empty,
      a[3] ?? empty,
      numToStr(a[4] ?? '0'),
    ],
  },
  // HierarchySubsetElementDelete(dim, hier, subset, elem)
  {
    name: 'HierarchySubsetElementDelete',
    opName: 'SubsetElementDelete',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },
  // HierarchySubsetMDXSet(dim, hier, subset, mdx)
  {
    name: 'HierarchySubsetMDXSet',
    opName: 'SubsetMDXSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },
  // HierarchySubsetIsAllSet(dim, hier, subset, flag[num])
  {
    name: 'HierarchySubsetIsAllSet',
    opName: 'SubsetIsAllSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, numToStr(a[3] ?? '0')],
  },
  // HierarchySubsetAliasSet(dim, hier, subset, alias)
  {
    name: 'HierarchySubsetAliasSet',
    opName: 'SubsetAliasSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },
  // HierarchySubsetAttrInsert(dim, hier, subset, attr, type)
  {
    name: 'HierarchySubsetAttrInsert',
    opName: 'HierarchySubsetAttrInsert',
    buildArgs: (a) => [
      a[0] ?? empty,
      a[1] ?? empty,
      a[2] ?? empty,
      a[3] ?? empty,
      a[4] ?? empty,
    ],
  },
  // HierarchySubsetAttrDelete(dim, hier, subset, attr)
  {
    name: 'HierarchySubsetAttrDelete',
    opName: 'HierarchySubsetAttrDelete',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },

  // ── View extras ─────────────────────────────────────────────────────────
  {
    name: 'ViewDelete',
    opName: 'ViewDelete',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },
  {
    name: 'ViewDestroy',
    opName: 'ViewDestroy',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },
  // ViewMDXSet(cube, view, mdx)
  {
    name: 'ViewMDXSet',
    opName: 'ViewMDXSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  // ViewSuppressZeroesSet(cube, view, flag[num])
  {
    name: 'ViewSuppressZeroesSet',
    opName: 'ViewSuppressZeroesSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  {
    name: 'ViewZeroSuppressionSet',
    opName: 'ViewZeroSuppressionSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  // ViewRow/Column/TitleDimensionSet(cube, view, dim, pos[num])
  {
    name: 'ViewRowDimensionSet',
    opName: 'ViewRowDimensionSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, numToStr(a[3] ?? '0')],
  },
  {
    name: 'ViewColumnDimensionSet',
    opName: 'ViewColumnDimensionSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, numToStr(a[3] ?? '0')],
  },
  {
    name: 'ViewTitleDimensionSet',
    opName: 'ViewTitleDimensionSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, numToStr(a[3] ?? '0')],
  },
  // ViewTitleElementSet(cube, view, dim, elem)
  {
    name: 'ViewTitleElementSet',
    opName: 'ViewTitleElementSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },
  // ViewExtractSkip*Set(cube, view, skip[num])
  {
    name: 'ViewExtractSkipCalcsSet',
    opName: 'ViewExtractSkipCalcsSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  {
    name: 'ViewExtractSkipConsolidatedValuesSet',
    opName: 'ViewExtractSkipConsolidatedValuesSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  {
    name: 'ViewExtractSkipConsolidatedStringsSet',
    opName: 'ViewExtractSkipConsolidatedStringsSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  // ViewSubsetAssign(cube, view, dim, subset)
  {
    name: 'ViewSubsetAssign',
    opName: 'ViewSubsetAssign',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty, a[3] ?? empty],
  },
  {
    name: 'ViewExtractSkipRuleValuesSet',
    opName: 'ViewExtractSkipRuleValuesSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  {
    name: 'ViewExtractSkipZeroesSet',
    opName: 'ViewExtractSkipZeroesSet',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, numToStr(a[2] ?? '0')],
  },
  // ViewStructUpdate(cube, view)
  {
    name: 'ViewStructUpdate',
    opName: 'ViewStructUpdate',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty],
  },
  // View attribute metadata
  {
    name: 'ViewAttrInsert',
    opName: 'ViewAttrInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  {
    name: 'ViewAttrDelete',
    opName: 'ViewAttrDelete',
    buildArgs: (a) => [a[0] ?? empty],
  },

  // ── Chore attribute metadata ────────────────────────────────────────────
  {
    name: 'ChoreAttrInsert',
    opName: 'ChoreAttrInsert',
    buildArgs: (a) => [a[0] ?? empty, a[1] ?? empty, a[2] ?? empty],
  },
  {
    name: 'ChoreAttrDelete',
    opName: 'ChoreAttrDelete',
    buildArgs: (a) => [a[0] ?? empty],
  },

  // ── Rule ────────────────────────────────────────────────────────────────
  { name: 'RuleDestroy', opName: 'RuleDestroy', buildArgs: (a) => [a[0] ?? empty] },

  // ── Tran (transaction log) ──────────────────────────────────────────────
  { name: 'TranSave', opName: 'TranSave', buildArgs: (a) => [a[0] ?? empty] },
  { name: 'TranDelete', opName: 'TranDelete', buildArgs: (a) => [a[0] ?? empty] },

  // ── File output (marker + the real write, capture runs live) ───────────
  // The marker copies the row into sLogFile, with the original <file>
  // argument, so the diff shows what the process wrote where.
  {
    name: 'TextOutput',
    opName: '__TEXTOUTPUT__',
    buildArgs: (a) => [...a],
  },
  {
    name: 'ASCIIOutput',
    opName: '__ASCIIOUTPUT__',
    buildArgs: (a) => [...a],
  },
  {
    name: 'ASCIIOutputOpen',
    opName: '__ASCIIOUTPUTOPEN__',
    buildArgs: (a) => [...a],
  },
  {
    name: 'ASCIIOutputClose',
    opName: '__ASCIIOUTPUTCLOSE__',
    buildArgs: (a) => [...a],
  },
  // SetOutputCharacterSet(file, charset) — configures encoding AND opens/
  // creates the file.
  {
    name: 'SetOutputCharacterSet',
    opName: '__SETOUTPUTCHARSET__',
    buildArgs: (a) => [...a],
  },
  {
    name: 'SetInputCharacterSet',
    opName: '__SETINPUTCHARSET__',
    buildArgs: (a) => [...a],
  },
];

// `*Direct` variants change the same structure as their buffered siblings;
// they log the same row.
for (const base of DIRECT_VARIANT_BASES) {
  const m = WRITE_CALL_MAPPINGS.find((x) => x.name === base);
  if (!m) throw new Error(`tiRewriteMapping: no mapping for ${base}`);
  WRITE_CALL_MAPPINGS.push({ ...m, name: `${base}Direct` });
}
for (const [name, spec] of Object.entries(TUPLE_OPS)) {
  WRITE_CALL_MAPPINGS.push({
    name,
    opName: name,
    buildArgs: (a) => tupleArgs(spec, a.map((x, i) => (spec.numeric?.includes(i) ? numToStr(x) : x))),
  });
}

const MAPPING_BY_NAME_LOWER = new Map<string, WriteCallMapping>(
  WRITE_CALL_MAPPINGS.map((m) => [m.name.toLowerCase(), m]),
);

export const WRITE_CALL_NAMES_LOWER: ReadonlySet<string> = new Set(
  WRITE_CALL_MAPPINGS.map((m) => m.name.toLowerCase()),
);

export function findMapping(name: string): WriteCallMapping | undefined {
  return MAPPING_BY_NAME_LOWER.get(name.toLowerCase());
}

export function emitTextOutput(
  mapping: WriteCallMapping,
  rawArgs: string[],
  logFileVar: string,
): string {
  const args = mapping.buildArgs(rawArgs);
  const all = [logFileVar, `'${mapping.opName}'`, ...args];
  return `ASCIIOutput(${all.join(', ')})`;
}

/**
 * Maps a simulator-level TI call (`name + Value[] args`) into a typed
 * `LogRow` matching the shape that `captureWorkflow` would persist to
 * `expected/dim-deltas.jsonl`.
 *
 * Used by `evalStatement.ts` to record every mutation the simulator makes
 * so the local-replay diff has parity with the server-side capture.
 *
 * Returns `null` for any name that is not a known mutation TI builtin (math,
 * string, read-only ops, etc. — they don't appear in the log).
 */

import type { Value } from '../types';
import { type LogRow, TUPLE_OPS, tupleArgs } from '../../tiTestFramework/log/logSchema';
import { splitPreFormattedRow } from '../../tiTestFramework/log/preformattedRowSplit';
import { numToStr } from '../eval/builtins/_helpers';

const FILE_OUTPUT_MARKER_BY_NAME: Record<string, string> = {
  textoutput: '__TEXTOUTPUT__',
  asciioutput: '__ASCIIOUTPUT__',
  asciioutputopen: '__ASCIIOUTPUTOPEN__',
  asciioutputclose: '__ASCIIOUTPUTCLOSE__',
  setoutputcharacterset: '__SETOUTPUTCHARSET__',
};

const TUPLE_OP_BY_LOWER = new Map(Object.entries(TUPLE_OPS).map(([op, spec]) => [op.toLowerCase(), { op, spec }]));

const asStr = (v: Value | undefined): string =>
  v === undefined ? '' : typeof v === 'string' ? v : String(v);

const asNum = (v: Value | undefined): number => {
  if (v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Build a typed log row from a TI call. Order/shape mirrors `parseLog` cases
 * in `tiTestFramework/log/logParser.ts` and the rewriter mapping in
 * `tiTestFramework/rewriter/tiRewriteMapping.ts` (so capture and simulate
 * produce comparable rows for the same source).
 */
export function buildOpRow(name: string, args: Value[]): LogRow | null {
  const lower = name.toLowerCase();

  // View/Subset infra runs live in clones but the rewriter ALSO emits log
  // markers for them (see tiSourceRewriter "live-passthrough with marker"),
  // so the diff compares the captured definition rows against simulator-
  // emitted rows. The user explicitly requested visibility in the diff.

  // File-output redirect markers — rewriter emits these to the clone's
  // sLogFile so the diff can compare against simulator-emitted markers.
  // Shape mirrors the captured log row: op-marker + all args verbatim.
  const fileOutputMarker = FILE_OUTPUT_MARKER_BY_NAME[lower];
  if (fileOutputMarker) {
    // Bedrock-style export builds the data row as ONE Expand'd string with
    // embedded `pFieldDelim` separators (`"a";"b";"c"`). The captured log
    // came through TM1's ASCIIOutput which writes each piece as its own
    // field, so the recorded args have one entry per value. Split any sim
    // arg that already contains `;` outside quotes into the same shape so
    // the diff aligns.
    const flat: string[] = [];
    for (const a of args) {
      const s = asStr(a);
      const split = splitPreFormattedRow(s);
      if (split.length > 1) flat.push(...split);
      else flat.push(s);
    }
    return { op: fileOutputMarker, args: flat };
  }

  const tuple = TUPLE_OP_BY_LOWER.get(lower);
  if (tuple) {
    // Numeric args go through NumberToString on the capture side (rewriter); same formatting here.
    const { spec } = tuple;
    return { op: tuple.op, args: tupleArgs(spec, args.map((a, i) => (spec.numeric?.includes(i) ? numToStr(a) : asStr(a)))) };
  }

  // `*Direct` variants log the same row as their buffered sibling.
  switch (lower.endsWith('direct') ? lower.slice(0, -'direct'.length) : lower) {
    // ── Dim element ops ────────────────────────────────────────────────
    case 'dimensionelementinsert':
      return {
        op: 'DimElementInsert',
        dim: asStr(args[0]),
        hier: '',
        name: asStr(args[2]),
        type: asStr(args[3]),
        insertAfter: asStr(args[1]),
      };
    case 'dimensionelementdelete':
      return {
        op: 'DimElementDelete',
        dim: asStr(args[0]),
        hier: '',
        name: asStr(args[1]),
      };
    case 'dimensionelementcomponentadd':
      return {
        op: 'DimElementComponentAdd',
        dim: asStr(args[0]),
        hier: '',
        parent: asStr(args[1]),
        child: asStr(args[2]),
        weight: asNum(args[3]),
      };
    case 'dimensionelementcomponentdelete':
      return {
        op: 'DimElementComponentDelete',
        dim: asStr(args[0]),
        hier: '',
        parent: asStr(args[1]),
        child: asStr(args[2]),
      };
    case 'hierarchyelementinsert':
      return {
        op: 'DimElementInsert',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        name: asStr(args[3]),
        type: asStr(args[4]),
        insertAfter: asStr(args[2]),
      };
    case 'hierarchyelementdelete':
      return {
        op: 'DimElementDelete',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        name: asStr(args[2]),
      };
    case 'hierarchyelementcomponentadd':
      return {
        op: 'DimElementComponentAdd',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        parent: asStr(args[2]),
        child: asStr(args[3]),
        weight: asNum(args[4]),
      };
    case 'hierarchyelementcomponentdelete':
      return {
        op: 'DimElementComponentDelete',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        parent: asStr(args[2]),
        child: asStr(args[3]),
      };
    case 'dimensiontopelementinsert':
      return {
        op: 'DimElementInsert',
        dim: asStr(args[0]),
        hier: '',
        name: asStr(args[1]),
        type: asStr(args[2]),
        insertAfter: '',
      };
    case 'hierarchytopelementinsert':
      return {
        op: 'DimElementInsert',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        name: asStr(args[3]),
        type: '',
        insertAfter: '',
      };
    case 'elementinsert':
      return {
        op: 'DimElementInsert',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        name: asStr(args[3]),
        type: '',
        insertAfter: '',
      };
    case 'elementdelete':
      return args.length >= 3
        ? {
            op: 'DimElementDelete',
            dim: asStr(args[0]),
            hier: asStr(args[1]),
            name: asStr(args[2]),
          }
        : {
            op: 'DimElementDelete',
            dim: asStr(args[0]),
            hier: '',
            name: asStr(args[1]),
          };

    // ── Dim / Hierarchy lifecycle ──────────────────────────────────────
    case 'dimensioncreate':
      return { op: 'DimensionCreate', name: asStr(args[0]) };
    case 'dimensiondestroy':
      return { op: 'DimensionDestroy', name: asStr(args[0]) };
    case 'hierarchycreate':
    case 'dimensionhierarchycreate':
      return { op: 'HierarchyCreate', dim: asStr(args[0]), hier: asStr(args[1]) };
    case 'hierarchydestroy':
      return { op: 'HierarchyDestroy', dim: asStr(args[0]), hier: asStr(args[1]) };
    case 'hierarchyelementsecurityput':
      return {
        op: 'HierarchyElementSecurityPut',
        dim: asStr(args[1]),
        hier: asStr(args[2]),
        element: asStr(args[3]),
        group: asStr(args[4]),
        level: asStr(args[0]),
      };

    // ── Element-level Attr ops ─────────────────────────────────────────
    case 'attrputs':
      return {
        op: 'AttrPutS',
        dim: asStr(args[1]),
        hier: '',
        element: asStr(args[2]),
        attribute: asStr(args[3]),
        value: asStr(args[0]),
      };
    case 'attrputn':
      return {
        op: 'AttrPutN',
        dim: asStr(args[1]),
        hier: '',
        element: asStr(args[2]),
        attribute: asStr(args[3]),
        value: asNum(args[0]),
      };
    case 'elementattrputs':
      return {
        op: 'AttrPutS',
        dim: asStr(args[1]),
        hier: asStr(args[2]),
        element: asStr(args[3]),
        attribute: asStr(args[4]),
        value: asStr(args[0]),
      };
    case 'elementattrputn':
      return {
        op: 'AttrPutN',
        dim: asStr(args[1]),
        hier: asStr(args[2]),
        element: asStr(args[3]),
        attribute: asStr(args[4]),
        value: asNum(args[0]),
      };
    case 'attributeput': {
      // Legacy alias of AttrPutS/N — sim treats both as AttrPutS for diff.
      const v = args[0];
      if (typeof v === 'number') {
        return {
          op: 'AttrPutN',
          dim: asStr(args[1]),
          hier: '',
          element: asStr(args[2]),
          attribute: asStr(args[3]),
          value: v,
        };
      }
      return {
        op: 'AttrPutS',
        dim: asStr(args[1]),
        hier: '',
        element: asStr(args[2]),
        attribute: asStr(args[3]),
        value: asStr(v),
      };
    }
    case 'attrinsert':
      return {
        op: 'AttrInsert',
        dim: asStr(args[0]),
        hier: '',
        element: '',
        attribute: asStr(args[2]),
        type: asStr(args[3]),
        prevAttr: asStr(args[1]),
      };
    case 'elementattrinsert':
      return {
        op: 'AttrInsert',
        dim: asStr(args[0]),
        hier: '',
        element: '',
        attribute: asStr(args[2]),
        type: asStr(args[3]),
        prevAttr: asStr(args[1]),
      };
    case 'attrdelete':
      return {
        op: 'AttrDelete',
        dim: asStr(args[0]),
        hier: '',
        element: '',
        attribute: asStr(args[1]),
      };
    case 'elementattrdelete':
      return {
        op: 'AttrDelete',
        dim: asStr(args[0]),
        hier: '',
        element: '',
        attribute: asStr(args[1]),
      };
    case 'attributecreate':
      return {
        op: 'AttrInsert',
        dim: asStr(args[0]),
        hier: '',
        element: '',
        attribute: asStr(args[1]),
        type: asStr(args[2]),
        prevAttr: '',
      };
    case 'attributedelete':
      return {
        op: 'AttrDelete',
        dim: asStr(args[0]),
        hier: '',
        element: '',
        attribute: asStr(args[1]),
      };

    // ── Object-type attribute schema (no instance) ─────────────────────
    case 'cubeattrinsert':
      return {
        op: 'CubeAttrInsert',
        prevAttr: asStr(args[0]),
        attribute: asStr(args[1]),
        type: asStr(args[2]),
      };
    case 'cubeattrdelete':
      return { op: 'CubeAttrDelete', attribute: asStr(args[0]) };
    case 'dimensionattrinsert':
      return {
        op: 'DimensionAttrInsert',
        prevAttr: asStr(args[0]),
        attribute: asStr(args[1]),
        type: asStr(args[2]),
      };
    case 'dimensionattrdelete':
      return { op: 'DimensionAttrDelete', attribute: asStr(args[0]) };
    case 'choreattrinsert':
      return {
        op: 'ChoreAttrInsert',
        prevAttr: asStr(args[0]),
        attribute: asStr(args[1]),
        type: asStr(args[2]),
      };
    case 'choreattrdelete':
      return { op: 'ChoreAttrDelete', attribute: asStr(args[0]) };
    case 'viewattrinsert':
      return {
        op: 'ViewAttrInsert',
        prevAttr: asStr(args[0]),
        attribute: asStr(args[1]),
        type: asStr(args[2]),
      };
    case 'viewattrdelete':
      return { op: 'ViewAttrDelete', attribute: asStr(args[0]) };
    case 'subsetattrinsert':
      return {
        op: 'SubsetAttrInsert',
        prevAttr: asStr(args[0]),
        attribute: asStr(args[1]),
        type: asStr(args[2]),
      };
    case 'subsetattrdelete':
      return { op: 'SubsetAttrDelete', attribute: asStr(args[0]) };
    case 'hierarchysubsetattrinsert':
      return {
        op: 'HierarchySubsetAttrInsert',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        attribute: asStr(args[3]),
        type: asStr(args[4]),
      };
    case 'hierarchysubsetattrdelete':
      return {
        op: 'HierarchySubsetAttrDelete',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        attribute: asStr(args[3]),
      };

    // ── Subset ops ─────────────────────────────────────────────────────
    case 'subsetcreate':
      return {
        op: 'SubsetCreate',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
      };
    case 'subsetcreatebymdx':
      return {
        op: 'SubsetCreateByMDX',
        dim: asStr(args[0]),
        hier: '',
        mdx: asStr(args[1]),
      };
    case 'subsetelementinsert':
      return {
        op: 'SubsetElementInsert',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
        element: asStr(args[2]),
        position: asNum(args[3]),
      };
    case 'subsetelementdelete':
      // SubsetElementDelete(DimName, SubsetName, Index) — dim-first (IBM)
      return {
        op: 'SubsetElementDelete',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
        element: asStr(args[2]),
      };
    case 'subsetelementadd':
      return {
        op: 'SubsetElementInsert',
        dim: asStr(args[1]),
        hier: '',
        subset: asStr(args[0]),
        element: asStr(args[2]),
        position: 0,
      };
    case 'subsetdeleteallelements':
      return {
        op: 'SubsetDeleteAllElements',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
      };
    case 'subsetdestroy':
      return {
        op: 'SubsetDestroy',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
      };
    case 'subsetdelete':
      return {
        op: 'SubsetDestroy',
        dim: asStr(args[1]),
        hier: '',
        subset: asStr(args[0]),
      };
    case 'subsetmdxset':
      return {
        op: 'SubsetMDXSet',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
        mdx: asStr(args[2]),
      };
    case 'subsetisallset':
      return {
        op: 'SubsetIsAllSet',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
        flag: asNum(args[2]),
      };
    case 'subsetaliasset':
      return {
        op: 'SubsetAliasSet',
        dim: asStr(args[0]),
        hier: '',
        subset: asStr(args[1]),
        alias: asStr(args[2]),
      };
    case 'hierarchysubsetcreate':
      return {
        op: 'SubsetCreate',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
      };
    case 'hierarchysubsetdestroy':
      return {
        op: 'SubsetDestroy',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
      };
    case 'hierarchysubsetelementinsert':
      return {
        op: 'SubsetElementInsert',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        element: asStr(args[3]),
        position: asNum(args[4]),
      };
    case 'hierarchysubsetelementdelete':
      return {
        op: 'SubsetElementDelete',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        element: asStr(args[3]),
      };
    case 'hierarchysubsetmdxset':
      return {
        op: 'SubsetMDXSet',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        mdx: asStr(args[3]),
      };
    case 'hierarchysubsetisallset':
      return {
        op: 'SubsetIsAllSet',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        flag: asNum(args[3]),
      };
    case 'hierarchysubsetaliasset':
      return {
        op: 'SubsetAliasSet',
        dim: asStr(args[0]),
        hier: asStr(args[1]),
        subset: asStr(args[2]),
        alias: asStr(args[3]),
      };

    // ── View ops ───────────────────────────────────────────────────────
    case 'viewcreate':
      return { op: 'ViewCreate', cube: asStr(args[0]), view: asStr(args[1]) };
    case 'viewzeroout':
      return { op: 'ViewZeroOut', cube: asStr(args[0]), view: asStr(args[1]) };
    case 'viewdelete':
      return { op: 'ViewDelete', cube: asStr(args[0]), view: asStr(args[1]) };
    case 'viewdestroy':
      return { op: 'ViewDestroy', cube: asStr(args[0]), view: asStr(args[1]) };
    case 'viewmdxset':
      return {
        op: 'ViewMDXSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        mdx: asStr(args[2]),
      };
    case 'viewsuppresszeroesset':
      return {
        op: 'ViewSuppressZeroesSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        flag: asNum(args[2]),
      };
    case 'viewzerosuppressionset':
      return {
        op: 'ViewZeroSuppressionSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        flag: asNum(args[2]),
      };
    case 'viewrowdimensionset':
      return {
        op: 'ViewRowDimensionSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        dim: asStr(args[2]),
        position: asNum(args[3]),
      };
    case 'viewcolumndimensionset':
      return {
        op: 'ViewColumnDimensionSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        dim: asStr(args[2]),
        position: asNum(args[3]),
      };
    case 'viewtitledimensionset':
      return {
        op: 'ViewTitleDimensionSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        dim: asStr(args[2]),
        position: asNum(args[3]),
      };
    case 'viewtitleelementset':
      return {
        op: 'ViewTitleElementSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        dim: asStr(args[2]),
        element: asStr(args[3]),
      };
    case 'viewextractskipcalcsset':
      return {
        op: 'ViewExtractSkipCalcsSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        skip: asNum(args[2]),
      };
    case 'viewextractskipconsolidatedvaluesset':
      return {
        op: 'ViewExtractSkipConsolidatedValuesSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        skip: asNum(args[2]),
      };
    case 'viewextractskiprulevaluesset':
      return {
        op: 'ViewExtractSkipRuleValuesSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        skip: asNum(args[2]),
      };
    case 'viewextractskipzeroesset':
      return {
        op: 'ViewExtractSkipZeroesSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        skip: asNum(args[2]),
      };
    case 'viewextractskipconsolidatedstringsset':
      return {
        op: 'ViewExtractSkipConsolidatedStringsSet',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        skip: asNum(args[2]),
      };
    case 'viewsubsetassign':
      return {
        op: 'ViewSubsetAssign',
        cube: asStr(args[0]),
        view: asStr(args[1]),
        dim: asStr(args[2]),
        subset: asStr(args[3]),
      };
    case 'viewstructupdate':
      return { op: 'ViewStructUpdate', cube: asStr(args[0]), view: asStr(args[1]) };

    // ── Cube lifecycle / security / DR ─────────────────────────────────
    case 'cubecreate':
      return {
        op: 'CubeCreate',
        name: asStr(args[0]),
        dimensions: args.slice(1).map(asStr),
      };
    case 'cubedestroy':
      return { op: 'CubeDestroy', name: asStr(args[0]) };
    case 'cubedelete':
      return { op: 'CubeDelete', name: asStr(args[0]) };
    case 'cuberuledestroy':
      return { op: 'CubeRuleDestroy', name: asStr(args[0]) };
    case 'ruledestroy':
      return { op: 'RuleDestroy', name: asStr(args[0]) };
    case 'cellsecuritycubecreate':
      return { op: 'CellSecurityCubeCreate', name: asStr(args[0]) };
    case 'cellsecuritycubedestroy':
      return { op: 'CellSecurityCubeDestroy', name: asStr(args[0]) };
    case 'cubedatareservationrelease':
      return {
        op: 'CubeDataReservationRelease',
        name: asStr(args[0]),
        elements: args.slice(1).map(asStr),
      };
    case 'cubedrrelease':
      return {
        op: 'CubeDRRelease',
        name: asStr(args[0]),
        elementList: asStr(args[1]),
      };

    // ── Tran ──────────────────────────────────────────────────────────
    case 'transave':
      return { op: 'TranSave', transactionId: asStr(args[0]) };
    case 'trandelete':
      return { op: 'TranDelete', transactionId: asStr(args[0]) };

    default:
      return null;
  }
}

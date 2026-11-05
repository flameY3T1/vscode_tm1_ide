/**
 * Object-level attribute-read built-ins (2026-07-13).
 *
 * TI functions that read an attribute value off a cube / dimension / hierarchy /
 * subset / view / chore / process whose identifiers are built from variables at
 * runtime (e.g. `CubeAttrS(sCube, 'Owner')`). The simulator cannot recompute
 * these — it resolves them from a captured fixture (`data/attr-reads.jsonl`,
 * loaded into `fixtures.objectAttributes`).
 *
 * Mirrors the cube cell-read pattern in `cube.ts` (readCellN/readCellS +
 * cellReadMisses miss-tracking): a MISS records the lookup key in
 * `fixtures.cellReadMisses` (if the sink is present) so the runner can surface
 * ONE aggregated warning, then returns the neutral 0 / '' fallback.
 *
 * Lookup key = `<fn.toLowerCase()>\t<arg1>\t…\t<argN>` — byte-identical to the
 * key the capture side writes.
 */

import { type Builtin } from './_helpers';
import type { Fixtures, Value } from '../../types';

type Ret = 'N' | 'S';

/** `ret` is 'N' for numeric/…N/…NL, 'S' for string/…S/…SL. */
const OBJECT_ATTR_READ_TABLE: ReadonlyArray<{ name: string; ret: Ret }> = [

  { name: 'ChoreAttrN', ret: 'N' },
  { name: 'ChoreAttrNL', ret: 'N' },
  { name: 'ChoreAttrS', ret: 'S' },
  { name: 'ChoreAttrSL', ret: 'S' },

  { name: 'CubeAttrN', ret: 'N' },
  { name: 'CubeAttrNL', ret: 'N' },
  { name: 'CubeAttrS', ret: 'S' },
  { name: 'CubeAttrSL', ret: 'S' },

  // NOTE: DimensionAttrN / DimensionAttrS are registered elsewhere — only the
  // *L variants live here.
  { name: 'DimensionAttrNL', ret: 'N' },
  { name: 'DimensionAttrSL', ret: 'S' },

  { name: 'HierarchyAttrN', ret: 'N' },
  { name: 'HierarchyAttrNL', ret: 'N' },
  { name: 'HierarchyAttrS', ret: 'S' },
  { name: 'HierarchyAttrSL', ret: 'S' },

  { name: 'HierarchySubsetAttrN', ret: 'N' },
  { name: 'HierarchySubsetAttrNL', ret: 'N' },
  { name: 'HierarchySubsetAttrS', ret: 'S' },
  { name: 'HierarchySubsetAttrSL', ret: 'S' },

  { name: 'ProcessAttrN', ret: 'N' },
  { name: 'ProcessAttrNL', ret: 'N' },
  { name: 'ProcessAttrS', ret: 'S' },
  { name: 'ProcessAttrSL', ret: 'S' },

  { name: 'SubsetAttrN', ret: 'N' },
  { name: 'SubsetAttrNL', ret: 'N' },
  { name: 'SubsetAttrS', ret: 'S' },
  { name: 'SubsetAttrSL', ret: 'S' },

  { name: 'ViewAttrN', ret: 'N' },
  { name: 'ViewAttrNL', ret: 'N' },
  { name: 'ViewAttrS', ret: 'S' },
  { name: 'ViewAttrSL', ret: 'S' },

  // Rule text: captured by length over the log, text fetched over REST
  // (see instrumentReads RULE_READ). Same fixture file, key `cuberuleget\t<cube>`.
  { name: 'CubeRuleGet', ret: 'S' },
];

function makeObjectAttrRead(name: string, ret: Ret): Builtin {
  const lower = name.toLowerCase();
  return {
    name,
    invoke: (args: Value[], fx?: Fixtures): Value => {
      const key = `${lower}\t${args.map(String).join('\t')}`;
      const v = fx?.objectAttributes?.get(key);
      if (v === undefined) {
        // Miss: record for the runner's aggregated warning, return neutral value.
        fx?.cellReadMisses?.add(key);
        return ret === 'N' ? 0 : '';
      }
      return ret === 'N'
        ? typeof v === 'number' ? v : Number(v) || 0
        : typeof v === 'string' ? v : String(v);
    },
  };
}

export const OBJECT_ATTR_READ_BUILTINS: Builtin[] = OBJECT_ATTR_READ_TABLE.map((e) =>
  makeObjectAttrRead(e.name, e.ret),
);

/**
 * Subset built-ins (incl. hierarchy-named variant family).
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Five named arrays kept in source-line order:
 *  - SUBSET_OPS_BUILTINS     (section 5,  L636-682)  — incl. early stubs that
 *                            are later overridden in HIER_SUBSET / SUBSET_PROPS.
 *  - SUBSET_QUERY_BUILTINS   (section 6b, L691-766)  — full SubsetExists etc.
 *  - SUBSET_EXTRAS_BUILTINS  (section 17, L1284-1294)
 *  - SUBSET_PROPS_BUILTINS   (section 18, L1295-1340)
 *  - HIER_SUBSET_BUILTINS    (section 19, L1342-1522)
 *
 * Last-wins registry semantics preserved by source-order concat in
 * `eval/builtins/index.ts`.
 */

import { subsetKey } from '../../types';
import {
  type Builtin,
  asNumber,
  asString,
  expectArity,
  noopVoid,
} from './_helpers';

// ── Section 5 — Subset operations (in-memory subset registry) ─────────
export const SUBSET_OPS_BUILTINS: Builtin[] = [
  {
    name: 'SubsetCreate',
    invoke: (args, fx) => {
      expectArity('SubsetCreate', args, 2, 3);
      if (!fx) return 0;
      // SubsetCreate(DimName, SubsetName[, AsTemporary]) — dim-first (IBM); canonical key is (dim, sub)
      fx.subsets.set(subsetKey(asString(args[0]), asString(args[1])), []);
      return 1;
    },
  },
  {
    // SubsetCreateByMDX(subsetName, mdxExpression[, temporary])
    // Simulator does NOT evaluate MDX (Phase α scope) — definition compared
    // against capture log verbatim via buildOpRow. Dimension is derived from
    // the first `[DimName]` token in the MDX so SubsetExists / SubsetDestroy
    // can match (e.g. epilog cleanup).
    name: 'SubsetCreateByMDX',
    invoke: (args, fx) => {
      expectArity('SubsetCreateByMDX', args, 2, 3);
      if (!fx) return 0;
      const subset = asString(args[0]);
      const mdx = asString(args[1]);
      const dimMatch = mdx.match(/\[([^\]]+)\]/);
      const dim = dimMatch ? dimMatch[1] : '__mdx__';
      fx.subsets.set(subsetKey(dim, subset), []);
      return 1;
    },
  },
  // Hierarchy-named variants (just route to buildOpRow + record in fx).
  {
    name: 'HierarchySubsetCreate',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetCreate', args, 3, 4);
      if (!fx) return 0;
      fx.subsets.set(subsetKey(asString(args[0]), asString(args[2])), []);
      return 1;
    },
  },
  noopVoid('HierarchySubsetDestroy', 3),
  noopVoid('HierarchySubsetElementInsert', 4, 5),
  noopVoid('HierarchySubsetElementDelete', 4),
  noopVoid('HierarchySubsetMDXSet', 4),
  noopVoid('HierarchySubsetIsAllSet', 4),
  noopVoid('HierarchySubsetAliasSet', 4),
  noopVoid('SubsetMDXSet', 3),
  noopVoid('SubsetIsAllSet', 3),
  noopVoid('SubsetAliasSet', 3),
];

// ── Section 6b — Subset queries (interleaved with view stubs in source) ─
export const SUBSET_QUERY_BUILTINS: Builtin[] = [
  {
    name: 'SubsetExists',
    invoke: (args, fx) => {
      expectArity('SubsetExists', args, 2);
      if (!fx) return 0;
      // SubsetExists(DimName, SubsetName) — dim-first (IBM); canonical key is (dim, sub)
      return fx.subsets.has(subsetKey(asString(args[0]), asString(args[1]))) ? 1 : 0;
    },
  },
  {
    name: 'SubsetDestroy',
    invoke: (args, fx) => {
      expectArity('SubsetDestroy', args, 2);
      if (!fx) return 0;
      fx.subsets.delete(subsetKey(asString(args[0]), asString(args[1])));
      return 1;
    },
  },
  {
    name: 'SubsetDeleteAllElements',
    invoke: (args, fx) => {
      expectArity('SubsetDeleteAllElements', args, 2);
      if (!fx) return 0;
      const k = subsetKey(asString(args[0]), asString(args[1]));
      if (fx.subsets.has(k)) fx.subsets.set(k, []);
      return 1;
    },
  },
  {
    name: 'SubsetElementInsert',
    invoke: (args, fx) => {
      expectArity('SubsetElementInsert', args, 3, 4);
      if (!fx) return 0;
      const k = subsetKey(asString(args[0]), asString(args[1]));
      const arr = fx.subsets.get(k) ?? [];
      const elem = asString(args[2]);
      // 1-based position; 0 or omitted → append.
      const pos = args.length === 4 ? Math.floor(asNumber(args[3], 'SubsetElementInsert', 3)) : 0;
      if (pos > 0 && pos <= arr.length + 1) arr.splice(pos - 1, 0, elem);
      else arr.push(elem);
      fx.subsets.set(k, arr);
      return 1;
    },
  },
  {
    name: 'SubsetElementDelete',
    invoke: (args, fx) => {
      expectArity('SubsetElementDelete', args, 3);
      if (!fx) return 0;
      // SubsetElementDelete(DimName, SubsetName, Index) — dim-first (IBM); canonical key is (dim, sub)
      const k = subsetKey(asString(args[0]), asString(args[1]));
      const arr = fx.subsets.get(k);
      if (!arr) return 0;
      // Third arg: 1-based index per TI spec.
      const idx = Math.floor(asNumber(args[2], 'SubsetElementDelete', 2)) - 1;
      if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
      return 1;
    },
  },
  {
    name: 'SubsetGetSize',
    invoke: (args, fx) => {
      expectArity('SubsetGetSize', args, 2);
      if (!fx) return 0;
      // SubsetGetSize(DimName, SubsetName) — dim-first (IBM); canonical key is (dim, sub)
      return fx.subsets.get(subsetKey(asString(args[0]), asString(args[1])))?.length ?? 0;
    },
  },
  {
    name: 'SubsetGetElementName',
    invoke: (args, fx) => {
      expectArity('SubsetGetElementName', args, 3);
      if (!fx) return '';
      // SubsetGetElementName(DimName, SubsetName, Index) — dim-first (IBM); canonical key is (dim, sub)
      const arr = fx.subsets.get(subsetKey(asString(args[0]), asString(args[1])));
      if (!arr) return '';
      const idx = Math.floor(asNumber(args[2], 'SubsetGetElementName', 2)) - 1;
      return arr[idx] ?? '';
    },
  },
];

// ── Section 17 — Subset extras (tolerated non-standard spelling) ──────
export const SUBSET_EXTRAS_BUILTINS: Builtin[] = [
  {
    // SubsetDelete(subset, dim) is NOT an official TM1 TI function (the real
    // one is SubsetDestroy). It is a non-standard spelling seen in some
    // scripts; handle it defensively like SubsetDestroy with reversed args.
    name: 'SubsetDelete',
    invoke: (args, fx) => {
      expectArity('SubsetDelete', args, 2);
      if (!fx) return 0;
      fx.subsets.delete(subsetKey(asString(args[1]), asString(args[0])));
      return 1;
    },
  },
];

// ── Section 18 — Subset properties (mdx / alias / isAll) ───────────────
export const SUBSET_PROPS_BUILTINS: Builtin[] = [
  {
    name: 'SubsetMDXSet',
    invoke: (args, fx) => {
      expectArity('SubsetMDXSet', args, 3);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), '', asString(args[1]));
      const props = fx.subsetProps.get(k) ?? {};
      props.mdx = asString(args[2]);
      fx.subsetProps.set(k, props);
      return 1;
    },
  },
  {
    name: 'SubsetIsAllSet',
    invoke: (args, fx) => {
      expectArity('SubsetIsAllSet', args, 3);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), '', asString(args[1]));
      const props = fx.subsetProps.get(k) ?? {};
      props.isAll = asNumber(args[2], 'SubsetIsAllSet', 2) !== 0;
      fx.subsetProps.set(k, props);
      return 1;
    },
  },
  {
    name: 'SubsetAliasSet',
    invoke: (args, fx) => {
      expectArity('SubsetAliasSet', args, 3);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), '', asString(args[1]));
      const props = fx.subsetProps.get(k) ?? {};
      props.alias = asString(args[2]);
      fx.subsetProps.set(k, props);
      return 1;
    },
  },
  {
    name: 'SubsetAliasGet',
    invoke: (args, fx) => {
      expectArity('SubsetAliasGet', args, 2);
      if (!fx) return '';
      const k = subsetKey(asString(args[0]), '', asString(args[1]));
      return fx.subsetProps.get(k)?.alias ?? '';
    },
  },
];

// ── Section 19 — Hierarchy-named subset family (hier-aware state) ──────
export const HIER_SUBSET_BUILTINS: Builtin[] = [
  {
    name: 'HierarchySubsetCreate',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetCreate', args, 3, 4);
      if (!fx) return 1;
      fx.subsets.set(
        subsetKey(asString(args[0]), asString(args[1]), asString(args[2])),
        [],
      );
      return 1;
    },
  },
  {
    name: 'HierarchySubsetDestroy',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetDestroy', args, 3);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      fx.subsets.delete(k);
      fx.subsetProps.delete(k);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetExists',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetExists', args, 3);
      if (!fx) return 0;
      return fx.subsets.has(
        subsetKey(asString(args[0]), asString(args[1]), asString(args[2])),
      )
        ? 1
        : 0;
    },
  },
  {
    name: 'HierarchySubsetGetSize',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetGetSize', args, 3);
      if (!fx) return 0;
      return (
        fx.subsets.get(
          subsetKey(asString(args[0]), asString(args[1]), asString(args[2])),
        )?.length ?? 0
      );
    },
  },
  {
    name: 'HierarchySubsetGetElementName',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetGetElementName', args, 4);
      if (!fx) return '';
      const arr = fx.subsets.get(
        subsetKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (!arr) return '';
      const idx = Math.floor(asNumber(args[3], 'HierarchySubsetGetElementName', 3)) - 1;
      return arr[idx] ?? '';
    },
  },
  {
    name: 'HierarchySubsetElementExists',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetElementExists', args, 4);
      if (!fx) return 0;
      const arr = fx.subsets.get(
        subsetKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (!arr) return 0;
      const lower = asString(args[3]).toLowerCase();
      return arr.some((e) => e.toLowerCase() === lower) ? 1 : 0;
    },
  },
  {
    name: 'HierarchySubsetElementGetIndex',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetElementGetIndex', args, 4);
      if (!fx) return 0;
      const arr = fx.subsets.get(
        subsetKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (!arr) return 0;
      const lower = asString(args[3]).toLowerCase();
      const idx = arr.findIndex((e) => e.toLowerCase() === lower);
      return idx >= 0 ? idx + 1 : 0;
    },
  },
  {
    name: 'HierarchySubsetDeleteAllElements',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetDeleteAllElements', args, 3);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      if (fx.subsets.has(k)) fx.subsets.set(k, []);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetElementInsert',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetElementInsert', args, 5);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      const arr = fx.subsets.get(k) ?? [];
      const elem = asString(args[3]);
      const pos = Math.floor(asNumber(args[4], 'HierarchySubsetElementInsert', 4));
      if (pos > 0 && pos <= arr.length + 1) arr.splice(pos - 1, 0, elem);
      else arr.push(elem);
      fx.subsets.set(k, arr);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetElementDelete',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetElementDelete', args, 4);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      const arr = fx.subsets.get(k);
      if (!arr) return 0;
      const lower = asString(args[3]).toLowerCase();
      const idx = arr.findIndex((e) => e.toLowerCase() === lower);
      if (idx >= 0) arr.splice(idx, 1);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetMDXSet',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetMDXSet', args, 4);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      const props = fx.subsetProps.get(k) ?? {};
      props.mdx = asString(args[3]);
      fx.subsetProps.set(k, props);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetIsAllSet',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetIsAllSet', args, 4);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      const props = fx.subsetProps.get(k) ?? {};
      props.isAll = asNumber(args[3], 'HierarchySubsetIsAllSet', 3) !== 0;
      fx.subsetProps.set(k, props);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetAliasSet',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetAliasSet', args, 4);
      if (!fx) return 1;
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      const props = fx.subsetProps.get(k) ?? {};
      props.alias = asString(args[3]);
      fx.subsetProps.set(k, props);
      return 1;
    },
  },
  {
    name: 'HierarchySubsetAliasGet',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetAliasGet', args, 3);
      if (!fx) return '';
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      return fx.subsetProps.get(k)?.alias ?? '';
    },
  },
  {
    name: 'HierarchySubsetMDXGet',
    invoke: (args, fx) => {
      expectArity('HierarchySubsetMDXGet', args, 3);
      if (!fx) return '';
      const k = subsetKey(asString(args[0]), asString(args[1]), asString(args[2]));
      return fx.subsetProps.get(k)?.mdx ?? '';
    },
  },
];

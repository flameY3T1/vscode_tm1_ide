/**
 * Dimension + hierarchy built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Five named arrays, kept in source-line order so the index-side concat
 * preserves the original last-wins registry semantics:
 *  - DIM_QUERY_BUILTINS       (section 2,  L279-447)
 *  - DIM_MUT_BUILTINS         (section 4,  L512-634)
 *  - HIER_LIFECYCLE_BUILTINS  (section 11, L932-936)
 *  - HIER_QUERY_BUILTINS      (section 12, L937-994)
 *  - ELEM_EXTRAS_BUILTINS     (section 13, L995-1091)
 */

import type { DimElement } from '../../types';
import {
  type Builtin,
  asNumber,
  asString,
  expectArity,
  findDimElementIndex,
  noopVoid,
} from './_helpers';

// ── Section 2 — Dimension functions (need fixtures.dimensions) ─────────
export const DIM_QUERY_BUILTINS: Builtin[] = [
  {
    // TabDim(cube, n) — 1-based nth dim name of cube, '' when out of range or
    // cube unknown. Bedrock idiom: `While( TabDim(pCube, nCount) @<> '' )`.
    name: 'TabDim',
    invoke: (args, fx) => {
      expectArity('TabDim', args, 2);
      const dims = fx?.cubeDims.get(asString(args[0]));
      if (!dims) return '';
      const i = Math.floor(asNumber(args[1], 'TabDim', 1)) - 1;
      return dims[i] ?? '';
    },
  },
  {
    // CubeExists(name) → 1 if the cube has any fixture data (dims or cells),
    // else 0. Mirrors TM1's existence check used by bedrock guards.
    name: 'CubeExists',
    invoke: (args, fx) => {
      expectArity('CubeExists', args, 1);
      const name = asString(args[0]);
      if (!fx) return 0;
      if (fx.cubeDims.has(name)) return 1;
      for (const key of fx.cubeCells.keys()) {
        if (key.startsWith(`${name}\t`)) return 1;
      }
      return 0;
    },
  },
  {
    // Mod(a, b) — JS-style modulo; matches TM1 for positive operands. Bedrock
    // uses `Mod(nElements, nMaxThreads)` for thread distribution.
    name: 'Mod',
    invoke: (args) => {
      expectArity('Mod', args, 2);
      const b = asNumber(args[1], 'Mod', 1);
      if (b === 0) throw new EvalError('Mod: divide by zero');
      return asNumber(args[0], 'Mod', 0) % b;
    },
  },
  {
    // Fill(char, n) — string built from repeating `char` n times. Used by
    // bedrock-style zero-pad idioms (`Fill('0', 8 - Long(s)) | s`).
    name: 'Fill',
    invoke: (args) => {
      expectArity('Fill', args, 2);
      const ch = asString(args[0]);
      const n = Math.max(0, Math.floor(asNumber(args[1], 'Fill', 1)));
      return ch.repeat(n);
    },
  },
  {
    // IF(c, a, b) — ternary form of If. Returns `a` when c≠0, else `b`.
    name: 'IF',
    invoke: (args) => {
      expectArity('IF', args, 3);
      const cond = asNumber(args[0], 'IF', 0);
      return cond !== 0 ? args[1] : args[2];
    },
  },
  {
    // CubeDimensionCountGet(cube) → number of dims in cube (0 if unknown).
    name: 'CubeDimensionCountGet',
    invoke: (args, fx) => {
      expectArity('CubeDimensionCountGet', args, 1);
      return fx?.cubeDims.get(asString(args[0]))?.length ?? 0;
    },
  },
  {
    // ElementCount(dim) — alias of DIMSIZ. TM1 exposes both names.
    name: 'ElementCount',
    invoke: (args, fx) => {
      expectArity('ElementCount', args, 1);
      return fx?.dimensions.get(asString(args[0]))?.length ?? 0;
    },
  },
  {
    // ElementComponentCount(dim, elem) — number of children. Simulator has
    // no parent/child graph fixture yet, so report 0 (leaf-equivalent).
    name: 'ElementComponentCount',
    invoke: (args) => {
      expectArity('ElementComponentCount', args, 2);
      return 0;
    },
  },
  {
    name: 'DIMIX',
    invoke: (args, fx) => {
      expectArity('DIMIX', args, 2);
      return findDimElementIndex(fx, asString(args[0]), asString(args[1]));
    },
  },
  {
    name: 'DIMNM',
    invoke: (args, fx) => {
      expectArity('DIMNM', args, 2);
      const elems = fx?.dimensions.get(asString(args[0]));
      if (!elems) return '';
      const i = Math.floor(asNumber(args[1], 'DIMNM', 1)) - 1;
      return elems[i]?.name ?? '';
    },
  },
  {
    name: 'DIMSIZ',
    invoke: (args, fx) => {
      expectArity('DIMSIZ', args, 1);
      return fx?.dimensions.get(asString(args[0]))?.length ?? 0;
    },
  },
  {
    name: 'ELLEV',
    invoke: (args, fx) => {
      expectArity('ELLEV', args, 2);
      const elems = fx?.dimensions.get(asString(args[0]));
      if (!elems) return 0;
      const lower = asString(args[1]).toLowerCase();
      const found = elems.find((e) => e.name.toLowerCase() === lower);
      return found?.level ?? 0;
    },
  },
  {
    name: 'DimensionElementPrincipalName',
    invoke: (args, fx) => {
      expectArity('DimensionElementPrincipalName', args, 2);
      const elem = asString(args[1]);
      const elems = fx?.dimensions.get(asString(args[0]));
      if (!elems) return elem;
      const lower = elem.toLowerCase();
      const found = elems.find((e) => e.name.toLowerCase() === lower);
      return found?.name ?? elem;
    },
  },
  {
    name: 'ElIsAnc',
    invoke: (args, fx) => {
      expectArity('ElIsAnc', args, 3);
      if (!fx) return 0;
      const elems = fx.dimensions.get(asString(args[0]));
      if (!elems) return 0;
      const anc = asString(args[1]).toLowerCase();
      const desc = asString(args[2]).toLowerCase();
      if (anc === desc) return 0;
      const byName = new Map<string, DimElement>();
      for (const e of elems) byName.set(e.name.toLowerCase(), e);
      const start = byName.get(anc);
      if (!start || !start.children || start.children.length === 0) return 0;
      const seen = new Set<string>();
      const stack = [...start.children.map((c) => c.toLowerCase())];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        if (cur === desc) return 1;
        const node = byName.get(cur);
        if (node?.children) for (const c of node.children) stack.push(c.toLowerCase());
      }
      return 0;
    },
  },
  {
    name: 'DTYPE',
    invoke: (args, fx) => {
      expectArity('DTYPE', args, 2);
      const elems = fx?.dimensions.get(asString(args[0]));
      if (!elems) return '';
      const lower = asString(args[1]).toLowerCase();
      const found = elems.find((e) => e.name.toLowerCase() === lower);
      return found ? (found.level > 0 ? 'C' : 'N') : '';
    },
  },
];

// ── Section 4 — Dimension creation / mutation ─────────────────────────
export const DIM_MUT_BUILTINS: Builtin[] = [
  {
    name: 'DimensionExists',
    invoke: (args, fx) => {
      expectArity('DimensionExists', args, 1);
      if (!fx) return 0;
      return fx.dimensions.has(asString(args[0])) ? 1 : 0;
    },
  },
  {
    name: 'DimensionCreate',
    invoke: (args, fx) => {
      expectArity('DimensionCreate', args, 1);
      if (!fx) return 0;
      const name = asString(args[0]);
      if (!fx.dimensions.has(name)) fx.dimensions.set(name, []);
      return 1;
    },
  },
  {
    name: 'DimensionDestroy',
    invoke: (args, fx) => {
      expectArity('DimensionDestroy', args, 1);
      if (!fx) return 0;
      fx.dimensions.delete(asString(args[0]));
      return 1;
    },
  },
  {
    name: 'DimensionElementInsert',
    invoke: (args, fx) => {
      expectArity('DimensionElementInsert', args, 4);
      if (!fx) return 0;
      const dim = asString(args[0]);
      const after = asString(args[1]);
      const elem = asString(args[2]);
      const type = asString(args[3]).toUpperCase();
      const arr = fx.dimensions.get(dim) ?? [];
      const newElem = { name: elem, level: type === 'C' ? 1 : 0 };
      if (after === '') {
        arr.push(newElem);
      } else {
        const idx = arr.findIndex((e) => e.name.toLowerCase() === after.toLowerCase());
        if (idx >= 0) arr.splice(idx + 1, 0, newElem);
        else arr.push(newElem);
      }
      fx.dimensions.set(dim, arr);
      return 1;
    },
  },
  {
    // DimensionElementInsertDirect — same semantics as DimensionElementInsert
    // but bypasses input-validation on the live server. For the simulator the
    // two are indistinguishable.
    name: 'DimensionElementInsertDirect',
    invoke: (args, fx) => {
      expectArity('DimensionElementInsertDirect', args, 4);
      if (!fx) return 0;
      const dim = asString(args[0]);
      const after = asString(args[1]);
      const elem = asString(args[2]);
      const type = asString(args[3]).toUpperCase();
      const arr = fx.dimensions.get(dim) ?? [];
      const newElem = { name: elem, level: type === 'C' ? 1 : 0 };
      if (after === '') arr.push(newElem);
      else {
        const idx = arr.findIndex((e) => e.name.toLowerCase() === after.toLowerCase());
        if (idx >= 0) arr.splice(idx + 1, 0, newElem);
        else arr.push(newElem);
      }
      fx.dimensions.set(dim, arr);
      return 1;
    },
  },
  {
    name: 'DimensionElementDelete',
    invoke: (args, fx) => {
      expectArity('DimensionElementDelete', args, 2);
      if (!fx) return 0;
      const arr = fx.dimensions.get(asString(args[0]));
      if (!arr) return 0;
      const lower = asString(args[1]).toLowerCase();
      const idx = arr.findIndex((e) => e.name.toLowerCase() === lower);
      if (idx >= 0) arr.splice(idx, 1);
      return 1;
    },
  },
  {
    name: 'DimensionElementComponentAdd',
    invoke: (args, fx) => {
      expectArity('DimensionElementComponentAdd', args, 4);
      if (!fx) return 0;
      const arr = fx.dimensions.get(asString(args[0]));
      if (!arr) return 0;
      const parent = arr.find((e) => e.name.toLowerCase() === asString(args[1]).toLowerCase());
      if (parent && parent.level === 0) parent.level = 1;
      // Weight + child stored implicitly — sim only tracks element list+level.
      return 1;
    },
  },
  {
    name: 'HierarchyElementInsert',
    invoke: (args, fx) => {
      expectArity('HierarchyElementInsert', args, 5);
      if (!fx) return 0;
      // First arg is dim, second is hierarchy — we treat single-hierarchy
      // dimensions only (matches Phase γ scope).
      const dim = asString(args[0]);
      const after = asString(args[2]);
      const elem = asString(args[3]);
      const type = asString(args[4]).toUpperCase();
      const arr = fx.dimensions.get(dim) ?? [];
      const newElem = { name: elem, level: type === 'C' ? 1 : 0 };
      if (after === '') arr.push(newElem);
      else {
        const idx = arr.findIndex((e) => e.name.toLowerCase() === after.toLowerCase());
        if (idx >= 0) arr.splice(idx + 1, 0, newElem);
        else arr.push(newElem);
      }
      fx.dimensions.set(dim, arr);
      return 1;
    },
  },
];

// ── Section 11 — Hierarchy lifecycle (sim is single-hierarchy → no-op) ─
export const HIER_LIFECYCLE_BUILTINS: Builtin[] = [
  noopVoid('HierarchyCreate', 2),
  noopVoid('HierarchyDestroy', 2),
  noopVoid('DimensionHierarchyCreate', 2),
];

// ── Section 12 — Hierarchy read queries (single-hierarchy: backed by dim element list) ─
export const HIER_QUERY_BUILTINS: Builtin[] = [
  {
    name: 'HierarchyExists',
    invoke: (args, fx) => {
      expectArity('HierarchyExists', args, 2);
      if (!fx) return 0;
      // Sim is single-hierarchy: a hierarchy "exists" iff the dim does.
      return fx.dimensions.has(asString(args[0])) ? 1 : 0;
    },
  },
  {
    name: 'HierarchyElementExists',
    invoke: (args, fx) => {
      expectArity('HierarchyElementExists', args, 3);
      if (!fx) return 0;
      const arr = fx.dimensions.get(asString(args[0]));
      if (!arr) return 0;
      const lower = asString(args[2]).toLowerCase();
      return arr.some((e) => e.name.toLowerCase() === lower) ? 1 : 0;
    },
  },
  {
    name: 'HierarchyElementCount',
    invoke: (args, fx) => {
      expectArity('HierarchyElementCount', args, 2);
      if (!fx) return 0;
      return fx.dimensions.get(asString(args[0]))?.length ?? 0;
    },
  },
  {
    name: 'HierarchyName',
    invoke: (args, fx) => {
      expectArity('HierarchyName', args, 2);
      if (!fx) return '';
      const dim = asString(args[0]);
      // Single-hierarchy sim: index 1 → dim name; otherwise empty.
      const idx = Math.floor(asNumber(args[1], 'HierarchyName', 1));
      return idx === 1 && fx.dimensions.has(dim) ? dim : '';
    },
  },
  {
    // HierarchyDeleteElements(dim, hier, elem1, ...elemN) — variadic.
    name: 'HierarchyDeleteElements',
    invoke: (args, fx) => {
      if (args.length < 3) {
        throw new Error(`HierarchyDeleteElements: expected >=3 args, got ${args.length}`);
      }
      if (!fx) return 0;
      const arr = fx.dimensions.get(asString(args[0]));
      if (!arr) return 0;
      const targets = new Set(args.slice(2).map((v) => asString(v).toLowerCase()));
      for (let i = arr.length - 1; i >= 0; i--) {
        if (targets.has(arr[i].name.toLowerCase())) arr.splice(i, 1);
      }
      return 1;
    },
  },
];

// ── Section 13 — Element extras (component-delete, top-element, legacy aliases) ─
export const ELEM_EXTRAS_BUILTINS: Builtin[] = [
  {
    name: 'DimensionElementComponentDelete',
    invoke: (args, fx) => {
      expectArity('DimensionElementComponentDelete', args, 3);
      // Sim doesn't track parent-child edges (only element list+level).
      // No-op suffices for compatibility.
      void args;
      void fx;
      return 1;
    },
  },
  noopVoid('HierarchyElementComponentAdd', 5),
  noopVoid('HierarchyElementComponentDelete', 4),
  {
    name: 'HierarchyElementDelete',
    invoke: (args, fx) => {
      expectArity('HierarchyElementDelete', args, 3);
      if (!fx) return 0;
      const arr = fx.dimensions.get(asString(args[0]));
      if (!arr) return 0;
      const lower = asString(args[2]).toLowerCase();
      const idx = arr.findIndex((e) => e.name.toLowerCase() === lower);
      if (idx >= 0) arr.splice(idx, 1);
      return 1;
    },
  },
  {
    name: 'HierarchyDeleteAllElements',
    invoke: (args, fx) => {
      expectArity('HierarchyDeleteAllElements', args, 2);
      if (!fx) return 0;
      fx.dimensions.set(asString(args[0]), []);
      return 1;
    },
  },
  {
    name: 'DimensionTopElementInsert',
    invoke: (args, fx) => {
      // (dim, elem, type) — root insert (no parent, no insertAfter).
      expectArity('DimensionTopElementInsert', args, 3);
      if (!fx) return 0;
      const dim = asString(args[0]);
      const elem = asString(args[1]);
      const type = asString(args[2]).toUpperCase();
      const arr = fx.dimensions.get(dim) ?? [];
      arr.push({ name: elem, level: type === 'C' ? 1 : 0 });
      fx.dimensions.set(dim, arr);
      return 1;
    },
  },
  {
    name: 'HierarchyTopElementInsert',
    invoke: (args, fx) => {
      // (dim, hier, pos[num], elem) — root insert in named hierarchy.
      expectArity('HierarchyTopElementInsert', args, 4);
      if (!fx) return 0;
      const dim = asString(args[0]);
      const elem = asString(args[3]);
      const arr = fx.dimensions.get(dim) ?? [];
      arr.push({ name: elem, level: 0 });
      fx.dimensions.set(dim, arr);
      return 1;
    },
  },
  {
    // ElementInsert(dim, hier, parent, elem, weight) — legacy alias of
    // HierarchyElementInsert; weight ignored by sim.
    name: 'ElementInsert',
    invoke: (args, fx) => {
      expectArity('ElementInsert', args, 5);
      if (!fx) return 0;
      const dim = asString(args[0]);
      const elem = asString(args[3]);
      const arr = fx.dimensions.get(dim) ?? [];
      arr.push({ name: elem, level: 0 });
      fx.dimensions.set(dim, arr);
      return 1;
    },
  },
  {
    // ElementDelete: 2-arg (dim, elem) or 3-arg (dim, hier, elem).
    name: 'ElementDelete',
    invoke: (args, fx) => {
      expectArity('ElementDelete', args, 2, 3);
      if (!fx) return 0;
      const dim = asString(args[0]);
      const elem = args.length >= 3 ? asString(args[2]) : asString(args[1]);
      const arr = fx.dimensions.get(dim);
      if (!arr) return 0;
      const lower = elem.toLowerCase();
      const idx = arr.findIndex((e) => e.name.toLowerCase() === lower);
      if (idx >= 0) arr.splice(idx, 1);
      return 1;
    },
  },
];

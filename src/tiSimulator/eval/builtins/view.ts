/**
 * View built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Three named arrays kept in source-line order:
 *  - VIEW_INFRA_STUBS_BUILTINS (section 6a, L683-690)  — early noopVoid stubs.
 *  - VIEW_REGISTRY_BUILTINS    (section 15, L1103-1178) — full create/delete/mdx.
 *  - VIEW_AXIS_BUILTINS        (section 16, L1179-1282) — axis/title/extract setters.
 *
 * Section-6a stubs for ViewExtractSkip* / ViewStructUpdate are overridden by
 * the full versions in VIEW_AXIS_BUILTINS (last-wins registry).
 */

import { viewKey } from '../../types';
import {
  type Builtin,
  asNumber,
  asString,
  expectArity,
  noopVoid,
} from './_helpers';

// ── Section 6a — View infrastructure stubs (defs-only, no live iteration) ─
export const VIEW_INFRA_STUBS_BUILTINS: Builtin[] = [
  noopVoid('ViewSubsetAssign', 4),
  noopVoid('ViewExtractSkipCalcsSet', 3),
  noopVoid('ViewExtractSkipConsolidatedValuesSet', 3),
  noopVoid('ViewExtractSkipConsolidatedStringsSet', 3),
  noopVoid('ViewExtractSkipRuleValuesSet', 3),
  noopVoid('ViewExtractSkipZeroesSet', 3),
  noopVoid('ViewStructUpdate', 2),
];

// ── Section 15 — View registry (Phase D minimal: cube/view/mdx/suppressZeroes) ─
export const VIEW_REGISTRY_BUILTINS: Builtin[] = [
  {
    name: 'ViewCreate',
    invoke: (args, fx) => {
      // Third arg = Private flag (bedrock.cube.view.create passes pTemp).
      expectArity('ViewCreate', args, 2, 3);
      if (!fx) return 1;
      const cube = asString(args[0]);
      const view = asString(args[1]);
      fx.views.set(viewKey(cube, view), { cube, view });
      return 1;
    },
  },
  {
    name: 'ViewExists',
    invoke: (args, fx) => {
      expectArity('ViewExists', args, 2);
      if (!fx) return 0;
      return fx.views.has(viewKey(asString(args[0]), asString(args[1]))) ? 1 : 0;
    },
  },
  {
    name: 'ViewDelete',
    invoke: (args, fx) => {
      expectArity('ViewDelete', args, 2);
      if (!fx) return 1;
      fx.views.delete(viewKey(asString(args[0]), asString(args[1])));
      return 1;
    },
  },
  {
    name: 'ViewDestroy',
    invoke: (args, fx) => {
      expectArity('ViewDestroy', args, 2);
      if (!fx) return 1;
      fx.views.delete(viewKey(asString(args[0]), asString(args[1])));
      return 1;
    },
  },
  noopVoid('ViewZeroOut', 2),
  {
    name: 'ViewMDXSet',
    invoke: (args, fx) => {
      expectArity('ViewMDXSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.mdx = asString(args[2]);
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewSuppressZeroesSet',
    invoke: (args, fx) => {
      expectArity('ViewSuppressZeroesSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.suppressZeroes = asNumber(args[2], 'ViewSuppressZeroesSet', 2) !== 0;
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewZeroSuppressionSet',
    invoke: (args, fx) => {
      expectArity('ViewZeroSuppressionSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.suppressZeroes = asNumber(args[2], 'ViewZeroSuppressionSet', 2) !== 0;
      fx.views.set(k, v);
      return 1;
    },
  },
];

// ── Section 16 — View axis setters (state-tracking) ────────────────────
export const VIEW_AXIS_BUILTINS: Builtin[] = [
  {
    name: 'ViewRowDimensionSet',
    invoke: (args, fx) => {
      expectArity('ViewRowDimensionSet', args, 4);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.rowDims = v.rowDims ?? new Map();
      v.rowDims.set(Math.floor(asNumber(args[3], 'ViewRowDimensionSet', 3)), asString(args[2]));
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewColumnDimensionSet',
    invoke: (args, fx) => {
      expectArity('ViewColumnDimensionSet', args, 4);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.columnDims = v.columnDims ?? new Map();
      v.columnDims.set(Math.floor(asNumber(args[3], 'ViewColumnDimensionSet', 3)), asString(args[2]));
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewTitleDimensionSet',
    invoke: (args, fx) => {
      expectArity('ViewTitleDimensionSet', args, 4);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.titleDims = v.titleDims ?? new Map();
      v.titleDims.set(Math.floor(asNumber(args[3], 'ViewTitleDimensionSet', 3)), asString(args[2]));
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewTitleElementSet',
    invoke: (args, fx) => {
      expectArity('ViewTitleElementSet', args, 4);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.titleElems = v.titleElems ?? new Map();
      v.titleElems.set(asString(args[2]), asString(args[3]));
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewExtractSkipCalcsSet',
    invoke: (args, fx) => {
      expectArity('ViewExtractSkipCalcsSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.extractSkipCalcs = asNumber(args[2], 'ViewExtractSkipCalcsSet', 2) !== 0;
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewExtractSkipConsolidatedValuesSet',
    invoke: (args, fx) => {
      expectArity('ViewExtractSkipConsolidatedValuesSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.extractSkipConsolidatedValues =
        asNumber(args[2], 'ViewExtractSkipConsolidatedValuesSet', 2) !== 0;
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewExtractSkipRuleValuesSet',
    invoke: (args, fx) => {
      expectArity('ViewExtractSkipRuleValuesSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.extractSkipRuleValues = asNumber(args[2], 'ViewExtractSkipRuleValuesSet', 2) !== 0;
      fx.views.set(k, v);
      return 1;
    },
  },
  {
    name: 'ViewExtractSkipZeroesSet',
    invoke: (args, fx) => {
      expectArity('ViewExtractSkipZeroesSet', args, 3);
      if (!fx) return 1;
      const k = viewKey(asString(args[0]), asString(args[1]));
      const v = fx.views.get(k) ?? { cube: asString(args[0]), view: asString(args[1]) };
      v.extractSkipZeroes = asNumber(args[2], 'ViewExtractSkipZeroesSet', 2) !== 0;
      fx.views.set(k, v);
      return 1;
    },
  },
  // ViewStructUpdate is a server-side recompute trigger; no observable state.
  noopVoid('ViewStructUpdate', 2),
];

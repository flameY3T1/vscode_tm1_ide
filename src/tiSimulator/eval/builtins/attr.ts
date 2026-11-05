/**
 * Element / object attribute built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Three named arrays kept in source-line order:
 *  - ATTR_BASE_BUILTINS  (section 7,  L768-887) — Element/AttrPut/Get + Insert/Delete.
 *  - ATTR_ALIAS_BUILTINS (section 9,  L895-915) — legacy + Element-prefix aliases.
 *  - OBJ_ATTR_BUILTINS   (section 10, L916-931) — control-cube attr schema mutations.
 */

import { attrKey } from '../../types';
import {
  type Builtin,
  asNumber,
  asString,
  expectArity,
  noopVoid,
} from './_helpers';

// ── Section 7 — Element attributes ────────────────────────────────────
export const ATTR_BASE_BUILTINS: Builtin[] = [
  // Hierarchy as the THIRD parameter (after value and dimension) and mandatory:
  // `ElementAttrPutS(v,'Dim','Elem','Attr')` does not compile on TM1 11.8 (live,
  // via compile probe 2026-08-12). Five to seven arguments are valid — the
  // two trailing slots are locale and security flag respectively. The
  // simulator's attribute store knows no hierarchies, so the slot is
  // checked but not evaluated.
  {
    name: 'ElementAttrPutN',
    invoke: (args, fx) => {
      expectArity('ElementAttrPutN', args, 5, 7);
      if (!fx) return 0;
      const v = asNumber(args[0], 'ElementAttrPutN', 0);
      fx.attributes.set(attrKey(asString(args[1]), asString(args[3]), asString(args[4])), v);
      return 1;
    },
  },
  {
    name: 'ElementAttrPutS',
    invoke: (args, fx) => {
      expectArity('ElementAttrPutS', args, 5, 7);
      if (!fx) return 0;
      fx.attributes.set(
        attrKey(asString(args[1]), asString(args[3]), asString(args[4])),
        asString(args[0]),
      );
      return 1;
    },
  },
  {
    name: 'ElementAttrGetN',
    invoke: (args, fx) => {
      expectArity('ElementAttrGetN', args, 3);
      if (!fx) return 0;
      const v = fx.attributes.get(
        attrKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (v === undefined) return 0;
      return typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  {
    name: 'ElementAttrGetS',
    invoke: (args, fx) => {
      expectArity('ElementAttrGetS', args, 3);
      if (!fx) return '';
      const v = fx.attributes.get(
        attrKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (v === undefined) return '';
      return typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'AttrPutN',
    invoke: (args, fx) => {
      expectArity('AttrPutN', args, 4);
      if (!fx) return 0;
      const v = asNumber(args[0], 'AttrPutN', 0);
      fx.attributes.set(attrKey(asString(args[1]), asString(args[2]), asString(args[3])), v);
      return 1;
    },
  },
  {
    name: 'AttrPutS',
    invoke: (args, fx) => {
      expectArity('AttrPutS', args, 4);
      if (!fx) return 0;
      fx.attributes.set(
        attrKey(asString(args[1]), asString(args[2]), asString(args[3])),
        asString(args[0]),
      );
      return 1;
    },
  },
  {
    name: 'AttrGetN',
    invoke: (args, fx) => {
      expectArity('AttrGetN', args, 3);
      if (!fx) return 0;
      const v = fx.attributes.get(
        attrKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (v === undefined) return 0;
      return typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  {
    name: 'AttrGetS',
    invoke: (args, fx) => {
      expectArity('AttrGetS', args, 3);
      if (!fx) return '';
      const v = fx.attributes.get(
        attrKey(asString(args[0]), asString(args[1]), asString(args[2])),
      );
      if (v === undefined) return '';
      return typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'AttrInsert',
    invoke: (args, fx) => {
      // Sim only stores attribute values, not schema. AttrInsert is no-op +
      // returns 1 for compatibility with TI processes that pre-declare attrs.
      void args;
      void fx;
      return 1;
    },
  },
  {
    name: 'AttrDelete',
    invoke: (args, fx) => {
      // Drop every stored value for (dim, *, attr).
      expectArity('AttrDelete', args, 2);
      if (!fx) return 1;
      const dimLower = asString(args[0]).toLowerCase();
      const attrLower = asString(args[1]).toLowerCase();
      for (const key of [...fx.attributes.keys()]) {
        const parts = key.split('\t');
        if (parts[0] === dimLower && parts[2] === attrLower) {
          fx.attributes.delete(key);
        }
      }
      return 1;
    },
  },
];

// ── Section 9 — Aliases of AttrInsert / AttrDelete (legacy + Element-prefix variants) ─
export const ATTR_ALIAS_BUILTINS: Builtin[] = [
  // Both with a hierarchy slot (measured live 2026-08-12): Insert exactly 5
  // (Dim, Hier, PreviousAttribute, Attribute, Type), Delete exactly 3
  // (Dim, Hier, Attribute). The forms without a hierarchy do not compile.
  noopVoid('ElementAttrInsert', 5),
  noopVoid('ElementAttrDelete', 3),
  noopVoid('AttributeCreate', 3),
  noopVoid('AttributeDelete', 2),
  {
    // AttributePut(value, dim, elem, attr) — legacy alias of AttrPutS/N.
    // Treat numeric or string the same as AttrPutS (simulator stores both).
    name: 'AttributePut',
    invoke: (args, fx) => {
      expectArity('AttributePut', args, 4);
      if (!fx) return 1;
      const v = args[0];
      const dim = asString(args[1]);
      const elem = asString(args[2]);
      const attr = asString(args[3]);
      fx.attributes.set(attrKey(dim, elem, attr), v);
      return 1;
    },
  },
];

// ── Section 10 — Object-type attribute-schema mutations (control cubes) ─
//   Applies to }CubeAttributes / }DimensionAttributes / etc.
//   Sim does not model control-object schema → no-op.
export const OBJ_ATTR_BUILTINS: Builtin[] = [
  noopVoid('CubeAttrInsert', 3),
  noopVoid('CubeAttrDelete', 1),
  noopVoid('DimensionAttrInsert', 3),
  noopVoid('DimensionAttrDelete', 1),
  noopVoid('ChoreAttrInsert', 3),
  noopVoid('ChoreAttrDelete', 1),
  noopVoid('ViewAttrInsert', 3),
  noopVoid('ViewAttrDelete', 1),
  noopVoid('SubsetAttrInsert', 3),
  noopVoid('SubsetAttrDelete', 1),
  noopVoid('HierarchySubsetAttrInsert', 5),
  noopVoid('HierarchySubsetAttrDelete', 4),
];

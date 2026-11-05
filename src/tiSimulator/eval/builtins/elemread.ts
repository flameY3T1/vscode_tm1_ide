import { attrKey, subsetKey, type DimElement } from '../../types';
import { type Builtin, expectArity, asString, asNumber, noopVoid } from './_helpers';

/**
 * Element / dimension READ builtins (Batch ④). All resolve against `fixtures`:
 * `dimensions` (element list with level + direct children) and `attributes`.
 * The modern hier-aware forms take an optional HierarchyName as the 2nd arg — the
 * element/index is always the LAST arg, so we read it positionally and ignore the
 * hierarchy (fixtures hold a single default hierarchy). Legacy `EL*`/`ATTR*` names
 * are the same semantics without the hierarchy slot.
 */

const lc = (s: string) => s.toLowerCase();
type Elems = DimElement[] | undefined;

function findElem(elems: Elems, name: string): DimElement | undefined {
  const l = lc(name);
  return elems?.find((e) => lc(e.name) === l);
}
/** Elements listing `child` among their direct components (reverse edge). */
function parentsOf(elems: DimElement[], child: string): DimElement[] {
  const l = lc(child);
  return elems.filter((e) => (e.children ?? []).some((c) => lc(c) === l));
}
/** BFS: is `anc` a (transitive) ancestor of `desc`? */
function isAncestor(elems: DimElement[], anc: string, desc: string): boolean {
  const byName = new Map<string, DimElement>();
  for (const e of elems) byName.set(lc(e.name), e);
  const start = byName.get(lc(anc));
  if (!start?.children?.length) return false;
  const target = lc(desc);
  const seen = new Set<string>();
  const stack = start.children.map(lc);
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === target) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const node = byName.get(cur);
    if (node?.children) stack.push(...node.children.map(lc));
  }
  return false;
}

export const ELEM_READ_BUILTINS: Builtin[] = [
  // ── Modern hier-aware forms (HierarchyName optional; element/index is last) ──
  {
    name: 'ElementIndex',
    invoke: (a, fx) => {
      expectArity('ElementIndex', a, 2, 3);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return 0;
      const l = lc(asString(a[a.length - 1]));
      const i = elems.findIndex((e) => lc(e.name) === l);
      return i < 0 ? 0 : i + 1;
    },
  },
  {
    name: 'ElementName',
    invoke: (a, fx) => {
      expectArity('ElementName', a, 2, 3);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return '';
      const idx = Math.trunc(asNumber(a[a.length - 1], 'ElementName', a.length));
      return idx >= 1 && idx <= elems.length ? elems[idx - 1].name : '';
    },
  },
  {
    name: 'ElementType',
    invoke: (a, fx) => {
      expectArity('ElementType', a, 2, 3);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[a.length - 1]));
      return e ? (e.level > 0 ? 'C' : 'N') : '';
    },
  },
  {
    name: 'ElementLevel',
    invoke: (a, fx) => {
      expectArity('ElementLevel', a, 2, 3);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[a.length - 1]));
      return e?.level ?? 0;
    },
  },
  {
    name: 'ElementComponent',
    invoke: (a, fx) => {
      expectArity('ElementComponent', a, 3, 4);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[a.length - 2]));
      const idx = Math.trunc(asNumber(a[a.length - 1], 'ElementComponent', a.length));
      const ch = e?.children ?? [];
      return idx >= 1 && idx <= ch.length ? ch[idx - 1] : '';
    },
  },
  {
    // Overrides the earlier stub (which returned 0) — count direct components.
    name: 'ElementComponentCount',
    invoke: (a, fx) => {
      expectArity('ElementComponentCount', a, 2, 3);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[a.length - 1]));
      return e?.children?.length ?? 0;
    },
  },
  {
    name: 'ElementIsAncestor',
    invoke: (a, fx) => {
      expectArity('ElementIsAncestor', a, 4, 4);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return 0;
      return isAncestor(elems, asString(a[2]), asString(a[3])) ? 1 : 0;
    },
  },
  {
    name: 'ElementParent',
    invoke: (a, fx) => {
      expectArity('ElementParent', a, 3, 4);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return '';
      const ps = parentsOf(elems, asString(a[a.length - 2]));
      const idx = Math.trunc(asNumber(a[a.length - 1], 'ElementParent', a.length));
      return idx >= 1 && idx <= ps.length ? ps[idx - 1].name : '';
    },
  },
  {
    name: 'ElementParentCount',
    invoke: (a, fx) => {
      expectArity('ElementParentCount', a, 2, 3);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return 0;
      return parentsOf(elems, asString(a[a.length - 1])).length;
    },
  },
  {
    // Fixtures carry no edge weights → 1 for a real component, else 0.
    name: 'ElementWeight',
    invoke: (a, fx) => {
      expectArity('ElementWeight', a, 3, 4);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[a.length - 2]));
      const child = lc(asString(a[a.length - 1]));
      return (e?.children ?? []).some((c) => lc(c) === child) ? 1 : 0;
    },
  },
  // `ElementAttr*` carry the hierarchy as the SECOND parameter, and as a
  // mandatory one: `ElementAttrS('Dim','Elem','Attr')` is not a valid call
  // on TM1 11.8 but a compile error ("Unerwartete Klammer",
  // measured live via compile probe 2026-08-12; the IBM docs say the same:
  // `ElementAttrS(dimension, hierarchy, element, attribute)`). The three-argument
  // form is called `ATTRS`/`ATTRN` and appears further below.
  //
  // The simulator's attribute store knows no hierarchies — the slot is
  // checked but not evaluated.
  {
    name: 'ElementAttrS',
    invoke: (a, fx) => {
      expectArity('ElementAttrS', a, 4);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[2]), asString(a[3])));
      return v === undefined ? '' : typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'ElementAttrN',
    invoke: (a, fx) => {
      expectArity('ElementAttrN', a, 4);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[2]), asString(a[3])));
      return v === undefined ? 0 : typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  // ── Legacy EL* / ATTR* forms (no hierarchy slot) ──
  {
    name: 'ELCOMP',
    invoke: (a, fx) => {
      expectArity('ELCOMP', a, 3);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[1]));
      const idx = Math.trunc(asNumber(a[2], 'ELCOMP', 3));
      const ch = e?.children ?? [];
      return idx >= 1 && idx <= ch.length ? ch[idx - 1] : '';
    },
  },
  {
    name: 'ELCOMPN',
    invoke: (a, fx) => {
      expectArity('ELCOMPN', a, 2);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[1]));
      return e?.children?.length ?? 0;
    },
  },
  {
    name: 'ELPAR',
    invoke: (a, fx) => {
      expectArity('ELPAR', a, 3);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return '';
      const ps = parentsOf(elems, asString(a[1]));
      const idx = Math.trunc(asNumber(a[2], 'ELPAR', 3));
      return idx >= 1 && idx <= ps.length ? ps[idx - 1].name : '';
    },
  },
  {
    name: 'ELPARN',
    invoke: (a, fx) => {
      expectArity('ELPARN', a, 2);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return 0;
      return parentsOf(elems, asString(a[1])).length;
    },
  },
  {
    name: 'ELWEIGHT',
    invoke: (a, fx) => {
      expectArity('ELWEIGHT', a, 3);
      const e = findElem(fx?.dimensions.get(asString(a[0])), asString(a[1]));
      const child = lc(asString(a[2]));
      return (e?.children ?? []).some((c) => lc(c) === child) ? 1 : 0;
    },
  },
  // ELISANC is already provided by the existing `ElIsAnc` builtin (same lowercase
  // key) — not re-declared here to avoid overriding it with a different arg order.
  {
    // ELISPAR(dim, element, parent) → is `parent` a direct parent of `element`?
    name: 'ELISPAR',
    invoke: (a, fx) => {
      expectArity('ELISPAR', a, 3);
      const p = findElem(fx?.dimensions.get(asString(a[0])), asString(a[2]));
      const el = lc(asString(a[1]));
      return (p?.children ?? []).some((c) => lc(c) === el) ? 1 : 0;
    },
  },
  {
    name: 'DNLEV',
    invoke: (a, fx) => {
      expectArity('DNLEV', a, 1);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems || elems.length === 0) return 0;
      return Math.max(...elems.map((e) => e.level)) + 1;
    },
  },
  {
    name: 'ATTRS',
    invoke: (a, fx) => {
      expectArity('ATTRS', a, 3);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[1]), asString(a[2])));
      return v === undefined ? '' : typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'ATTRN',
    invoke: (a, fx) => {
      expectArity('ATTRN', a, 3);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[1]), asString(a[2])));
      return v === undefined ? 0 : typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  {
    name: 'DimensionElementExists',
    invoke: (a, fx) => {
      expectArity('DimensionElementExists', a, 2);
      return findElem(fx?.dimensions.get(asString(a[0])), asString(a[1])) ? 1 : 0;
    },
  },
  // ── Subset reads (Batch ⑤; non-hier forms — Hierarchy* variants already exist) ──
  {
    name: 'SubsetElementGetIndex',
    invoke: (a, fx) => {
      expectArity('SubsetElementGetIndex', a, 3);
      const arr = fx?.subsets.get(subsetKey(asString(a[0]), asString(a[1])));
      if (!arr) return 0;
      const l = lc(asString(a[2]));
      const i = arr.findIndex((e) => lc(e) === l);
      return i >= 0 ? i + 1 : 0;
    },
  },
  {
    name: 'SubsetElementExists',
    invoke: (a, fx) => {
      expectArity('SubsetElementExists', a, 3);
      const arr = fx?.subsets.get(subsetKey(asString(a[0]), asString(a[1])));
      if (!arr) return 0;
      const l = lc(asString(a[2]));
      return arr.some((e) => lc(e) === l) ? 1 : 0;
    },
  },
  {
    name: 'SubsetMDXGet',
    invoke: (a, fx) => {
      expectArity('SubsetMDXGet', a, 2);
      return fx?.subsetProps.get(subsetKey(asString(a[0]), '', asString(a[1])))?.mdx ?? '';
    },
  },
  {
    // No cell-iteration in the simulator — return the view name as an opaque
    // handle so `hView = ReturnViewHandle(cube, view)` gets a usable value.
    name: 'ReturnViewHandle',
    invoke: (a) => {
      expectArity('ReturnViewHandle', a, 2);
      return asString(a[1]);
    },
  },
  // ── Attribute reads with locale (locale ignored) + dimension/hierarchy attrs ──
  {
    name: 'AttrSL',
    invoke: (a, fx) => {
      expectArity('AttrSL', a, 3, 4);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[1]), asString(a[2])));
      return v === undefined ? '' : typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'AttrNL',
    invoke: (a, fx) => {
      expectArity('AttrNL', a, 3, 4);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[1]), asString(a[2])));
      return v === undefined ? 0 : typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  // Like `ElementAttrS/N`: hierarchy in the second slot, mandatory. The locale is
  // the optional fifth (live: 4 and 5 arguments compile, 3 and 6 do not).
  {
    name: 'ElementAttrSL',
    invoke: (a, fx) => {
      expectArity('ElementAttrSL', a, 4, 5);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[2]), asString(a[3])));
      return v === undefined ? '' : typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'ElementAttrNL',
    invoke: (a, fx) => {
      expectArity('ElementAttrNL', a, 4, 5);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[2]), asString(a[3])));
      return v === undefined ? 0 : typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  {
    // Dimension-level attribute (no element) — keyed with an empty element slot.
    name: 'DimensionAttrS',
    invoke: (a, fx) => {
      expectArity('DimensionAttrS', a, 2);
      const v = fx?.attributes.get(attrKey(asString(a[0]), '', asString(a[1])));
      return v === undefined ? '' : typeof v === 'string' ? v : String(v);
    },
  },
  {
    name: 'DimensionAttrN',
    invoke: (a, fx) => {
      expectArity('DimensionAttrN', a, 2);
      const v = fx?.attributes.get(attrKey(asString(a[0]), '', asString(a[1])));
      return v === undefined ? 0 : typeof v === 'number' ? v : Number(v) || 0;
    },
  },
  {
    // ElementIsComponent(dim, hier, parent, child) → is `child` a DIRECT component
    // of `parent`? (contrast ElementIsAncestor which is transitive).
    name: 'ElementIsComponent',
    invoke: (a, fx) => {
      expectArity('ElementIsComponent', a, 4);
      const p = findElem(fx?.dimensions.get(asString(a[0])), asString(a[2]));
      const child = lc(asString(a[3]));
      return (p?.children ?? []).some((c) => lc(c) === child) ? 1 : 0;
    },
  },
  {
    // Hier-aware principal (canonical) name — resolves case to the stored element.
    name: 'HierarchyElementPrincipalName',
    invoke: (a, fx) => {
      expectArity('HierarchyElementPrincipalName', a, 3);
      const elem = asString(a[2]);
      const found = findElem(fx?.dimensions.get(asString(a[0])), elem);
      return found?.name ?? elem;
    },
  },
  // ── Batch ⑧ common reads (fixture-backed, certain semantics) ──────────────
  {
    // LevelCount(dim) — number of hierarchy levels (= DNLEV; max leaf-to-top).
    name: 'LevelCount',
    invoke: (a, fx) => {
      expectArity('LevelCount', a, 1);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems || elems.length === 0) return 0;
      return Math.max(...elems.map((e) => e.level)) + 1;
    },
  },
  {
    // ElementFirst(dim, hier) — name of the first element in storage order, '' if none.
    name: 'ElementFirst',
    invoke: (a, fx) => {
      expectArity('ElementFirst', a, 2);
      return fx?.dimensions.get(asString(a[0]))?.[0]?.name ?? '';
    },
  },
  {
    // ElementNext(dim, hier, elem) — name of the element after `elem` in storage
    // order; '' if `elem` is last or absent.
    name: 'ElementNext',
    invoke: (a, fx) => {
      expectArity('ElementNext', a, 3);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return '';
      const l = lc(asString(a[2]));
      const i = elems.findIndex((e) => lc(e.name) === l);
      return i >= 0 && i + 1 < elems.length ? elems[i + 1].name : '';
    },
  },
  {
    // DNEXT(dim, elem) — legacy (default-hierarchy) form of ElementNext.
    name: 'DNEXT',
    invoke: (a, fx) => {
      expectArity('DNEXT', a, 2);
      const elems = fx?.dimensions.get(asString(a[0]));
      if (!elems) return '';
      const l = lc(asString(a[1]));
      const i = elems.findIndex((e) => lc(e.name) === l);
      return i >= 0 && i + 1 < elems.length ? elems[i + 1].name : '';
    },
  },
  {
    // AttributeGet(dim, element, attr) — element attribute value as string
    // (alias of ATTRS / ElementAttrS).
    name: 'AttributeGet',
    invoke: (a, fx) => {
      expectArity('AttributeGet', a, 3);
      const v = fx?.attributes.get(attrKey(asString(a[0]), asString(a[1]), asString(a[2])));
      return v === undefined ? '' : typeof v === 'string' ? v : String(v);
    },
  },
  // ── Security / sort ops (writes — no-op so processes using them run) ──
  noopVoid('ElementSecurityPut', 4),
  noopVoid('DimensionSortOrder', 5),
];

import type { DimDraftState, ElementType } from './model';

export function buildElements(state: DimDraftState): Array<{ name: string; type: ElementType }> {
  const out: Array<{ name: string; type: ElementType }> = [];
  for (const el of state.elements.values()) {
    if (el.marked === 'deleted') continue;
    out.push({ name: el.name, type: el.type });
  }
  return out;
}

export function buildEdges(state: DimDraftState): Array<{ parent: string; child: string; weight: number }> {
  // Group children by parent in a single pass (Map, first-seen parent order).
  // Avoids the O(edges × parents) blow-up of `parentOrder.includes` +
  // per-parent `live.filter` — on a 171k-element / 295k-edge dimension that
  // quadratic version cost minutes; this is linear.
  const parentOrder: string[] = [];
  const byParent = new Map<string, typeof state.edges>();
  for (const e of state.edges) {
    if (e.marked === 'deleted') continue;
    let kids = byParent.get(e.parent);
    if (!kids) { kids = []; byParent.set(e.parent, kids); parentOrder.push(e.parent); }
    kids.push(e);
  }
  const out: Array<{ parent: string; child: string; weight: number }> = [];
  for (const p of parentOrder) {
    const kids = byParent.get(p)!.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const k of kids) out.push({ parent: k.parent, child: k.child, weight: k.weight });
  }
  return out;
}

/**
 * Numeric attribute values go out as a JSON number: TM1 parses a string in the
 * server locale ("15.5" became 155 on a German server, measured for
 * `tm1.Update`, see `DimensionApi.setAttr`). Unparseable input stays a string.
 */
export function attrWireValue(state: DimDraftState, attr: string, value: string): string | number {
  const def = state.attrDefs.find((d) => d.name === attr);
  if (def?.type !== 'Numeric' || value.trim() === '') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

export function collectAttrValues(state: DimDraftState, hier: string): Array<{ hier: string; element: string; attr: string; value: string | number }> {
  // Only collect values for REAL attribute definitions. TM1 exposes an implicit
  // `Caption` (and possibly other synthetic entries) in every element's Attributes
  // map — those are not ElementAttribute definitions and have no cell in the
  // `}ElementAttributes_<dim>` cube. Worse, a dimension with zero attribute defs
  // has no attribute cube at all, so writing any value would target a non-existent
  // cube (ExecuteMDX → 400/501). Restricting to defined attrs makes a no-attr dim
  // yield [] → the caller's writeAttrValues no-ops.
  const defined = new Set(
    state.attrDefs.filter((d) => d.marked !== 'deleted').map((d) => d.name),
  );
  const out: Array<{ hier: string; element: string; attr: string; value: string | number }> = [];
  for (const el of state.elements.values()) {
    if (el.marked === 'deleted') continue;
    for (const [attr, value] of Object.entries(el.attrs)) {
      if (defined.has(attr) && value !== '') out.push({ hier, element: el.name, attr, value: attrWireValue(state, attr, value) });
    }
  }
  return out;
}

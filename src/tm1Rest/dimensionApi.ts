// src/tm1Rest/dimensionApi.ts
import { apiRequest, assertOk as assertOkClient } from './client';
import type { Tm1Config } from './transport/types';
import type {
  DimSnapshot, HierarchySnapshot, ElementDraft, EdgeDraft, AttrDef, ElementType, AttrDefType,
} from '../dimensionEditor/model';
import { parseBody, parseBodySafe, odataErrorMessage, type ODataValueEnvelope } from './parseRest';
import type { ODataError } from './odataTypes';
import { escapeODataKey, escapeMdx } from '../utils/odataKey';
import { isOk } from './httpError';

export type ApiResponse = { statusCode: number; body: string };

/** Minimal signature of `apiRequest` so we can inject stubs for tests. */
export type ApiFetch = (
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  config?: Tm1Config,
) => Promise<ApiResponse>;

// ─── OData row shapes (TM1 REST responses) ──────────────────────────────────
// Narrow row interfaces for the `value` arrays in OData responses. Used
// to type the `.map` callbacks instead of `(x: any) => …`. Optional fields
// reflect $select projections that may omit them.

interface DimensionRow { Name: string }
interface DimensionWithHierarchiesRow { Name: string; Hierarchies: Array<{ Name: string }> }
interface HierarchyRow { Name: string }
interface ElementAttributeRow { Name: string; Type?: string }
interface ElementRow {
  Name: string;
  Type?: string;
  Attributes?: Record<string, unknown>;
}
interface EdgeRow { ParentName: string; ComponentName: string; Weight?: number }

/** OData key escape: doubles single-quotes. */
function q(s: string): string {
  return escapeODataKey(s);
}

/** URL-safe + OData-escaped dim/hier path segment. */
function encKey(s: string): string {
  return encodeURIComponent(q(s));
}

const TM1_TYPE_BY_CODE: Record<ElementType, string> = {
  N: 'Numeric', C: 'Consolidated', S: 'String',
};
const CODE_BY_TM1_TYPE: Record<string, ElementType> = {
  Numeric: 'N', Consolidated: 'C', String: 'S',
};

function assertOk(res: ApiResponse, op: string): void {
  if (!isOk(res)) {
    let msg = `${op} failed (${res.statusCode})`;
    try {
      const m = odataErrorMessage(JSON.parse(res.body) as ODataError);
      if (m) msg += `: ${m}`;
    } catch { /* body not json */ }
    throw new Error(msg);
  }
}

export interface DimensionApiOptions {
  dimName: string;
  config: Tm1Config;
}

export class DimensionApi {
  constructor(private _fetch: ApiFetch, private opts: DimensionApiOptions) {}

  async createElement(hier: string, name: string, type: ElementType): Promise<void> {
    const res = await this._fetch(
      'POST',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Elements`,
      { Name: name, Type: TM1_TYPE_BY_CODE[type] },
      undefined,
      this.opts.config,
    );
    assertOk(res, `createElement('${name}')`);
  }

  async createElements(hier: string, els: Array<{ name: string; type: ElementType }>): Promise<void> {
    if (els.length === 0) return;
    const res = await this._fetch(
      'POST',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Elements`,
      els.map((e) => ({ Name: e.name, Type: TM1_TYPE_BY_CODE[e.type] })),
      undefined,
      this.opts.config,
    );
    assertOk(res, `createElements(${els.length})`);
  }

  /**
   * Changes the type of an existing element IN-PLACE via PATCH.
   * Lossless: the element's identity is preserved -> edges and attribute values remain.
   * No delete+create -- a failure leaves the element untouched instead of destroying it.
   */
  async changeElementType(hier: string, name: string, type: ElementType): Promise<void> {
    const res = await this._fetch(
      'PATCH',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Elements('${encKey(name)}')`,
      { Type: TM1_TYPE_BY_CODE[type] },
      undefined,
      this.opts.config,
    );
    assertOk(res, `changeElementType('${name}' → ${type})`);
  }

  async deleteElement(hier: string, name: string): Promise<void> {
    const res = await this._fetch(
      'DELETE',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Elements('${encKey(name)}')`,
      undefined,
      undefined,
      this.opts.config,
    );
    assertOk(res, `deleteElement('${name}')`);
  }

  async addEdge(hier: string, parent: string, child: string, weight: number): Promise<void> {
    const res = await this._fetch(
      'POST',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Edges`,
      { ParentName: parent, ComponentName: child, Weight: weight },
      undefined,
      this.opts.config,
    );
    assertOk(res, `addEdge(${parent}→${child})`);
  }

  async addEdges(hier: string, edges: Array<{ parent: string; child: string; weight: number }>): Promise<void> {
    if (edges.length === 0) return;
    const res = await this._fetch(
      'POST',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Edges`,
      edges.map((e) => ({ ParentName: e.parent, ComponentName: e.child, Weight: e.weight })),
      undefined,
      this.opts.config,
    );
    assertOk(res, `addEdges(${edges.length})`);
  }

  /**
   * Rewrites the element index order by PATCHing the hierarchy with its full
   * element and edge lists (measured 11.8, 2026-09-30: index follows the list;
   * edges, types, attribute values and cube data survive). The PATCH REPLACES:
   * Elements alone dropped every edge, and an element missing from the list
   * would go too — so the server's element set is checked first.
   */
  async reorderElements(
    hier: string,
    elements: Array<{ name: string; type: ElementType }>,
    edges: Array<{ parent: string; child: string; weight: number }>,
  ): Promise<void> {
    const path = `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')`;
    const cur = await this._fetch('GET', `${path}/Elements?$select=Name`, undefined, undefined, this.opts.config);
    assertOk(cur, 'reorderElements: fetch elements');
    const wanted = new Set(elements.map(e => e.name.toLowerCase()));
    const unknown = (parseBody<ODataValueEnvelope<{ Name: string }>>(cur).value ?? [])
      .map(e => e.Name).filter(n => !wanted.has(n.toLowerCase()));
    if (unknown.length) {
      throw new Error(`the server has elements this editor does not know (${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ', …' : ''}) — reload and try again`);
    }
    const res = await this._fetch('PATCH', path, {
      Elements: elements.map(e => ({ Name: e.name, Type: TM1_TYPE_BY_CODE[e.type] })),
      Edges: edges.map(e => ({ ParentName: e.parent, ComponentName: e.child, Weight: e.weight })),
    }, undefined, this.opts.config);
    assertOk(res, 'reorderElements');
  }

  async deleteEdge(hier: string, parent: string, child: string): Promise<void> {
    const res = await this._fetch(
      'DELETE',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Edges(ParentName='${encKey(parent)}',ComponentName='${encKey(child)}')`,
      undefined,
      undefined,
      this.opts.config,
    );
    assertOk(res, `deleteEdge(${parent}→${child})`);
  }

  /**
   * Changes the weight of an existing edge in place. Measured on 11.8
   * (2026-10-01): PATCH on the edge key with `{Weight}` returns 200 and keeps
   * the edge at its position among the parent's children, so no
   * delete-and-add (which would move it to the end). Same on v12 (2026-10-01).
   */
  async setEdgeWeight(hier: string, parent: string, child: string, weight: number): Promise<void> {
    const res = await this._fetch(
      'PATCH',
      `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Edges(ParentName='${encKey(parent)}',ComponentName='${encKey(child)}')`,
      { Weight: weight },
      undefined,
      this.opts.config,
    );
    assertOk(res, `setEdgeWeight(${parent}→${child})`);
  }

  async setAttr(hier: string, elem: string, attr: string, value: string | number): Promise<void> {
    const attrCube = `}ElementAttributes_${this.opts.dimName}`;
    // Measured 2026-08-12 against 11.8 (German server locale) on the same
    // `tm1.Update` endpoint as cubeWriteApi: a string value gets parsed
    // server-side using the locale ("15.5" -> 155). Numeric attribute values
    // land in exactly this cell cube, so the same rule applies: a number
    // stays a number, everything else (text/alias attributes) stays a string.
    const wireValue = typeof value === 'number' && Number.isFinite(value) ? value : String(value);
    const res = await this._fetch(
      'POST',
      `Cubes('${encKey(attrCube)}')/tm1.Update`,
      {
        Cells: [{
          'Tuple@odata.bind': [
            `Dimensions('${encKey(this.opts.dimName)}')/Hierarchies('${encKey(hier)}')/Elements('${encKey(String(elem))}')`,
            `Dimensions('${encKey(attrCube)}')/Hierarchies('${encKey(attrCube)}')/Elements('${encKey(String(attr))}')`,
          ],
        }],
        Value: wireValue,
      },
      undefined,
      this.opts.config,
    );
    assertOk(res, `setAttr('${elem}'.${attr})`);
  }

  async createDimensionFull(
    dim: string,
    hier: string,
    els: Array<{ name: string; type: ElementType }>,
    edges: Array<{ parent: string; child: string; weight: number }>,
  ): Promise<void> {
    const res = await this._fetch(
      'POST',
      'Dimensions',
      {
        Name: dim,
        Hierarchies: [{
          Name: hier,
          Elements: els.map((e) => ({ Name: e.name, Type: TM1_TYPE_BY_CODE[e.type] })),
          Edges: edges.map((e) => ({ ParentName: e.parent, ComponentName: e.child, Weight: e.weight })),
        }],
      },
      undefined,
      this.opts.config,
    );
    assertOk(res, `createDimensionFull('${dim}')`);
  }

  /**
   * `hier` is the hierarchy the element was edited in. The attribute cube is
   * addressed as `[dim].[hier].[element]`: a consolidation that exists only in
   * an alternate hierarchy is not a member of `[dim].[dim]`, and a dimension
   * whose same-name hierarchy was removed has no `[dim].[dim]` at all. Same
   * class of bug as the element/edge routes fixed on 2026-08-14 — the attribute
   * route was left out then.
   */
  async writeAttrValues(
    values: Array<{ hier?: string; element: string; attr: string; value: string | number }>,
  ): Promise<void> {
    if (values.length === 0) return;
    const dim = this.opts.dimName;
    const ac = `}ElementAttributes_${dim}`;
    const rowRef = (v: { hier?: string; element: string }): string =>
      `[${escapeMdx(dim)}].[${escapeMdx(v.hier ?? dim)}].[${escapeMdx(v.element)}]`;
    // distinct rows / attrs, stable first-seen order
    const rowRefs: string[] = [];
    const attrs: string[] = [];
    for (const v of values) {
      const ref = rowRef(v);
      if (!rowRefs.includes(ref)) rowRefs.push(ref);
      if (!attrs.includes(v.attr)) attrs.push(v.attr);
    }
    const cols = attrs.map((a) => `[${escapeMdx(ac)}].[${escapeMdx(ac)}].[${escapeMdx(a)}]`).join(',');
    const mdx = `SELECT {${cols}} ON COLUMNS, {${rowRefs.join(',')}} ON ROWS FROM [${escapeMdx(ac)}]`;
    const csRes = await this._fetch('POST', 'ExecuteMDX', { MDX: mdx }, undefined, this.opts.config);
    assertOk(csRes, 'writeAttrValues ExecuteMDX');
    const id = parseBody<{ ID: string }>(csRes).ID;
    try {
      const cells = values.map((v) => ({
        Ordinal: rowRefs.indexOf(rowRef(v)) * attrs.length + attrs.indexOf(v.attr),
        Value: v.value,
      }));
      const pRes = await this._fetch(
        'PATCH', `Cellsets('${encKey(id)}')/Cells`, cells, undefined, this.opts.config,
      );
      assertOk(pRes, 'writeAttrValues PATCH Cells');
    } finally {
      await this._fetch('DELETE', `Cellsets('${encKey(id)}')`, undefined, undefined, this.opts.config)
        .catch(() => { /* orphaned cellset is not fatal */ });
    }
  }

  async createHierarchy(dim: string, hierName: string): Promise<void> {
    const res = await this._fetch(
      'POST',
      `Dimensions('${encKey(dim)}')/Hierarchies`,
      { Name: hierName },
      undefined,
      this.opts.config,
    );
    assertOk(res, `createHierarchy('${hierName}')`);
  }

  async deleteHierarchy(dim: string, hierName: string): Promise<void> {
    const res = await this._fetch(
      'DELETE',
      `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hierName)}')`,
      undefined,
      undefined,
      this.opts.config,
    );
    assertOk(res, `deleteHierarchy('${hierName}')`);
  }

  /** `hier` defaults to the same-name hierarchy; pass the edited one — it may not exist. */
  async createAttrDef(dim: string, name: string, type: AttrDefType, hier: string = dim): Promise<void> {
    const res = await this._fetch(
      'POST',
      `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/ElementAttributes`,
      { Name: name, Type: type },
      undefined,
      this.opts.config,
    );
    assertOk(res, `createAttrDef('${name}')`);
  }

  async deleteAttrDef(dim: string, name: string, hier: string = dim): Promise<void> {
    const res = await this._fetch(
      'DELETE',
      `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/ElementAttributes('${encKey(name)}')`,
      undefined,
      undefined,
      this.opts.config,
    );
    assertOk(res, `deleteAttrDef('${name}')`);
  }

  /** Loads only the list of hierarchy names (without content). */
  async fetchHierarchyList(dim: string): Promise<string[]> {
    const hierRes = await this._fetch(
      'GET',
      `Dimensions('${encKey(dim)}')/Hierarchies?$select=Name`,
      undefined, undefined, this.opts.config,
    );
    assertOk(hierRes, 'fetch hierarchies');
    const parsed = parseBody<ODataValueEnvelope<HierarchyRow>>(hierRes);
    return (parsed.value ?? []).map((h) => h.Name);
  }

  /** Loads the content (elements + edges + attribute definitions) of exactly one hierarchy. */
  async fetchHierarchyContent(dim: string, hier: string): Promise<HierarchySnapshot> {
    const [elemRes, edgeRes, attrRes] = await Promise.all([
      this._fetch('GET',
        `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/Elements?$select=Name,Type,Attributes`,
        undefined, undefined, this.opts.config),
      this._fetch('GET',
        `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/Edges?$select=ParentName,ComponentName,Weight`,
        undefined, undefined, this.opts.config),
      this._fetch('GET',
        `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/ElementAttributes?$select=Name,Type`,
        undefined, undefined, this.opts.config),
    ]);
    assertOk(elemRes, `fetch elements (${hier})`);
    assertOk(edgeRes, `fetch edges (${hier})`);
    assertOk(attrRes, `fetch attrDefs (${hier})`);

    const elemParsed = parseBody<ODataValueEnvelope<ElementRow>>(elemRes);
    const edgeParsed = parseBody<ODataValueEnvelope<EdgeRow>>(edgeRes);
    const attrParsed = parseBody<ODataValueEnvelope<ElementAttributeRow>>(attrRes);

    const elements: ElementDraft[] = (elemParsed.value ?? []).map((e, index) => ({
      name: e.Name,
      // TM1 lists elements in index order.
      index,
      type: (CODE_BY_TM1_TYPE[e.Type ?? ''] ?? 'N') as ElementType,
      attrs: (e.Attributes ?? {}) as Record<string, string>,
      marked: 'clean' as const,
    }));
    // TM1 returns Edges flat, in storage order (parent, then component order
    // within each parent). Capture each child's per-parent index as `order` so
    // the editor can render + preserve component order.
    const _orderByParent = new Map<string, number>();
    const edges: EdgeDraft[] = (edgeParsed.value ?? []).map((ed) => {
      const parent = ed.ParentName;
      const order = _orderByParent.get(parent) ?? 0;
      _orderByParent.set(parent, order + 1);
      return {
        parent,
        child: ed.ComponentName,
        weight: Number(ed.Weight ?? 1),
        marked: 'clean' as const,
        order,
      };
    });
    const attrDefs: AttrDef[] = (attrParsed.value ?? []).map((a) => ({
      name: a.Name,
      type: (a.Type ?? 'String') as AttrDefType,
      marked: 'clean' as const,
    }));
    return { elements, edges, attrDefs };
  }

  /**
   * Loads a complete or partial snapshot.
   * @param hierFilter when set, only the named hierarchies are loaded
   *   (a memory optimization for large dimensions with many hierarchies).
   */
  async fetchSnapshot(dim: string, hierFilter?: string[]): Promise<DimSnapshot> {
    const hierarchies = await this.fetchHierarchyList(dim);
    const targetHiers = hierFilter
      ? hierarchies.filter(h => hierFilter.includes(h))
      : hierarchies;

    const perHier: Record<string, HierarchySnapshot> = {};
    await Promise.all(targetHiers.map(async (hier) => {
      perHier[hier] = await this.fetchHierarchyContent(dim, hier);
    }));

    return { dimName: dim, hierarchies, perHier };
  }
}

// ---------------------------------------------------------------------------
// Functional helpers (call-site replacements for raw apiRequest)
// ---------------------------------------------------------------------------

/** GET /Dimensions?$select=Name — returns dimension names. */
export async function listDimensionNames(cfg: Tm1Config, timeoutMs?: number): Promise<string[]> {
  const res = await apiRequest('GET', 'Dimensions?$select=Name', undefined, timeoutMs, cfg);
  // Throw, not []: an empty list hid auth/server errors as "no dimensions".
  assertOkClient(res);
  const parsed = parseBodySafe<ODataValueEnvelope<DimensionRow>>(res, {});
  return (parsed.value ?? []).map((d) => d.Name);
}

/** GET /Dimensions?$select=Name,Hierarchies — returns dim+hier rows. */
export async function listDimensionsWithHierarchies(
  cfg: Tm1Config, timeoutMs?: number,
): Promise<DimensionWithHierarchiesRow[]> {
  const res = await apiRequest('GET', 'Dimensions?$select=Name,Hierarchies', undefined, timeoutMs, cfg);
  if (!isOk(res)) { return []; }
  const parsed = parseBodySafe<ODataValueEnvelope<DimensionWithHierarchiesRow>>(res, {});
  return parsed.value ?? [];
}

/** GET /Dimensions('X')/Hierarchies?$select=Name — returns hierarchy names. */
export async function listHierarchyNames(
  cfg: Tm1Config, dim: string, timeoutMs?: number,
): Promise<string[]> {
  const res = await apiRequest('GET', `Dimensions('${encKey(dim)}')/Hierarchies?$select=Name`, undefined, timeoutMs, cfg);
  // Throw, not []: an empty list hid auth/server errors as "no dimensions".
  assertOkClient(res);
  const parsed = parseBodySafe<ODataValueEnvelope<HierarchyRow>>(res, {});
  return (parsed.value ?? []).map((h) => h.Name);
}

/** GET .../ElementAttributes — full Name+Type rows. */
export async function listElementAttributes(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<ElementAttributeRow[]> {
  const res = await apiRequest(
    'GET', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/ElementAttributes`,
    undefined, timeoutMs, cfg,
  );
  if (!isOk(res)) { return []; }
  const parsed = parseBodySafe<ODataValueEnvelope<ElementAttributeRow>>(res, {});
  return parsed.value ?? [];
}

/** GET .../ElementAttributes?$select=Name — attribute names only. */
export async function listElementAttributeNames(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<string[]> {
  const res = await apiRequest(
    'GET', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/ElementAttributes?$select=Name`,
    undefined, timeoutMs, cfg,
  );
  if (!isOk(res)) { return []; }
  const parsed = parseBodySafe<ODataValueEnvelope<ElementAttributeRow>>(res, {});
  return (parsed.value ?? []).map((a) => a.Name);
}

/** GET .../Elements?$select=Name — element names. `top` optional. */
export async function listElementNames(
  cfg: Tm1Config, dim: string, hier: string = dim,
  opts?: { top?: number; timeoutMs?: number },
): Promise<string[]> {
  const top = opts?.top !== undefined ? `&$top=${opts.top}` : '';
  const res = await apiRequest(
    'GET', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/Elements?$select=Name${top}`,
    undefined, opts?.timeoutMs, cfg,
  );
  if (!isOk(res)) { return []; }
  const parsed = parseBodySafe<ODataValueEnvelope<ElementRow>>(res, {});
  return (parsed.value ?? []).map((e) => e.Name);
}

/**
 * Every element name of a hierarchy, and the leaves among them (numeric and
 * string, orphans included) — one read for both. Throws on a failed read.
 */
export async function listElementNamesAndLeaves(
  cfg: Tm1Config, dim: string, hier: string = dim,
): Promise<{ names: string[]; leaves: string[] }> {
  const res = await apiRequest(
    'GET', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/Elements?$select=Name,Type`,
    undefined, undefined, cfg,
  );
  assertOk(res, `listElementNamesAndLeaves(${dim}:${hier})`);
  const rows = parseBody<ODataValueEnvelope<ElementRow>>(res).value ?? [];
  return { names: rows.map(e => e.Name), leaves: rows.filter(e => e.Type !== 'Consolidated').map(e => e.Name) };
}

/** DimensionApi takes an object body; apiRequest wants a string and another argument order. */
export const apiFetch: ApiFetch = async (method, path, body, extraHeaders, config) => {
  if (!config) { throw new Error('DimensionApi: config is required'); }
  const bodyStr = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  return apiRequest(method, path, bodyStr, undefined, config, extraHeaders);
};

/** GET .../Edges?$select=ParentName,ComponentName — returns parent/child pairs. */
export async function listEdges(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<Array<Pick<EdgeRow, 'ParentName' | 'ComponentName'>>> {
  const res = await apiRequest(
    'GET', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/Edges?$select=ParentName,ComponentName`,
    undefined, timeoutMs, cfg,
  );
  if (!isOk(res)) { return []; }
  const parsed = parseBodySafe<ODataValueEnvelope<Pick<EdgeRow, 'ParentName' | 'ComponentName'>>>(res, {});
  return parsed.value ?? [];
}

/**
 * GET .../Edges with weights. Strict on purpose: unlike `listEdges`, a failed
 * read throws instead of returning [] — an empty edge list would look like
 * "every element is missing" to the consolidation compare.
 */
export async function listWeightedEdges(
  cfg: Tm1Config, dim: string, hier: string = dim, timeoutMs?: number,
): Promise<Array<{ parent: string; child: string; weight: number }>> {
  const res = await apiRequest(
    'GET', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')/Edges?$select=ParentName,ComponentName,Weight`,
    undefined, timeoutMs, cfg,
  );
  assertOk(res, `listWeightedEdges(${dim}:${hier})`);
  return (parseBody<ODataValueEnvelope<EdgeRow>>(res).value ?? [])
    .map((e) => ({ parent: e.ParentName, child: e.ComponentName, weight: e.Weight ?? 1 }));
}

/** POST /Dimensions — create dimension. Body is the full payload (already JSON-stringified or object). */
export async function createDimension(
  cfg: Tm1Config, body: string | Record<string, any>, errorMsg?: string,
): Promise<void> {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest('POST', 'Dimensions', bodyStr, undefined, cfg);
  assertOkClient(res, errorMsg);
}

/** DELETE /Dimensions('X'). */
export async function deleteDimension(
  cfg: Tm1Config, name: string, errorMsg?: string,
): Promise<void> {
  const res = await apiRequest('DELETE', `Dimensions('${encKey(name)}')`, undefined, undefined, cfg);
  assertOkClient(res, errorMsg);
}

/**
 * POST /Dimensions('<dim>')/Hierarchies with `{ Name }`.
 *
 * A free function alongside the identically named `DimensionApi` method: the
 * class needs an injected fetch and serves the editor commit path; for a
 * tree command that would just be unnecessary scaffolding.
 */
export async function createHierarchy(
  cfg: Tm1Config, dim: string, hier: string, errorMsg?: string,
): Promise<void> {
  const res = await apiRequest(
    'POST', `Dimensions('${encKey(dim)}')/Hierarchies`, JSON.stringify({ Name: hier }), undefined, cfg,
  );
  assertOkClient(res, errorMsg);
}

/** DELETE /Dimensions('<dim>')/Hierarchies('<hier>'). */
export async function deleteHierarchy(
  cfg: Tm1Config, dim: string, hier: string, errorMsg?: string,
): Promise<void> {
  const res = await apiRequest(
    'DELETE', `Dimensions('${encKey(dim)}')/Hierarchies('${encKey(hier)}')`, undefined, undefined, cfg,
  );
  assertOkClient(res, errorMsg);
}

// ---------------------------------------------------------------------------
// Object Overview support (dimension list + lazy metrics)
// ---------------------------------------------------------------------------

export interface RawDimension {
  Name: string;
  Hierarchies?: { Name: string; Cardinality?: number }[];
}

/** GET /Dimensions?$expand=Hierarchies($select=Name,Cardinality) — dims with hier cardinalities (one call). */
export async function listDimensionsOverview(cfg: Tm1Config): Promise<RawDimension[]> {
  const res = await apiRequest(
    'GET', 'Dimensions?$expand=Hierarchies($select=Name,Cardinality)', undefined, undefined, cfg,
  );
  assertOkClient(res, 'listDimensionsOverview');
  const parsed = parseBody<ODataValueEnvelope<RawDimension>>(res);
  return parsed.value ?? [];
}

interface DimensionAttrNamesRow {
  Name: string;
  Hierarchies?: { Name: string; ElementAttributes?: { Name: string }[] }[];
}

/** Attribute NAMES per dimension via the default hierarchy's ElementAttributes (one call). */
export async function fetchDimensionAttributeNames(cfg: Tm1Config): Promise<Map<string, string[]>> {
  const res = await apiRequest(
    'GET',
    'Dimensions?$select=Name&$expand=Hierarchies($select=Name;$expand=ElementAttributes($select=Name))',
    undefined, undefined, cfg,
  );
  assertOkClient(res, 'fetchDimensionAttributeNames');
  const parsed = parseBody<ODataValueEnvelope<DimensionAttrNamesRow>>(res);
  const out = new Map<string, string[]>();
  for (const dim of parsed.value ?? []) {
    // TM1 default hierarchy shares its name with the dimension — prefer that
    // one over Hierarchies[0], which may be an alternate hierarchy.
    const hier = dim.Hierarchies?.find(h => h.Name === dim.Name) ?? dim.Hierarchies?.[0];
    const names = (hier?.ElementAttributes ?? []).map(a => a.Name);
    out.set(dim.Name, names);
  }
  return out;
}

interface CubeDimensionUsageRow {
  Name: string;
  Dimensions?: { Name: string }[];
}

/** Names of the cubes that use each dimension. One Cubes call, expanded to Dimensions. */
export async function fetchDimensionCubeNames(cfg: Tm1Config): Promise<Map<string, string[]>> {
  const res = await apiRequest(
    'GET', 'Cubes?$select=Name&$expand=Dimensions($select=Name)', undefined, undefined, cfg,
  );
  assertOkClient(res, 'fetchDimensionCubeNames');
  const parsed = parseBody<ODataValueEnvelope<CubeDimensionUsageRow>>(res);
  const out = new Map<string, string[]>();
  for (const cube of parsed.value ?? []) {
    for (const dim of cube.Dimensions ?? []) {
      const arr = out.get(dim.Name) ?? [];
      arr.push(cube.Name);
      out.set(dim.Name, arr);
    }
  }
  return out;
}

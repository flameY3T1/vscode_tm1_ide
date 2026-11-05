/**
 * Read and write the element attribute `Format` with its prefix.
 *
 * Read through the attribute cube, not through `Elements?$select=Attributes`:
 * REST strips any one-letter prefix there (measured 11.8, 2026-09-27), and the
 * prefix decides whether TM1 applies the format at all.
 *
 * `hier` defaults to the dimension name. Attributes are per dimension (one
 * `}ElementAttributes_<dim>` cube), but an element must be addressed through a
 * hierarchy that holds it: a consolidation of an alternate hierarchy is no
 * member of `[dim].[dim]`, and a dimension whose same-named hierarchy was
 * deleted has no `[dim].[dim]` at all.
 */
import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { parseBody } from './parseRest';
import { encodeODataKey, escapeMdx } from '../utils/odataKey';
import { listElementAttributes } from './dimensionApi';

export const FORMAT_ATTR = 'Format';

const attrCube = (dim: string) => `}ElementAttributes_${dim}`;

/** Name of the dimension's default hierarchy — not always the dimension's own name. */
export async function defaultHierarchyName(cfg: Tm1Config, dim: string): Promise<string> {
  const res = await apiRequest('GET', `Dimensions('${encodeODataKey(dim)}')/DefaultHierarchy?$select=Name`, undefined, 15000, cfg);
  assertOk(res, 'Read default hierarchy');
  return parseBody<{ Name?: string }>(res).Name || dim;
}

export async function hasFormatAttribute(cfg: Tm1Config, dim: string, hier: string = dim): Promise<boolean> {
  return (await listElementAttributes(cfg, dim, hier)).some((a) => a.Name.toLowerCase() === FORMAT_ATTR.toLowerCase());
}

/** Raw stored value per element (prefix included); elements without a value are left out. */
export async function readElementFormats(
  cfg: Tm1Config, dim: string, elements: string[], hier: string = dim,
): Promise<Record<string, string>> {
  if (!elements.length || !(await hasFormatAttribute(cfg, dim, hier))) { return {}; }
  const ac = attrCube(dim);
  const d = escapeMdx(dim);
  const h = escapeMdx(hier);
  const a = escapeMdx(ac);
  const mdx = `SELECT {[${a}].[${a}].[${escapeMdx(FORMAT_ATTR)}]} ON 0, `
    + `{${elements.map((e) => `[${d}].[${h}].[${escapeMdx(e)}]`).join(',')}} ON 1 FROM [${a}]`;
  const res = await apiRequest('POST', 'ExecuteMDX?$expand=Cells($select=Ordinal,Value)', JSON.stringify({ MDX: mdx }), undefined, cfg);
  assertOk(res, 'readElementFormats');
  const body = parseBody<{ ID?: string; Cells?: Array<{ Ordinal: number; Value: unknown }> }>(res);
  if (body.ID) {
    void apiRequest('DELETE', `Cellsets('${encodeODataKey(body.ID)}')`, undefined, 10000, cfg).catch(() => { /* best effort */ });
  }
  const out: Record<string, string> = {};
  for (const c of body.Cells ?? []) {
    if (typeof c.Value === 'string' && c.Value) { out[elements[c.Ordinal]] = c.Value; }
  }
  return out;
}

/**
 * Write `values[element] = raw` (prefix included; empty string clears).
 * Creates the `Format` attribute (String) first when the dimension has none.
 */
export async function writeElementFormats(
  cfg: Tm1Config, dim: string, values: Record<string, string>, hier: string = dim,
): Promise<{ createdAttribute: boolean }> {
  let createdAttribute = false;
  if (!(await hasFormatAttribute(cfg, dim, hier))) {
    const res = await apiRequest(
      'POST', `Dimensions('${encodeODataKey(dim)}')/Hierarchies('${encodeODataKey(hier)}')/ElementAttributes`,
      JSON.stringify({ Name: FORMAT_ATTR, Type: 'String' }), undefined, cfg,
    );
    assertOk(res, 'create Format attribute');
    createdAttribute = true;
  }
  const ac = attrCube(dim);
  const cells = Object.entries(values).map(([el, raw]) => ({
    Cells: [{
      'Tuple@odata.bind': [
        `Dimensions('${encodeODataKey(dim)}')/Hierarchies('${encodeODataKey(hier)}')/Elements('${encodeODataKey(el)}')`,
        `Dimensions('${encodeODataKey(ac)}')/Hierarchies('${encodeODataKey(ac)}')/Elements('${encodeODataKey(FORMAT_ATTR)}')`,
      ],
    }],
    Value: raw,
  }));
  if (cells.length) {
    const res = await apiRequest('POST', `Cubes('${encodeODataKey(ac)}')/tm1.Update`, JSON.stringify(cells), undefined, cfg);
    assertOk(res, 'write Format attribute');
  }
  return { createdAttribute };
}

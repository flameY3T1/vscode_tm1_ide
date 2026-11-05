/**
 * Async builder of the CubeIndex used by the Element-Qualifier.
 *
 * Fetches the cube's dimensions in order, then the elements of each dimension,
 * and builds a reverse-index `elementName(lower) → DimName[]`. Results are
 * cached per `(cacheKey, cube)` for 5 minutes.
 */

import * as vscode from 'vscode';
import type { CubeIndex } from './qualifyElements';
import { encodeODataKey } from '../utils/odataKey';
import { normalizeElementName, attributeStringValues } from '../utils/tm1ElementName';
import { parseBodySafe } from '../tm1Rest/parseRest';
import { isOk } from '../tm1Rest/httpError';

export type ApiRequestFn = (
  method: string,
  path: string,
) => Promise<{ statusCode: number; body: string }>;

const TTL_5MIN = 5 * 60 * 1000;

interface CacheEntry { ts: number; value: CubeIndex }
const _cache = new Map<string, CacheEntry>();

function makeKey(cacheKey: string, cube: string): string {
  return `${cacheKey}|${cube.toLowerCase()}`;
}

function parseValue(res: { body: string }): { Name: string; Attributes?: unknown }[] {
  return parseBodySafe<{ value?: Array<{ Name: string; Attributes?: unknown }> }>(res, {}).value ?? [];
}

/**
 * Builds (or returns from cache) a CubeIndex for the given cube.
 *
 * @param cacheKey unique per-server identifier (e.g. server URL + user) so
 *                 indices for different servers do not collide.
 */
export async function buildCubeElementIndex(
  cube: string,
  cacheKey: string,
  api: ApiRequestFn,
): Promise<CubeIndex> {
  const key = makeKey(cacheKey, cube);
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_5MIN) { return cached.value; }

  const dimsRes = await api('GET', `Cubes('${encodeODataKey(cube)}')/Dimensions?$select=Name`);
  if (!isOk(dimsRes)) {
    throw new Error(vscode.l10n.t('Could not load dimensions for cube "{0}" (HTTP {1}).', cube, String(dimsRes.statusCode)));
  }
  const dimOrder: string[] = parseValue(dimsRes).map(d => d.Name);

  const elemsByDim = await Promise.all(dimOrder.map(async (dim) => {
    const enc = encodeODataKey(dim);
    const res = await api('GET', `Dimensions('${enc}')/Hierarchies('${enc}')/Elements?$select=Name,Attributes`);
    if (!isOk(res)) {
      return { dim, elems: [] as string[] };
    }
    // Each element contributes its Name plus every string (alias) attribute
    // value — all are valid TM1 references to the same element.
    const elems: string[] = [];
    for (const e of parseValue(res)) {
      elems.push(e.Name, ...attributeStringValues(e.Attributes));
    }
    return { dim, elems };
  }));

  const elemToDims = new Map<string, string[]>();
  for (const { dim, elems } of elemsByDim) {
    for (const elem of elems) {
      const k = normalizeElementName(elem);
      const existing = elemToDims.get(k);
      if (existing) {
        if (!existing.includes(dim)) { existing.push(dim); }
      } else {
        elemToDims.set(k, [dim]);
      }
    }
  }

  const index: CubeIndex = { cube, dimOrder, elemToDims };
  _cache.set(key, { ts: Date.now(), value: index });
  return index;
}

/** Clears the cache (test-only). */
export function _clearCacheForTest(): void {
  _cache.clear();
}

/** Invalidates a single cube entry — useful after rules edit/save. */
export function invalidateCubeIndex(cube: string, cacheKey: string): void {
  _cache.delete(makeKey(cacheKey, cube));
}

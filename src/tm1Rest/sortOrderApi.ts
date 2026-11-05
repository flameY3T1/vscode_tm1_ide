// src/tm1Rest/sortOrderApi.ts
//
// Read and set the sort order of a hierarchy (hierarchy properties +
// `HierarchySortOrder`, see `sortOrderPure.ts` for the measured behavior).
// vscode-free per rule `tm1rest-no-vscode`.
import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { executeTransientProcess } from './transientProcess';
import { parseBody } from './parseRest';
import { encodeODataKey as enc } from '../utils/odataKey';
import { SORT_PROPS, buildSetSortOrderTi, parseSortOrder } from './sortOrderPure';
import type { SortOrderState } from '../dimensionEditor/model';

export type { SortOrderState };

/** Throws when the hierarchy cannot be read. */
export async function readSortOrder(dim: string, hier: string, cfg: Tm1Config): Promise<SortOrderState> {
  const res = await apiRequest('GET',
    `Dimensions('${enc(dim)}')/Hierarchies('${enc(hier)}')?$select=${SORT_PROPS.join(',')}`, undefined, undefined, cfg);
  assertOk(res, 'read sort order');
  const h = parseBody<Record<string, unknown>>(res);
  return parseSortOrder(SORT_PROPS.map(p => h[p]));
}

/** Sets the order; the caller reloads the hierarchy anyway. */
export async function setSortOrder(
  dim: string, hier: string, s: SortOrderState, cfg: Tm1Config,
): Promise<void> {
  await executeTransientProcess(cfg, {
    name: '}VSCode_SetSortOrder',
    prolog: buildSetSortOrderTi(dim, hier, s),
  });
}

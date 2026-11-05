import { apiRequest, assertOk } from './client';
import { parseBody } from './parseRest';
import type { Tm1Config } from './transport/types';
import { attributeStringValues } from '../utils/tm1ElementName';
import { buildElementsPagePath } from './areaDbBuilderRest.pure';

export const ELEMENT_PAGE_SIZE = 50;

export interface ElementRow {
  name: string;
  aliases: string[];
}

/** Fetch one page of elements (Name + alias string values) of a dimension. */
export async function fetchElementsPage(
  config: Tm1Config,
  dim: string,
  query: string,
  skip: number,
): Promise<{ rows: ElementRow[]; hasMore: boolean }> {
  const path = buildElementsPagePath(dim, query, skip, ELEMENT_PAGE_SIZE);
  const res = await apiRequest('GET', path, undefined, undefined, config);
  assertOk(res);
  const parsed = parseBody<{ value?: Array<{ Name: string; Attributes?: unknown }> }>(res);
  const value = parsed.value ?? [];
  const rows: ElementRow[] = value.slice(0, ELEMENT_PAGE_SIZE).map((v) => ({
    name: String(v.Name),
    aliases: attributeStringValues(v.Attributes),
  }));
  return { rows, hasMore: value.length > ELEMENT_PAGE_SIZE };
}

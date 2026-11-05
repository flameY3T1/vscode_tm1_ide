/**
 * Server fetchers for datasource picker dropdowns.
 */

import { apiRequest } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getCubeViewNames, getCubeDimensionNames } from '../../tm1Rest/cubeApi';
import { listPublicSubsetNames } from '../../tm1Rest/subsetApi';
import { INTERACTIVE_CAP_MS } from '../../tm1Rest/timeouts';
import { parseBody } from '../../tm1Rest/parseRest';

export async function fetchViewNames(cubeName: string, config: Tm1Config): Promise<string[]> {
  if (!cubeName) { return []; }
  try {
    return await getCubeViewNames(config, cubeName, false, 5000);
  } catch (err) {
    console.warn('[TM1] fetchViewNames failed:', err);
    return [];
  }
}

export async function fetchSubsetNames(dimensionName: string, config: Tm1Config): Promise<string[]> {
  if (!dimensionName) { return []; }
  try {
    return await listPublicSubsetNames(config, dimensionName, dimensionName, 5000);
  } catch (err) {
    console.warn('[TM1] fetchSubsetNames failed:', err);
    return [];
  }
}

export async function fetchCubeDimensions(cubeName: string, config: Tm1Config): Promise<string[]> {
  if (!cubeName) { return []; }
  try {
    return await getCubeDimensionNames(config, cubeName, 5000);
  } catch (err) {
    console.warn('[TM1] fetchCubeDimensions failed:', err);
    return [];
  }
}

/** Lists ODBC DSNs available on the TM1 server host. Requires TM1 11.2+. */
export async function fetchOdbcDataSources(config: Tm1Config): Promise<string[]> {
  try {
    const res = await apiRequest('GET', 'SQLDataSources?$select=Name', undefined, INTERACTIVE_CAP_MS, config);
    if (res.statusCode !== 200) { return []; }
    return (parseBody<{ value?: { Name: string }[] }>(res).value ?? []).map((d: { Name: string }) => d.Name);
  } catch (err) {
    console.warn('[TM1] fetchOdbcDataSources failed:', err);
    return [];
  }
}

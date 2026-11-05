import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { withSandbox } from '../tm1Rest/sandboxTracker';
import { SPREAD_METHODS, type SpreadMethod } from './spreadMethods';
import { escapeODataKey, escapeMdx } from '../utils/odataKey';
import { memberMdxRef } from '../utils/hierKeyPure';
import { isOk } from '../tm1Rest/httpError';
import { BULK_READ_CAP_MS, SIDE_READ_CAP_MS } from '../tm1Rest/timeouts';

const odataEsc = (s: string) => escapeODataKey(s);
const mdxEsc = (s: string) => escapeMdx(s);

/** Builds the PAW-style spread value string sent in Cellset.Update's Value field.
 *  - proportional(1000) → "P1000"
 *  - repeat(200)        → "LR200"
 *  - percentage(10)     → "R%110"  (+10 %)
 *  - percentage(-10)    → "R%90"   (-10 %)
 *  - clear              → "R0"  (value ignored) */
export function buildSpreadValue(method: SpreadMethod, value: number): string {
  const meta = SPREAD_METHODS[method];
  if (!meta.needsValue) { return meta.codePrefix; }
  // `R%N` sets every leaf to N % of its value (measured 2026-11-05: `R%10` turned
  // 10/20/30 into 1/2/3), so "adjust by N %" has to send 100+N.
  if (method === 'percentage') { return meta.codePrefix + String(100 + value); }
  return meta.codePrefix + String(value);
}

/** Builds a single-cell MDX with ALL dimension members in ONE tuple on ONE axis.
 *  TM1 rejects spread operations on cellsets with 3+ axes
 *  (`CannotSpreadIntoViewMoreThanTwoAxes`), so we CROSSJOIN every dim into a
 *  single tuple and put that on axis 0.
 *
 *  Example (3-dim cube):
 *   SELECT {([D1].[D1].[E1], [D2].[D2].[E2], [D3].[D3].[E3])} ON 0 FROM [Cube] */
export function buildSpreadMdx(cubeName: string, dimensions: string[], coordinates: string[]): string {
  if (dimensions.length !== coordinates.length) {
    throw new Error(`Dimensions/Coordinates length mismatch: ${dimensions.length} vs ${coordinates.length}`);
  }
  if (dimensions.length === 0) {
    throw new Error('buildSpreadMdx requires at least one dimension');
  }
  // Three-part refs: a two-part `[dim].[el]` misses members that exist only in
  // an alternate hierarchy on 11.8 ("member not found") and is ambiguous when
  // the tuple holds two hierarchies of one dimension (measured 2026-09-28).
  const members = dimensions.map((key, i) => memberMdxRef(key, coordinates[i])).join(', ');
  return `SELECT {(${members})} ON 0 FROM [${mdxEsc(cubeName)}]`;
}

/** 3-call spread lifecycle: ExecuteMDX → Cellsets('id')/tm1.Update → DELETE Cellsets('id').
 *  Returns the tm1.Update response. DELETE runs in `finally` (best-effort).
 *  If ExecuteMDX fails, we return its response directly — no cellset to clean up. */
export async function spreadCell(
  cubeName: string,
  method: SpreadMethod,
  dimensions: string[],
  coordinates: string[],
  value: number,
  config: Tm1Config,
): Promise<{ statusCode: number; body: string }> {
  const mdx = buildSpreadMdx(cubeName, dimensions, coordinates);
  const mdxRes = await apiRequest('POST', 'ExecuteMDX', JSON.stringify({ MDX: mdx }), 30000, config, withSandbox(config));
  if (!isOk(mdxRes)) {
    return mdxRes;
  }

  let cellsetId: string;
  try {
    cellsetId = JSON.parse(mdxRes.body).ID;
    if (typeof cellsetId !== 'string' || cellsetId === '') {
      throw new Error('Cellset ID missing in ExecuteMDX response');
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { message: `Invalid ExecuteMDX response: ${(err as Error).message}` } }),
    };
  }

  const cellsetPath = `Cellsets('${odataEsc(cellsetId)}')`;
  try {
    const updateBody = JSON.stringify({ BeginOrdinal: 0, Value: buildSpreadValue(method, value) });
    return await apiRequest('POST', `${cellsetPath}/tm1.Update`, updateBody, BULK_READ_CAP_MS, config, withSandbox(config));
  } finally {
    try {
      await apiRequest('DELETE', cellsetPath, undefined, SIDE_READ_CAP_MS, config, withSandbox(config));
    } catch { /* swallow cleanup errors */ }
  }
}

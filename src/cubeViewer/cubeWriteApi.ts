import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { withSandbox } from '../tm1Rest/sandboxTracker';
import { encodeODataKey } from '../utils/odataKey';
import { hierODataPath } from '../utils/hierKeyPure';
import { isOk } from '../tm1Rest/httpError';

export interface CellEdit {
  Dimensions: string[];
  Coordinates: string[];
  Value: number | string;
}

function buildTupleRefs(dimensions: string[], coordinates: string[]): string[] {
  if (dimensions.length !== coordinates.length) {
    throw new Error(
      `Dimensions/Coordinates length mismatch: ${dimensions.length} vs ${coordinates.length}`,
    );
  }
  // encodeODataKey = quote-double + URL-encode. Names with `/` (legal in TM1) must be
  // URL-encoded or they split the @odata.bind resource path → wrong/failed cell write.
  // `dimensions` are viewer keys (`dim` or `dim:hier`): a leaf is writable
  // through any hierarchy of its dimension (measured 11.8, 2026-09-28).
  return dimensions.map((key, i) => `${hierODataPath(key)}/Elements('${encodeODataKey(coordinates[i])}')`);
}

/** Wire shape for a single-cell `Cubes('name')/tm1.Update`:
 *  `{ "Cells": [{ "Tuple@odata.bind": [...] }], "Value": <num>|"<str>" }`
 *
 *  - `Value` sits TOP-LEVEL, not inside the Cell descriptor (TM1 rejects it in the
 *    descriptor with "Invalid CellDescriptor property encountered in payload.").
 *  - Measured 2026-08-12 against 11.8 (German server locale): a STRING `Value`
 *    is parsed on the server side in the server's locale — `"15.5"` lands as `155`
 *    (`.` = thousands separator), `"1234.5"` as `12345`. A JSON NUMBER, on the
 *    other hand, is taken literally, without the locale detour. Hence: numeric values go out
 *    unchanged as a JSON number; everything else (text cells, spread tokens such as
 *    "P1000", empty string for deleting) stays a string, because it is one.
 *
 *  For batched writes, one POST is issued per edit (the endpoint takes one cell
 *  per request). Callers that need bulk should use a Cellset-based path instead. */
function toWireValue(value: number | string): number | string {
  return typeof value === 'number' && Number.isFinite(value) ? value : String(value ?? '');
}

export async function updateCells(
  cubeName: string,
  edits: CellEdit[],
  config: Tm1Config,
  /** `false` writes to the base, even when a sandbox is active. */
  useSandbox = true,
) {
  if (edits.length === 0) {
    throw new Error('updateCells called with empty edits array');
  }
  const path = `Cubes('${encodeODataKey(cubeName)}')/tm1.Update`;
  let last = undefined as any;
  for (const e of edits) {
    const body = {
      Cells: [{ 'Tuple@odata.bind': buildTupleRefs(e.Dimensions, e.Coordinates) }],
      Value: toWireValue(e.Value),
    };
    last = await apiRequest('POST', path, JSON.stringify(body), 30000, config, useSandbox ? withSandbox(config) : undefined);
    // On first failure, return immediately — don't keep pushing writes past a 4xx/5xx.
    if (!isOk(last)) return last;
  }
  return last;
}

// src/security/api/mdxCellset.ts
//
// Shared scaffolding for the five security-matrix read APIs (cube, dim,
// process, element, hierarchy). Each of them ran the identical MDX-cellset
// dance ~10× verbatim:
//
//   POST ExecuteMDX  →  201-check + OData error extraction  →  read cellset id
//   →  GET Cellsets(id)?$expand=…  →  parse+release  →  DELETE Cellsets(id) (finally)
//
// This helper owns the scaffolding and returns the raw parsed cellset (Axes +
// Cells); each caller keeps its own result-shaping (single-row vs. matrix).
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import { parseBody, odataErrorMessage } from '../../tm1Rest/parseRest';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { ODataError } from '../../tm1Rest/odataTypes';
import { encodeKey } from './_odata';
import { Tm1HttpError } from '../../tm1Rest/httpError';

/**
 * The security cube a matrix reads from does not exist on this server.
 *
 * TM1 creates `}DimensionSecurity`, `}HierarchySecurity`, `}ElementSecurity_<dim>`
 * and friends lazily — only once the first permission of that kind is assigned.
 * Querying a missing one yields a raw MDX parse error (*"Syntax error at or near
 * '[}DimensionSecurity]'"*) that says nothing about the real cause, so the read
 * APIs translate it into this typed error and the command layer turns it into a
 * sentence the user can act on.
 */
export class SecurityCubeMissingError extends Error {
  constructor(public readonly cubeName: string) {
    super(`security cube '${cubeName}' does not exist on this server`);
    this.name = 'SecurityCubeMissingError';
  }
}

/**
 * `true` if the cube exists, `false` on 404. Any other status throws — a 401 or
 * 503 must never be mistaken for "not there".
 *
 * Callers pass a RAW name (`}ElementSecurity_<dim>`, `}DimensionSecurity`), never
 * a pre-encoded literal, so the key is encoded exactly once (`}` → `%7D`, never
 * `%257D`).
 */
export async function cubeExists(cfg: Tm1Config, cubeName: string): Promise<boolean> {
  const res = await apiRequest('GET', `Cubes('${encodeKey(cubeName)}')?$select=Name`, undefined, undefined, cfg);
  if (res.statusCode === 200) return true;
  if (res.statusCode === 404) return false;
  throw new Tm1HttpError(`cubeExists[${cubeName}]: HTTP ${res.statusCode}: ${res.body}`, res.statusCode);
}

/** Raw parsed security cellset: groups on the COLUMNS axis, resources on ROWS. */
export interface SecurityCellset {
  Axes: Array<{ Ordinal: number; Tuples: Array<{ Members: Array<{ Name: string }> }> }>;
  Cells: Array<{ Ordinal: number; Value: string | null }>;
}

/** The `$expand` shared verbatim by all five security-matrix reads. */
export const SECURITY_CELLSET_EXPAND =
  '$expand=Cells($select=Ordinal,Value),Axes($expand=Tuples($expand=Members($select=Name)))';

/**
 * Execute an MDX query against a security system-cube and return the parsed
 * cellset. Owns the POST→201-check→cellsetId→GET→parse→DELETE-in-finally
 * scaffolding; `label` prefixes every thrown error (`<label>: …`) and the
 * cellset `assertOk` context (`<label> cellset`), matching the original
 * per-call-site messages exactly.
 *
 * `expand` defaults to the shared `SECURITY_CELLSET_EXPAND`; callers may pass a
 * different one. The `DELETE Cellsets(id)` cleanup always runs (best-effort),
 * even if the GET/parse throws.
 *
 * `probeCube` names the security cube the MDX reads FROM. When the query fails,
 * that cube's existence is checked and a `SecurityCubeMissingError` is thrown
 * instead of the raw MDX parse error — a missing control cube is by far the most
 * common reason these queries fail, and TM1's own message never says so. The
 * probe is best-effort: if it cannot decide, the original error is thrown.
 */
export async function executeMdxCellset(
  cfg: Tm1Config,
  mdx: string,
  label: string,
  expand: string = SECURITY_CELLSET_EXPAND,
  probeCube?: string,
): Promise<SecurityCellset> {
  const post = await apiRequest('POST', 'ExecuteMDX', JSON.stringify({ MDX: mdx }), 60000, cfg);
  if (post.statusCode !== 201) {
    let msg = post.body || `HTTP ${post.statusCode}`;
    try {
      const j = JSON.parse(post.body) as ODataError;
      const m = odataErrorMessage(j);
      if (m) msg = m;
    } catch { /* ignore */ }
    if (probeCube) {
      let missing = false;
      try { missing = !(await cubeExists(cfg, probeCube)); } catch { /* probe inconclusive → raw error */ }
      if (missing) throw new SecurityCubeMissingError(probeCube);
    }
    throw new Error(`${label}: ${msg}`);
  }
  const cellsetId = String((JSON.parse(post.body) as { ID?: string }).ID ?? '');
  if (!cellsetId) throw new Error(`${label}: cellset id missing`);

  try {
    const res = await apiRequest('GET', `Cellsets('${cellsetId}')?${expand}`, undefined, 60000, cfg);
    assertOk(res, `${label} cellset`);
    return parseBody<SecurityCellset>(res);
  } finally {
    apiRequest('DELETE', `Cellsets('${cellsetId}')`, undefined, 10000, cfg).catch(() => { /* best-effort */ });
  }
}

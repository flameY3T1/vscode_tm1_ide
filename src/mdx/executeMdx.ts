import { parseCellset, CellsetTable } from './cellsetParser';
import { encodeODataKey } from '../utils/odataKey';
import { errMsg } from '../utils/errMsg';
import { parseBody, parseJsonSafe, odataErrorMessage } from '../tm1Rest/parseRest';
import type { ODataCellset, ODataError } from '../tm1Rest/odataTypes';
import { isOk } from '../tm1Rest/httpError';

export const MDX_CELL_LIMIT = 50_000;

/**
 * Detect bare-set MDX (`{ ... }`) vs full SELECT.
 * Comments (`// …`) and leading whitespace are ignored.
 * Bare sets aren't executable via `POST /ExecuteMDX` (501); they're routed
 * through a temporary subset Expression instead.
 */
export function isBareSetMdx(mdx: string): boolean {
  const stripped = mdx.replace(/\/\/[^\n]*/g, '').trim();
  if (!stripped) { return false; }
  if (/^(WITH|SELECT)\b/i.test(stripped)) { return false; }
  return stripped.charAt(0) === '{';
}

/** Strip `// …` line comments — Subset Expression doesn't tolerate them. */
function _stripComments(mdx: string): string {
  return mdx.replace(/\/\/[^\n]*/g, '').trim();
}

/**
 * Parse the first `[Dim].[Hier].[Elem]` / `[Dim].[X]` / `[Dim]` token to derive
 * the subset target.
 *
 * `hierAmbiguous` marks the two-segment case, which is genuinely undecidable
 * from the text alone: `X` is a hierarchy in `TM1SUBSETALL([D].[H])` but a
 * MEMBER in the far more common `{ [D].[Element] }` (and a subset name in the
 * legacy `[D].[SubsetName]` shorthand). Guessing "hierarchy" unconditionally
 * built `Hierarchies('<element>')`, which TM1 answers with error 278,
 * "'…' can not be found in collection of type 'Hierarchy'" — reproduced live
 * against 11.8. The caller settles it against the server.
 */
export function parseFirstDimHier(mdx: string): { dim: string; hier: string; hierAmbiguous: boolean } | null {
  const stripped = mdx.replace(/\/\/[^\n]*\n/g, '\n');
  const m3 = /\[([^\]\n]+)\]\s*\.\s*\[([^\]\n]+)\]\s*\.\s*\[/.exec(stripped);
  if (m3) { return { dim: m3[1], hier: m3[2], hierAmbiguous: false }; }
  const m2 = /\[([^\]\n]+)\]\s*\.\s*\[([^\]\n]+)\]/.exec(stripped);
  if (m2) { return { dim: m2[1], hier: m2[2], hierAmbiguous: true }; }
  // No hierarchy qualifier (e.g. `{TM1SUBSETALL([aa])}`): TM1 defaults to the
  // hierarchy that shares the dimension's name. Fall back to dim === hier so
  // dimensions with multiple hierarchies still resolve against their leaf hierarchy.
  const m1 = /\[([^\]\n]+)\]/.exec(stripped);
  if (m1) { return { dim: m1[1], hier: m1[1], hierAmbiguous: false }; }
  return null;
}

/**
 * Settle an ambiguous `[Dim].[X]` by asking the server whether `X` is a
 * hierarchy of `Dim`. If it is not, fall back to the same-name hierarchy, which
 * TM1 always provides.
 *
 * Matching is CASE-INSENSITIVE and yields the server's canonical spelling: TM1
 * object names are case-insensitive (verified live on 11.8 —
 * `GET Dimensions('aa')/Hierarchies('TEST')` answers 200 with `"Name":"test"`),
 * so `{TM1SUBSETALL([Region].[EUROPA])}` has to resolve against a hierarchy
 * really named `Europa`. An exact `===` compare found no match, silently
 * rewrote the hierarchy to `Region`, and POSTed the temp subset under the wrong
 * hierarchy while its Expression still referenced EUROPA.
 *
 * A failed listing falls back to `dim`, NOT to the parsed guess: for the
 * dominant two-part form `[Dim].[Element]` that guess is the ELEMENT name, and
 * putting it in the `Hierarchies(...)` segment is exactly the TM1 error 278
 * this resolution exists to prevent. The same-name hierarchy always exists and
 * is right in the common case, so it is the safer no-evidence choice.
 */
async function _resolveHier(dim: string, hier: string, api: ApiFetcher): Promise<string> {
  const lcHier = hier.toLowerCase();
  if (lcHier === dim.toLowerCase()) { return hier; }
  const res = await api('GET', `Dimensions('${encodeODataKey(dim)}')/Hierarchies?$select=Name`)
    .catch(() => null);
  if (!res || !isOk(res)) { return dim; }
  const names = parseJsonSafe<{ value?: { Name?: string }[] }>(res.body, {}).value ?? [];
  const match = names.find(h => typeof h.Name === 'string' && h.Name.toLowerCase() === lcHier);
  return match?.Name ?? dim;
}

export interface MdxError {
  /** Server-reported code when available, else HTTP status as string. */
  code: string;
  message: string;
}

export type MdxResult =
  | { ok: true;  table: CellsetTable; cellsetId: string; elapsedMs: number }
  | { ok: false; needsConfirm: true; cellCount: number; cellsetId: string }
  | { ok: false; needsConfirm?: false; error: MdxError };

/** apiRequest-style fetcher — returned by tm1Client.apiRequest, injected here for testability. */
export type ApiFetcher = (method: string, path: string, body?: string) => Promise<{ statusCode: number; body: string }>;

const CELLSET_EXPAND =
  '$expand=Axes($expand=Hierarchies($select=Name),Tuples($expand=Members($select=Name)))'
  + ',Cells($select=Ordinal,Value,FormattedValue)';

function parseErrorBody(body: string, statusCode: number): MdxError {
  const obj = parseJsonSafe<ODataError>(body, {});
  const err = obj.error;
  if (err && typeof err === 'object') {
    return {
      code: String(err.code ?? statusCode),
      // odataErrorMessage handles BOTH shapes TM1 uses (plain string and
      // `{ value: string }`); the old `String(err.message)` produced
      // `[object Object]` for the nested shape.
      message: odataErrorMessage(obj) ?? body,
    };
  }
  return { code: String(statusCode), message: body || `HTTP ${statusCode}` };
}

/**
 * Best-effort cell-count pre-check.
 *  - Primary:  GET …/Cells/$count?$format=text/plain  → plain integer body.
 *    The `$format` is required: the transport sends a hard `Accept:
 *    application/json`, and a bare `/$count` answers 400 code 278 (live 11.8).
 *  - Fallback: GET …/Axes?$select=Cardinality  → multiply cardinalities.
 *  - Returns `null` when both fail (caller skips the limit and loads anyway).
 */
async function getCellCount(cellsetPath: string, api: ApiFetcher): Promise<number | null> {
  const direct = await api('GET', `${cellsetPath}/Cells/$count?$format=text/plain`);
  if (direct.statusCode === 200) {
    const n = parseInt(direct.body.trim(), 10);
    if (Number.isFinite(n)) { return n; }
  }

  const axes = await api('GET', `${cellsetPath}/Axes?$select=Cardinality`);
  if (axes.statusCode === 200) {
    try {
      const obj = parseBody<{ value?: Array<{ Cardinality?: number }> }>(axes);
      const cards = (obj.value ?? []).map(v => Number(v.Cardinality ?? 0));
      if (cards.length > 0 && cards.every(n => Number.isFinite(n) && n >= 0)) {
        return cards.reduce((acc, n) => acc * n, 1);
      }
    } catch { /* fall through */ }
  }
  return null;
}

/**
 * Executes an MDX query against a TM1 server via the cellset protocol:
 *   1. POST /ExecuteMDX                    → creates cellset, returns ID
 *   2. GET  …/Cells/$count                 → cell-count pre-check
 *      (fallback: GET …/Axes?$select=Cardinality → product of cardinalities)
 *   3a. If count > MDX_CELL_LIMIT          → return needsConfirm (cellset left on server)
 *   3b. GET  /Cellsets('id')?$expand=…     → full cellset payload
 *   4. DELETE /Cellsets('id')              → server-side cleanup (best-effort)
 *
 * On success returns the parsed table; on any failure the error is surfaced
 * and (if a cellset was created) DELETE is still attempted.
 */
export async function executeMdx(mdx: string, api: ApiFetcher): Promise<MdxResult> {
  if (isBareSetMdx(mdx)) {
    return executeMdxAsSet(mdx, api);
  }
  const start = Date.now();
  const post = await api('POST', 'ExecuteMDX', JSON.stringify({ MDX: mdx }));
  if (post.statusCode !== 201) {
    return { ok: false, error: parseErrorBody(post.body, post.statusCode) };
  }

  let cellsetId: string;
  try {
    const parsed = JSON.parse(post.body) as { ID?: unknown };
    if (typeof parsed.ID !== 'string' || parsed.ID === '') {
      return { ok: false, error: { code: '201', message: 'POST /ExecuteMDX response missing ID field' } };
    }
    cellsetId = parsed.ID;
  } catch {
    return { ok: false, error: { code: '201', message: 'POST /ExecuteMDX response was not valid JSON' } };
  }

  const cellsetPath = `Cellsets('${encodeURIComponent(cellsetId)}')`;

  try {
    const cellCount = await getCellCount(cellsetPath, api);
    if (cellCount !== null && cellCount > MDX_CELL_LIMIT) {
      // Leave the cellset on the server; caller decides continue vs. abort.
      return { ok: false, needsConfirm: true, cellCount, cellsetId };
    }
  } catch (e) {
    // A transport rejection (ECONNRESET, timeout) is not a status code — the
    // cellset still exists and holds server memory until the session ends.
    await api('DELETE', cellsetPath).catch(() => undefined);
    throw e;
  }

  return _fetchAndParse(cellsetId, api, start);
}

/**
 * Load a cellset that was previously created but held for user confirmation.
 * Called after the user clicks "Trotzdem laden" on a >50 k warning.
 * `elapsedMs` in the returned result measures only the post-confirm load
 * time (GET + parse), NOT POST+$count which already completed in the
 * original `executeMdx` call.
 */
export async function executeMdxContinue(cellsetId: string, api: ApiFetcher): Promise<MdxResult> {
  return _fetchAndParse(cellsetId, api, Date.now());
}

async function _fetchAndParse(cellsetId: string, api: ApiFetcher, start: number): Promise<MdxResult> {
  const cellsetPath = `Cellsets('${encodeURIComponent(cellsetId)}')`;
  let get: Awaited<ReturnType<ApiFetcher>>;
  try {
    get = await api('GET', `${cellsetPath}?${CELLSET_EXPAND}`);
  } catch (e) {
    await api('DELETE', cellsetPath).catch(() => undefined);
    throw e;
  }

  if (get.statusCode !== 200) {
    await api('DELETE', cellsetPath).catch(() => undefined);
    return { ok: false, error: parseErrorBody(get.body, get.statusCode) };
  }

  let table: CellsetTable;
  try {
    // parseBody releases the raw response string (10+ MB for views over large dims)
    // immediately after a successful parse.
    const parsed = parseBody<ODataCellset>(get);
    table = parseCellset(parsed);
  } catch (e) {
    await api('DELETE', cellsetPath).catch(() => undefined);
    return { ok: false, error: { code: '200', message: `Cellset parse failed: ${errMsg(e)}` } };
  }

  // Fire-and-forget delete — server sweeps eventually, a failed delete
  // shouldn't break the caller's query result.
  await api('DELETE', cellsetPath).catch(() => undefined);

  return {
    ok: true,
    table,
    cellsetId,
    elapsedMs: Date.now() - start,
  };
}

/** Abort a held (unconfirmed) cellset — silently deletes. */
export async function abortMdxCellset(cellsetId: string, api: ApiFetcher): Promise<void> {
  const cellsetPath = `Cellsets('${encodeURIComponent(cellsetId)}')`;
  await api('DELETE', cellsetPath).catch(() => undefined);
}

/**
 * Resolve a bare set MDX (`{ … }`) against a TM1 dimension by:
 *   1. POST /Dimensions('D')/Hierarchies('H')/PrivateSubsets  body {Name,Expression}
 *   2. GET  …/PrivateSubsets('Name')/Elements?$select=Name,Type,Level
 *   3. DELETE …/PrivateSubsets('Name')  (best-effort)
 *
 * Returns a single-axis CellsetTable: row-axis = `<Dim>.<Hier>`, one column
 * "Element". No cube needed — works regardless of cube/control-cube perms.
 */
export async function executeMdxAsSet(mdx: string, api: ApiFetcher): Promise<MdxResult> {
  const start = Date.now();
  const ctx = parseFirstDimHier(mdx);
  if (!ctx) {
    // English source string; the vscode-aware caller (mdxRunner) re-localizes by `code`.
    return { ok: false, error: { code: 'bare-set', message: 'Set expression — could not determine dimension/hierarchy.' } };
  }
  const expr = _stripComments(mdx);
  // `[Dim].[X]` alone cannot say whether X is a hierarchy or a member — ask the
  // server before building the path, or a member name lands in the Hierarchies
  // segment and TM1 rejects the whole run with error 278.
  const hier = ctx.hierAmbiguous ? await _resolveHier(ctx.dim, ctx.hier, api) : ctx.hier;
  const dimEnc = encodeODataKey(ctx.dim);
  const hierEnc = encodeODataKey(hier);
  const subsetName = `_tm1ti_runner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nameEnc = encodeURIComponent(subsetName);
  const base = `Dimensions('${dimEnc}')/Hierarchies('${hierEnc}')/PrivateSubsets`;

  const post = await api(
    'POST', base,
    JSON.stringify({ Name: subsetName, Expression: expr }),
  );
  if (!isOk(post)) {
    return { ok: false, error: parseErrorBody(post.body, post.statusCode) };
  }

  const get = await api('GET', `${base}('${nameEnc}')/Elements?$select=Name,Type,Level`);
  // Always attempt cleanup, even on error path.
  await api('DELETE', `${base}('${nameEnc}')`).catch(() => undefined);

  if (!isOk(get)) {
    return { ok: false, error: parseErrorBody(get.body, get.statusCode) };
  }

  type SubsetElement = { Name?: string; Type?: number | string; Level?: number };
  let elems: SubsetElement[];
  try {
    elems = parseBody<{ value?: SubsetElement[] }>(get).value ?? [];
  } catch (e) {
    return { ok: false, error: { code: '200', message: `Elements parse failed: ${errMsg(e)}` } };
  }

  const rowHier = `${ctx.dim}.${hier}`;
  const rowHeaders = elems.map(e => [String(e.Name ?? '')]);
  const cells = elems.map(e => [{ value: String(e.Name ?? ''), formatted: String(e.Name ?? '') }]);

  const table: CellsetTable = {
    colHeaders: [['Element']],
    colHierarchies: ['Element'],
    rowHeaders,
    rowHierarchies: [rowHier],
    titleHeaders: [],
    cells,
    dims: { cols: 1, rows: elems.length },
  };

  return {
    ok: true,
    table,
    cellsetId: '',
    elapsedMs: Date.now() - start,
  };
}

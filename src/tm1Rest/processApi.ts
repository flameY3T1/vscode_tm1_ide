import { apiRequest, assertOk } from './client';
import type { Tm1Config, TiSections, DataSource, ProcessParameter, ProcessVariable } from './transport/types';
import { parseODataValueBody, parseJsonSafe, parseBody } from './parseRest';
import { encodeODataKey } from '../utils/odataKey';
import { isOk } from './httpError';
import { splitVariableColumns } from '../utils/processVariablesUi';

/**
 * Every property of a process, named one by one.
 *
 * `$select=*` is NOT usable here (measured live 11.8, 2026-08-29): it truncates
 * the complex type `DataSource` to its `Type` alone — no delimiter, no file name
 * — while a plain GET returns it whole. It also omits the two undeclared
 * properties `UIData` and `VariablesUIData`, which is why the star crept in at
 * all. Naming the fields gets both: the full DataSource and the two lists.
 */
export const PROCESS_FULL_SELECT =
  'Name,HasSecurityAccess,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,'
  + 'DataSource,Parameters,Variables,Attributes,VariablesUIData,UIData';

/** The same without the four procedures: everything the git header holds. */
export const PROCESS_HEADER_SELECT =
  'Name,HasSecurityAccess,DataSource,Parameters,Variables,Attributes,VariablesUIData,UIData';

// Moved to transport/types.ts (vscode-free, so webview protocols can name them).
export type { ProcessParameter, ProcessVariable } from './transport/types';

/** Process parameter shape commonly used by callers. */
export interface Tm1Parameter {
  Name: string;
  Type: string | number;
  Value: any;
  Prompt?: string;
}

export interface Tm1ProcessSummary {
  Name: string;
  Parameters?: Tm1Parameter[];
}

export interface ListProcessOptions {
  /** Comma-separated $select. Defaults to "Name". */
  select?: string;
  /** $top — defaults to none. */
  top?: number;
  /** $orderby clause (without prefix). */
  orderby?: string;
  /** $expand clause (without prefix). */
  expand?: string;
}

function buildQuery(opts: ListProcessOptions = {}): string {
  const parts: string[] = [];
  if (opts.select) { parts.push(`$select=${opts.select}`); }
  if (opts.top != null) { parts.push(`$top=${opts.top}`); }
  if (opts.orderby) { parts.push(`$orderby=${opts.orderby}`); }
  if (opts.expand) { parts.push(`$expand=${opts.expand}`); }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** GET /Processes. Returns array (default `$select=Name`). */
export async function listProcesses(
  cfg: Tm1Config,
  opts: ListProcessOptions = { select: 'Name' },
  timeoutMs?: number,
): Promise<Tm1ProcessSummary[]> {
  const url = `Processes${buildQuery(opts)}`;
  const res = await apiRequest('GET', url, undefined, timeoutMs, cfg);
  assertOk(res);
  return parseODataValueBody<Tm1ProcessSummary>(res);
}

/** GET /Processes('<name>') — full process payload. */
export async function getProcess(
  cfg: Tm1Config,
  name: string,
  opts: { select?: string } = {},
  timeoutMs?: number,
): Promise<any> {
  const enc = encodeODataKey(name);
  const sel = opts.select ? `?$select=${opts.select}` : '';
  const res = await apiRequest('GET', `Processes('${enc}')${sel}`, undefined, timeoutMs, cfg);
  assertOk(res);
  // Strict: copy/deploy write this payload back, and `{}` would be an empty process.
  return parseBody<Record<string, unknown>>(res);
}

/** GET /Processes('<name>')?$select=Parameters — just the parameter list. */
export async function getProcessParameters(
  cfg: Tm1Config,
  name: string,
  timeoutMs?: number,
): Promise<Tm1Parameter[]> {
  const proc = await getProcess(cfg, name, { select: 'Parameters' }, timeoutMs);
  return (proc.Parameters ?? []) as Tm1Parameter[];
}

/**
 * GET /Processes('<name>')/Parameters — direct Parameters collection.
 * Returns an empty array on 404.
 */
export async function getParametersOrEmpty(
  cfg: Tm1Config,
  name: string,
  timeoutMs?: number,
): Promise<Tm1Parameter[]> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('GET', `Processes('${enc}')/Parameters`, undefined, timeoutMs, cfg);
  if (res.statusCode === 404) { return []; }
  assertOk(res);
  return parseODataValueBody<Tm1Parameter>(res);
}

/** PATCH /Processes('<name>'). Body must NOT contain a `Name` field on TM1 11.x. */
export async function updateProcess(
  cfg: Tm1Config,
  name: string,
  body: Record<string, any> | string,
  errorMsg = 'Process could not be saved',
): Promise<void> {
  const enc = encodeODataKey(name);
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await apiRequest('PATCH', `Processes('${enc}')`, payload, undefined, cfg);
  assertOk(res, errorMsg);
}

/**
 * Writes a process: PATCH first, POST only when the PATCH answers 404 — any
 * other PATCH failure (403, 400 Code 248) is the real cause and is thrown.
 * Returns the ETag of the version now on the server.
 *
 * `ifMatch`: the ETag the caller last saw. A stale one answers 412 — and so
 * does a process deleted meanwhile (with `*` that is a 404). Measured on 11.8,
 * 2026-10-27: the ETag is per process, the same for every `$select`,
 * unchanged by a run, new after every PATCH, and the PATCH answer carries the
 * same one a later GET shows. Without `ifMatch` the PATCH overwrites.
 *
 * `payload` must not carry `Name`: TM1 11.x reads it as a rename.
 */
export async function upsertProcess(
  cfg: Tm1Config,
  name: string,
  payload: Record<string, unknown>,
  ifMatch?: string,
): Promise<string | undefined> {
  const res = await apiRequest('PATCH', `Processes('${encodeODataKey(name)}')`, JSON.stringify(payload),
    undefined, cfg, ifMatch ? { 'If-Match': ifMatch } : undefined);
  if (res.statusCode !== 404) {
    assertOk(res, 'Process could not be saved');
    return etagOf(res.body);
  }
  const created = await apiRequest('POST', 'Processes', JSON.stringify({ Name: name, ...payload }), undefined, cfg);
  assertOk(created, 'Process could not be created');
  return etagOf(created.body);
}

/** ETag of the process as it is on the server now; `undefined` when unknown. */
export async function fetchProcessEtag(cfg: Tm1Config, name: string): Promise<string | undefined> {
  const res = await apiRequest('GET', `Processes('${encodeODataKey(name)}')?$select=Name`, undefined, undefined, cfg);
  return isOk(res) ? etagOf(res.body) : undefined;
}

function etagOf(body: string): string | undefined {
  const tag = parseJsonSafe<{ '@odata.etag'?: unknown }>(body, {})['@odata.etag'];
  return typeof tag === 'string' ? tag : undefined;
}

/** DELETE /Processes('<name>'). */
export async function deleteProcess(
  cfg: Tm1Config,
  name: string,
  errorMsg = 'Process could not be deleted',
): Promise<void> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('DELETE', `Processes('${enc}')`, undefined, undefined, cfg);
  assertOk(res, errorMsg);
}

/**
 * Upsert a process: GET to detect existence, then PATCH (200) or POST (404).
 * Throws with a friendly Auth-message on 401/403.
 */
export async function deployProcess(
  processName: string,
  sections: TiSections,
  dataSource: DataSource | undefined,
  parameters: ProcessParameter[] | undefined,
  variables: ProcessVariable[] | undefined,
  config: Tm1Config,
  hasSecurity?: boolean,
  /**
   * Architect's remembered wizard state (`CubeAction`/`DataAction`/
   * `CubeLogChanges`, form-feed separated). A PATCH that omits it leaves the
   * server value alone, but a POST cannot — so a copy loses it unless the caller
   * hands it over. Undefined = "don't touch".
   */
  uiData?: string,
): Promise<void> {
  const cfg = config;

  const enc = encodeODataKey(processName);
  const path = `Processes('${enc}')`;

  const payload: Record<string, unknown> = {
    PrologProcedure:   sections.prolog,
    MetadataProcedure: sections.metadata,
    DataProcedure:     sections.data,
    EpilogProcedure:   sections.epilog,
  };

  if (dataSource) {
    payload.DataSource = dataSource;
  }
  // `undefined` = "don't touch the parameters", `[]` = "remove them all". Omitting
  // the property on an empty array made the second case unreachable: TM1 kept the
  // old parameters while the editor cleared its own state and reported "saved".
  if (parameters !== undefined) {
    payload.Parameters = parameters;
  }
  // Always send Variables — empty array clears old variables when switching to None.
  // VariablesUIData travels WITH it, never on its own: TM1 keeps the two lists
  // strictly independent, so a PATCH that updates only one leaves the other
  // pointing at the wrong columns (measured — processIgnoreVarDriftProbe.js).
  const split = splitVariableColumns(variables ?? []);
  payload.Variables = split.Variables;
  payload.VariablesUIData = split.VariablesUIData;
  // Process "Security access" flag — omit when caller passes undefined so a
  // partial PATCH leaves the server value untouched.
  if (hasSecurity !== undefined) {
    payload.HasSecurityAccess = hasSecurity;
  }
  if (uiData !== undefined) {
    payload.UIData = uiData;
  }

  const checkRes = await apiRequest('GET', path, undefined, undefined, cfg);

  if (checkRes.statusCode === 200) {
    const patchRes = await apiRequest('PATCH', path, JSON.stringify(payload), undefined, cfg);
    if (patchRes.statusCode === 403 || patchRes.statusCode === 401) {
      throw new Error(`Access denied (${patchRes.statusCode}): TM1 user has no write permission on "${processName}".`);
    }
    assertOk(patchRes, 'PATCH failed');
  } else if (checkRes.statusCode === 404) {
    const postRes = await apiRequest('POST', 'Processes', JSON.stringify({ Name: processName, ...payload }), undefined, cfg);
    assertOk(postRes, 'POST failed');
  } else if (checkRes.statusCode === 403 || checkRes.statusCode === 401) {
    throw new Error(`Access denied (${checkRes.statusCode}): TM1 user cannot read "${processName}".`);
  } else {
    throw new Error(`Unexpected status while checking the process (${checkRes.statusCode}): ${checkRes.body}`);
  }
}

/**
 * Reads a process's `UIData` — Architect's remembered wizard state. It sits
 * OUTSIDE the default projection: a plain GET, and even `$select=*`, omits it
 * (measured live, 11.8). Returns undefined only when the server sends no
 * field (TM1 12 leaves it out on some processes). An empty string is a value:
 * 11.8 sends `"UIData": ""` on every process without wizard state, and
 * "Save as…" copies exactly what the source holds.
 */
export async function fetchProcessUiData(processName: string, config: Tm1Config): Promise<string | undefined> {
  const enc = encodeODataKey(processName);
  const res = await apiRequest('GET', `Processes('${enc}')?$select=UIData`, undefined, undefined, config);
  if (res.statusCode !== 200) { return undefined; }
  const d = parseJsonSafe<{ UIData?: unknown }>(res.body, {});
  return typeof d.UIData === 'string' ? d.UIData : undefined;
}

/** GET /Processes('<name>')?$select=...Procedure — returns code sections, or null on 404. */
export async function fetchProcessSections(processName: string, config: Tm1Config): Promise<TiSections | null> {
  const enc = encodeODataKey(processName);
  const fields = 'PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure';
  const res = await apiRequest('GET', `Processes('${enc}')?$select=${fields}`, undefined, undefined, config);
  if (res.statusCode === 404) { return null; }
  assertOk(res);
  let d: { PrologProcedure?: string; MetadataProcedure?: string; DataProcedure?: string; EpilogProcedure?: string };
  try {
    d = parseBody(res);
  } catch {
    const preview = res.body.trimStart().substring(0, 80);
    throw new Error(`Server response is not valid JSON: "${preview}…" — Possible cause: authentication failed or wrong server URL.`);
  }
  return {
    prolog:   (d.PrologProcedure   ?? '').replace(/\r\n/g, '\n').trimEnd(),
    metadata: (d.MetadataProcedure ?? '').replace(/\r\n/g, '\n').trimEnd(),
    data:     (d.DataProcedure     ?? '').replace(/\r\n/g, '\n').trimEnd(),
    epilog:   (d.EpilogProcedure   ?? '').replace(/\r\n/g, '\n').trimEnd(),
  };
}

/** Raw process shape for the process overview page (one-call inline fetch). */
export interface RawProcess {
  Name: string;
  HasSecurityAccess?: boolean;
  Parameters?: { Name: string; Type?: 'Numeric' | 'String'; Value?: string | number; Prompt?: string }[];
  /** Used datasource columns; ignored ones are not in this list (see ProcessVariable). */
  Variables?: { Name: string; Type?: 'Numeric' | 'String' }[];
  DataSource?: { Type?: string };
  PrologProcedure?: string;
  MetadataProcedure?: string;
  DataProcedure?: string;
  EpilogProcedure?: string;
}

/** One call returning every process with inline code, params, and datasource. */
export async function listProcessesFull(cfg: Tm1Config): Promise<RawProcess[]> {
  const sel = 'Name,HasSecurityAccess,Parameters,Variables,DataSource,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure';
  const res = await apiRequest('GET', `Processes?$select=${sel}`, undefined, undefined, cfg);
  assertOk(res);
  const parsed = parseBody<{ value: RawProcess[] }>(res);
  return parsed.value ?? [];
}


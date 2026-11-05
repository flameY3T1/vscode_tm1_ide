import { apiRequest } from './client';
import { parseJsonSafe, odataErrorMessage } from './parseRest';
import type { ODataError } from './odataTypes';
import type { Tm1Config } from './transport/types';
import { classifyExecuteStatus, fetchErrorLog, findLatestErrorLogFile } from './executionApi';
import { isOk, Tm1HttpError } from './httpError';

/**
 * Unbound OData action that runs a process handed over INLINE in the request
 * body. Nothing is persisted — no `Processes('…')` object remains afterwards.
 * Live-verified on TM1 11.8 AND v12 (both answer HTTP 201 with a
 * `ProcessExecuteResult`, and no `Processes('…')` object exists afterwards);
 * it is also how Arc runs its internal helpers. No named-helper fallback:
 * every supported server exposes the action.
 */
export const TRANSIENT_EXEC_PATH = 'ExecuteProcessWithReturn';

/** TI snippet to run without leaving an object behind. */
export interface TransientProcessSpec {
  /**
   * Process name. NOT an object key — nothing is stored under it. It only
   * labels the run in the TM1 message log and in error-log filenames, so keep
   * it recognizable (`}VSCode_…`).
   */
  name: string;
  /** TI code per section. Each is emitted behind a leading `#` comment line. */
  prolog?: string;
  metadata?: string;
  data?: string;
  epilog?: string;
  /** Defaults to `{ Type: 'None' }`. */
  dataSource?: Record<string, unknown>;
  /** Editor column list; entries flagged `Ignored` are dropped (TM1 skips them anyway). */
  variables?: Array<{ Name: string; Type: string; Position: number; Ignored?: boolean }>;
}

/** Non-2xx from the transient-exec endpoint — carries the HTTP status. */
export class TransientExecError extends Tm1HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = 'TransientExecError';
  }
}

/** `#` guard line so TM1 never mistakes the snippet for a generated block. */
function section(code: string | undefined): string {
  const c = (code ?? '').trim();
  return c ? `#\r\n${c}` : '#';
}

/**
 * Build the `POST ExecuteProcessWithReturn` payload: the whole process
 * definition lives under `Process`, execution parameters at top level (we never
 * need any — the snippets are self-contained).
 */
export function buildTransientProcessBody(spec: TransientProcessSpec): {
  Process: {
    Name: string;
    PrologProcedure: string;
    MetadataProcedure: string;
    DataProcedure: string;
    EpilogProcedure: string;
    DataSource: Record<string, unknown>;
    Variables: Array<{ Name: string; Type: string; Position: number }>;
  };
  Parameters: [];
} {
  return {
    Process: {
      Name: spec.name,
      PrologProcedure: section(spec.prolog),
      MetadataProcedure: section(spec.metadata),
      DataProcedure: section(spec.data),
      EpilogProcedure: section(spec.epilog),
      DataSource: spec.dataSource ?? { Type: 'None' },
      // Ignored columns have no place in the REST `Variables` collection — the
      // transient process only needs the ones the snippet can actually read.
      Variables: (spec.variables ?? [])
        .filter(v => !v.Ignored)
        .map(v => ({ Name: v.Name, Type: v.Type, Position: v.Position })),
    },
    Parameters: [],
  };
}

/** `ProcessExecuteResult` — `ErrorLogFile` is a bare name on some builds, a document on others. */
interface TransientExecResult {
  ProcessExecuteStatusCode?: string;
  ErrorLogFile?: string | { Filename?: string };
}

/**
 * Best-effort ErrorLog readback so a failure is diagnosable at all — the bare
 * status code (`HasMinorErrors`) says nothing about WHAT went wrong. Reuses the
 * named path's helpers (`executionApi`) instead of duplicating the read: they
 * carry the sandbox header, the legacy `ErrorLogs('<n>')/tm1.GetContent`
 * fallback and — crucially — the directory scan. The `…WithReturn` family names
 * NO `ErrorLogFile` on TM1 11.8, so without that scan a failed run would still
 * report nothing but its status code; `spec.name` is exactly the label TM1 puts
 * into the `TM1ProcessError_…_<name>.log` filename.
 *
 * Falls back to the filename alone when the content is unreachable, undefined
 * when no log can be found at all.
 */
async function errorLogDetail(
  cfg: Tm1Config, elf: TransientExecResult['ErrorLogFile'], name: string,
): Promise<string | undefined> {
  const named = typeof elf === 'string' ? elf : elf?.Filename;
  const filename = named || await findLatestErrorLogFile(cfg, name);
  if (!filename) { return undefined; }
  const content = await fetchErrorLog(cfg, filename);
  return content ? `${filename}: ${content.trim()}` : filename;
}

/** Result of a run, without throwing — the path for callers that DISPLAY a
 *  failure instead of propagating it (TI console). */
export interface TransientRunResult {
  /** True only on a clean success status. */
  ok: boolean;
  /** `ProcessExecuteStatusCode`; empty on a 204 without a body. */
  status: string;
  /** Filename plus content of the error log, if TM1 wrote one. */
  errorLog?: string;
}

/**
 * Interprets the response of the transient endpoint. Still throws on a
 * response that is not a TM1 result at all (empty body other than 204,
 * unparseable body) — that is not a process status but a counterpart we do
 * not know, and silently calling that a "successful" SaveDataAll would be
 * the worst possible outcome.
 */
async function readRunResult(
  cfg: Tm1Config, res: { statusCode: number; body: string }, name: string,
): Promise<TransientRunResult> {
  if ((res.body ?? '').trim() === '') {
    // Only 204 legitimately carries no result. Live-verified, 11.8 AND v12
    // answer 201 WITH a `ProcessExecuteResult` (see the header comment), so an
    // empty 200 is not a TM1 answer we know — it is a proxy/gateway reply, and
    // calling that a successful SaveDataAll is the worst possible outcome.
    if (res.statusCode === 204) { return { ok: true, status: '' }; }
    throw new Error(`${name}: empty execute response (HTTP ${res.statusCode}) — process status unknown`);
  }
  const json = parseJsonSafe<TransientExecResult | null>(res.body, null);
  if (json === null || typeof json !== 'object') {
    // 2xx, but the body is not parseable (proxy login HTML, truncation): do
    // NOT report it as success — the actual process status is unknown, and
    // silently calling that a "successful" SaveDataAll is the worst possible
    // answer. Same rule as in the named path (executionApi.executeProcess).
    throw new Error(
      `${name}: unparseable execute response (HTTP ${res.statusCode}) — ${res.body.slice(0, 200)}`,
    );
  }
  const status = json.ProcessExecuteStatusCode ?? '';
  if (classifyExecuteStatus(status) === 'success') { return { ok: true, status }; }
  return { ok: false, status, errorLog: await errorLogDetail(cfg, json.ErrorLogFile, name) };
}

/** Message for a run that did not succeed — one place for both paths. */
function failureMessage(name: string, r: TransientRunResult): string {
  return r.errorLog ? `${name}: ${r.status} — ${r.errorLog}` : `${name}: ${r.status}`;
}

/**
 * Run a TI snippet WITHOUT persisting a process. Throws {@link TransientExecError}
 * on a non-2xx response and a plain Error when the process itself reported
 * minor/serious errors.
 *
 * `timeoutMs` defaults to 0 (no inactivity timer) — a snippet like `SaveDataAll`
 * can legitimately run for many minutes.
 */
export async function executeTransientProcess(
  cfg: Tm1Config, spec: TransientProcessSpec, timeoutMs = 0,
): Promise<void> {
  const result = await runTransientProcess(cfg, spec, timeoutMs);
  if (result.ok) { return; }
  throw new Error(failureMessage(spec.name, result));
}

/**
 * Like {@link executeTransientProcess}, but RETURNS the outcome instead of
 * throwing it. A non-2xx (translation error, 401) remains a throw: in that
 * case TM1 did not execute at all, there is no process status to report.
 */
export async function runTransientProcess(
  cfg: Tm1Config, spec: TransientProcessSpec, timeoutMs = 0,
): Promise<TransientRunResult> {
  const body = JSON.stringify(buildTransientProcessBody(spec));
  const res = await apiRequest('POST', TRANSIENT_EXEC_PATH, body, timeoutMs, cfg);
  if (!isOk(res)) {
    const msg = odataErrorMessage(parseJsonSafe<ODataError>(res.body, {})) ?? `HTTP ${res.statusCode}`;
    throw new TransientExecError(msg, res.statusCode);
  }
  return readRunResult(cfg, res, spec.name);
}

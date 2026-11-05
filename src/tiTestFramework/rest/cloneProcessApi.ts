/**
 * REST wrapper for the lifecycle of a temporary clone-process used by the
 * TI-Test-Framework. Handles deploy → execute → result → delete. Errors are
 * surfaced as plain Error throws; the caller decides whether to retry or
 * fail the test.
 */

import { apiRequest, apiRequestBinary } from '../../tm1Rest/client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { ProcessStatus } from '../diff/statusDiff';
import { encodeODataKey } from '../../utils/odataKey';
import { decodeServerText } from '../../utils/serverText';
import { isOk, Tm1HttpError } from '../../tm1Rest/httpError';

export type ProcessShape = {
  name: string;
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
  dataSource?: { Type: string; [k: string]: unknown };
  parameters?: {
    Name: string;
    Type: 'Numeric' | 'String';
    Value?: string | number;
    Prompt?: string;
  }[];
  /** Source-column variable bindings (vdim_1 etc.) — required for any non-None datasource. */
  variables?: {
    Name: string;
    Type: 'Numeric' | 'String';
    Position: number;
    StartByte: number;
    EndByte: number;
  }[];
};

export type ExecuteParam = { Name: string; Value: string | number };

export type ExecuteResult = {
  status: ProcessStatus;
  rawStatusCode: string;
  errorLogContent: string;
  durationMs: number;
};

const TM1_TO_PROCESS_STATUS: Record<string, ProcessStatus> = {
  CompletedSuccessfully: 'success',
  HasMinorErrors: 'minorErrors',
  CompletedWithMessages: 'minorErrors',
  Aborted: 'majorErrors',
  CompletedWithFailure: 'majorErrors',
  QuitCalled: 'quitCalled',
  RollbackCalled: 'rollback',
};

function mapStatus(raw: string): ProcessStatus {
  return TM1_TO_PROCESS_STATUS[raw] ?? 'majorErrors';
}

function ensureOk(label: string, statusCode: number, body: string): void {
  if (statusCode < 200 || statusCode >= 300) {
    throw new Tm1HttpError(`${label}: HTTP ${statusCode} — ${body.slice(0, 400)}`, statusCode);
  }
}

export async function deployClone(cfg: Tm1Config, shape: ProcessShape): Promise<void> {
  // A previous capture may have left this clone on the server (it failed after
  // deploy, or `keepCloneOnError` retained it). The clone name is deterministic,
  // so POST /Processes would fail with HTTP 400 "already exists". Delete any
  // stale copy first (best-effort, ignores 404) so the deploy is self-healing.
  await deleteClone(cfg, shape.name).catch(() => undefined);
  const body = JSON.stringify({
    Name: shape.name,
    PrologProcedure: shape.prolog,
    MetadataProcedure: shape.metadata,
    DataProcedure: shape.data,
    EpilogProcedure: shape.epilog,
    DataSource: shape.dataSource ?? { Type: 'None' },
    Parameters: shape.parameters ?? [],
    Variables: shape.variables ?? [],
  });
  const res = await apiRequest('POST', 'Processes', body, undefined, cfg);
  ensureOk(`deployClone('${shape.name}')`, res.statusCode, res.body);
}

export async function executeClone(
  cfg: Tm1Config,
  name: string,
  parameters: ExecuteParam[] = [],
  timeoutMs?: number,
): Promise<ExecuteResult> {
  const t0 = Date.now();
  const body = JSON.stringify({ Parameters: parameters });
  // Default: no inactivity timeout (0) — clone runs (bedrock exports, large
  // loads) can take arbitrarily long. Callers may override via `timeoutMs`.
  const res = await apiRequest(
    'POST',
    `Processes('${encodeODataKey(name)}')/tm1.ExecuteWithReturn`,
    body,
    timeoutMs ?? 0,
    cfg,
  );
  const durationMs = Date.now() - t0;
  ensureOk(`executeClone('${name}')`, res.statusCode, res.body);

  let raw = 'CompletedSuccessfully';
  let errorLogContent = '';
  try {
    const parsed = JSON.parse(res.body) as {
      ProcessExecuteStatusCode?: string;
      ErrorLogFile?: { Filename?: string };
    };
    if (parsed.ProcessExecuteStatusCode) raw = parsed.ProcessExecuteStatusCode;

    if (raw !== 'CompletedSuccessfully') {
      const logFile = parsed.ErrorLogFile?.Filename;
      if (logFile) {
        try {
          // TM1 11.8: process error logs are read via ErrorLogFiles('<name>')/Content
          // (the ErrorLogs collection + tm1.GetContent action don't exist here).
          // Binary + decode: the log is Windows-1252 on German servers, not UTF-8.
          const logRes = await apiRequestBinary(
            'GET',
            `ErrorLogFiles('${encodeODataKey(logFile)}')/Content`,
            undefined,
            cfg,
          );
          if (isOk(logRes)) {
            errorLogContent = decodeServerText(logRes.body).slice(0, 8000);
          }
        } catch {
          /* best-effort error-log fetch */
        }
      }
    }
  } catch {
    /* unparseable execute response — keep defaults */
  }

  return {
    status: mapStatus(raw),
    rawStatusCode: raw,
    errorLogContent,
    durationMs,
  };
}

export async function deleteClone(cfg: Tm1Config, name: string): Promise<void> {
  const res = await apiRequest(
    'DELETE',
    `Processes('${encodeODataKey(name)}')`,
    undefined,
    undefined,
    cfg,
  );
  if (res.statusCode === 404) return;
  ensureOk(`deleteClone('${name}')`, res.statusCode, res.body);
}

/**
 * Shared choreography for a server-side datasource preview.
 *
 * Both preview paths run a transient inline process through
 * `POST ExecuteProcessWithReturn` and pick the captured rows out of a log file.
 * Extracted from `asciiPreview.ts` when the ODBC preview arrived, because the
 * details here were all paid for once already and must not be re-derived:
 *
 * - a FAILED run still answers HTTP 201; the outcome lives in
 *   `ProcessExecuteStatusCode`, and swallowing it is what once made "preview does
 *   not work" impossible to diagnose,
 * - the reason for a failure is only in the error log TM1 wrote alongside,
 * - the capture log holds verbatim datasource rows, so a failed cleanup has to be
 *   visible rather than silent.
 */

import { apiRequest, apiRequestBinary } from '../../tm1Rest/client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { errMsg } from '../../utils/errMsg';
import { encodeODataKey } from '../../utils/odataKey';
import { decodeServerText } from '../../utils/serverText';
import { classifyExecuteStatus, fetchErrorLog, findLatestErrorLogFile } from '../../tm1Rest/executionApi';
import { isOk } from '../../tm1Rest/httpError';

export interface InlinePreviewResult {
  /** Captured log text, or undefined when the log could not be read. */
  text?: string;
  /** `ProcessExecuteStatusCode` as reported, for callers that care. */
  status: string;
}

export interface InlinePreviewOptions {
  /**
   * OData path of the capture log, for paths that name it themselves. Omit to
   * take the log TM1 names on its own out of the response — that needs
   * `expandErrorLog`.
   */
  logPath?: string;
  /**
   * Ask for `$expand=ErrorLogFile`, whose `Filename` then locates the log. The
   * ODBC path needs this: it captures rows through `ItemReject`, so the file is
   * TM1's own error log and only the server knows its name.
   */
  expandErrorLog?: boolean;
  /** Process name in the payload — used to find the error log of a failed run. */
  processName: string;
  /** Prefix for cleanup warnings, e.g. `asciiPreview`. */
  label: string;
  /** What the log holds, for the cleanup warning. */
  describeContents: string;
}

/**
 * Turn an aborted preview run into the server's own sentence.
 *
 * TM1 answers a failed inline execution with HTTP 201 and merely
 * `ProcessExecuteStatusCode: "Aborted"` — the reason ("Unable to open data
 * source '…'") lives only in the error log it wrote alongside. Without this the
 * caller can only report a generic failure that names no cause.
 */
export async function describeFailedPreview(
  config: Tm1Config,
  status: string,
  processName: string,
  knownLogFile?: string,
): Promise<string> {
  const file = knownLogFile ?? await findLatestErrorLogFile(config, processName);
  const detail = file ? (await fetchErrorLog(config, file))?.trim() : undefined;
  return detail ? `${status} — ${detail}` : status;
}

/**
 * Run the inline process, read the capture log, delete it.
 *
 * Returns undefined when the execution call itself failed (non-2xx or network),
 * so the caller can fall through to another read strategy. Throws only when the
 * process ran and aborted — that is a real, reportable failure with a cause.
 */
export async function runInlinePreview(
  config: Tm1Config,
  body: string,
  opts: InlinePreviewOptions,
): Promise<InlinePreviewResult | undefined> {
  const action = opts.expandErrorLog
    ? 'ExecuteProcessWithReturn?$expand=ErrorLogFile'
    : 'ExecuteProcessWithReturn';

  let exec;
  try {
    exec = await apiRequest('POST', action, body, undefined, config);
  } catch {
    return undefined;
  }
  if (!isOk(exec)) { return undefined; }

  const parsed = JSON.parse(exec.body || '{}') as {
    ProcessExecuteStatusCode?: string;
    ErrorLogFile?: { Filename?: string };
  };
  const status = String(parsed.ProcessExecuteStatusCode ?? '');
  const serverLogName = parsed.ErrorLogFile?.Filename;

  if (classifyExecuteStatus(status) === 'major') {
    throw new Error(await describeFailedPreview(config, status, opts.processName, serverLogName));
  }

  const logPath = opts.logPath
    ?? (serverLogName ? `ErrorLogFiles('${encodeODataKey(serverLogName)}')` : undefined);
  if (!logPath) { return { status }; }

  let text: string | undefined;
  try {
    const log = await apiRequestBinary('GET', `${logPath}/Content`, undefined, config);
    if (isOk(log)) {
      text = decodeServerText(log.body);
    }
  } catch { /* text stays undefined */ }

  // Best-effort cleanup (fire-and-forget) — but NOT silent: the log holds
  // verbatim datasource rows, so a server that refuses the DELETE leaves that
  // data behind and the user must be able to see why.
  apiRequest('DELETE', logPath, undefined, undefined, config)
    .then((del) => {
      if (!isOk(del)) {
        console.warn(`[${opts.label}] temp log not deleted (HTTP ${del.statusCode}) — it still holds ${opts.describeContents} on the TM1 server`);
      }
    })
    .catch((err) => {
      console.warn(`[${opts.label}] temp log not deleted: ${errMsg(err)} — it still holds ${opts.describeContents} on the TM1 server`);
    });

  return { text, status };
}

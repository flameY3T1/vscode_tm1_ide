import { apiRequest } from './client';
import { parseBody, odataErrorMessage } from './parseRest';
import type { ODataError } from './odataTypes';
import type { Tm1Config } from './transport/types';
import { withSandbox, getActiveSandboxName } from './sandboxTracker';
import { encodeODataKey } from '../utils/odataKey';
import { Tm1HttpError } from './httpError';
import { logRestBestEffort } from './bestEffort';
import { escapeRegex } from '../utils/escapeRegexPure';

export type ExecuteSeverity = 'success' | 'minor' | 'major';

export interface ExecuteResult {
  status: string;
  severity: ExecuteSeverity;
  errorMessage?: string;
  /** ErrorLog filename returned by the server — present on minor/major errors. */
  logFilename?: string;
  /** Number of minor-error entries. TM1 reports no count anywhere in the REST
   * response (`ProcessExecuteResult` carries only the status code + a log
   * filename — verified live on 11.8 $metadata), so this is derived by counting
   * non-empty lines of the ErrorLog content. Best-effort, present on minor runs. */
  minorCount?: number;
}

/** Count minor-error entries in a TM1 ErrorLog. Each minor error is one line;
 * there is no numeric count in the REST response, so line-counting is the only
 * available signal. Blank lines and a trailing newline are ignored. */
export function countLogEntries(content: string | undefined): number | undefined {
  if (!content) { return undefined; }
  const n = content.split('\n').filter(l => l.trim() !== '').length;
  return n > 0 ? n : undefined;
}

/** Map a TM1 `ProcessExecuteStatusCode` to a coarse severity. Minor errors
 * (`HasMinorErrors` / `CompletedWithMessages`) must be surfaced distinctly —
 * a run that completes with minor errors is NOT a clean success. */
export function classifyExecuteStatus(status: string): ExecuteSeverity {
  switch (status) {
    case 'CompletedSuccessfully':
    case 'Successful':
    case '':
      return 'success';
    case 'HasMinorErrors':
    case 'CompletedWithMessages':
      return 'minor';
    default:
      return 'major';
  }
}

/**
 * Turn a v12 `ProcessLog_*.jsonl` into the plain lines a v11 `.log` would hold.
 *
 * v12 logs one JSON object per line — `{"id":1,"level":"error","timestamp":"…",
 * "name":"<proc>","message":"…"}`. Handing that raw to the user buries the one
 * sentence that matters ("Unable to open data source '…'") in transport noise,
 * so keep the `error`/`warn` messages and drop the `info` bookkeeping
 * ("executed by user", "execution aborted with errors").
 *
 * Pure and total: input that is not JSONL comes back unchanged, and so does a
 * log whose only entries are `info` (better a noisy message than none).
 */
export function condenseProcessLogJsonl(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '');
  if (lines.length === 0 || !lines.every(l => l.startsWith('{'))) { return text; }
  const entries: Array<{ level?: string; message?: string }> = [];
  for (const l of lines) {
    try { entries.push(JSON.parse(l) as { level?: string; message?: string }); } catch { return text; }
  }
  const notable = entries.filter(e => e.level === 'error' || e.level === 'warn');
  const picked = (notable.length > 0 ? notable : entries)
    .map(e => (e.message ?? '').trim())
    .filter(m => m !== '');
  return picked.length > 0 ? picked.join('\n') : text;
}

/** Read an ErrorLog's content (BOM-stripped, v12 JSONL condensed). Exported for
 *  the transient-exec path (`transientProcess.ts`), which needs the identical readback. */
export async function fetchErrorLog(cfg: Tm1Config, filename: string): Promise<string | undefined> {
  // TM1 11.8 exposes the log via ErrorLogFiles('<name>')/Content (raw text, may
  // carry a BOM); older servers use ErrorLogs('<name>')/tm1.GetContent. Try the
  // modern endpoint first, fall back to the legacy one.
  try {
    // `encodeODataKey`, not `encodeURIComponent`: an apostrophe in the filename
    // must be doubled INSIDE the key literal, otherwise the literal breaks
    // open (B11 — the legacy branch below already did it right).
    const enc = encodeODataKey(filename);
    const res = await apiRequest('GET', `ErrorLogFiles('${enc}')/Content`, undefined, 0, cfg, withSandbox(cfg));
    if (res.statusCode === 200 && res.body) {
      const raw = res.body.charCodeAt(0) === 0xFEFF ? res.body.slice(1) : res.body;
      return condenseProcessLogJsonl(raw);
    }
  } catch { /* fall through to legacy endpoint */ }
  try {
    const enc = encodeODataKey(filename);
    const res = await apiRequest('GET', `ErrorLogs('${enc}')/tm1.GetContent`, undefined, undefined, cfg);
    if (res.statusCode === 200) {
      const raw = res.body;
      const json = parseBody<{ Content?: string; value?: string }>(res);
      const content = json.Content ?? json.value ?? raw;
      return content;
    }
  } catch (e) { logRestBestEffort('execution', `read error log ${filename}`, e); /* caller falls back to status-only message */ }
  return undefined;
}

/**
 * ExecuteWithReturn omits `ErrorLogFile` on some servers (verified on TM1 11.8)
 * even when the run has minor/serious errors. The server still writes a
 * `TM1ProcessError_<YYYYMMDDHHMMSS>_<pid>_<processName>.log` — find the newest one
 * for this process so the caller can still offer the log. The timestamp is
 * embedded in the name, so a lexicographic sort is chronological.
 *
 * Exported for the transient-exec path (`transientProcess.ts`): the unbound
 * `ExecuteProcessWithReturn` answers exactly like `tm1.ExecuteWithReturn` and
 * therefore names no `ErrorLogFile` either.
 */
export async function findLatestErrorLogFile(cfg: Tm1Config, processName: string): Promise<string | undefined> {
  try {
    const res = await apiRequest('GET', 'ErrorLogFiles', undefined, 0, cfg, withSandbox(cfg));
    if (res.statusCode !== 200) { return undefined; }
    const json = JSON.parse(res.body) as { value?: Array<{ Filename?: string }> };
    // Anchor the whole name — a bare `_<processName>.log` suffix is ambiguous
    // (process "Import" would also match "…_Reporting_Import.log"). Require the
    // exact `TM1ProcessError_<ts>_<pid>_<processName>.log` shape: two digit runs
    // (timestamp, pid) between prefix and the escaped process name.
    const esc = escapeRegex(processName);
    // v11 writes `TM1ProcessError_<ts>_<pid>_<name>.log`, v12 writes
    // `ProcessLog_<ts>_<id>_<name>.jsonl` (live-verified 2026-07-26) — without
    // the second shape every v12 failure degrades to a status-only message.
    const re = new RegExp(`^(?:TM1ProcessError_\\d+_\\d+_${esc}\\.log|ProcessLog_\\d+_\\d+_${esc}\\.jsonl)$`);
    const matches = (json.value ?? [])
      .map(f => f.Filename)
      .filter((f): f is string => !!f && re.test(f));
    if (matches.length === 0) { return undefined; }
    // Sort by the EMBEDDED timestamp, not the whole name: the two prefixes sort
    // against each other alphabetically, so a plain sort would pick whichever
    // prefix comes last rather than the newest log.
    const stamp = (f: string): string => /_(\d+)_\d+_/.exec(f)?.[1] ?? '';
    matches.sort((a, b) => stamp(a).localeCompare(stamp(b)) || a.localeCompare(b));
    return matches[matches.length - 1];
  } catch { return undefined; }
}

/**
 * POST /Processes('<name>')/tm1.Execute — runs a process with parameters and returns
 * an {@link ExecuteResult} with status + optional errorMessage (fetched from ErrorLogs).
 * Uses timeoutMs=0 (no inactivity timer) — process execution can take arbitrarily long.
 */
export async function executeProcess(
  processName: string,
  parameters: Array<{ Name: string; Value: string | number }> = [],
  config: Tm1Config,
): Promise<ExecuteResult> {
  const cfg = config;

  const enc = encodeODataKey(processName);
  const body = JSON.stringify({ Parameters: parameters });
  // Sandbox propagation into TI runtime is a known TM1 limitation:
  //   - TM1 v11.x: NEITHER the TM1-Sandbox header NOR the `!sandbox` URL
  //     parameter (raw or %21-encoded) propagate into tm1.Execute's runtime.
  //     TI cell-writes always hit base. The only workaround is to add
  //     `ServerSandboxNameSet('<name>');` as the first line of the prolog
  //     manually in the TI source.
  //   - PA 2.x:    the `!sandbox` URL parameter is honored (TM1py-canonical).
  // We still send both signals (header via withSandbox + URL param) so PA 2.x
  // gets the correct routing automatically. v11 users see this as a no-op
  // for TI — direct CubeViewer/MDX writes remain fully sandbox-aware.
  const sbName = getActiveSandboxName(cfg);
  // tm1.ExecuteWithReturn (NOT tm1.Execute): returns HTTP 200 with
  // { ProcessExecuteStatusCode, ErrorLogFile: { Filename } } for EVERY outcome —
  // including minor AND serious errors. Plain tm1.Execute returns 204 No Content,
  // so minor errors were indistinguishable from success and no error-log filename
  // was ever available.
  const url = sbName
    ? `Processes('${enc}')/tm1.ExecuteWithReturn?%21sandbox=${encodeURIComponent(sbName)}`
    : `Processes('${enc}')/tm1.ExecuteWithReturn`;
  const res = await apiRequest('POST', url, body, 0, cfg, withSandbox(cfg));

  if (res.statusCode === 204) {
    return { status: 'Successful', severity: 'success' };
  }

  if (res.statusCode === 200 || res.statusCode === 201) {
    try {
      const json = JSON.parse(res.body);
      const status = json.ProcessExecuteStatusCode ?? 'Successful';
      // ErrorLogFile is a bare filename string on some TM1 versions and a
      // { Filename } document object on others — accept both.
      const elf = json.ErrorLogFile;
      let logFilename: string | undefined = typeof elf === 'string' ? elf : elf?.Filename;
      const severity = classifyExecuteStatus(status);
      // Verified on TM1 11.8: ExecuteWithReturn returns the status code but NOT an
      // ErrorLogFile — recover the newest TM1ProcessError log for this process so
      // minor/serious runs can still offer the log to open.
      if (!logFilename && severity !== 'success') {
        logFilename = await findLatestErrorLogFile(cfg, processName);
      }
      let errorMessage: string | undefined;
      if (logFilename) {
        errorMessage = await fetchErrorLog(cfg, logFilename);
      }
      // Minor-error count is not in the REST response — derive it from the log.
      const minorCount = severity === 'minor' ? countLogEntries(errorMessage) : undefined;
      return { status, severity, errorMessage, logFilename, minorCount };
    } catch {
      // HTTP 200 but the body is not parseable (proxy HTML, truncation): do NOT
      // report it as success — the actual process status is unknown. The
      // consumer treats everything except 'Successful'/'' as an error.
      const snippet = String(res.body ?? '').slice(0, 200);
      return { status: 'Unknown', severity: 'major', errorMessage: `Unparseable execute response (HTTP 200): ${snippet}` };
    }
  }

  // 503 = TM1 still loading all cubes into RAM at startup (or overloaded).
  // Surface a plain "not ready" hint instead of the raw HTML/empty body.
  if (res.statusCode === 503) {
    throw new Error('TM1 server not ready (HTTP 503) — still starting up or overloaded. Please retry shortly.');
  }
  let detail = res.body;
  try {
    const json = JSON.parse(res.body) as ODataError & { Message?: string };
    detail = odataErrorMessage(json) ?? json.Message ?? res.body;
  } catch { /* use raw body */ }
  throw new Tm1HttpError(`HTTP ${res.statusCode}: ${detail}`, res.statusCode);
}

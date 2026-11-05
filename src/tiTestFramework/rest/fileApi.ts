/**
 * Read / delete TM1 server-side files via the OData /Files collection
 * (TM1 11.x+). Used to fetch the virtual log emitted by a clone-process
 * and to clean up after a run.
 */

import { apiRequest, apiRequestBinary } from '../../tm1Rest/client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { encodeODataKey } from '../../utils/odataKey';
import { isOk, Tm1HttpError } from '../../tm1Rest/httpError';
import { decodeServerText } from '../../utils/serverText';

export type ReadFileResult = {
  found: boolean;
  content: string;
};

export async function readFile(cfg: Tm1Config, fileName: string): Promise<ReadFileResult> {
  const res = await apiRequest(
    'GET',
    `Files('${encodeODataKey(fileName)}')/Content`,
    undefined,
    undefined,
    cfg,
  );
  if (res.statusCode === 404) {
    return { found: false, content: '' };
  }
  if (!isOk(res)) {
    throw new Tm1HttpError(`readFile('${fileName}'): HTTP ${res.statusCode} — ${res.body.slice(0, 400)}`, res.statusCode);
  }
  return { found: true, content: res.body };
}

/**
 * Read a file from the TM1 ProcessError directory (`GetProcessErrorFileDirectory()`)
 * via the `ErrorLogFiles` OData collection — `GET ErrorLogFiles('<name>')/Content`.
 * Live-verified TM1 11.8: this is the ONLY REST-visible view of that directory,
 * and it enumerates ONLY files matching `TM1ProcessError_*.log` (a plain
 * `<base>_log.txt` returns 404, and the `ErrorLogs`/`Files` collections don't
 * exist on 11.8 at all). Callers must therefore name the file `TM1ProcessError_….log`.
 * Tolerant: any non-2xx (incl. a name the collection can't resolve) yields
 * `found:false` so the caller can fall back to the manual-copy path rather than
 * aborting the capture.
 *
 * v12: `ErrorLogFiles` lists only the server's own `ProcessLog_*.jsonl`, so the
 * helper writes a bare name, which lands in the `Files` content space instead.
 */
export async function readErrorLog(cfg: Tm1Config, fileName: string): Promise<ReadFileResult> {
  let res;
  try {
    // Binary read + explicit decode: the text apiRequest coerces bytes to UTF-8,
    // which corrupts Windows-1252 umlauts written by ASCIIOutput/TextOutput.
    res = await apiRequestBinary(
      'GET',
      `${errorLogPath(cfg, fileName)}/Content`,
      undefined,
      cfg,
    );
  } catch {
    return { found: false, content: '' };
  }
  if (!isOk(res)) {
    // 404 = genuinely no such log (the common, expected case). Any OTHER non-2xx
    // (401/500/…) still falls through to found:false so capture can proceed via
    // the manual-copy fallback, but surface the real status so it isn't silently
    // indistinguishable from "no logs found".
    if (res.statusCode !== 404) {
      console.warn(
        `readErrorLog('${fileName}'): unexpected HTTP ${res.statusCode} — treating as not-found`,
      );
    }
    return { found: false, content: '' };
  }
  return { found: true, content: decodeServerText(res.body) };
}

function errorLogPath(cfg: Tm1Config, fileName: string): string {
  return cfg.version === 'v12'
    ? `Contents('Files')/Contents('${encodeODataKey(fileName)}')`
    : `ErrorLogFiles('${encodeODataKey(fileName)}')`;
}

/** Best-effort removal of a file {@link readErrorLog} read; never throws. */
export async function deleteErrorLog(cfg: Tm1Config, fileName: string): Promise<void> {
  await apiRequest('DELETE', errorLogPath(cfg, fileName), undefined, undefined, cfg).catch(() => undefined);
}

export async function deleteFile(cfg: Tm1Config, fileName: string): Promise<void> {
  const res = await apiRequest(
    'DELETE',
    `Files('${encodeODataKey(fileName)}')`,
    undefined,
    undefined,
    cfg,
  );
  if (res.statusCode === 404) return;
  if (!isOk(res)) {
    throw new Tm1HttpError(`deleteFile('${fileName}'): HTTP ${res.statusCode} — ${res.body.slice(0, 400)}`, res.statusCode);
  }
}

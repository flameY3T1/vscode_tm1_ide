import * as vscode from 'vscode';
import * as path from 'node:path';
import { errMsg } from '../../utils/errMsg';
import { apiRequestBinary } from '../../tm1Rest/client';
import { runInlinePreview } from './previewExec';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { encodeODataKey } from '../../utils/odataKey';
import { decodeServerText } from '../../utils/serverText';
import { buildContentsUrl, buildServerPreviewProcess, countPhysicalLines, newRecordScan, parsePreviewParams, parsePreviewRows, scanRecords, utf8SafeEnd } from './asciiPreviewPure';
import { isOk } from '../../tm1Rest/httpError';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

/** Monotonic sequence for unique preview log names within a session. */
let _previewSeq = 0;

/** Label of the transient preview process — also how its error log is named. */
const PREVIEW_PROC_NAME = '}tm1ide_dspreview';

/**
 * v12 only: read the datasource file DIRECTLY, with no TI execution at all.
 *
 * v12 exposes a real file space — `Contents('Files')/Contents('<name>')/Content`
 * returns the bytes verbatim (live-verified 2026-07-26, umlauts intact). This is
 * what Arc/PAW appear to do, and on v12 it is also the cleanest channel:
 * nothing is written, nothing has to be cleaned up, and a file the server does
 * not have fails as a plain 404 instead of an aborted process.
 *
 * v11 has no equivalent — its `Contents` root only holds `Applications` and
 * `Blobs` (uploads), never the data directory — so the TI path stays primary
 * there.
 *
 * Returns undefined for anything but a 2xx, so the caller falls through.
 */
async function readViaContentsFiles(config: Tm1Config, filePath: string): Promise<string | undefined> {
  try {
    const res = await apiRequestBinary('GET', buildContentsUrl('Files', filePath), undefined, config);
    if (!isOk(res)) { return undefined; }
    return decodeServerText(res.body);
  } catch {
    return undefined;
  }
}

/**
 * Read the first `maxLines` raw lines of a server-side datasource file over pure
 * REST — the way Arc/PAW preview a file the VS Code client machine can't reach.
 *
 * TM1 11.x has no endpoint to read a data-directory file directly (Contents only
 * exposes the Blobs/Applications spaces, never the data dir). The only route is a
 * transient TI read: `POST ExecuteProcessWithReturn` with an INLINE throwaway
 * process (nothing is persisted — verified: no Processes('…') object remains). It
 * reads the datasource with a BEL delimiter so each line lands whole in `V1`, and
 * appends the first N lines to a log in the ProcessError directory — the one server
 * dir readable back via `ErrorLogFiles('<name>')/Content`. We read that log
 * (Windows-1252-aware) and delete it. The log text IS the raw file text, so it
 * feeds straight into {@link parsePreviewRows}.
 *
 * Returns the raw file text, or undefined when the server can't open the file
 * (aborted execution → no log) or lacks execute permission.
 */
interface ServerReadResult {
  /** Raw file text as the TI captured it. */
  text: string;
  /**
   * True when the TI returned as many PHYSICAL LINES as it was asked for, i.e.
   * it hit its `ProcessBreak` cap and the file is not known to have ended.
   *
   * The TI reads with an empty quote char, so it counts physical lines, while
   * {@link parsePreviewRows} merges quoted multi-line fields into one record.
   * Without this flag a file with embedded newlines yields fewer records than
   * requested and looks complete when it is not.
   */
  hitLineCap: boolean;
}

async function readViaServerExecute(config: Tm1Config, filePath: string, maxLines: number): Promise<ServerReadResult | undefined> {
  // v12 cannot read a file back out of the ProcessError directory (`ErrorLogFiles`
  // lists only the server's own `ProcessLog_*.jsonl` there), so the capture goes
  // into the `Files` content space under a bare name instead.
  const v12 = config.version === 'v12';
  const stamp = `${Date.now()}_${_previewSeq++}`;
  const logName = v12
    ? `tm1ide_dspreview_${stamp}_output.txt`
    : `TM1ProcessError_tm1ide_dspreview_${stamp}_output.log`;
  const logPath = v12
    ? `Contents('Files')/Contents('${encodeODataKey(logName)}')`
    : `ErrorLogFiles('${encodeODataKey(logName)}')`;
  const body = JSON.stringify(buildServerPreviewProcess(filePath, maxLines, logName, { v12 }));

  const run = await runInlinePreview(config, body, {
    logPath,
    processName: PREVIEW_PROC_NAME,
    label: 'asciiPreview',
    describeContents: `up to ${maxLines} datasource lines`,
  });
  const text = run?.text;

  if (text === undefined) { return undefined; }
  return { text, hitLineCap: countPhysicalLines(text) >= Math.max(1, Math.floor(maxLines)) };
}

/**
 * Hard byte ceiling for the bounded local read. Normally the stream stops after
 * `maxRecords` records; a file with an unterminated quote never completes
 * another record, so cap the bytes too.
 */
const LOCAL_READ_BYTE_CAP = 32 * 1024 * 1024;

/**
 * Read only as much of a local file as the preview needs.
 *
 * Streams the file and stops as soon as `maxRecords` records are in — a naive
 * `readFile` would pull an 800 MB CSV into a string (and throw
 * ERR_FS_FILE_TOO_LARGE past 2 GiB) just to show 50 rows.
 *
 * Record counting happens on the RAW bytes ({@link scanRecords}): quote-aware,
 * so a quoted field with an embedded newline counts as one record like in
 * {@link parsePreviewRows}, and decode-safe, because decoding chunk by chunk
 * would corrupt multi-byte chars at chunk boundaries. The collected bytes are
 * decoded once, with the same UTF-8/Windows-1252 + BOM handling the server path
 * uses — otherwise a CP1252 file renders `M<U+FFFD>ller` and a UTF-8-BOM file
 * hides a BOM inside the first column header.
 */
export async function readLocalBounded(filePath: string, maxRecords: number, quoteChar: string): Promise<string> {
  const fs = await import('node:fs');
  const quoteByte = quoteChar.length === 1 && quoteChar.charCodeAt(0) < 0x80 ? quoteChar.charCodeAt(0) : undefined;
  const stream = fs.createReadStream(filePath);
  const chunks: Buffer[] = [];
  const scan = newRecordScan();
  let bytes = 0;
  let stoppedEarly = false;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      bytes += chunk.length;
      scanRecords(chunk, quoteByte, scan);
      if (scan.records >= maxRecords || bytes >= LOCAL_READ_BYTE_CAP) { stoppedEarly = true; break; }
    }
  } finally {
    stream.destroy();
  }
  const raw = Buffer.concat(chunks);
  // Whole chunks are kept, so the last one can end INSIDE a multi-byte UTF-8
  // sequence. decodeServerText decodes strictly — one dangling byte would drop
  // the ENTIRE preview to the Windows-1252 fallback (every umlaut mojibake).
  // Only relevant when the read stopped early; at EOF the file is complete and
  // an odd tail is genuine content (e.g. a CP1252 file), so nothing is cut.
  const end = stoppedEarly ? utf8SafeEnd(raw) : raw.length;
  return decodeServerText(raw.subarray(0, end));
}

// Once the user allows local datasource reads, remember it for the rest of the
// session so previewing further txt/csv files doesn't re-prompt on every path.
// (Real datasource files usually sit in the TM1 data dir, which the REST
// Contents endpoints don't expose, so the local fallback is the normal path.)
let _localReadsApproved = false;

/**
 * Confirm before reading a local file off the CLIENT machine. The datasource
 * path can originate from the server-side process definition, so a malicious
 * process could point it at client secrets (e.g. ~/.ssh/id_rsa). Gate the local
 * read behind an explicit user OK — asked once per session, not per path.
 */
async function _confirmLocalRead(filePath: string): Promise<boolean> {
  if (_localReadsApproved) { return true; }
  const yes = vscode.l10n.t('Read local files');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('Not found under TM1 Contents. Read the local datasource file "{0}" from this (client) machine? The path comes from the process definition; this allows local reads for the rest of this session.', filePath),
    { modal: true },
    yes,
  );
  if (choice === yes) { _localReadsApproved = true; return true; }
  return false;
}

/**
 * Reads first ~N lines from an ASCII file and returns parsed rows.
 * Tries TM1 REST Contents first (the "real" datasource lives on the TM1 host);
 * only falls back to a local client-side fs read — behind a confirm prompt —
 * when the server has nothing.
 */
export async function handleAsciiPreview(panel: vscode.WebviewPanel, msg: any, config: Tm1Config): Promise<void> {
  const params = parsePreviewParams(msg);
  if (!params.filePath) {
    postTo<HostToWebview>(panel.webview, { type: 'asciiPreview', error: vscode.l10n.t('No file path given.') });
    return;
  }

  let text: string | undefined;
  let source: 'client' | 'server' | null = null;
  // See ServerReadResult.hitLineCap — the server path caps PHYSICAL LINES, not records.
  let serverHitLineCap = false;

  // One record MORE than shown: the extra one is what makes "the file has more"
  // detectable at all — the TI ProcessBreaks right after it, so nothing else
  // about the file's size is ever known.
  const wantRecords = params.maxLines + 1;

  // Everything up to the parse runs inside one guard: buildServerPreviewProcess
  // asserts its log name, and the confirm prompt is a vscode call — an escaping
  // throw would leave the webview spinner running forever with no message.
  try {
    // Attempt 0 (v12 only): plain file read, no TI at all. v12 serves the data
    // directory as the `Files` content space, so the datasource can be fetched
    // directly — no throwaway process, no capture file, no cleanup. Skipped on
    // v11, whose `Contents` root exposes only Applications/Blobs.
    if (config.version === 'v12') {
      const direct = await readViaContentsFiles(config, params.filePath);
      if (direct !== undefined) {
        text = direct;
        source = 'server';
        // Whole-file read: the record cap in parsePreviewRows reports truncation,
        // there is no server-side line cap to account for.
        serverHitLineCap = false;
      }
    }

    // Attempt 1: server-side read via a transient inline TI process. The datasource
    // file lives on the TM1 host — this is the only way to preview it when the VS
    // Code client machine has no access to that path (the normal remote case, and
    // what Arc/PAW do). Nothing is persisted on the server.
    if (text === undefined) {
      const server = await readViaServerExecute(config, params.filePath, wantRecords);
      if (server !== undefined) {
        text = server.text;
        source = 'server';
        serverHitLineCap = server.hitLineCap;
      }
    }

    // Attempt 2: client-side read via fs — only when VS Code runs on (or has access
    // to) the TM1 host. ONLY for absolute paths (a relative datasource name resolves
    // against the extension-host CWD, never the TM1 data dir). Gated behind a confirm
    // prompt because the path may be server-controlled and point at client secrets.
    if (text === undefined && path.isAbsolute(params.filePath)) {
      if (await _confirmLocalRead(params.filePath)) {
        try {
          text = await readLocalBounded(params.filePath, wantRecords, params.quoteChar);
          source = 'client';
        } catch { /* text stays undefined */ }
      }
    }
  } catch (err) {
    postTo<HostToWebview>(panel.webview, { type: 'asciiPreview', error: errMsg(err) });
    return;
  }

  if (text === undefined) {
    postTo<HostToWebview>(panel.webview, {
      type: 'asciiPreview',
      error: vscode.l10n.t('Could not read the datasource file. The TM1 server could not open "{0}" (missing/inaccessible on the host), and it is not reachable from this machine either.', params.filePath),
    });
    return;
  }

  try {
    const { rows, truncated } = parsePreviewRows(text, params.maxLines, params.delimiter, params.quoteChar);
    // No `totalLines`: both reads stop after maxLines+1 records, so the file's
    // real record count is unknown here. The webview renders the unknown total
    // as "?" rather than a made-up number.
    //
    // `serverHitLineCap` makes the two read paths agree on "there is more": the
    // local read stops after maxLines+1 RECORDS (so `truncated` alone is right),
    // the server TI stops after maxLines+1 PHYSICAL LINES. With quoted multi-line
    // records the server therefore returns fewer records than asked for and
    // `truncated` would say false while the TI actually ProcessBreak'd mid-file.
    // Erring towards "more" is the safe side: the alternative presents a partial
    // file as complete.
    postTo<HostToWebview>(panel.webview, {
      type: 'asciiPreview',
      rows,
      headerRecords: params.headerRecords,
      truncated: truncated || serverHitLineCap,
      source,
    });
  } catch (err) {
    postTo<HostToWebview>(panel.webview, { type: 'asciiPreview', error: errMsg(err) });
  }
}

/** Pure helpers for asciiPreview command — no vscode dependencies. */

import { parseAsciiLine } from './processEditorUtils';
import { encodeODataKey } from '../../utils/odataKey';

export interface PreviewParams {
  filePath: string;
  delimiter: string;
  quoteChar: string;
  headerRecords: number;
  maxLines: number;
}

/**
 * Normalize incoming preview-request message to typed params.
 * Pure — accepts any payload, applies defaults + clamping.
 *
 * Clamping: `maxLines` ∈ [10, 500], default 50.
 */
export function parsePreviewParams(msg: { filePath?: unknown; delimiter?: unknown; quoteChar?: unknown; headerRecords?: unknown; maxLines?: unknown }): PreviewParams {
  return {
    filePath: String(msg.filePath ?? ''),
    delimiter: String(msg.delimiter ?? ','),
    quoteChar: String(msg.quoteChar ?? '"'),
    headerRecords: parseInt(String(msg.headerRecords ?? 0), 10) || 0,
    maxLines: Math.max(10, Math.min(500, parseInt(String(msg.maxLines ?? 50), 10) || 50)),
  };
}

/**
 * Build TM1 Contents OData URL for a file path.
 *
 * Splits the path on `/`, drops Windows drive segments (`C:`), and chains
 * `Contents('<seg>')` for each non-empty segment, ending in `/Content`.
 *
 * Used to address v12 `Files` and v11 `Blobs` spaces.
 *
 * @param root  Root space, e.g. `'Files'` or `'Blobs'`.
 * @param p     File path, may use either separator and may include a Windows drive letter.
 */
export function buildContentsUrl(root: string, p: string): string {
  const normalized = p.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(s => s.length > 0 && !/^[A-Za-z]:$/.test(s));
  const chain = segments.map(s => `Contents('${encodeODataKey(s)}')`).join('/');
  return `Contents('${root}')/${chain}/Content`;
}

/**
 * Accepted shape for the transient preview log name. `ErrorLogFiles` only
 * enumerates `TM1ProcessError_*.log` on 11.8, and the name goes verbatim into a
 * TI string literal — so no quote, no separator, no wildcard may appear in it.
 */
// At least TWO underscore-separated segments after the prefix: `ErrorLogFiles`
// serves `TM1ProcessError_a_b.log` but 404s on `TM1ProcessError_colprobe.log`,
// even though TI writes both to the same directory (measured 2026-08-17,
// odbcPreviewProbe.js). The production name has always been
// multi-segment, so this only closes a trap for future callers.
export const LOG_NAME_RE = /^TM1ProcessError_[A-Za-z0-9.-]+_[A-Za-z0-9_.-]+\.log$/;

/**
 * Same, for v12. There the capture file is written under a BARE name, which
 * lands in the `Files` content space and is read back with
 * `Contents('Files')/Contents('<name>')/Content`.
 *
 * v12 needs its own shape because a file written to
 * `GetProcessErrorFileDirectory()` is NOT enumerated by `ErrorLogFiles` there —
 * that collection only lists the server's own `ProcessLog_*.jsonl` /
 * `ChoreLog_*.jsonl`. The TI runs fine and the file exists, but nothing can
 * read it back (live-verified 2026-07-26).
 */
export const V12_LOG_NAME_RE = /^tm1ide_dspreview_[A-Za-z0-9_.-]+\.txt$/;

/**
 * Build the inline throwaway process for a server-side ASCII preview, run via
 * `POST ExecuteProcessWithReturn`. Nothing is persisted on the server — the
 * process exists only for the duration of the call.
 *
 * How it reads whole raw lines regardless of the file's real delimiter: the
 * datasource delimiter is set to BEL (never present in text files) and
 * the quote char is empty, so every source record collapses into a single
 * variable `V1` holding the verbatim line. The Metadata procedure appends the
 * first `maxLines` lines to a log in the TM1 ProcessError directory (the only
 * server dir readable back over REST, via `ErrorLogFiles('<name>')/Content`),
 * then `ProcessBreak`s so large files are not scanned in full.
 *
 * Live-verified on TM1 11.8: empty delimiter is rejected (HTTP 400
 * SystemParameterTypeInvalid) — BEL is required; empty quote makes ASCIIOutput
 * write the line verbatim with no wrapping quotes.
 *
 * @param filePath  Server-side datasource path (from the process definition).
 * @param maxLines  How many leading lines to capture.
 * @param logName   Target log filename — MUST match {@link LOG_NAME_RE} or
 *                  `ErrorLogFiles` won't enumerate it. Caller keeps it unique.
 *                  Asserted, not escaped: the name is interpolated into a TI
 *                  string literal, so a `'` in it would close that literal and
 *                  inject TI code into the transient process.
 * @throws When `logName` does not match {@link LOG_NAME_RE}.
 */
export function buildServerPreviewProcess(filePath: string, maxLines: number, logName: string, opts: { v12?: boolean } = {}): {
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
  const nameRe = opts.v12 ? V12_LOG_NAME_RE : LOG_NAME_RE;
  if (!nameRe.test(logName)) {
    throw new Error(`buildServerPreviewProcess: invalid log name (must match ${nameRe.source})`);
  }
  const n = Math.max(1, Math.floor(maxLines));
  const BEL = String.fromCharCode(7); // datasource delimiter — never occurs in text
  // Where the captured lines go. v11: the ProcessError directory, the only
  // server dir `ErrorLogFiles` serves back. v12: a bare name, which lands in
  // the `Files` content space and is read with `Contents('Files')/…/Content`.
  const target = opts.v12 ? `'${logName}'` : `GetProcessErrorFileDirectory() | '${logName}'`;
  // Metadata runs once per source record. `sO` is (re)built each record — cheap
  // and avoids relying on Prolog→Metadata variable carry-over.
  const metadata =
    '#\r\n' +
    `sO = ${target};\r\n` +
    'nR = nR + 1;\r\n' +
    `IF( nR <= ${n} );\r\n` +
    'ASCIIOutput( sO, V1 );\r\n' +
    'ENDIF;\r\n' +
    `IF( nR >= ${n} );\r\n` +
    'ProcessBreak;\r\n' +
    'ENDIF;';
  return {
    Process: {
      Name: '}tm1ide_dspreview',
      PrologProcedure: '#\r\nnR = 0;',
      MetadataProcedure: metadata,
      DataProcedure: '#',
      EpilogProcedure: '#',
      DataSource: {
        Type: 'ASCII',
        dataSourceNameForServer: filePath,
        asciiDelimiterType: 'Character',
        asciiDelimiterChar: BEL, // BEL, never in text — forces the whole line into V1
        asciiQuoteCharacter: '',      // empty → ASCIIOutput writes V1 verbatim
        asciiDecimalSeparator: '.',
        asciiThousandSeparator: ',',
        asciiHeaderRecords: 0,        // capture ALL lines incl. header; UI shows row 0 as header
      },
      Variables: [{ Name: 'V1', Type: 'String', Position: 1 }],
    },
    Parameters: [],
  };
}

export interface PreviewParseResult {
  rows: string[][];
  /**
   * True when the source held at least one more record than `maxLines`.
   *
   * There is deliberately NO total-record count: both read paths are bounded
   * (the server TI `ProcessBreak`s, the local read stops streaming), so the
   * text handed in is never the whole file and any total derived from it would
   * be a lie. Both paths read `maxLines + 1` records so "there is more" stays
   * detectable.
   */
  truncated: boolean;
}

/**
 * Ceiling for a SINGLE preview record. The read cap bounds the bytes fetched,
 * not the parse: one unterminated quote turns the whole read into a single
 * record, which would otherwise be built char-by-char and then run through
 * {@link parseAsciiLine} — tens of MB of string building on the extension-host
 * thread for a row nobody can read anyway.
 */
export const PREVIEW_MAX_RECORD_CHARS = 64 * 1024;

/**
 * Ceiling for the whole record scan. Bounds the loop itself (not just the
 * per-record buffer) so a pathological input can never turn the preview into a
 * multi-second freeze.
 */
export const PREVIEW_MAX_SCAN_CHARS = 4 * 1024 * 1024;

/**
 * Split raw file text into records, quote-aware: a line terminator inside an
 * open quoted field does NOT end the record.
 *
 * Stops after `limit` records — the caller only ever renders `maxLines`, and
 * one extra record is all that is needed to detect truncation.
 *
 * Bounded twice more: at most {@link PREVIEW_MAX_SCAN_CHARS} characters are
 * scanned, and a single record stops growing at
 * {@link PREVIEW_MAX_RECORD_CHARS} (scanning continues, so the record still
 * ends at the right place — only the retained text is capped).
 * {@link parsePreviewRows} turns either cap into `truncated`.
 *
 * A trailing terminator does not produce a phantom empty record; a blank line
 * in the middle of the file does produce an empty record.
 */
export function splitPreviewRecords(text: string, quoteChar: string, limit: number): string[] {
  const out: string[] = [];
  const q = quoteChar.length === 1 ? quoteChar : '';
  const end = Math.min(text.length, PREVIEW_MAX_SCAN_CHARS);
  let current = '';
  let inQuote = false;
  for (let i = 0; i < end && out.length < limit; i++) {
    const ch = text[i];
    if (q && ch === q) {
      // Plain toggle — a doubled quote ("") flips twice and stays inside the
      // field, which is exactly what parseAsciiLine unescapes later.
      inQuote = !inQuote;
      if (current.length < PREVIEW_MAX_RECORD_CHARS) { current += ch; }
      continue;
    }
    if (!inQuote && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') { i++; }
      out.push(current);
      current = '';
      continue;
    }
    if (current.length < PREVIEW_MAX_RECORD_CHARS) { current += ch; }
  }
  if (current !== '' && out.length < limit) { out.push(current); }
  return out;
}

/**
 * Parse preview text into rows.
 *
 * Record splitting is quote-aware ({@link splitPreviewRecords}), per-record
 * field splitting is delegated to {@link parseAsciiLine}. At most `maxLines`
 * rows come back; one extra record is read to set `truncated`.
 *
 * Trailing BLANK lines are trimmed, but a record of empty fields (`,,`) is
 * kept — it is a real record.
 */
export function parsePreviewRows(text: string, maxLines: number, delimiter: string, quoteChar: string): PreviewParseResult {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; // strip BOM
  const cap = Math.max(1, Math.floor(maxLines));
  const records = splitPreviewRecords(src, quoteChar, cap + 1);
  // A parse bound that actually bit means there IS more than what is shown —
  // report it as truncation rather than presenting a silently cut record as
  // the complete file.
  const parseBounded = src.length > PREVIEW_MAX_SCAN_CHARS
    || records.some(r => r.length >= PREVIEW_MAX_RECORD_CHARS);
  const truncated = records.length > cap || parseBounded;
  const rows = records.slice(0, cap).map(l => parseAsciiLine(l, delimiter, quoteChar));
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') { rows.pop(); }
  return { rows, truncated };
}

/**
 * Count PHYSICAL lines (LF, CRLF or bare CR), quote-UNaware.
 *
 * This is what the server-side TI counts: it reads with an empty quote char, so
 * it `ProcessBreak`s after N physical lines — while {@link parsePreviewRows}
 * merges a quoted multi-line field into ONE record. Comparing this count with
 * the number of lines requested is the only way to tell whether the TI stopped
 * at its cap (⇒ more data exists) or simply ran out of file.
 *
 * A trailing line without a terminator counts; empty text is 0 lines.
 */
export function countPhysicalLines(text: string): number {
  if (text.length === 0) { return 0; }
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\r') {
      if (text[i + 1] === '\n') { i++; }
      n++;
    } else if (ch === '\n') {
      n++;
    }
  }
  const last = text[text.length - 1];
  if (last !== '\n' && last !== '\r') { n++; }
  return n;
}

/**
 * Byte offset of the end of the last COMPLETE UTF-8 sequence in `buf`.
 *
 * A bounded read stops on an arbitrary chunk boundary, which can fall inside a
 * 2/3/4-byte sequence. Strict UTF-8 decoding then throws over that one dangling
 * byte and the whole buffer falls back to Windows-1252 — the entire preview
 * turns into mojibake because of the last byte. Cutting the incomplete tail off
 * first keeps the decode strict-clean.
 *
 * Conservative: only a byte sequence that really is a valid-but-incomplete
 * UTF-8 prefix is dropped. A Windows-1252 tail (e.g. a trailing `0xFC`, which
 * is no legal UTF-8 lead) is left alone so the 1252 fallback still sees it.
 */
export function utf8SafeEnd(buf: Uint8Array): number {
  const len = buf.length;
  // A UTF-8 sequence is at most 4 bytes, so the lead byte of an incomplete
  // trailing sequence is within the last 4 bytes.
  for (let back = 1; back <= 4 && back <= len; back++) {
    const b = buf[len - back];
    if (b < 0x80) { return len; }                 // ASCII — nothing pending
    if (b <= 0xbf) { continue; }                  // continuation — keep walking back
    const need = b >= 0xf0 && b <= 0xf4 ? 4
      : b >= 0xe0 && b <= 0xef ? 3
        : b >= 0xc2 && b <= 0xdf ? 2
          : 0;                                    // not a legal UTF-8 lead
    if (need === 0) { return len; }
    return back < need ? len - back : len;
  }
  return len;                                     // no lead byte in reach — not UTF-8
}

/** Quote-aware byte-level record counter — state for {@link scanRecords}. */
export interface RecordScan {
  /** Completed records seen so far. */
  records: number;
  /** True while inside an open quoted field. */
  inQuote: boolean;
  /** True when the previous byte was a CR (so a following LF is the same break). */
  lastWasCr: boolean;
}

export function newRecordScan(): RecordScan {
  return { records: 0, inQuote: false, lastWasCr: false };
}

/**
 * Advance the record count over one RAW chunk, so a streaming read can stop as
 * soon as enough records are in without decoding anything.
 *
 * Byte-level on purpose: decoding chunk by chunk corrupts multi-byte chars at
 * chunk boundaries (see the transport UTF-8 rule). Counting bytes is safe for
 * UTF-8 and Windows-1252 alike, because an ASCII byte (`\n`, `\r`, `"`) never
 * occurs inside a UTF-8 multi-byte sequence.
 *
 * @param quoteByte Quote char as a single ASCII byte, or undefined to ignore quoting.
 */
export function scanRecords(chunk: Uint8Array, quoteByte: number | undefined, state: RecordScan): RecordScan {
  for (let i = 0; i < chunk.length; i++) {
    const b = chunk[i];
    if (quoteByte !== undefined && b === quoteByte) {
      state.inQuote = !state.inQuote;
      state.lastWasCr = false;
      continue;
    }
    if (!state.inQuote && b === 0x0d) {          // CR ends the record
      state.records++;
      state.lastWasCr = true;
      continue;
    }
    if (!state.inQuote && b === 0x0a) {          // LF ends it, unless CRLF
      if (!state.lastWasCr) { state.records++; }
      state.lastWasCr = false;
      continue;
    }
    state.lastWasCr = false;
  }
  return state;
}

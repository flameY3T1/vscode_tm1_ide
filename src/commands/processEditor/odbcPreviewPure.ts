/**
 * ODBC datasource preview — pure part. No vscode, no REST.
 *
 * ## Why the rows travel through a rejected record
 *
 * TM1 has no way to hand TI output back in a response body: `ProcessExecuteResult`
 * consists of a status code and a navigation property to an error log, and
 * `$expand=ErrorLogFile($select=Content)` returns only an `@odata.id` (measured
 * 2026-08-17, odbcPreviewProbe.js). Rows therefore always arrive
 * through a file, which we read and delete.
 *
 * Of the two ways to fill that file, `ItemReject` beats writing our own
 * `ASCIIOutput` lines, all live-measured against a Postgres source
 * (odbcPreviewTypesProbe.js):
 *
 * - **Numbers stay locale-independent.** `ItemReject` dumps `1234.567`;
 *   `ASCIIOutput` on the same row writes `1234,567` on a German server, because
 *   the value has to pass through a `String` variable first. The comma is an
 *   artefact of the preview, not what the process will see.
 * - **No variables needed.** The rejected-record dump prints every column of the
 *   source row even when the process declares no variables at all (verified with
 *   0 declared variables and 2, 4 and 60 columns). `ASCIIOutput` can only print
 *   declared variables, so it would need synthetic ones and could not tell a
 *   genuinely empty trailing column from padding.
 * - **It cannot abort on variable types.** `ASCIIOutput( sO, V1 )` with `V1`
 *   declared `Numeric` fails the whole run ("ungültiger Zeichenfolgeausdruck"),
 *   which every process with a numeric variable would have hit.
 *
 * What both share, and what the UI has to admit: `NULL` and the empty string both
 * arrive as an empty field, and integers beyond 2^53 lose precision on the way in
 * (9007199254740993 read back as …992) — that happens inside TM1's ODBC read, not
 * in either output path.
 */

import { cleanDataSource, normalizeReadDataSource } from '../../utils/dataSourceWire';

/**
 * Passed to `ItemReject` as the rejection reason. It ends up in the log line
 * after the record's fields, and is deliberately never parsed — the parser stops
 * at the first field that is not quoted, whatever the server's language.
 */
export const PREVIEW_REJECT_REASON = 'tm1ide-preview';

/** Hard ceiling on rows a single preview may request. */
export const MAX_PREVIEW_ROWS = 1000;

export interface OdbcPreviewProcess {
  Process: {
    Name: string;
    PrologProcedure: string;
    MetadataProcedure: string;
    DataProcedure: string;
    EpilogProcedure: string;
    DataSource: Record<string, unknown>;
    Variables: never[];
  };
  Parameters: never[];
}

/**
 * Build the inline throwaway process that previews an ODBC datasource.
 *
 * Nothing is persisted: `ExecuteProcessWithReturn` takes the process as payload
 * and leaves no `Processes('…')` object behind (verified 2026-08-17).
 *
 * @param wireDataSource ODBC datasource in TM1's own wire spelling (`query`,
 *        `userName`, `password`, …) — build it with
 *        `utils/dataSourceWire#cleanDataSource`, never by hand.
 * @param maxRows Rows to display. One MORE record is rejected than that, which
 *        is the only thing that makes "there are more rows" detectable; the
 *        process breaks right after it, so the total row count stays unknown.
 */
export function buildOdbcPreviewProcess(
  wireDataSource: Record<string, unknown>,
  maxRows: number,
): OdbcPreviewProcess {
  const n = Math.min(MAX_PREVIEW_ROWS, Math.max(1, Math.floor(maxRows)));
  const probe = n + 1;
  const CR = '\r\n';
  // The reason string is interpolated into a TI string literal, so a `'` in it
  // would close that literal. It is a module constant, but assert rather than
  // trust — this is the one place a stray quote would break the whole run.
  if (PREVIEW_REJECT_REASON.includes("'")) {
    throw new Error('buildOdbcPreviewProcess: reject reason must not contain a quote');
  }
  const dataProcedure =
    '#' + CR +
    'nR = nR + 1;' + CR +
    `IF( nR <= ${probe} );` + CR +
    `ItemReject( '${PREVIEW_REJECT_REASON}' );` + CR +
    'ENDIF;' + CR +
    `IF( nR >= ${probe} );` + CR +
    'ProcessBreak;' + CR +
    'ENDIF;';
  return {
    Process: {
      Name: '}tm1ide_odbcpreview',
      PrologProcedure: '#' + CR + 'nR = 0;',
      MetadataProcedure: '#',
      DataProcedure: dataProcedure,
      EpilogProcedure: '#',
      DataSource: { ...wireDataSource, Type: 'ODBC' },
      // Deliberately none: the rejected-record dump prints all source columns
      // regardless, and declaring numeric ones would abort the run.
      Variables: [],
    },
    Parameters: [],
  };
}

/**
 * Form state → the wire datasource the preview payload needs.
 *
 * The webview hands over what its own `getDataSource()` produced, which is
 * ALREADY wire-spelled (`query`, `userName`). Cleaning that a second time would
 * look for `Query`/`UserName`, find nothing and preview an empty query — TM1
 * answers that with `Fehler beim Ausführen der SQL Abfrage: ""`, naming no cause.
 * Normalising first accepts either spelling, so this is idempotent.
 *
 * The password is carried by hand because `normalizeReadDataSource` deliberately
 * drops it (it only reports that one is stored) — a password typed into the form
 * would otherwise never reach the preview.
 */
export function toPreviewWireDataSource(raw: Record<string, unknown>): Record<string, unknown> {
  const typedPassword = [raw.password, raw.Password].find(v => typeof v === 'string' && v !== '');
  return cleanDataSource({
    ...normalizeReadDataSource(raw),
    Password: typedPassword as string | undefined,
  }) as unknown as Record<string, unknown>;
}

/**
 * Split one reject-log line into the source record's fields.
 *
 * A line looks like `"42","abc","",<server message>` — the record's fields are
 * quoted and comma-separated, the appended message is not quoted. Parsing stops
 * at the first unquoted field, so the message never has to be recognised and the
 * server's language is irrelevant.
 *
 * TM1 does NOT escape a quote inside a value: `a"b` is written as `"a"b"`
 * (measured). The scan therefore accepts a closing quote only when a comma or
 * the line end follows, which reads such values correctly. The one shape that
 * still misparses is a value containing the exact sequence `","`.
 */
export function splitRejectLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length && line[i] === '"') {
    let from = i + 1;
    let closed = false;
    for (;;) {
      const q = line.indexOf('"', from);
      if (q === -1) { return fields; } // unterminated — keep what is certain
      const next = line[q + 1];
      if (next === undefined || next === ',') {
        fields.push(line.slice(i + 1, q));
        i = q + 2; // step over the closing quote and its comma
        closed = true;
        break;
      }
      from = q + 1; // an unescaped quote inside the value
    }
    if (!closed) { break; }
  }
  return fields;
}

export interface OdbcPreviewRows {
  rows: string[][];
  /**
   * True when the source held at least one row beyond `maxRows`. There is no
   * total count: the process breaks after `maxRows + 1` records, so nothing about
   * the real size is known and a number here would be invented.
   */
  truncated: boolean;
}

/** Parse a reject log into preview rows, dropping the extra probe record. */
export function parseRejectRows(text: string, maxRows: number): OdbcPreviewRows {
  const all = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(l => l.length > 0)
    .map(splitRejectLine)
    .filter(fields => fields.length > 0);
  const n = Math.max(1, Math.floor(maxRows));
  return { rows: all.slice(0, n), truncated: all.length > n };
}

/**
 * Column headers for the preview table.
 *
 * ODBC hands back no column names anywhere on this path, so the process's own
 * variable names are the closest honest label — they are what the TI code will
 * call these columns. Falls back to 1-based positions, and pads or trims to the
 * width actually returned so the table never claims a column that has no data.
 */
export function buildPreviewHeader(variableNames: string[], colCount: number): string[] {
  return Array.from({ length: Math.max(0, colCount) }, (_, i) => variableNames[i] || String(i + 1));
}

import { describe, it, expect } from 'vitest';
import { classifyExecuteStatus } from '../../tm1Rest/executionApi';
import { LOG_NAME_RE } from '../../commands/processEditor/asciiPreviewPure';
import {
  buildOdbcPreviewProcess,
  toPreviewWireDataSource,
  splitRejectLine,
  parseRejectRows,
  buildPreviewHeader,
  PREVIEW_REJECT_REASON,
  MAX_PREVIEW_ROWS,
} from '../../commands/processEditor/odbcPreviewPure';

/**
 * The fixtures are verbatim reject-log lines from TM1 11.8 against a Postgres
 * source (odbcPreviewProbe.js, `odbcPreviewTypesProbe.js`).
 */
const TYPED_LINE =
  '"42","9007199254740992","1234.567","0.1","1","2026-08-17","2026-08-17 13:45:56","abc","",'
  + 'Datenquellenzeile (1) Fehler: Data Prozedurzeile (4): tm1ide-preview';

describe('buildOdbcPreviewProcess', () => {
  const WIRE = { Type: 'ODBC', dataSourceNameForServer: 'TM1PROBE', userName: 'u', password: 'p', query: 'SELECT 1' };

  it('rejects one record more than it shows, then breaks', () => {
    const p = buildOdbcPreviewProcess(WIRE, 10);
    expect(p.Process.DataProcedure).toContain('IF( nR <= 11 );');
    expect(p.Process.DataProcedure).toContain('IF( nR >= 11 );');
    expect(p.Process.DataProcedure).toContain('ProcessBreak;');
    expect(p.Process.DataProcedure).toContain(`ItemReject( '${PREVIEW_REJECT_REASON}' );`);
  });

  // Declaring variables is what would break this: ASCIIOutput on a Numeric
  // variable aborts the run, and the record dump needs no variables at all.
  it('declares no variables and keeps the datasource wire shape', () => {
    const p = buildOdbcPreviewProcess(WIRE, 10);
    expect(p.Process.Variables).toEqual([]);
    expect(p.Process.DataSource).toMatchObject({ query: 'SELECT 1', userName: 'u', password: 'p', Type: 'ODBC' });
  });

  it('forces Type ODBC even if the caller passes something else', () => {
    expect(buildOdbcPreviewProcess({ ...WIRE, Type: 'ASCII' }, 5).Process.DataSource.Type).toBe('ODBC');
  });

  it('clamps the row count', () => {
    expect(buildOdbcPreviewProcess(WIRE, 0).Process.DataProcedure).toContain('IF( nR <= 2 );');
    expect(buildOdbcPreviewProcess(WIRE, 99999).Process.DataProcedure).toContain(`IF( nR <= ${MAX_PREVIEW_ROWS + 1} );`);
  });
});

describe('toPreviewWireDataSource', () => {
  // The regression: the webview sends what its own getDataSource() produced,
  // which is already wire-spelled. Cleaning that again read `Query`/`UserName`,
  // found nothing, and TM1 answered
  // `Fehler beim Ausführen der SQL Abfrage: ""`.
  it('keeps the fields when the form already sends wire spelling', () => {
    expect(toPreviewWireDataSource({
      Type: 'ODBC', dataSourceNameForServer: 'TM1PROBE', userName: 'tm1probe',
      password: 'ProbePw123', query: 'SELECT id FROM probe',
    })).toMatchObject({
      Type: 'ODBC', dataSourceNameForServer: 'TM1PROBE', userName: 'tm1probe',
      password: 'ProbePw123', query: 'SELECT id FROM probe',
    });
  });

  it('accepts the canonical spelling just as well', () => {
    expect(toPreviewWireDataSource({
      Type: 'ODBC', dataSourceNameForServer: 'TM1PROBE', UserName: 'tm1probe',
      Password: 'ProbePw123', Query: 'SELECT id FROM probe',
    })).toMatchObject({ userName: 'tm1probe', password: 'ProbePw123', query: 'SELECT id FROM probe' });
  });

  it('omits the password when the form has none, so the stored one can fill in', () => {
    const wire = toPreviewWireDataSource({ Type: 'ODBC', query: 'SELECT 1', password: '' });
    expect('password' in wire).toBe(false);
  });
});

describe('splitRejectLine', () => {
  it('takes the quoted fields and drops the server message', () => {
    expect(splitRejectLine('"1","a",Datenquellenzeile (1) Fehler: irgendwas')).toEqual(['1', 'a']);
  });

  it('reads all nine typed columns of a real log line', () => {
    expect(splitRejectLine(TYPED_LINE)).toEqual([
      '42', '9007199254740992', '1234.567', '0.1', '1', '2026-08-17', '2026-08-17 13:45:56', 'abc', '',
    ]);
  });

  // TM1 writes `a"b` as `"a"b"` — unescaped. Accepting a closing quote only
  // before a comma or the line end is what makes that readable.
  it('survives an unescaped quote inside a value', () => {
    expect(splitRejectLine('"1","a"b","",Fehler: x')).toEqual(['1', 'a"b', '']);
  });

  it('keeps a comma inside a quoted value', () => {
    expect(splitRejectLine('"1","a,b",Fehler: x')).toEqual(['1', 'a,b']);
  });

  it('returns what is certain when a value is never closed', () => {
    expect(splitRejectLine('"1","unterminated')).toEqual(['1']);
  });

  it('yields nothing for a line that does not start with a field', () => {
    expect(splitRejectLine('Fehler: der Prozess hat abgebrochen')).toEqual([]);
  });
});

describe('parseRejectRows', () => {
  const line = (n: number) => `"${n}","x",Fehler: y`;

  it('drops the extra probe record and reports truncation', () => {
    const text = [line(1), line(2), line(3)].join('\r\n') + '\r\n';
    expect(parseRejectRows(text, 2)).toEqual({ rows: [['1', 'x'], ['2', 'x']], truncated: true });
  });

  it('reports no truncation when the source ran out first', () => {
    const text = [line(1), line(2)].join('\r\n');
    expect(parseRejectRows(text, 10)).toEqual({ rows: [['1', 'x'], ['2', 'x']], truncated: false });
  });

  it('ignores a BOM and message-only lines', () => {
    expect(parseRejectRows('\uFEFF' + line(1) + '\r\nFehler: allgemein\r\n', 10).rows).toEqual([['1', 'x']]);
  });

  it('returns no rows for empty content', () => {
    expect(parseRejectRows('', 10)).toEqual({ rows: [], truncated: false });
  });
});

describe('buildPreviewHeader', () => {
  it('uses the declared variable names', () => {
    expect(buildPreviewHeader(['sKunde', 'nUmsatz'], 2)).toEqual(['sKunde', 'nUmsatz']);
  });

  it('falls back to positions and pads to the returned width', () => {
    expect(buildPreviewHeader(['sKunde'], 3)).toEqual(['sKunde', '2', '3']);
    expect(buildPreviewHeader([], 2)).toEqual(['1', '2']);
  });

  it('trims names the query did not return', () => {
    expect(buildPreviewHeader(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
  });
});

describe('preview plumbing the ODBC path depends on', () => {
  // The ODBC preview's SUCCESS status is CompletedWithMessages — ItemReject is
  // how the rows get out. Classifying that as major would turn every successful
  // preview into an error message.
  it('does not treat CompletedWithMessages as a failure', () => {
    expect(classifyExecuteStatus('CompletedWithMessages')).not.toBe('major');
    expect(classifyExecuteStatus('Aborted')).toBe('major');
  });

  // `ErrorLogFiles` serves TM1ProcessError_a_b.log but 404s on
  // TM1ProcessError_colprobe.log, although TI writes both (measured).
  it('requires two segments in a capture log name', () => {
    expect(LOG_NAME_RE.test('TM1ProcessError_tm1ide_dspreview_1_output.log')).toBe(true);
    expect(LOG_NAME_RE.test('TM1ProcessError_a_b.log')).toBe(true);
    expect(LOG_NAME_RE.test('TM1ProcessError_colprobe.log')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  normalizeReadDataSource,
  cleanDataSource,
  escapeAttr,
  parseOdbcSelectColumns,
  odbcPasswordRow,
  type DataSource,
} from '../../../webviewClient/processEditorMonaco/dataSourcePure';
import { assignIfSet } from '../../../utils/dataSourceWire';

describe('normalizeReadDataSource', () => {
  it('returns Type:None for null/undefined/non-object input', () => {
    expect(normalizeReadDataSource(null)).toEqual({ Type: 'None' });
    expect(normalizeReadDataSource(undefined)).toEqual({ Type: 'None' });
    expect(normalizeReadDataSource('string')).toEqual({ Type: 'None' });
    expect(normalizeReadDataSource(42)).toEqual({ Type: 'None' });
  });
  it('defaults missing Type to None', () => {
    expect(normalizeReadDataSource({})).toEqual({ Type: 'None' });
  });
  it('translates v11 ASCII write-alias keys to canonical', () => {
    const wire = {
      Type: 'ASCII',
      asciiDelimiterChar: ',',
      asciiQuoteCharacter: '"',
      asciiDecimalSeparator: '.',
      asciiThousandSeparator: ',',
      asciiHeaderRecords: 1,
      asciiDelimiterType: 'Character',
      usesUnicode: true,
      dataSourceNameForServer: 'load.csv',
      dataSourceNameForClient: 'C:\\load.csv',
    };
    expect(normalizeReadDataSource(wire)).toEqual({
      Type: 'ASCII',
      dataSourceNameForServer: 'load.csv',
      dataSourceNameForClient: 'C:\\load.csv',
      Delimiter: ',',
      QuoteCharacter: '"',
      DecimalSeparator: '.',
      ThousandSeparator: ',',
      NumberOfHeaderRecordsToSkip: 1,
      _asciiDelimiterType: 'Character',
      UsesUnicode: true,
    });
  });
  it('translates v11 ASCII read-alias keys (Delimiter, HeaderRecords)', () => {
    const wire = {
      Type: 'ASCII',
      Delimiter: ';',
      NumberOfHeaderRecordsToSkip: 2,
      UsesUnicode: false,
    };
    const out = normalizeReadDataSource(wire);
    expect(out.Delimiter).toBe(';');
    expect(out.NumberOfHeaderRecordsToSkip).toBe(2);
    expect(out.UsesUnicode).toBe(false);
  });
  it('coerces NumberOfHeaderRecordsToSkip from string to number, falls back to 0', () => {
    expect(normalizeReadDataSource({ Type: 'ASCII', asciiHeaderRecords: '5' }).NumberOfHeaderRecordsToSkip).toBe(5);
    expect(normalizeReadDataSource({ Type: 'ASCII', asciiHeaderRecords: 'bogus' }).NumberOfHeaderRecordsToSkip).toBe(0);
  });
  it('prefers write-alias over read-alias when both present', () => {
    const wire = { Type: 'ASCII', asciiDelimiterChar: ',', Delimiter: ';' };
    expect(normalizeReadDataSource(wire).Delimiter).toBe(',');
  });
  it('skips empty-string values via pickKey', () => {
    const wire = { Type: 'ASCII', asciiDelimiterChar: '', Delimiter: ';' };
    expect(normalizeReadDataSource(wire).Delimiter).toBe(';');
  });
  // Verbatim payload from `GET Processes('<odbc proc>')` on 11.8 (2026-08-16).
  // The lowercase spelling is the only one the server ever sends; reading it is
  // what makes the SQL query visible in the editor at all.
  it('reads the lowercase ODBC keys TM1 11.8 actually sends', () => {
    const wire = {
      Type: 'ODBC',
      dataSourceNameForClient: 'ODBC_PLAN_DSN',
      dataSourceNameForServer: 'ODBC_PLAN_DSN',
      password: 'xxxxxxxxxxxxxxxx==',
      query: 'SELECT * FROM plan_station_codes;',
      userName: 'tm1_reader',
      usesUnicode: true,
    };
    expect(normalizeReadDataSource(wire)).toEqual({
      Type: 'ODBC',
      dataSourceNameForClient: 'ODBC_PLAN_DSN',
      dataSourceNameForServer: 'ODBC_PLAN_DSN',
      UserName: 'tm1_reader',
      Query: 'SELECT * FROM plan_station_codes;',
      hasStoredPassword: true,
      // The wire fixture above is a real 11.8 payload and always carried this
      // flag; the reader used to drop it, so the editor showed no Unicode box
      // for ODBC and a save could not preserve the setting.
      UsesUnicode: true,
    });
  });
  // An empty password field must not read as "no password set" — the value is
  // withheld deliberately, so presence travels as its own flag.
  it('reports whether a password is stored without exposing it', () => {
    expect(normalizeReadDataSource({ Type: 'ODBC', password: 'gA1Okt==' }).hasStoredPassword).toBe(true);
    expect(normalizeReadDataSource({ Type: 'ODBC', password: '' }).hasStoredPassword).toBe(false);
    expect(normalizeReadDataSource({ Type: 'ODBC' }).hasStoredPassword).toBe(false);
    // Legacy spellings count too, so an older server does not read as "unset".
    expect(normalizeReadDataSource({ Type: 'ODBC', odbcPassword: 'x' }).hasStoredPassword).toBe(true);
    expect(normalizeReadDataSource({ Type: 'ODBC', Password: 'x' }).hasStoredPassword).toBe(true);
    // The flag is a UI marker only — it must never reach the wire.
    const wire = cleanDataSource({ Type: 'ODBC', dataSourceNameForServer: 'DSN', hasStoredPassword: true });
    expect('hasStoredPassword' in wire).toBe(false);
  });
  it('never reads the ODBC password back — the server value is ciphertext', () => {
    // Writing it back would hand TM1 the ciphertext as a new plaintext password.
    expect(normalizeReadDataSource({ Type: 'ODBC', password: 'gA1Okt==' }).Password).toBeUndefined();
    expect(normalizeReadDataSource({ Type: 'ODBC', odbcPassword: 'x' }).Password).toBeUndefined();
    expect(normalizeReadDataSource({ Type: 'ODBC', Password: 'x' }).Password).toBeUndefined();
  });
  it('still accepts the historical ODBC aliases', () => {
    expect(normalizeReadDataSource({ Type: 'ODBC', odbcUserName: 'svc_user', odbcQuery: 'SELECT 1' })).toEqual({
      Type: 'ODBC',
      UserName: 'svc_user',
      Query: 'SELECT 1',
      hasStoredPassword: false,
    });
    expect(normalizeReadDataSource({ Type: 'ODBC', UserName: 'u', DataSourceQuery: 'SELECT 2' })).toEqual({
      Type: 'ODBC', UserName: 'u', Query: 'SELECT 2', hasStoredPassword: false,
    });
  });
  it('handles TM1CubeView and TM1DimensionSubset', () => {
    expect(normalizeReadDataSource({ Type: 'TM1CubeView', view: 'VPlan' }).view).toBe('VPlan');
    expect(normalizeReadDataSource({ Type: 'TM1DimensionSubset', DataSourceSubsetName: 'AllProds' }).subset).toBe('AllProds');
  });
  it('preserves Type:None with no extras', () => {
    expect(normalizeReadDataSource({ Type: 'None' })).toEqual({ Type: 'None' });
  });
});

describe('cleanDataSource', () => {
  it('returns bare { Type } for None', () => {
    expect(cleanDataSource({ Type: 'None' })).toEqual({ Type: 'None' });
  });
  it('emits ascii* keys for ASCII Type, strips undefineds', () => {
    const ds: DataSource = {
      Type: 'ASCII',
      dataSourceNameForServer: 'load.csv',
      Delimiter: ',',
      NumberOfHeaderRecordsToSkip: 1,
      UsesUnicode: true,
    };
    const wire = cleanDataSource(ds) as unknown as Record<string, unknown>;
    expect(wire.Type).toBe('ASCII');
    expect(wire.dataSourceNameForServer).toBe('load.csv');
    expect(wire.asciiDelimiterChar).toBe(',');
    expect(wire.asciiDelimiterType).toBe('Character');
    expect(wire.asciiHeaderRecords).toBe(1);
    expect(wire.asciiQuoteCharacter).toBeUndefined();
    // TM1 refuses `usesUnicode` on an ASCII source — `400 code 248 … unprocessed
    // properties were: "usesUnicode"` on POST and PATCH alike, taking the whole
    // payload including the process code (measured 2026-08-17). It must not be
    // emitted here even when the in-memory object carries it.
    expect('usesUnicode' in wire).toBe(false);
  });
  it('preserves _asciiDelimiterType when set', () => {
    const ds: DataSource = { Type: 'ASCII', _asciiDelimiterType: 'Mixed' };
    const wire = cleanDataSource(ds) as unknown as Record<string, unknown>;
    expect(wire.asciiDelimiterType).toBe('Mixed');
  });
  // `odbcQuery`/`odbcUserName`/`odbcPassword` make TM1 11.8 reject the entire
  // PATCH with `400 code 248` — process code included. Only lowercase works.
  it('emits lowercase keys for ODBC Type', () => {
    const ds: DataSource = {
      Type: 'ODBC',
      UserName: 'svc',
      Password: 'pw_x',
      Query: 'SELECT 1',
    };
    expect(cleanDataSource(ds)).toEqual({
      Type: 'ODBC',
      userName: 'svc',
      password: 'pw_x',
      query: 'SELECT 1',
    });
  });
  it('omits the ODBC password when the form left it empty', () => {
    // DataSource PATCH merges, so an omitted password keeps the stored one.
    const wire = cleanDataSource({ Type: 'ODBC', dataSourceNameForServer: 'DSN', Query: 'SELECT 1' });
    expect(wire).toEqual({ Type: 'ODBC', dataSourceNameForServer: 'DSN', query: 'SELECT 1' });
    expect('password' in wire).toBe(false);
  });
  it('emits view for TM1CubeView, subset for TM1DimensionSubset', () => {
    expect(cleanDataSource({ Type: 'TM1CubeView', view: 'VPlan', dataSourceNameForServer: 'Plan' })).toEqual({
      Type: 'TM1CubeView', view: 'VPlan', dataSourceNameForServer: 'Plan',
    });
    expect(cleanDataSource({ Type: 'TM1DimensionSubset', subset: 'AllProds', dataSourceNameForServer: 'Product' })).toEqual({
      Type: 'TM1DimensionSubset', subset: 'AllProds', dataSourceNameForServer: 'Product',
    });
  });
  it('handles NumberOfHeaderRecordsToSkip=0 correctly (not skipped as empty)', () => {
    const ds: DataSource = { Type: 'ASCII', NumberOfHeaderRecordsToSkip: 0 };
    const wire = cleanDataSource(ds) as unknown as Record<string, unknown>;
    expect(wire.asciiHeaderRecords).toBe(0);
  });
  it('coerces NumberOfHeaderRecordsToSkip string to number, 0 fallback', () => {
    const wire = cleanDataSource({ Type: 'ASCII', NumberOfHeaderRecordsToSkip: 'NaN' as unknown as number });
    expect((wire as unknown as Record<string, unknown>).asciiHeaderRecords).toBe(0);
  });
  it('round-trips ASCII payload through normalize -> clean', () => {
    const wire = {
      Type: 'ASCII',
      asciiDelimiterChar: ',',
      asciiHeaderRecords: 2,
      usesUnicode: true,
      asciiDelimiterType: 'Character',
      dataSourceNameForServer: 'load.csv',
    };
    const normalized = normalizeReadDataSource(wire);
    const cleaned = cleanDataSource(normalized) as unknown as Record<string, unknown>;
    expect(cleaned).toMatchObject({
      Type: 'ASCII',
      asciiDelimiterChar: ',',
      asciiHeaderRecords: 2,
      dataSourceNameForServer: 'load.csv',
    });
    // Read back for the UI, dropped again on the way out: an ASCII source cannot
    // carry the flag over REST (see above), only in its .pro file.
    expect(normalized.UsesUnicode).toBe(true);
    expect('usesUnicode' in cleaned).toBe(false);
  });
});

describe('assignIfSet', () => {
  it('assigns defined non-empty values', () => {
    const out: Record<string, unknown> = {};
    assignIfSet(out, 'x', 'value');
    expect(out.x).toBe('value');
  });
  it('skips undefined / null / empty-string', () => {
    const out: Record<string, unknown> = {};
    assignIfSet(out, 'a', undefined);
    assignIfSet(out, 'b', null);
    assignIfSet(out, 'c', '');
    expect(out).toEqual({});
  });
  it('assigns 0 (treats as set)', () => {
    const out: Record<string, unknown> = {};
    assignIfSet(out, 'n', 0);
    expect(out.n).toBe(0);
  });
  it('assigns false (treats as set)', () => {
    const out: Record<string, unknown> = {};
    assignIfSet(out, 'b', false);
    expect(out.b).toBe(false);
  });
});

describe('escapeAttr', () => {
  it('escapes &, ", \', <, >', () => {
    expect(escapeAttr('a&b"c\'d<e>f')).toBe('a&amp;b&quot;c&#039;d&lt;e&gt;f');
  });
  it('passes safe input through', () => {
    expect(escapeAttr('plain_text-123')).toBe('plain_text-123');
  });
  it('handles empty string', () => {
    expect(escapeAttr('')).toBe('');
  });
});

describe('parseOdbcSelectColumns', () => {
  it('returns empty for empty input', () => {
    expect(parseOdbcSelectColumns('')).toEqual([]);
    expect(parseOdbcSelectColumns(undefined as unknown as string)).toEqual([]);
  });
  it('returns empty when no SELECT/FROM block', () => {
    expect(parseOdbcSelectColumns('UPDATE t SET x=1')).toEqual([]);
    expect(parseOdbcSelectColumns('SELECT col1, col2')).toEqual([]);
  });
  it('returns empty for SELECT *', () => {
    expect(parseOdbcSelectColumns('SELECT * FROM tbl')).toEqual([]);
  });
  it('parses simple column list', () => {
    expect(parseOdbcSelectColumns('SELECT col1, col2 FROM tbl'))
      .toEqual(['col1', 'col2']);
  });
  it('strips table prefix', () => {
    expect(parseOdbcSelectColumns('SELECT t.col1, t.col2 FROM t'))
      .toEqual(['col1', 'col2']);
  });
  it('uses AS alias when present', () => {
    expect(parseOdbcSelectColumns('SELECT col1 AS alias1, col2 AS alias2 FROM t'))
      .toEqual(['alias1', 'alias2']);
  });
  it('AS is case-insensitive', () => {
    expect(parseOdbcSelectColumns('SELECT col1 as a1, col2 As a2 FROM t'))
      .toEqual(['a1', 'a2']);
  });
  it('handles function call with AS alias', () => {
    expect(parseOdbcSelectColumns('SELECT COUNT(*) AS cnt, SUM(x) AS total FROM t'))
      .toEqual(['cnt', 'total']);
  });
  it('handles function call with trailing alias (no AS)', () => {
    expect(parseOdbcSelectColumns('SELECT COUNT(*) cnt FROM t'))
      .toEqual(['cnt']);
  });
  it('handles double-quoted identifier', () => {
    expect(parseOdbcSelectColumns('SELECT "Order Date" FROM t'))
      .toEqual(['Order_Date']);
  });
  it('handles bracketed identifier', () => {
    expect(parseOdbcSelectColumns('SELECT [Customer Name] FROM t'))
      .toEqual(['Customer_Name']);
  });
  it('splits top-level commas only (preserves comma inside parens)', () => {
    expect(parseOdbcSelectColumns('SELECT COALESCE(a, b) AS x, c FROM t'))
      .toEqual(['x', 'c']);
  });
  it('case-insensitive SELECT/FROM keywords', () => {
    expect(parseOdbcSelectColumns('select a, b from t')).toEqual(['a', 'b']);
    expect(parseOdbcSelectColumns('Select a From t')).toEqual(['a']);
  });
  it('handles multiline SQL', () => {
    expect(parseOdbcSelectColumns('SELECT\n  col1,\n  col2\nFROM tbl'))
      .toEqual(['col1', 'col2']);
  });
  it('normalizes leading-digit names', () => {
    expect(parseOdbcSelectColumns('SELECT "2024 Sales" FROM t'))
      .toEqual(['_2024_Sales']);
  });
  it('dedupes (case-insensitive, keep first)', () => {
    expect(parseOdbcSelectColumns('SELECT col, COL, col2 FROM t'))
      .toEqual(['col', 'col2']);
  });
  it('skips empty/unrecognized entries', () => {
    expect(parseOdbcSelectColumns('SELECT col1, *, col2 FROM t'))
      .toEqual(['col1', 'col2']);
  });
});

describe('odbcPasswordRow', () => {
  it('offers the field with the "stored" hint when the process holds a password', () => {
    expect(odbcPasswordRow('process', true)).toEqual({ kind: 'field', placeholder: 'stored' });
  });

  it('offers the field with the "unset" hint when it holds none', () => {
    expect(odbcPasswordRow('process', false)).toEqual({ kind: 'field', placeholder: 'unset' });
  });

  // A template is persisted to globalState and to an export bundle, so a
  // password can never be kept for it. Offering an input that is silently
  // dropped on save would be worse than offering none.
  it('offers no field at all in a template', () => {
    expect(odbcPasswordRow('template', false)).toEqual({ kind: 'note' });
  });

  it('offers no field in a template even if one somehow looks stored', () => {
    expect(odbcPasswordRow('template', true)).toEqual({ kind: 'note' });
  });
});

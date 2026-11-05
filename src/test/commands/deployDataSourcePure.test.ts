import { describe, it, expect } from 'vitest';
import { toRestDataSource } from '../../commands/processEditor/deployDataSourcePure';

/**
 * Field layout taken from a real 11.8 `.pro`; the payloads below are the ones
 * live-measured to return HTTP 200 (proDeployDsProbe.js).
 * The PascalCase shape this used to build was rejected outright with
 * `400 code 248`, so every .pro deploy with an ASCII or ODBC datasource failed.
 */
const CRLF = (lines: string[]) => lines.join('\r\n') + '\r\n';

const ODBC_PRO = CRLF([
  '601,100',
  '602,"#Mapping_Plan_SITE"',
  '562,"ODBC"',
  '586,"ODBC_PLAN_DSN"',
  '585,"ODBC_PLAN_DSN"',
  '564,"tm1_reader"',
  '565,"v0bP>q]DCHRP0"',
  '566,1',
  'SELECT * FROM plan_station_codes;',
  '567,","',
  '588,","',
  '589,"."',
  '568,""""',
  '569,0',
  '572,0',
]);

const ASCII_PRO = CRLF([
  '602,"00500_Import_DIM_TREE"',
  '562,"CHARACTERDELIMITED"',
  '585,"C:\\TM1\\SALES\\STRC.txt"',
  '567,"^"',
  '568,""""',
  '588,"."',
  '589,","',
  '569,1',
  '572,0',
]);

describe('toRestDataSource', () => {
  it('emits lowercase ODBC wire names and no Delimiter', () => {
    const ds = toRestDataSource(ODBC_PRO) as Record<string, unknown>;
    expect(ds).toEqual({
      Type: 'ODBC',
      dataSourceNameForServer: 'ODBC_PLAN_DSN',
      dataSourceNameForClient: 'ODBC_PLAN_DSN',
      userName: 'tm1_reader',
      query: 'SELECT * FROM plan_station_codes;',
    });
    // TM1 answers `400 … unprocessed properties were: "Delimiter"` for ODBC,
    // even though the .pro carries one on line 567.
    expect('Delimiter' in ds).toBe(false);
    // The encrypted password from line 565 must never travel — TM1 would take
    // the ciphertext as a new plaintext password.
    expect('password' in ds).toBe(false);
  });

  it('emits ascii* wire names including the mandatory delimiter type', () => {
    const ds = toRestDataSource(ASCII_PRO) as Record<string, unknown>;
    expect(ds).toEqual({
      Type: 'ASCII',
      dataSourceNameForServer: 'C:\\TM1\\SALES\\STRC.txt',
      dataSourceNameForClient: 'C:\\TM1\\SALES\\STRC.txt',
      asciiDelimiterChar: '^',
      asciiDelimiterType: 'Character',
      asciiQuoteCharacter: '"',
      asciiDecimalSeparator: '.',
      asciiThousandSeparator: ',',
      asciiHeaderRecords: 1,
    });
    // Without asciiDelimiterType TM1 refuses with "Delimiter type must be
    // specified when changing the data source type to ASCII".
    expect(ds.asciiDelimiterType).toBe('Character');
  });

  // Line 559 is the .pro Unicode flag (measured 2026-08-17,
  // proUnicodeLineProbe.js). The deploy used to drop it entirely,
  // so an ODBC setting in the file never reached TM1.
  it('carries the Unicode flag from .pro line 559 — for ODBC only', () => {
    const odbcOff = toRestDataSource(CRLF(['562,"ODBC"', '585,"DSN"', '559,0']));
    expect(odbcOff?.usesUnicode).toBe(false);
    const odbcOn = toRestDataSource(CRLF(['562,"ODBC"', '585,"DSN"', '559,1']));
    expect(odbcOn?.usesUnicode).toBe(true);
    // ASCII must NOT get the key: TM1 answers `400 code 248 … "usesUnicode"` and
    // rejects the whole deploy, process code included (measured 2026-08-17).
    const ascii = toRestDataSource(CRLF(['562,"CHARACTERDELIMITED"', '585,"a.csv"', '567,";"', '559,0'])) as Record<string, unknown>;
    expect('usesUnicode' in ascii).toBe(false);
  });

  it('omits the Unicode flag when the .pro states none, so a PATCH keeps the server value', () => {
    const ds = toRestDataSource(CRLF(['562,"ODBC"', '585,"DSN"'])) as Record<string, unknown>;
    expect('usesUnicode' in ds).toBe(false);
  });

  it('carries only Type plus names for VIEW/SUBSET', () => {
    const view = toRestDataSource(CRLF(['562,"VIEW"', '585,"Planung"', '570,"Ansicht1"']));
    expect(view).toEqual({
      Type: 'TM1CubeView',
      dataSourceNameForServer: 'Planung',
      dataSourceNameForClient: 'Planung',
      view: 'Ansicht1',
    });
    const subset = toRestDataSource(CRLF(['562,"SUBSET"', '585,"Region"', '570,"All"']));
    expect(subset).toEqual({
      Type: 'TM1DimensionSubset',
      dataSourceNameForServer: 'Region',
      dataSourceNameForClient: 'Region',
      subset: 'All',
    });
  });

  it('reads the subset from 571 and the server name from 586', () => {
    // TM1 and the Bedrock repo write the subset into 571; the MCP export leaves 585 empty.
    const subset = toRestDataSource(CRLF(['562,"SUBSET"', '586,"}Cubes"', '585,', '570,', '571,All']));
    expect(subset).toMatchObject({ dataSourceNameForServer: '}Cubes', subset: 'All' });
  });

  it('keeps an empty client name and an empty quote character', () => {
    // Missing keys make TM1 fill in its defaults (client = server name, quote = ").
    const ascii = toRestDataSource(CRLF(['562,"CHARACTERDELIMITED"', '586,"x.txt"', '585,""', '567,";"', '568,""']));
    expect(ascii).toMatchObject({ dataSourceNameForServer: 'x.txt', dataSourceNameForClient: '', asciiQuoteCharacter: '' });
    const subset = toRestDataSource(CRLF(['562,"SUBSET"', '586,"Konten"', '585,', '571,All']));
    expect(subset).toMatchObject({ dataSourceNameForServer: 'Konten', dataSourceNameForClient: '' });
  });

  it('maps a missing or unknown 562 line to None', () => {
    expect(toRestDataSource(CRLF(['602,"x"', '572,0']))).toEqual({ Type: 'None' });
    expect(toRestDataSource(CRLF(['562,"NULL"']))).toEqual({ Type: 'None' });
    expect(toRestDataSource(CRLF(['562,"WHATEVER"']))).toEqual({ Type: 'None' });
  });

  it('keeps a multi-line SQL query intact', () => {
    const pro = CRLF(['562,"ODBC"', '585,"DSN"', '566,3', 'SELECT a,', '  b FROM t', ' WHERE a > 0', '567,","']);
    const ds = toRestDataSource(pro) as Record<string, unknown>;
    expect(ds.query).toBe('SELECT a,\n  b FROM t\n WHERE a > 0');
  });
});

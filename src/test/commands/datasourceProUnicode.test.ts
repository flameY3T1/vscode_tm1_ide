import { describe, it, expect } from 'vitest';
import { parseDatasourceFromFileContent } from '../../commands/datasource/parse';
import { buildProFile } from '../../commands/processEditor/loadProcesses';

/**
 * .pro line 559 carries the Unicode flag — `559,1` on, `559,0` off. Pinned down
 * on 2026-08-17 by writing `usesUnicode` true and false through REST and diffing
 * the two `.pro` states (proUnicodeLineProbe.js); a witness run
 * that wrote the same value twice produced zero differences, so the one changed
 * line is the flag and not the time-salted password blob.
 *
 * Before that the line was only ever copied through verbatim as `_line559`.
 */
const CRLF = (lines: string[]) => lines.join('\r\n') + '\r\n';

describe('.pro Unicode flag (line 559)', () => {
  it('reads 559,1 as on and 559,0 as off', () => {
    expect(parseDatasourceFromFileContent(CRLF(['562,"ODBC"', '559,1'])).usesUnicode).toBe(true);
    expect(parseDatasourceFromFileContent(CRLF(['562,"ODBC"', '559,0'])).usesUnicode).toBe(false);
  });

  it('leaves usesUnicode undefined when the file has no 559 line', () => {
    expect(parseDatasourceFromFileContent(CRLF(['562,"ODBC"'])).usesUnicode).toBeUndefined();
  });

  // The writing side used to live in the `.pro` wizard (`datasource/build.ts`).
  // That was dropped on 2026-08-30; `.pro` is now only written on
  // export. It wrote `559,1` hard-coded — an ODBC source with Unicode
  // switched off thus came out as switched on, and the next deploy switched
  // it over on the server.
  const proFor = (ds: Record<string, unknown>) => buildProFile({
    Name: 'p', PrologProcedure: '', MetadataProcedure: '', DataProcedure: '',
    EpilogProcedure: '', DataSource: ds, Parameters: [], Variables: [],
  });

  it('the export writes the flag of the ODBC source along', () => {
    expect(proFor({ Type: 'ODBC', dataSourceNameForServer: 'dsn', usesUnicode: false }))
      .toContain('559,0');
    expect(proFor({ Type: 'ODBC', dataSourceNameForServer: 'dsn', usesUnicode: true }))
      .toContain('559,1');
  });

  it('without a value and for other source types it stays at 1', () => {
    expect(proFor({ Type: 'ODBC', dataSourceNameForServer: 'dsn' })).toContain('559,1');
    expect(proFor({ Type: 'ASCII', dataSourceNameForServer: 'a.csv' })).toContain('559,1');
  });
});

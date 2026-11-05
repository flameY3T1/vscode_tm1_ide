import { describe, it, expect } from 'vitest';
import { fileSourceDir, odbcTables } from '../../references/dataSourceRefs';

// Shapes taken from real import processes (11.8, 2026-09-26).
describe('fileSourceDir', () => {
  const declared = 'C:\\TM1\\Imp\\SRC\\SAP202012_213_B87.txt';

  it('a folder from a parameter cube is keyed by cube and element, shown with the declared folder', () => {
    const prolog = [
      "csCubeParam = 'zzz_Settings';",
      "sIMP_DATA = CellGetS(csCubeParam, 'IMP_Data', 'Text');",
      "csDatei = sIMP_DATA|'SAP'| psJahr | psMonat |'_213_B87.txt';",
      'DatasourceNameForServer = csDatei;',
    ].join('\n');
    expect(fileSourceDir([prolog], declared)).toMatchObject({
      key: 'cell:zzz_settings|imp_data', path: 'C:\\TM1\\Imp\\SRC\\', setBy: "CellGetS(zzz_Settings, 'IMP_Data')",
    });
  });

  it('a quoted folder in front of a dynamic name gives that folder', () => {
    const prolog = "sDatei = 'C:\\TM1\\Imp\\Vertrieb\\'|psDatei;\nDatasourceNameForServer = sDatei;";
    expect(fileSourceDir([prolog], declared)).toEqual({ key: 'dir:c:\\tm1\\imp\\vertrieb\\', path: 'C:\\TM1\\Imp\\Vertrieb\\', file: '{psDatei}' });
  });

  it('a folder from a parameter falls back to the declared folder', () => {
    const prolog = "pSrcDir = pSrcDir | '\\';\nsFile = pSrcDir | pSrcFile;\nDatasourceNameForServer = sFile;";
    expect(fileSourceDir([prolog], declared)).toEqual({ key: 'dir:c:\\tm1\\imp\\src\\', path: 'C:\\TM1\\Imp\\SRC\\', file: '{pSrcFile}' });
  });

  it('no assignment in code: the declared folder; commented-out lines do not count', () => {
    expect(fileSourceDir(["# DatasourceNameForServer = 'D:\\x\\y.txt';"], declared)?.key).toBe('dir:c:\\tm1\\imp\\src\\');
    expect(fileSourceDir([''], undefined)).toBeUndefined();
  });
});

describe('file pattern and ODBC tables', () => {
  it('the name after the folder becomes a pattern with the dynamic parts in braces', () => {
    const prolog = [
      "sIMP_DATA = CellGetS(csCubeParam, 'IMP_Data', 'Text');",
      "csDatei = sIMP_DATA|'SAP'| psJahr | psMonat |'_213_B87.txt';",
      'DatasourceNameForServer = csDatei;',
    ].join('\n');
    expect(fileSourceDir([prolog], 'C:\\a\\b.txt')?.file).toBe('SAP{psJahr}{psMonat}_213_B87.txt');
    const inLiteral = "csDatei = '\\TM1\\Imp\\Manuell\\'| pDim |'.csv';\nDatasourceNameForServer = csDatei;";
    expect(fileSourceDir([inLiteral], undefined)).toMatchObject({ path: '\\TM1\\Imp\\Manuell\\', file: '{pDim}.csv' });
  });

  it('reads tables from the stored query and the quoted parts of an assigned one', () => {
    const prolog = "DatasourceQuery = 'SELECT * FROM dbo.PRICE_SOURCE a JOIN [plan_station] b ON a.x = b.x WHERE j = ' | sJahr;";
    expect(odbcTables([prolog], 'select a from PLAN_STATION_CONV')).toEqual(['PLAN_STATION_CONV', 'dbo.PRICE_SOURCE', 'plan_station']);
  });

  it('skips FROM inside a function call, keeps it in a subquery', () => {
    const q = 'SELECT EXTRACT(YEAR FROM d) FROM t1 WHERE x IN (SELECT y FROM t2)';
    expect(odbcTables([], q)).toEqual(['t1', 't2']);
  });

  it('reads an assignment over several lines and a # inside a quoted path', () => {
    const prolog = "DatasourceQuery = 'SELECT * ' |\n  'FROM t3';\nDatasourceNameForServer = 'D:\\in#1\\a.csv';";
    expect(odbcTables([prolog], undefined)).toEqual(['t3']);
    expect(fileSourceDir([prolog], undefined)).toMatchObject({ path: 'D:\\in#1\\', file: 'a.csv' });
  });
});

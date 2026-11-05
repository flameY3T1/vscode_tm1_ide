import { describe, it, expect } from 'vitest';
import {
  toApiDataSource,
  toApiParameters,
  toApiVariables,
} from '../../commands/processEditor/newProcessPure';
import { toDatasourceConfig } from '../../commands/datasource/fromForm';
import { DATASOURCE_DEFAULTS } from '../../commands/datasource/types';
import type { DatasourceConfig } from '../../commands/datasource/types';
import type { DataSource } from '../../tm1Rest/transport/types';

function makeDs(over: Partial<DatasourceConfig>): DatasourceConfig {
  return { ...DATASOURCE_DEFAULTS, ...over };
}

describe('toDatasourceConfig', () => {
  // The regression this guards: the handler used to rebuild the config field by
  // field and forgot `odbcPassword`/`usesUnicode`, so a wizard-created ODBC
  // process landed on the server without its password.
  it('carries every ODBC field the wizard collects through to the payload', () => {
    const cfg = toDatasourceConfig({
      dsType: 'ODBC',
      datasourceName: 'TM1PROBE',
      odbcUsername: 'tm1probe',
      odbcPassword: 'ProbePw123',
      usesUnicode: false,
      sqlQuery: 'SELECT id, txt FROM probe',
    }, DATASOURCE_DEFAULTS);

    expect(cfg).toMatchObject({
      type: 'ODBC',
      datasourceName: 'TM1PROBE',
      odbcUsername: 'tm1probe',
      odbcPassword: 'ProbePw123',
      usesUnicode: false,
      sqlQuery: 'SELECT id, txt FROM probe',
    });
    expect(toApiDataSource(cfg)).toMatchObject({
      password: 'ProbePw123',
      usesUnicode: false,
      userName: 'tm1probe',
    });
  });

  it('leaves usesUnicode undefined when the wizard sends nothing (server default wins)', () => {
    expect(toDatasourceConfig({ dsType: 'ODBC' }, DATASOURCE_DEFAULTS).usesUnicode).toBeUndefined();
  });

  it('falls back to the ASCII defaults for missing separator fields', () => {
    expect(toDatasourceConfig({ dsType: 'CHARACTERDELIMITED', datasourceName: 'a.csv' }, DATASOURCE_DEFAULTS))
      .toMatchObject({ delimiter: ',', quoteChar: '"', decimalSep: '.', thousandSep: ',', titleRows: 0 });
  });
});

describe('toApiDataSource', () => {
  it('NULL → Type:None bare', () => {
    expect(toApiDataSource(makeDs({ type: 'NULL', datasourceName: 'ignored' }))).toEqual({ Type: 'None' });
  });

  it('VIEW → TM1CubeView with view name', () => {
    expect(toApiDataSource(makeDs({
      type: 'VIEW', datasourceName: 'SalesCube', viewSubsetName: 'Default',
    }))).toEqual({
      Type: 'TM1CubeView',
      dataSourceNameForServer: 'SalesCube',
      view: 'Default',
    });
  });

  it('SUBSET → TM1DimensionSubset', () => {
    expect(toApiDataSource(makeDs({
      type: 'SUBSET', datasourceName: 'Product', viewSubsetName: 'AllProducts',
    }))).toEqual({
      Type: 'TM1DimensionSubset',
      dataSourceNameForServer: 'Product',
      subset: 'AllProducts',
    });
  });

  it('CHARACTERDELIMITED → ASCII with all wizard fields', () => {
    expect(toApiDataSource(makeDs({
      type: 'CHARACTERDELIMITED',
      datasourceName: 'C:/data/sales.csv',
      delimiter: ';',
      quoteChar: '"',
      decimalSep: ',',
      thousandSep: '.',
      titleRows: 2,
    }))).toEqual({
      Type: 'ASCII',
      dataSourceNameForServer: 'C:/data/sales.csv',
      asciiDelimiterType: 'Character',
      asciiDelimiterChar: ';',
      asciiQuoteCharacter: '"',
      asciiDecimalSeparator: ',',
      asciiThousandSeparator: '.',
      asciiHeaderRecords: 2,
    });
  });

  it('type-checks the emitted ascii* keys — no double cast to hide typos', () => {
    // Compile-time assertion (run by `npm run typecheck` via src/test/tsconfig.json):
    // a misspelled ascii key must NOT be assignable. Before the DataSource
    // interface carried these keys, `toApiDataSource` needed
    // `as unknown as DataSource`, which silenced exactly this class of typo —
    // and TM1 ignores unknown DataSource keys without any error.
    // @ts-expect-error asciiDelimterChar is not a DataSource key
    const typo: DataSource = { Type: 'ASCII', asciiDelimterChar: ';' };
    expect(typo.Type).toBe('ASCII');

    const ok: DataSource = toApiDataSource(makeDs({ type: 'CHARACTERDELIMITED', delimiter: ';' }));
    expect(ok.asciiDelimiterChar).toBe(';');
  });

  // Lowercase wire names — TM1 11.8 rejects `UserName`/`Query` with
  // `400 code 248 … unprocessed properties`, taking the whole create with it.
  it('ODBC → ODBC with DSN/user/query; blank password sends no key at all', () => {
    expect(toApiDataSource(makeDs({
      type: 'ODBC',
      datasourceName: 'MyDsn',
      odbcUsername: 'svc_loader',
      sqlQuery: 'SELECT 1 FROM dual',
    }))).toEqual({
      Type: 'ODBC',
      dataSourceNameForServer: 'MyDsn',
      userName: 'svc_loader',
      query: 'SELECT 1 FROM dual',
    });
  });

  it('ODBC carries a wizard-typed password as the lowercase wire key', () => {
    expect(toApiDataSource(makeDs({
      type: 'ODBC',
      datasourceName: 'TM1PROBE',
      odbcUsername: 'tm1probe',
      odbcPassword: 'ProbePw123',
      sqlQuery: 'SELECT id, txt FROM probe',
    }))).toEqual({
      Type: 'ODBC',
      dataSourceNameForServer: 'TM1PROBE',
      userName: 'tm1probe',
      password: 'ProbePw123',
      query: 'SELECT id, txt FROM probe',
    });
  });

  // `false` must survive: TM1 defaults an ODBC create to usesUnicode=true, so a
  // dropped `false` would silently flip the box back on.
  it('ODBC keeps usesUnicode=false instead of stripping it', () => {
    expect(toApiDataSource(makeDs({
      type: 'ODBC', datasourceName: 'TM1PROBE', usesUnicode: false,
    }))).toMatchObject({ Type: 'ODBC', usesUnicode: false });
  });

  it('CHARACTERDELIMITED defaults titleRows=0', () => {
    expect((toApiDataSource(makeDs({
      type: 'CHARACTERDELIMITED', datasourceName: 'a.csv',
    })) as unknown as Record<string, unknown>).asciiHeaderRecords).toBe(0);
  });

  it('CHARACTERDELIMITED always sets asciiDelimiterType=Character (TM1 requires it)', () => {
    expect((toApiDataSource(makeDs({
      type: 'CHARACTERDELIMITED', datasourceName: 'a.csv',
    })) as unknown as Record<string, unknown>).asciiDelimiterType).toBe('Character');
  });
});

describe('toApiParameters', () => {
  it('maps empty array to empty array', () => {
    expect(toApiParameters([])).toEqual([]);
  });

  it('type=1 → Numeric, type=2 → String', () => {
    const result = toApiParameters([
      { name: 'pNum', type: 1, defaultValue: '42', prompt: 'Anzahl' },
      { name: 'pStr', type: 2, defaultValue: 'hi',  prompt: 'Text' },
    ]);
    expect(result).toEqual([
      { Name: 'pNum', Type: 'Numeric', Value: '42', Prompt: 'Anzahl' },
      { Name: 'pStr', Type: 'String',  Value: 'hi', Prompt: 'Text'  },
    ]);
  });

  it('preserves empty defaultValue + prompt verbatim', () => {
    const [out] = toApiParameters([{ name: 'p', type: 2, defaultValue: '', prompt: '' }]);
    expect(out.Value).toBe('');
    expect(out.Prompt).toBe('');
  });
});

describe('toApiVariables', () => {
  it('maps empty array to empty array', () => {
    expect(toApiVariables([])).toEqual([]);
  });

  it('always sets StartByte/EndByte to 0', () => {
    const [out] = toApiVariables([{ name: 'vCol1', type: 2, position: 1 }]);
    expect(out.StartByte).toBe(0);
    expect(out.EndByte).toBe(0);
  });

  it('type=1 → Numeric, type=2 → String', () => {
    const result = toApiVariables([
      { name: 'vAmount', type: 1, position: 1 },
      { name: 'vLabel',  type: 2, position: 2 },
    ]);
    expect(result).toEqual([
      { Name: 'vAmount', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 0 },
      { Name: 'vLabel',  Type: 'String',  Position: 2, StartByte: 0, EndByte: 0 },
    ]);
  });

  it('preserves user-supplied position values (no auto-renumber)', () => {
    const result = toApiVariables([
      { name: 'a', type: 2, position: 7 },
      { name: 'b', type: 2, position: 3 },
    ]);
    expect(result.map(v => v.Position)).toEqual([7, 3]);
  });
});

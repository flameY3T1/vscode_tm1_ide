/**
 * .pro datasource block → TM1 REST `DataSource` payload. Pure — no vscode, so
 * the mapping is unit-testable and reachable from live probes.
 *
 * Split out of `deploy.ts` (2026-08-16) when a live measurement showed the
 * payload it built was rejected wholesale: TM1 11.8 answers `400 code 248
 * "Invalid data source properties supplied…"` for PascalCase field names, so
 * every .pro deploy carrying an ASCII or ODBC datasource failed. The wire names
 * now come from the one place that knows them, `utils/dataSourceWire`.
 */

// Leaf module, not the `datasourceConfig` barrel — that one reaches into
// `datasource/fetch.ts` and drags vscode in, which would make this file
// impure and untestable outside the extension host.
import { parseDatasourceFromFileContent } from '../datasource/parse';
import { cleanDataSource, type DataSource } from '../../utils/dataSourceWire';

/**
 * VIEW/SUBSET datasources are configured from TI code
 * (`DataSourceNameForServer = …`), so only the Type plus the names travel —
 * TM1 rejects extra properties for those types.
 */
export function toRestDataSource(content: string): DataSource | undefined {
  const cfg = parseDatasourceFromFileContent(content);
  const TYPE_MAP: Record<string, DataSource['Type']> = {
    'NULL':              'None',
    'VIEW':              'TM1CubeView',
    'SUBSET':            'TM1DimensionSubset',
    'CHARACTERDELIMITED': 'ASCII',
    'ODBC':              'ODBC',
  };
  const restType = TYPE_MAP[cfg.type] ?? 'None';
  if (restType === 'None') { return { Type: 'None' }; }

  if (restType === 'TM1CubeView') {
    return {
      Type: restType,
      dataSourceNameForServer: cfg.datasourceName,
      dataSourceNameForClient: cfg.datasourceClientName ?? cfg.datasourceName,
      view: cfg.viewSubsetName,
    };
  }
  if (restType === 'TM1DimensionSubset') {
    return {
      Type: restType,
      dataSourceNameForServer: cfg.datasourceName,
      dataSourceNameForClient: cfg.datasourceClientName ?? cfg.datasourceName,
      subset: cfg.viewSubsetName,
    };
  }

  const ds: DataSource = {
    Type: restType,
    dataSourceNameForServer: cfg.datasourceName,
    dataSourceNameForClient: cfg.datasourceClientName ?? cfg.datasourceName,
  };
  if (cfg.type === 'CHARACTERDELIMITED') {
    ds.Delimiter                   = cfg.delimiter;
    ds.QuoteCharacter              = cfg.quoteChar;
    ds.DecimalSeparator            = cfg.decimalSep;
    ds.ThousandSeparator           = cfg.thousandSep;
    ds.NumberOfHeaderRecordsToSkip = cfg.titleRows;
  }
  if (cfg.type === 'ODBC') {
    // .pro line 559 (measured 2026-08-17, proUnicodeLineProbe.js).
    // ODBC only: TM1 answers `400 code 248 … "usesUnicode"` for an ASCII source
    // and drops the whole payload, so the file's flag stays in the file there.
    ds.UsesUnicode = cfg.usesUnicode;
    ds.UserName = cfg.odbcUsername;
    ds.Query    = cfg.sqlQuery;
    // Deliberately no Delimiter: the .pro carries one (line 567) but TM1 answers
    // `400 … unprocessed properties were: "Delimiter"` for an ODBC datasource.
  }
  return cleanDataSource(ds);
}

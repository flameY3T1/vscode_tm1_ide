/**
 * Pure helpers for newProcess wizard — no vscode/REST/fs dependencies.
 *
 * Maps wizard form-state shapes to TM1 REST API payload shapes.
 */
import type { DatasourceConfig } from '../datasource/types';
import type { DataSource, ProcessParameter, ProcessVariable } from '../../tm1Client';
import { cleanDataSource } from '../../utils/dataSourceWire';

export interface NewProcessParamInput {
  name: string;
  type: 1 | 2;
  defaultValue: string;
  prompt: string;
}

export interface NewProcessVariableInput {
  name: string;
  type: 1 | 2;
  position: number;
  /**
   * Contents = "Ignore" — the column is skipped and invisible to the TI code.
   * `deployProcess` splits the list via `splitVariableColumns` into
   * `Variables` + `VariablesUIData`; an ignored column then appears ONLY in
   * the second one.
   */
  ignored?: boolean;
}

/**
 * Convert wizard datasource config to the TM1 REST API `DataSource` shape.
 *
 * Builds the canonical shape and lets `cleanDataSource` put the wire names on,
 * so the wizard cannot drift from what the editor saves. It used to spell the
 * ASCII keys itself and the ODBC ones PascalCase — TM1 rejected the latter with
 * `400 code 248 … unprocessed properties were: "Query" "UserName"`.
 */
export function toApiDataSource(ds: DatasourceConfig): DataSource {
  switch (ds.type) {
    case 'VIEW':
      return cleanDataSource({
        Type: 'TM1CubeView',
        dataSourceNameForServer: ds.datasourceName,
        view: ds.viewSubsetName,
      }) as DataSource;
    case 'SUBSET':
      return cleanDataSource({
        Type: 'TM1DimensionSubset',
        dataSourceNameForServer: ds.datasourceName,
        subset: ds.viewSubsetName,
      }) as DataSource;
    case 'CHARACTERDELIMITED':
      // `asciiDelimiterType` is mandatory — without it TM1 rejects the create
      // with HTTP 400 "Delimiter type must be specified when changing the data
      // source type to ASCII". cleanDataSource defaults it to 'Character'.
      return cleanDataSource({
        Type: 'ASCII',
        dataSourceNameForServer: ds.datasourceName,
        Delimiter: ds.delimiter,
        QuoteCharacter: ds.quoteChar,
        DecimalSeparator: ds.decimalSep,
        ThousandSeparator: ds.thousandSep,
        NumberOfHeaderRecordsToSkip: ds.titleRows,
      }) as DataSource;
    case 'ODBC':
      return cleanDataSource({
        Type: 'ODBC',
        dataSourceNameForServer: ds.datasourceName,
        UserName: ds.odbcUsername,
        // cleanDataSource strips it when empty, so a wizard run that leaves the
        // field blank sends no `password` key at all instead of clearing one.
        Password: ds.odbcPassword,
        UsesUnicode: ds.usesUnicode,
        Query: ds.sqlQuery,
      }) as DataSource;
    default:
      return { Type: 'None' };
  }
}

/** Convert wizard parameters to TM1 REST API `ProcessParameter[]`. */
export function toApiParameters(params: NewProcessParamInput[]): ProcessParameter[] {
  return params.map(p => ({
    Name: p.name,
    Type: p.type === 1 ? 'Numeric' as const : 'String' as const,
    Value: p.defaultValue,
    Prompt: p.prompt,
  }));
}

/** Convert wizard variables to TM1 REST API `ProcessVariable[]`. */
export function toApiVariables(vars: NewProcessVariableInput[]): ProcessVariable[] {
  return vars.map(v => ({
    Name: v.name,
    Type: v.type === 1 ? 'Numeric' as const : 'String' as const,
    Position: v.position,
    StartByte: 0,
    EndByte: 0,
    ...(v.ignored ? { Ignored: true } : {}),
  }));
}

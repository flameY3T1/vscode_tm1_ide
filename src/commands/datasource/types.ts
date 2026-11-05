/**
 * Datasource types & defaults.
 */

export type DatasourceType = 'NULL' | 'VIEW' | 'SUBSET' | 'CHARACTERDELIMITED' | 'ODBC';

export interface DatasourceConfig {
  type: DatasourceType;
  datasourceName: string;
  /** Line 585, the client-side file name; may differ from 586 or be empty. */
  datasourceClientName?: string;
  viewSubsetName: string;
  odbcUsername: string;
  /**
   * Plain-text ODBC password, only ever set while a wizard collects one. Absent
   * on every read path: TM1 hands the password back encrypted and echoing it
   * would let the ciphertext be saved as a new plaintext password.
   */
  odbcPassword?: string;
  /**
   * Unicode flag, for ASCII and ODBC alike. TM1 11.8 accepts `usesUnicode` on an
   * ODBC source too and defaults it to `true` when a create leaves it out
   * (measured 2026-08-17, odbcUnicodeProbe.js). In the .pro file
   * it is line 559 — `559,1` on, `559,0` off; the same measurement diffed the
   * file with a witness run to pin the line down. `undefined` means "not stated",
   * which keeps the server's value on a merging PATCH.
   */
  usesUnicode?: boolean;
  sqlQuery: string;
  delimiter: string;
  quoteChar: string;
  decimalSep: string;
  thousandSep: string;
  titleRows: number;
  _line565: string;
  _line559: string;
  _line928: string;
  _line593: string;
  _line594: string;
  _line595: string;
  _line597: string;
  _line598: string;
  _line596: string;
  _line800: string;
  _line801: string;
  _line592: string;
  _line571: string;
}

export const DATASOURCE_DEFAULTS: DatasourceConfig = {
  type: 'NULL', datasourceName: '', viewSubsetName: '', odbcUsername: '',
  sqlQuery: '', delimiter: ',', quoteChar: '"', decimalSep: '.', thousandSep: ',', titleRows: 0,
  _line565: '', _line559: '559,1', _line928: '928,0', _line593: '593,', _line594: '594,',
  _line595: '595,', _line597: '597,', _line598: '598,', _line596: '596,',
  _line800: '800,', _line801: '801,', _line592: '592,0', _line571: '571,',
};


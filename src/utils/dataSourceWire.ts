/**
 * DataSource wire mapping — the single place that knows how TM1 spells the
 * ASCII/ODBC datasource fields on the wire.
 *
 * Lives in `utils/` because two worlds need it and neither may import the
 * other: the process-editor webview bundle (`webviewClient/`, forbidden to
 * touch `tm1Rest/`) and the extension-host deploy paths (`commands/`, which
 * must not depend on the webview). No vscode, no DOM, no module state.
 *
 * Read and write names are identical on 11.8 — `asciiDelimiterChar`, `query`,
 * `userName`, `password` (live-measured 2026-08-16,
 * odbcQueryWriteProbe*.js). Unknown keys are NOT ignored: TM1
 * answers `400 code 248 "Invalid data source properties …"` and rejects the
 * whole PATCH, process code included.
 */

export type DataSourceType = 'None' | 'ASCII' | 'ODBC' | 'TM1CubeView' | 'TM1DimensionSubset';

export interface DataSource {
  Type: DataSourceType;
  dataSourceNameForServer?: string;
  dataSourceNameForClient?: string;
  UserName?: string;
  Password?: string;
  Query?: string;
  view?: string;
  subset?: string;
  Delimiter?: string;
  NumberOfHeaderRecordsToSkip?: number;
  QuoteCharacter?: string;
  DecimalSeparator?: string;
  ThousandSeparator?: string;
  UsesUnicode?: boolean;
  /** Preserved from server — internal; not user-editable in Phase 3. */
  _asciiDelimiterType?: string;
  /**
   * True when the server holds an ODBC password. Read-only marker for the UI —
   * the value itself is never read back, so without this an empty field would
   * be indistinguishable from "no password set". Never written to the wire.
   */
  hasStoredPassword?: boolean;
  [k: string]: unknown;
}

/** Pick the first defined+non-empty value across alias keys. */
function pickKey(ds: Record<string, unknown>, keys: ReadonlyArray<string>): unknown {
  for (const k of keys) {
    const v = ds[k];
    if (v !== undefined && v !== null && v !== '') { return v; }
  }
  return undefined;
}

/**
 * Normalize a server-side DataSource payload to canonical in-memory shape.
 * Accepts the names TM1 actually sends (`asciiDelimiterChar`, `query`) plus
 * historical aliases; produces canonical PascalCase names with sub-set fields
 * populated per Type.
 */
export function normalizeReadDataSource(ds: unknown): DataSource {
  if (!ds || typeof ds !== 'object') { return { Type: 'None' }; }
  const src = ds as Record<string, unknown>;
  const type: DataSourceType = ((src.Type as DataSourceType | undefined) ?? 'None');
  const out: DataSource = { Type: type };

  const nameForServer = pickKey(src, ['dataSourceNameForServer', 'DataSourceNameForServer']);
  if (nameForServer !== undefined) { out.dataSourceNameForServer = String(nameForServer); }
  const nameForClient = pickKey(src, ['dataSourceNameForClient', 'DataSourceNameForClient']);
  if (nameForClient !== undefined) { out.dataSourceNameForClient = String(nameForClient); }

  if (type === 'ASCII') {
    const delimiter = pickKey(src, ['asciiDelimiterChar', 'Delimiter', 'DataSourceASCIIDelimiter']);
    if (delimiter !== undefined) { out.Delimiter = String(delimiter); }
    const quote = pickKey(src, ['asciiQuoteCharacter', 'QuoteCharacter', 'DataSourceASCIIQuoteCharacter']);
    if (quote !== undefined) { out.QuoteCharacter = String(quote); }
    const dec = pickKey(src, ['asciiDecimalSeparator', 'DecimalSeparator', 'DataSourceASCIIDecimalSeparator']);
    if (dec !== undefined) { out.DecimalSeparator = String(dec); }
    const thou = pickKey(src, ['asciiThousandSeparator', 'ThousandSeparator', 'DataSourceASCIIThousandSeparator']);
    if (thou !== undefined) { out.ThousandSeparator = String(thou); }
    const header = pickKey(src, ['asciiHeaderRecords', 'NumberOfHeaderRecordsToSkip', 'HeaderRecords']);
    if (header !== undefined) { out.NumberOfHeaderRecordsToSkip = Number(header) || 0; }
    if (src.asciiDelimiterType !== undefined) { out._asciiDelimiterType = String(src.asciiDelimiterType); }
    // Read only: TM1 never sends this for ASCII, but a .pro-derived object can
    // carry it (file line 559). cleanDataSource drops it again before the wire,
    // because TM1 refuses the key for this type.
    if (src.usesUnicode !== undefined) { out.UsesUnicode = Boolean(src.usesUnicode); }
    else if (src.UsesUnicode !== undefined) { out.UsesUnicode = Boolean(src.UsesUnicode); }
  } else if (type === 'ODBC') {
    // TM1 11.8 spells these lowercase — `userName`, `query` (live-measured
    // 2026-08-16, odbcQueryProbe.js). The `odbc*` spellings this
    // list carried before matched nothing, so user and SQL query stayed blank in
    // the editor no matter what the process held.
    const user = pickKey(src, ['userName', 'odbcUserName', 'UserName', 'DataSourceUserName']);
    if (user !== undefined) { out.UserName = String(user); }
    // The password value is deliberately NOT read back into the form: TM1
    // returns it *encrypted* (`xxxxxxxxxxxxxxxx==`) and a ciphertext in a
    // visible field is neither useful nor safe to show. An empty field means
    // "keep what the server has" — safe because a DataSource PATCH merges (see
    // `cleanDataSource`). Note the ciphertext itself round-trips losslessly;
    // see `carryStoredPassword` for the one path that moves it.
    //
    // Whether one is *stored* does travel, as a flag: an empty field alone
    // cannot tell "we don't show it" from "there is none". TM1 sends `""` for
    // an unset password, so presence is decidable without exposing the value.
    // The flag never goes back on the wire — `cleanDataSource` only emits the
    // keys it knows.
    const storedPw = pickKey(src, ['password', 'odbcPassword', 'Password']);
    out.hasStoredPassword = typeof storedPw === 'string' && storedPw.length > 0;
    const query = pickKey(src, ['query', 'odbcQuery', 'Query', 'DataSourceQuery']);
    if (query !== undefined) { out.Query = String(query); }
    // `usesUnicode` is an ODBC-ONLY property (live-measured 2026-08-17,
    // odbcUnicodeProbe.js): accepted on POST and PATCH, read back
    // as sent, and a create that omits it comes back as `true`. For ASCII the
    // same key is rejected outright — see the ASCII branch of cleanDataSource.
    const uni = pickKey(src, ['usesUnicode', 'UsesUnicode']);
    if (uni !== undefined) { out.UsesUnicode = Boolean(uni); }
  } else if (type === 'TM1CubeView') {
    const view = pickKey(src, ['view', 'View', 'DataSourceView']);
    if (view !== undefined) { out.view = String(view); }
  } else if (type === 'TM1DimensionSubset') {
    const subset = pickKey(src, ['subset', 'Subset', 'DataSourceSubsetName']);
    if (subset !== undefined) { out.subset = String(subset); }
  }

  return out;
}

/**
 * Convert canonical in-memory DataSource back to TM1's PATCH wire shape:
 * camelCase, `ascii*`-prefixed for ASCII and bare lowercase for ODBC. Strips
 * undefined/empty fields. Unknown Type → bare `{ Type }`.
 *
 * Stripping empty fields is what makes an omitted password safe: TM1 merges a
 * DataSource PATCH (unnamed sub-fields keep their server value, measured
 * 2026-08-16), so leaving `password` out preserves the stored one.
 */
export function cleanDataSource(ds: DataSource): DataSource {
  const out: DataSource & Record<string, unknown> = { Type: ds.Type };
  switch (ds.Type) {
    case 'ASCII':
      assignIfSet(out, 'dataSourceNameForServer', ds.dataSourceNameForServer);
      assignIfDefined(out, 'dataSourceNameForClient', ds.dataSourceNameForClient);
      assignIfSet(out, 'asciiDelimiterChar', ds.Delimiter);
      assignIfSet(out, 'asciiDelimiterType', ds._asciiDelimiterType ?? 'Character');
      assignIfDefined(out, 'asciiQuoteCharacter', ds.QuoteCharacter);
      assignIfSet(out, 'asciiDecimalSeparator', ds.DecimalSeparator);
      assignIfSet(out, 'asciiThousandSeparator', ds.ThousandSeparator);
      if (ds.NumberOfHeaderRecordsToSkip !== undefined) {
        out.asciiHeaderRecords = Number(ds.NumberOfHeaderRecordsToSkip) || 0;
      }
      // NO usesUnicode here: TM1 11.8 rejects it for an ASCII source with
      // `400 code 248 … unprocessed properties were: "usesUnicode"` on POST and
      // PATCH alike, taking the whole payload — process code included — with it
      // (measured 2026-08-17). Real ASCII processes never carry it on read-back
      // either; the flag lives only in the .pro file (line 559) for that type.
      break;
    case 'ODBC':
      // Lowercase, exactly as TM1 reads them back. `odbcQuery`/`odbcUserName`/
      // `odbcPassword` are rejected outright — the whole PATCH fails with
      // `400 code 248 "Invalid data source properties … unprocessed properties
      // were: "odbcPassword" "odbcQuery" "odbcUserName""`, taking the process
      // code down with it. `Query` capitalized fails the same way.
      assignIfSet(out, 'dataSourceNameForServer', ds.dataSourceNameForServer);
      assignIfDefined(out, 'dataSourceNameForClient', ds.dataSourceNameForClient);
      assignIfSet(out, 'userName', ds.UserName);
      assignIfSet(out, 'password', ds.Password);
      assignIfSet(out, 'query', ds.Query);
      if (ds.UsesUnicode !== undefined) { out.usesUnicode = ds.UsesUnicode; }
      break;
    case 'TM1CubeView':
      assignIfSet(out, 'dataSourceNameForServer', ds.dataSourceNameForServer);
      assignIfDefined(out, 'dataSourceNameForClient', ds.dataSourceNameForClient);
      assignIfSet(out, 'view', ds.view);
      break;
    case 'TM1DimensionSubset':
      assignIfSet(out, 'dataSourceNameForServer', ds.dataSourceNameForServer);
      assignIfDefined(out, 'dataSourceNameForClient', ds.dataSourceNameForClient);
      assignIfSet(out, 'subset', ds.subset);
      break;
    case 'None':
    default:
      break;
  }
  return out;
}

/**
 * Carry an ODBC password from a source process into a *wire-shaped* payload
 * that is about to create a different process ("Save as…", copy).
 *
 * The merge semantics that make an omitted password safe on a normal save
 * (`cleanDataSource`) have nothing to merge with when the target process does
 * not exist yet — the copy would land without a password. TM1 hands the stored
 * password out encrypted, but the ciphertext travels: live-measured on 11.8
 * (2026-08-17, odbcPasswordCrossProcessProbe.js) the same
 * plaintext yields the same ciphertext in two unrelated processes, and writing
 * that ciphertext into a third process — by PATCH *or* by POST — stores it
 * byte-identically instead of encrypting it a second time. Copying the
 * ciphertext over is therefore equivalent to retyping the password.
 *
 * Only fills a gap: a password the user actually typed into the form wins, and
 * a source without a stored password leaves the payload untouched (so an
 * overwrite keeps whatever the target already had).
 *
 * `wire` must already be `cleanDataSource` output — the key is the lowercase
 * wire name `password`, not the canonical `Password`.
 */
// Generic over the payload shape on purpose: the callers hold the *transport*
// `DataSource` (a wider union, `tm1Rest/transport/types`), and widening this
// module's own type to match would drag the wire-name knowledge apart. The two
// fields touched here are identical in both.
export function carryStoredPassword<T extends { Type?: string; password?: unknown }>(
  wire: T,
  sourcePassword: unknown,
): T {
  if (wire.Type !== 'ODBC') { return wire; }
  if (typeof wire.password === 'string' && wire.password !== '') { return wire; }
  if (typeof sourcePassword !== 'string' || sourcePassword === '') { return wire; }
  return { ...wire, password: sourcePassword };
}

/**
 * Every spelling a stored ODBC password can arrive under: the canonical
 * PascalCase name of this codebase, the lowercase name TM1 actually sends on
 * the wire, and the historical alias.
 */
const PASSWORD_KEYS = ['Password', 'password', 'odbcPassword'] as const;

/**
 * Strip the ODBC password from a datasource before it is written to a FILE.
 *
 * TM1 hands the password out encrypted, but that ciphertext is not a
 * server-bound secret: live-measured on 11.8 (2026-08-17,
 * odbcPasswordCrossProcessProbe.js) it is deterministic and
 * process-independent, and writing it back — by PATCH *or* by POST — stores it
 * as-is instead of encrypting it again. See `carryStoredPassword` above, which
 * exploits exactly that to copy a password between processes. The flip side is
 * that a ciphertext in an exported file is a portable database credential:
 * anyone who can read the file can paste it into their own process on their own
 * TM1 and connect, without ever learning the plaintext. Committed to git it
 * additionally survives in the history.
 *
 * So: never serialize it. Both export paths (`.pro` via
 * `commands/processEditor/loadProcesses#buildProFile`, git via
 * `git/serializer#serializeProcess`) route their datasource through here.
 * Nothing is lost on re-deploy — the `DataSource` PATCH merges, so an
 * overwrite keeps the password the target process already holds; only a
 * genuinely new process needs it typed once.
 *
 * Generic for the same reason as `carryStoredPassword`: callers hold either
 * this module's `DataSource` or the wider transport one.
 */
export function redactPassword<T extends object>(ds: T): T {
  if (!ds || typeof ds !== 'object') { return ds; }
  const out = { ...(ds as Record<string, unknown>) };
  for (const key of PASSWORD_KEYS) { delete out[key]; }
  return out as T;
}

/** Set `out[key] = value` unless value is undefined/null/empty-string. */
export function assignIfSet(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') {
    out[key] = value;
  }
}

/**
 * Like `assignIfSet`, but keeps an empty string. For the client file name and
 * the quote character, empty is a value: TM1 fills in its own default when the
 * key is missing (client = server name, quote = `"`), so dropping `""` changed
 * 16 + 2 of 366 processes on a round trip (measured 2026-10-14, 11.8 and v12).
 */
function assignIfDefined(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    out[key] = value;
  }
}

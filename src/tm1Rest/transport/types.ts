// src/tm1Rest/transport/types.ts
// Shared TM1 REST transport types. No runtime dependencies — type-only module.

export type AuthType = 'Basic' | 'CAM' | 'integrated' | 'v12-basic' | 'browser';

export interface TiSections {
  prolog:   string;
  metadata: string;
  data:     string;
  epilog:   string;
}

export type DataSourceType =
  | 'None' | 'ODBC' | 'ASCII' | 'TM1CubeView' | 'TM1DimensionSubset' | 'TM1CubeViewAsDataSource';

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
  // Wire names. TM1 uses these on GET *and* on create/PATCH — the PascalCase
  // names above are this codebase's canonical shape, not a server spelling
  // (measured 11.8, 2026-08-16). An unknown key is NOT ignored: TM1 answers
  // `400 code 248 "Invalid data source properties supplied…"` and drops the
  // whole request. Build payloads via `utils/dataSourceWire#cleanDataSource`.
  asciiDelimiterType?: string;
  asciiDelimiterChar?: string;
  asciiQuoteCharacter?: string;
  asciiDecimalSeparator?: string;
  asciiThousandSeparator?: string;
  asciiHeaderRecords?: number;
}

export interface V12Config {
  /** Gateway instance name, e.g. "tm1". For 'saas': the tenant id. */
  instance: string;
  /** Database name inside the instance, e.g. "tm1_v12_test". */
  database: string;
  /**
   * How the session cookie is minted. 'saas' = Planning Analytics as a
   * Service: no mint, Basic `apikey:<key>` on the first call, the server's
   * `paSession` cookie afterwards.
   */
  authMode: 'basic-s2s' | 'basic-native' | 'saas';
  /** TM1 user to log in as — the {User} body of the session POST. */
  tm1User: string;
}

/** V12Config narrowed for the browser login against PA SaaS. */
export type V12SaasModeConfig = V12Config & { authMode: 'saas' };

/**
 * Non-auth connection fields shared by every auth mode. `Tm1Config` is this
 * base intersected with the `Tm1Auth` discriminated union — so `authType`
 * narrows which of `camNamespace` / `version` / `v12` are present and required.
 */
export interface Tm1ConfigBase {
  serverUrl:          string;
  username:           string;
  password:           string;
  rejectUnauthorized: boolean;
  /**
   * Set: the model is read and written THROUGH THE EYES of this TM1 user
   * (`TM1-Impersonate`). The logged-in user must be an administrator, and
   * this only applies to v11 — v12 has no such header.
   *
   * The value belongs in the session cache key (`_sessionCacheKey`): an
   * impersonated session is a DIFFERENT session, otherwise the impersonation
   * would keep running over one's own cookie and would keep showing one's
   * own permissions.
   */
  impersonate?:       string;
}

/**
 * Discriminated union on `authType` that makes invalid auth states
 * unrepresentable:
 *   - Basic       → no namespace, no v12 (authType may be omitted ≡ 'Basic').
 *   - CAM         → camNamespace REQUIRED (was silently `?? ''` → opaque 401).
 *   - integrated  → Windows authentication (Kerberos/NTLM). v11 ONLY:
 *                   `version` can only be 'v11', `v12` is excluded. In v12
 *                   the session comes from `/{instance}/auth/v1/session`,
 *                   where there is no SPNEGO — a `version: 'v12'` with this
 *                   auth type is therefore not representable.
 *   - v12-basic   → version 'v12' + a v12 config (basic-s2s | basic-native).
 *   - browser     → login in the user's browser, REST with its cookies
 *                   (transport/browserLogin.ts). Two shapes: PAW (v11,
 *                   `serverUrl = <paw>/api/v1/tm1/<instance>`) or PA SaaS
 *                   (version 'v12', authMode 'saas'). The URL shape of the PAW
 *                   form is not a type; buildTm1Config checks it.
 * Every member declares all four auth fields (absent ones as `?: undefined`)
 * so `cfg.camNamespace` / `cfg.version` / `cfg.v12` stay accessible union-wide
 * while `authType` still narrows their presence.
 */
export type Tm1Auth =
  | { authType?: 'Basic';     camNamespace?: undefined; version?: 'v11'; v12?: undefined }
  | { authType:  'CAM';       camNamespace:  string;    version?: 'v11'; v12?: undefined }
  | { authType:  'integrated'; camNamespace?: undefined; version?: 'v11'; v12?: undefined; spn?: string }
  | { authType:  'v12-basic'; camNamespace?: undefined; version:  'v12'; v12:  V12Config }
  | { authType:  'browser';   camNamespace?: undefined; version?: 'v11'; v12?: undefined }
  | { authType:  'browser';   camNamespace?: undefined; version:  'v12'; v12:  V12SaasModeConfig };

/**
 * Resolved TM1 connection config. `Tm1ConfigBase & Tm1Auth` — construction is
 * only compile-honest through the valid `Tm1Auth` shapes; build it at the
 * boundary via `buildTm1Config` (transport/authConfig) which validates/throws
 * on invalid combos rather than forcing partial form/profile state in.
 */
export type Tm1Config = Tm1ConfigBase & Tm1Auth;

/**
 * Response of a session-aware request. `v12MintFailure` is set when the v12
 * session mint failed, so the actual request never ran: the status then
 * belongs to the gateway, not to the requested resource.
 */
export interface Tm1Response<B> {
  statusCode: number;
  body: B;
  v12MintFailure?: { status: number; detail?: string; code?: string };
}

/** Typed process parameter (used by deployProcess). */
export interface ProcessParameter {
  Name: string;
  Type: 'Numeric' | 'String';
  /** A number for a Numeric parameter: TM1 11.8 types the parameter by the
   *  JSON type of Value, so `"0"` turns it into a String (measured 2026-10-14). */
  Value: string | number;
  Prompt: string;
}

/**
 * Typed process variable (used by deployProcess).
 *
 * `Ignored` is an editor-side field, not a wire field: a column with
 * Contents="Ignore" has no entry in the REST `Variables` collection at all and
 * lives purely in `VariablesUIData`. `deployProcess` splits the list back into
 * the two properties TM1 expects — see `utils/processVariablesUi.ts`.
 */
export interface ProcessVariable {
  Name: string;
  Type: 'Numeric' | 'String';
  Position: number;
  StartByte: number;
  EndByte: number;
  /** Contents = "Ignore": the column is skipped and invisible to the TI code. */
  Ignored?: boolean;
  /** Original `VariablesUIData` entry, carried through so unknown fields survive. */
}

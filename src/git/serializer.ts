import type { DataSource, ProcessParameter, ProcessVariable } from '../tm1Rest/transport/types';
import { redactPassword } from '../utils/dataSourceWire';
import { joinSections, splitSections, type TiSections } from './sectionMarkers';

export interface TM1Process extends TiSections {
  name: string;
  /**
   * `undefined` means "the header file says nothing about it", `[]` means "no
   * parameters". The difference carries through to the push: an invented `[]`
   * would delete the parameters on the server. Same contract as
   * `variablesUiData`.
   */
  parameters?: ProcessParameter[];
  variables: ProcessVariable[];
  dataSource: DataSource;
  hasSecurity?: boolean;
  /**
   * The two undeclared lists from TM1 — ONE each per process, not one
   * per variable. `variablesUiData` carries one row per SOURCE COLUMN (including the
   * ignored ones, which do not appear in `Variables` at all), `uiData` the
   * wizard state from Architect. Both sit outside the
   * default projection; a GET without `$select` does not return them.
   *
   * `undefined` means "unknown, do not touch" and is not the same as
   * `[]`/`''` — it decides whether the push sends them along. Old header files from
   * the time before 2026-08-30 do not have them.
   */
  variablesUiData?: string[];
  uiData?: string;
  /**
   * Write TM1 12's native layout instead of 11.x's: other `.ti` line breaks and
   * header key order (`joinSections`, `serializeProcess`). Comes from the
   * server the process belongs to, never from the files.
   */
  v12?: boolean;
}

// Header keys mirror the TM1 REST / OData `Processes(...)` wire shape exactly
// (PascalCase `Name`/`Parameters`/`DataSource`/`Variables`/`HasSecurityAccess`),
// so a git-stored process reads the same as the server payload — no extra
// envelope fields.
interface ProcessHeader {
  Name?: string;
  Parameters?: ProcessParameter[];
  DataSource?: DataSource;
  Variables?: ProcessVariable[];
  /** TM1 REST process property — full access regardless of executing user. */
  HasSecurityAccess?: boolean;
  /** One row per source column (U+000C-separated fields) — see `TM1Process`. */
  VariablesUIData?: string[];
  /** Architect-Assistentenzustand, ein String je Prozess — s. `TM1Process`. */
  UIData?: string;
  // --- Legacy read-only fallbacks ---
  // v1/v2 used lowercase wrapper keys; v1 additionally nested security under
  // uiState.hasSecurity. Kept so old checked-in files still parse.
  name?: string;
  parameters?: ProcessParameter[];
  datasource?: DataSource;
  variables?: ProcessVariable[];
  uiState?: { hasSecurity?: boolean };
}

// Normalize a parameter object to the exact TM1 REST / OData key order
// (`Name → Prompt → Value → Type`, verified live against TM1 11.8). The webview
// save path rebuilds parameters in a different key order; normalizing here keeps
// git-stored processes byte-consistent with a server-fetched payload regardless
// of which path produced them. Extra keys (should be none) are preserved last.
function orderParameter(p: ProcessParameter): ProcessParameter {
  const { Name, Prompt, Value, Type, ...rest } = p;
  return { Name, Prompt, Value, Type, ...rest };
}

// Same for a variable object: TM1 order is `Name → Type → Position → StartByte
// → EndByte` (verified live).
function orderVariable(v: ProcessVariable): ProcessVariable {
  const { Name, Type, Position, StartByte, EndByte, ...rest } = v;
  return { Name, Type, Position, StartByte, EndByte, ...rest };
}

export function serializeProcess(p: TM1Process): { tiText: string; headerJson: string } {
  // Byte-identical to `GET Processes('x')/Code/$value` of the process's own
  // server version: native markers and CRLF, so the extension and
  // tm1-mcp-server write the same file for the same process.
  const lf = (s: string) => s.replace(/\r\n/g, '\n');
  const tiText = joinSections({
    prolog: lf(p.prolog),
    metadata: lf(p.metadata),
    data: lf(p.data),
    epilog: lf(p.epilog),
  }, p.v12).replace(/\n/g, '\r\n');

  // The header is the REST response to `PROCESS_FULL_SELECT` minus the code
  // fields, `Attributes` (only `Caption`, equal to the name in 366 of 366
  // processes) and the password, in the server's own key order, independent of
  // the `$select` order. 11.8 puts UIData and VariablesUIData right after
  // HasSecurityAccess (366/366), 12.5.9 at the very end. On 12 the order of the
  // two lists among themselves is NOT fixed: 92 processes came with UIData
  // first, one the other way round (stable per process, the same for any
  // `$select` order and for the collection GET; measured 2026-10-12). We always
  // write UIData first, so a file does not change when the server flips the pair.
  // `undefined` drops out on serialization: a header file only gets the two
  // lists when the server sent them, instead of claiming an empty field.
  const uiLists = { UIData: p.uiData, VariablesUIData: p.variablesUiData };
  const header: ProcessHeader = {
    Name: p.name,
    HasSecurityAccess: !!p.hasSecurity,
    ...(p.v12 ? {} : uiLists),
    // Password stripped: the ciphertext is portable across servers, so it must
    // not land in a repo. See `utils/dataSourceWire#redactPassword`.
    DataSource: redactPassword(p.dataSource),
    ...(p.parameters === undefined ? {} : { Parameters: p.parameters.map(orderParameter) }),
    Variables: (p.variables ?? []).map(orderVariable),
    ...(p.v12 ? uiLists : {}),
  };
  const headerJson = JSON.stringify(header, null, 2) + '\n';
  return { tiText, headerJson };
}

export function serializeRules(rulesText: string): string {
  return rulesText;
}

export function parseRules(rulesText: string): string {
  return rulesText;
}

export function parseProcess(tiText: string, headerJson: string, v12 = false): TM1Process {
  const header = JSON.parse(headerJson) as ProcessHeader;
  // Sanity guard (no version field): a valid header must carry a process name
  // under the current TM1-OData `Name` key or the legacy lowercase `name`.
  const headerName = header.Name ?? header.name;
  if (typeof headerName !== 'string' || headerName.length === 0) {
    throw new Error('Invalid process header: missing Name');
  }
  const sections = splitSections(tiText, v12);
  if (!sections) {
    throw new Error('Invalid process code file: damaged #region/#endregion markers');
  }
  return {
    ...sections,
    // Current files use TM1-OData PascalCase keys; legacy files used lowercase.
    name: headerName,
    // NO `?? []`: a header file without a `Parameters` key says nothing
    // about parameters, one with `"Parameters": []` says "none". An invented
    // empty field would delete the server parameters on push.
    parameters: header.Parameters ?? header.parameters,
    variables: header.Variables ?? header.variables ?? [],
    dataSource: (header.DataSource ?? header.datasource) as DataSource,
    // v2/v3 store it top-level; v1 nested it under uiState.hasSecurity.
    hasSecurity: header.HasSecurityAccess ?? header.uiState?.hasSecurity ?? false,
    // Deliberately WITHOUT a default value: if the field is missing (header files before 2026-08-30),
    // it stays `undefined` and the push leaves the server list alone. A
    // `[]` here would delete the ignore markers on the server.
    variablesUiData: header.VariablesUIData,
    uiData: header.UIData,
  };
}
